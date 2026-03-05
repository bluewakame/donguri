// ===========================
// お店管理
// ===========================

let shops         = [];
let editingShopId = null;

function loadShops() {
  try {
    shops = JSON.parse(localStorage.getItem("managedShops") || "[]");
  } catch (e) {
    shops = [];
  }
}

function saveShopsToStorage() {
  localStorage.setItem("managedShops", JSON.stringify(shops));
}

function renderShopList() {
  const list  = document.getElementById("shop-list");
  const empty = document.getElementById("shop-empty");
  list.innerHTML = "";

  if (shops.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  shops.forEach(shop => {
    const safeId   = escapeHtml(shop.id);
    const safeName = escapeHtml(shop.name);
    const hasGps   = shop.lat != null && shop.lng != null;

    const card = document.createElement("div");
    card.className = "shop-mgmt-card";
    card.innerHTML = `
      <div class="shop-mgmt-info">
        <span class="shop-mgmt-name">${safeName}</span>
        <span class="shop-mgmt-id">ID: ${safeId}${hasGps ? " 📍" : " <span class=\"no-gps-badge\">GPS未設定</span>"}</span>
        <span class="shop-visit-stats" id="vstats-${safeId}">📊 集計中...</span>
      </div>
      <div class="shop-mgmt-actions">
        <button class="shop-action-btn qr-btn" onclick="showShopQR('${safeId}')">QR</button>
        <button class="shop-action-btn edit-btn" onclick="openEditShopModal('${safeId}')">編集</button>
        <button class="shop-action-btn del-btn" onclick="deleteShop('${safeId}')">削除</button>
      </div>
    `;
    list.appendChild(card);

    // 非同期で来客数を取得して表示（今日・昨日・累計・トレンド）
    sbGetVisitStats(shop.id).then(stats => {
      const el = document.getElementById("vstats-" + shop.id);
      if (!el) return;
      const trendText = stats.trend ? ` ${stats.trend}` : "";
      el.textContent = `📊 今日: ${stats.today}件 / 昨日: ${stats.yesterday}件${trendText} / 累計: ${stats.total}件`;
    });
  });
}

// ===========================
// お店追加・編集モーダル
// ===========================

let shopModalLat = null;
let shopModalLng = null;

function getLocationForShop() {
  const locMsg = document.getElementById("shop-location-msg");
  const btn    = document.getElementById("getLocationBtn");
  locMsg.textContent = "📍 現在地を取得中...";
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    function (pos) {
      shopModalLat = pos.coords.latitude;
      shopModalLng = pos.coords.longitude;
      locMsg.textContent = `📍 取得しました（${shopModalLat.toFixed(5)}, ${shopModalLng.toFixed(5)}）`;
      btn.disabled = false;
    },
    function (err) {
      let msg = "📍 現在地を取得できませんでした";
      if (err.code === 1) msg = "📍 位置情報の許可が必要です（ブラウザの設定を確認）";
      locMsg.textContent = msg;
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function openAddShopModal() {
  if (!isShopOwnerLoggedIn()) { openAuthModal(false); return; }

  editingShopId = null;
  shopModalLat  = null;
  shopModalLng  = null;
  document.getElementById("addShopTitle").textContent = "🏪 お店を追加";
  document.getElementById("shopNameInput").value = "";
  document.getElementById("shopIdInput").value = "";
  document.getElementById("shopIdInput").disabled = false;
  document.getElementById("shop-form-msg").textContent = "";
  document.getElementById("getLocationBtn").style.display = "block";

  const locMsg = document.getElementById("shop-location-msg");
  // 森ページですでに位置取得済みなら使う
  if (playerMarker) {
    const ll = playerMarker.getLatLng();
    shopModalLat = ll.lat;
    shopModalLng = ll.lng;
    locMsg.textContent = `📍 現在地: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  } else {
    locMsg.textContent = "「📍 現在地を取得」ボタンで位置を設定してください";
  }

  document.getElementById("addShopModal").style.display = "block";
  document.getElementById("addShopOverlay").style.display = "block";
  document.getElementById("shopNameInput").focus();
}

function openEditShopModal(shopId) {
  if (!isShopOwnerLoggedIn()) { openAuthModal(false); return; }

  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  editingShopId = shopId;
  shopModalLat  = shop.lat ?? null;
  shopModalLng  = shop.lng ?? null;
  document.getElementById("addShopTitle").textContent = "🏪 お店を編集";
  document.getElementById("shopNameInput").value = shop.name;
  document.getElementById("shopIdInput").value = shop.id;
  document.getElementById("shopIdInput").disabled = true;
  document.getElementById("shop-form-msg").textContent = "";
  document.getElementById("getLocationBtn").style.display = "block";

  const locMsg = document.getElementById("shop-location-msg");
  if (shop.lat != null && shop.lng != null) {
    locMsg.textContent = `📍 登録済み位置（${shop.lat.toFixed(5)}, ${shop.lng.toFixed(5)}）`;
  } else {
    locMsg.textContent = "「📍 現在地を取得」ボタンで位置を設定してください";
  }
  document.getElementById("addShopModal").style.display = "block";
  document.getElementById("addShopOverlay").style.display = "block";
  document.getElementById("shopNameInput").focus();
}

function closeAddShopModal() {
  document.getElementById("addShopModal").style.display = "none";
  document.getElementById("addShopOverlay").style.display = "none";
}

async function saveShop() {
  const name = document.getElementById("shopNameInput").value.trim();
  const id   = document.getElementById("shopIdInput").value.trim();
  const msg  = document.getElementById("shop-form-msg");

  if (!name) { msg.textContent = "❌ お店の名前を入力してください"; return; }
  if (name.length > 30) { msg.textContent = "❌ お店の名前は30文字以内で入力してください"; return; }
  if (!editingShopId) {
    if (!id) { msg.textContent = "❌ お店のIDを入力してください"; return; }
    if (id.length > 30) { msg.textContent = "❌ IDは30文字以内で入力してください"; return; }
    if (!/^[a-zA-Z0-9\-_]+$/.test(id)) {
      msg.textContent = "❌ IDは英数字・ハイフン・アンダースコアのみ使えます";
      return;
    }
    if (shops.some(s => s.id === id)) {
      msg.textContent = "❌ このIDはすでに使われています";
      return;
    }
    if (shopModalLat === null || shopModalLng === null) {
      msg.textContent = "❌ 「📍 現在地を取得」ボタンで位置を設定してください（QRスキャン時のGPS検証に使用）";
      return;
    }
    shops.push({ id, name, lat: shopModalLat, lng: shopModalLng, createdAt: Date.now() });
  } else {
    const shop = shops.find(s => s.id === editingShopId);
    if (shop) {
      shop.name = name;
      // 位置情報が更新されていれば上書き
      if (shopModalLat !== null) shop.lat = shopModalLat;
      if (shopModalLng !== null) shop.lng = shopModalLng;
    }
  }

  saveShopsToStorage();

  // Supabase に保存（他のプレイヤーへの公開）
  const savedShop = editingShopId
    ? shops.find(s => s.id === editingShopId)
    : shops[shops.length - 1];

  msg.textContent = "⏳ サーバーに保存中...";
  try {
    await sbSaveShop(savedShop);
  } catch (e) {
    console.warn("Supabaseへのお店保存に失敗:", e);
    msg.style.color = "#c0392b";
    msg.textContent = "❌ サーバーへの保存に失敗しました: " + e.message;
    return;
  }

  renderShopList();
  closeAddShopModal();

  // 地図が初期化済みなら店舗マーカーを再描画
  if (mapInitialized) {
    spawnShops();
  }
}

async function deleteShop(shopId) {
  if (!isShopOwnerLoggedIn()) { openAuthModal(false); return; }
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  if (!confirm(`「${shop.name}」を削除しますか？`)) return;
  shops = shops.filter(s => s.id !== shopId);
  saveShopsToStorage();
  renderShopList();

  // Supabase から削除（他のプレイヤーの地図から除去）
  try {
    await sbDeleteShop(shopId);
  } catch (e) {
    console.warn("Supabaseからのお店削除に失敗:", e);
  }

  if (mapInitialized) {
    spawnShops();
  }
}

// ===========================
// QRコード表示（時間窓付き）
// ===========================

let qrCountdownTimer = null;
let qrRefreshShopId  = null;

function showShopQR(shopId) {
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;

  qrRefreshShopId = shopId;
  document.getElementById("qrShopName").textContent = shop.name;
  document.getElementById("qrDisplayModal").style.display  = "block";
  document.getElementById("qrDisplayOverlay").style.display = "block";

  renderTimedQR(shop);
  startQrCountdown(shop);
}

function renderTimedQR(shop) {
  const win  = currentQrWindow();
  const text = `donguri:${shop.id}:${win}`;

  document.getElementById("qrShopId").textContent = text;

  const wrap = document.getElementById("qrCanvas");
  wrap.innerHTML = "";
  new QRCode(wrap, {
    text,
    width:  200,
    height: 200,
    colorDark:  "#2c3e50",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

function startQrCountdown(shop) {
  if (qrCountdownTimer) clearInterval(qrCountdownTimer);

  const countEl = document.getElementById("qrCountdown");

  function tick() {
    const elapsed   = Math.floor(Date.now() / 1000) % QR_WINDOW_SEC;
    const remaining = QR_WINDOW_SEC - elapsed;
    countEl.textContent = `🔄 ${remaining}秒後に更新`;
    if (remaining <= 1) renderTimedQR(shop);
  }

  tick();
  qrCountdownTimer = setInterval(tick, 1000);
}

function closeQrDisplay() {
  document.getElementById("qrDisplayModal").style.display  = "none";
  document.getElementById("qrDisplayOverlay").style.display = "none";
  if (qrCountdownTimer) {
    clearInterval(qrCountdownTimer);
    qrCountdownTimer = null;
  }
  qrRefreshShopId = null;
}

// ===========================
// 店舗オーナー認証
// ===========================

let shopOwnerToken        = sessionStorage.getItem("shopOwnerToken")        || null;
let shopOwnerEmail        = sessionStorage.getItem("shopOwnerEmail")        || null;
let shopOwnerRefreshToken = sessionStorage.getItem("shopOwnerRefreshToken") || null;

async function sbSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "ログインに失敗しました");
  return data;
}

async function sbSignUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "登録に失敗しました");
  return data;
}

function isShopOwnerLoggedIn() {
  if (!shopOwnerToken) return false;
  return !isTokenExpired(shopOwnerToken);
}

function openAuthModal(isSignUp) {
  document.getElementById("authEmail").value = "";
  document.getElementById("authPassword").value = "";
  document.getElementById("auth-form-msg").textContent = "";
  document.getElementById("authModal").style.display = "block";
  document.getElementById("authOverlay").style.display = "block";
  setAuthMode(isSignUp ? "signup" : "signin");
}

function closeAuthModal() {
  document.getElementById("authModal").style.display = "none";
  document.getElementById("authOverlay").style.display = "none";
}

function setAuthMode(mode) {
  const isSignUp = mode === "signup";
  document.getElementById("authTitle").textContent = isSignUp ? "📝 新規登録" : "🔑 ログイン";
  document.getElementById("authSubmitBtn").textContent = isSignUp ? "登録する" : "ログイン";
  document.getElementById("authToggleBtn").textContent = isSignUp
    ? "すでにアカウントをお持ちの方"
    : "新規登録はこちら";
  document.getElementById("authModal").dataset.mode = mode;
}

function toggleAuthMode() {
  const current = document.getElementById("authModal").dataset.mode;
  setAuthMode(current === "signin" ? "signup" : "signin");
  document.getElementById("auth-form-msg").textContent = "";
}

async function submitAuth() {
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const msg      = document.getElementById("auth-form-msg");
  const mode     = document.getElementById("authModal").dataset.mode;

  if (!email || !password) {
    msg.textContent = "❌ メールアドレスとパスワードを入力してください";
    return;
  }
  msg.textContent = "⏳ 処理中...";

  try {
    if (mode === "signup") {
      const data = await sbSignUp(email, password);
      if (data.access_token) {
        shopOwnerToken = data.access_token;
        shopOwnerEmail = email;
        shopOwnerRefreshToken = data.refresh_token || null;
        sessionStorage.setItem("shopOwnerToken", shopOwnerToken);
        sessionStorage.setItem("shopOwnerEmail", shopOwnerEmail);
        if (shopOwnerRefreshToken) sessionStorage.setItem("shopOwnerRefreshToken", shopOwnerRefreshToken);
        closeAuthModal();
        renderShopOwnerUI();
      } else {
        msg.style.color = "#2c7a2c";
        msg.textContent = "✅ 確認メールを送りました。メール内のリンクをクリックして登録を完了してください。";
      }
    } else {
      const data = await sbSignIn(email, password);
      shopOwnerToken = data.access_token;
      shopOwnerEmail = email;
      shopOwnerRefreshToken = data.refresh_token || null;
      sessionStorage.setItem("shopOwnerToken", shopOwnerToken);
      sessionStorage.setItem("shopOwnerEmail", shopOwnerEmail);
      if (shopOwnerRefreshToken) sessionStorage.setItem("shopOwnerRefreshToken", shopOwnerRefreshToken);
      closeAuthModal();
      renderShopOwnerUI();
    }
  } catch (e) {
    msg.style.color = "#c0392b";
    msg.textContent = "❌ " + e.message;
  }
}

function signOut() {
  if (!confirm("ログアウトしますか？")) return;
  shopOwnerToken        = null;
  shopOwnerEmail        = null;
  shopOwnerRefreshToken = null;
  sessionStorage.removeItem("shopOwnerToken");
  sessionStorage.removeItem("shopOwnerEmail");
  sessionStorage.removeItem("shopOwnerRefreshToken");
  renderShopOwnerUI();
}

function renderShopOwnerUI() {
  const loggedIn = isShopOwnerLoggedIn();
  document.getElementById("shop-auth-required").style.display  = loggedIn ? "none"  : "block";
  document.getElementById("shop-owner-content").style.display  = loggedIn ? "block" : "none";
  if (loggedIn) {
    document.getElementById("shop-owner-email").textContent = shopOwnerEmail || "";
    renderShopList();
  }
}
