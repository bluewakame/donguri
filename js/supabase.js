// ===========================
// 匿名認証（ゲームユーザー）
// ===========================

let authToken  = localStorage.getItem("authToken");
let authUserId = localStorage.getItem("authUserId");

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now() + 60000; // 1分前に期限切れとみなす
  } catch (_) {
    return true;
  }
}

async function refreshAuthToken() {
  const refreshToken = localStorage.getItem("authRefreshToken");
  if (!refreshToken) { authToken = null; authUserId = null; return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    authToken = data.access_token;
    if (data.refresh_token) localStorage.setItem("authRefreshToken", data.refresh_token);
    localStorage.setItem("authToken", authToken);
  } catch (_) {
    authToken  = null;
    authUserId = null;
    localStorage.removeItem("authToken");
    localStorage.removeItem("authRefreshToken");
    localStorage.removeItem("authUserId");
  }
}

async function ensureAuth() {
  if (authToken && authUserId) {
    if (!isTokenExpired(authToken)) return;
    await refreshAuthToken();
    if (authToken && authUserId) return;
  }
  // 新規匿名サインイン
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} })
  });
  if (!res.ok) throw new Error("匿名認証に失敗しました");
  const data = await res.json();
  authToken  = data.access_token;
  authUserId = data.user.id;
  localStorage.setItem("authToken",        authToken);
  localStorage.setItem("authRefreshToken", data.refresh_token);
  localStorage.setItem("authUserId",       authUserId);
}

// ===========================
// ゲームデータ CRUD
// ===========================

async function sbGet(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?user_key=eq.${encodeURIComponent(userId)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + authToken } }
  );
  const data = await res.json();
  return data[0] || null;
}

async function sbUpsert(userId, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + authToken,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ user_key: userId, ...fields })
  });
}

async function sbDelete(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?user_key=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + authToken } }
  );
  if (!res.ok) throw new Error("削除に失敗しました");
}

// ===========================
// 来店ログ（サーバー側重複排除対応）
// ===========================

/**
 * 来店ログをサーバーに記録する。
 * unique制約 (user_id, shop_id, date(scanned_at + 9h)) により
 * 1ユーザー・1店舗・1日1回のみ成功する（JST基準）。
 *
 * @param {string} shopId
 * @param {string} rewardType
 * @param {{lat: number, lng: number}|null} latLng - プレイヤーGPS座標
 * @returns {Promise<{success: boolean, alreadyVisited: boolean}>}
 */
async function sbLogVisit(shopId, rewardType, latLng) {
  try {
    await ensureAuth();
    const body = {
      user_id:     authUserId,
      shop_id:     shopId,
      reward_type: rewardType,
      lat:         latLng ? latLng.lat : null,
      lng:         latLng ? latLng.lng : null,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/visit_logs`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + authToken,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      // unique制約違反 → 今日すでに訪問済み
      return { success: false, alreadyVisited: true };
    }
    if (!res.ok) {
      console.warn("来店ログ記録失敗 HTTP:", res.status);
      return { success: false, alreadyVisited: false };
    }
    return { success: true, alreadyVisited: false };
  } catch (e) {
    console.warn("来店ログの送信に失敗:", e);
    return { success: false, alreadyVisited: false };
  }
}

// ===========================
// お店 CRUD（Supabase 同期）
// ===========================

/**
 * 店舗オーナートークンをリフレッシュする。
 * リフレッシュトークンがない or 失敗した場合はセッションをクリアして例外を投げる。
 */
async function refreshShopOwnerToken() {
  if (!shopOwnerRefreshToken) {
    shopOwnerToken = null;
    sessionStorage.removeItem("shopOwnerToken");
    throw new Error("セッションが期限切れです。再度ログインしてください。");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: shopOwnerRefreshToken }),
  });
  if (!res.ok) {
    shopOwnerToken = null;
    shopOwnerRefreshToken = null;
    sessionStorage.removeItem("shopOwnerToken");
    sessionStorage.removeItem("shopOwnerRefreshToken");
    throw new Error("セッションが期限切れです。再度ログインしてください。");
  }
  const data = await res.json();
  shopOwnerToken = data.access_token;
  sessionStorage.setItem("shopOwnerToken", shopOwnerToken);
  if (data.refresh_token) {
    shopOwnerRefreshToken = data.refresh_token;
    sessionStorage.setItem("shopOwnerRefreshToken", shopOwnerRefreshToken);
  }
}

/**
 * 店舗オーナートークンが有効であることを保証する。
 * 期限切れの場合はリフレッシュを試みる。
 */
async function ensureShopOwnerAuth() {
  if (!shopOwnerToken) throw new Error("ログインが必要です。");
  if (isTokenExpired(shopOwnerToken)) await refreshShopOwnerToken();
}

/**
 * お店情報を Supabase に保存（追加・更新）する。
 * shopOwnerToken が必要（RLS: owner_id = auth.uid()）。
 */
async function sbSaveShop(shop) {
  await ensureShopOwnerAuth();
  let ownerId = null;
  try { ownerId = JSON.parse(atob(shopOwnerToken.split(".")[1])).sub; } catch (_) {}
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shops`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + shopOwnerToken,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: shop.id, name: shop.name, lat: shop.lat, lng: shop.lng, owner_id: ownerId }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("お店の保存に失敗しました: " + err);
  }
}

/**
 * お店を Supabase から削除する。
 * shopOwnerToken が必要（RLS: owner_id = auth.uid()）。
 */
async function sbDeleteShop(shopId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/shops?id=eq.${encodeURIComponent(shopId)}`,
    { method: "DELETE", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + shopOwnerToken } }
  );
  if (!res.ok) throw new Error("お店の削除に失敗しました");
}

/**
 * Supabase から全お店を取得する（全プレイヤー向け）。
 */
async function sbLoadShops() {
  const token = authToken || SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shops?select=id,name,lat,lng`, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("お店の取得に失敗しました");
  return await res.json();
}

/**
 * 店舗の来客統計を取得する。
 * 今日・昨日・累計と昨日比トレンドを返す。
 */
async function sbGetVisitStats(shopId) {
  const token = shopOwnerToken || authToken;
  if (!token) return { today: "–", total: "–", yesterday: "–", trend: "" };
  try {
    const nowJst         = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayJst       = nowJst.toISOString().slice(0, 10);
    const todayStart     = `${todayJst}T00:00:00+09:00`;
    const yesterdayDate  = new Date(nowJst.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterdayStart = `${yesterdayDate}T00:00:00+09:00`;

    const base = `${SUPABASE_URL}/rest/v1/visit_logs?shop_id=eq.${encodeURIComponent(shopId)}&select=id&limit=1`;
    const headers = { apikey: SUPABASE_KEY, Authorization: "Bearer " + token, Prefer: "count=exact" };

    const [resDay, resAll, resYesterday] = await Promise.all([
      fetch(`${base}&scanned_at=gte.${encodeURIComponent(todayStart)}`, { headers }),
      fetch(base, { headers }),
      fetch(
        `${base}&scanned_at=gte.${encodeURIComponent(yesterdayStart)}&scanned_at=lt.${encodeURIComponent(todayStart)}`,
        { headers }
      ),
    ]);

    const parseCount = res => {
      const cr = res.headers.get("Content-Range") || "";
      const n  = parseInt(cr.split("/")[1]);
      return isNaN(n) ? "–" : n;
    };

    const todayCount     = parseCount(resDay);
    const yesterdayCount = parseCount(resYesterday);
    const trend = (typeof todayCount === "number" && typeof yesterdayCount === "number")
      ? (todayCount > yesterdayCount ? "📈" : todayCount < yesterdayCount ? "📉" : "→")
      : "";

    return { today: todayCount, total: parseCount(resAll), yesterday: yesterdayCount, trend };
  } catch (e) {
    console.warn("来店統計の取得に失敗:", e);
    return { today: "–", total: "–", yesterday: "–", trend: "" };
  }
}
