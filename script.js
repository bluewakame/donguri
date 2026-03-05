// ===========================
// Supabase 設定
// ===========================
//
// ⚠️  セキュリティ注意:
//   SUPABASE_KEY は Supabase の anonymous (公開) キーです。
//   ゲームユーザーは匿名認証（Anonymous Auth）を使用するため、
//   RLS ポリシーで auth.uid() による行レベル制御が有効に機能します。
//   参考: https://supabase.com/docs/guides/auth/anonymous-sign-ins

const SUPABASE_URL = "https://qqibyplvoeatjuyklqnp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxaWJ5cGx2b2VhdGp1eWtscW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mjc2NTAsImV4cCI6MjA4ODIwMzY1MH0.a-pJtRp3UXHSlyGwPD8STIH86tvrfjxAow9_C6uVtU4";

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
// 状態変数
// ===========================

let count     = 0;  // どんぐり
let gold      = 0;  // 金どんぐり
let leaf      = 0;  // 葉っぱ
let boiled    = 0;  // ゆで済みどんぐり
let shieldEnd = 0;  // バリア終了時刻（ms）

let shops = [];     // 登録お店リスト
let editingShopId = null; // 編集中のお店ID

let previousTrees    = 0;
let map;
let mapInitialized   = false;
let playerMarker     = null;
let initialLocSet    = false;
let lastSpawnLat     = null;
let lastSpawnLng     = null;
let scanStream       = null;
let scanAnimFrame    = null;

const SPAWN_DIST_M   = 30;    // 何m移動したら葉っぱ出現
const SPAWN_RADIUS   = 0.001; // スポーン半径（約110m）

// ===========================
// レートリミット（連打防止）
// ===========================

const ACTION_COOLDOWN_MS = 800;
const _actionTimestamps  = {};

function isOnCooldown(action) {
  const now = Date.now();
  if (_actionTimestamps[action] && now - _actionTimestamps[action] < ACTION_COOLDOWN_MS) return true;
  _actionTimestamps[action] = now;
  return false;
}

// ===========================
// 行動ログ（社会実験データ収集）
// ===========================

function logEvent(type, data) {
  try {
    const log = JSON.parse(localStorage.getItem("eventLog") || "[]");
    log.push(Object.assign({ type, ts: Date.now() }, data || {}));
    if (log.length > 500) log.splice(0, log.length - 500);
    localStorage.setItem("eventLog", JSON.stringify(log));
  } catch (e) {
    console.warn("ログの保存に失敗:", e);
  }
}

// ===========================
// 起動：Supabaseからデータ読み込み
// ===========================

async function initApp() {
  showMessage("📡 データを読み込み中...");

  try {
    await ensureAuth();
    const row = await sbGet(authUserId);
    if (row) {
      count     = row.acorn_count  || 0;
      gold      = row.gold_count   || 0;
      leaf      = row.leaf_count   || 0;
      boiled    = row.boiled_count || 0;
      shieldEnd = row.shield_end   || 0;
      applyTimeDecay(row.last_visit || 0);
    } else {
      await sbUpsert(authUserId, {
        acorn_count: 0, gold_count: 0, leaf_count: 0,
        boiled_count: 0, shield_end: 0, last_visit: Date.now()
      });
    }
  } catch (e) {
    console.warn("Supabase接続失敗、ローカルデータを使用:", e);
    count     = parseInt(localStorage.getItem("acornCount"))  || 0;
    gold      = parseInt(localStorage.getItem("goldCount"))   || 0;
    leaf      = parseInt(localStorage.getItem("leafCount"))   || 0;
    boiled    = parseInt(localStorage.getItem("boiledCount")) || 0;
    shieldEnd = parseInt(localStorage.getItem("shieldEnd"))   || 0;
    applyTimeDecay(parseInt(localStorage.getItem("lastVisit")) || 0);
  }

  previousTrees = Math.floor((count + boiled) / 10);
  refreshUI();
  updateForest();
  checkShieldWarning();
  showMessage("");
}

// ===========================
// 保存（localStorage + Supabase）
// ===========================

async function saveData() {
  const now = Date.now();
  localStorage.setItem("acornCount",  count);
  localStorage.setItem("goldCount",   gold);
  localStorage.setItem("leafCount",   leaf);
  localStorage.setItem("boiledCount", boiled);
  localStorage.setItem("shieldEnd",   shieldEnd);
  localStorage.setItem("lastVisit",   now);

  try {
    await ensureAuth();
    await sbUpsert(authUserId, {
      acorn_count:  count,
      gold_count:   gold,
      leaf_count:   leaf,
      boiled_count: boiled,
      shield_end:   shieldEnd,
      last_visit:   now
    });
  } catch (e) {
    console.warn("保存失敗（次回起動時に同期）:", e);
  }
}

// ===========================
// ページ切り替え
// ===========================

function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.remove("active");
    b.removeAttribute("aria-current");
  });
  document.getElementById("page-" + name).classList.add("active");
  const navBtn = document.getElementById("nav-" + name);
  navBtn.classList.add("active");
  navBtn.setAttribute("aria-current", "page");

  if (name === "forest" && !mapInitialized) {
    mapInitialized = true;
    setTimeout(initMap, 100);
  }
  if (name !== "qr") stopScanner();
}

// ===========================
// UI更新
// ===========================

function refreshUI() {
  document.getElementById("count").textContent       = count;
  document.getElementById("gold").textContent        = gold;
  document.getElementById("leafCount").textContent   = leaf;
  document.getElementById("boiledCount").textContent = boiled;
}

function showMessage(text) {
  document.getElementById("message").textContent = text;
}

function showQrMessage(text) {
  document.getElementById("qr-message").textContent = text;
}

// ===========================
// 葉っぱ交換（🌿5 → 🌰1）
// ===========================

async function exchangeLeaf() {
  if (isOnCooldown("exchangeLeaf")) return;
  if (leaf < 5) {
    showMessage("🌿 葉っぱが足りない（あと " + (5 - leaf) + " 枚必要）");
    return;
  }
  leaf  -= 5;
  count += 1;
  refreshUI();
  updateForest();
  showMessage("🌰 葉っぱ5枚をどんぐりと交換！");
  logEvent("leaf_exchanged", { leaf_after: leaf, acorn_after: count });
  await saveData();
}

// ===========================
// リセット
// ===========================

async function resetGame() {
  if (!confirm("本当にリセットしますか？")) return;
  count     = 0;
  gold      = 0;
  leaf      = 0;
  boiled    = 0;
  shieldEnd = 0;
  refreshUI();
  updateForest();
  showMessage("");
  await saveData();
}

// ===========================
// 🫕 ゆでる
// ===========================

async function boilAcorns() {
  if (isOnCooldown("boilAcorns")) return;
  if (count <= 0) { showMessage("🌰 ゆでるどんぐりがない"); return; }
  const n = count;
  boiled += n;
  count = 0;
  refreshUI();
  updateForest();
  showMessage("🫕 " + n + "個ゆでた！毛虫から守られたよ");
  document.getElementById("caterpillarWarning").style.display = "none";
  document.getElementById("caterpillar").textContent = "";
  logEvent("acorns_boiled", { count: n });
  await saveData();
}

// ===========================
// 金どんぐりショップ
// ===========================

function openGoldShop() {
  document.getElementById("goldInShop").textContent = gold;
  document.getElementById("goldShop").style.display = "block";
  document.getElementById("goldShopOverlay").style.display = "block";
}

function closeGoldShop() {
  document.getElementById("goldShop").style.display = "none";
  document.getElementById("goldShopOverlay").style.display = "none";
}

async function buyItem(type) {
  if (isOnCooldown("buyItem")) return;
  if (type === "boost") {
    if (gold < 1) { showMessage("✨ 金どんぐりが足りない"); closeGoldShop(); return; }
    gold--; count += 5;
    showMessage("⚡ どんぐりが5個増えた！");
  } else if (type === "shield") {
    if (gold < 3) { showMessage("✨ 金どんぐりが足りない（3個必要）"); closeGoldShop(); return; }
    gold -= 3;
    shieldEnd = Date.now() + 24 * 60 * 60 * 1000;
    showMessage("🛡️ 毛虫バリア発動！24時間守るよ");
    checkShieldWarning();
  } else if (type === "leaf") {
    if (gold < 2) { showMessage("✨ 金どんぐりが足りない（2個必要）"); closeGoldShop(); return; }
    gold -= 2; leaf += 10;
    showMessage("🌿 はっぱが10枚増えた！");
  }
  refreshUI();
  updateForest();
  document.getElementById("goldInShop").textContent = gold;
  closeGoldShop();
  logEvent("item_purchased", { type });
  await saveData();
}

function checkShieldWarning() {
  if (Date.now() < shieldEnd) {
    const remaining = Math.ceil((shieldEnd - Date.now()) / (60 * 60 * 1000));
    document.getElementById("caterpillarWarning").style.display = "none";
    showMessage("🛡️ バリア有効中（残り約" + remaining + "時間）");
  }
}

// ===========================
// 時間減衰（🐛 虫に食べられる）
// ===========================

function applyTimeDecay(lastVisitMs) {
  if (!lastVisitMs) return;
  if (Date.now() < shieldEnd) return;

  const diff       = Date.now() - lastVisitMs;
  const decayCount = Math.floor(diff / (60 * 60 * 1000)); // 1時間ごとに1個

  if (decayCount > 0 && count > 0) {
    const eaten = Math.min(decayCount, count);
    count = Math.max(0, count - eaten);
    showMessage("🐛 " + eaten + "個食べられた！「ゆでる」で守れるよ");
    document.getElementById("caterpillar").textContent = "🐛";
    document.getElementById("caterpillarWarning").style.display = "block";
  }
}

// ===========================
// 森の更新
// ===========================

function updateForest() {
  const total  = count + boiled;
  const trees  = Math.floor(total / 10);
  let display  = "";
  for (let i = 0; i < trees; i++) display += "🌳";
  document.getElementById("forest").textContent = display || "　";

  if (trees > previousTrees) {
    showForestMessage("🌳 新しい木が育った！");
  } else if (trees < previousTrees) {
    showForestMessage("🐛 虫に食べられて木が減った...");
  }
  previousTrees = trees;

  updateNextTree();
  updateForestLevel();
}

function updateNextTree() {
  const total = count + boiled;
  const rem   = total % 10;
  const left  = rem === 0 ? 10 : 10 - rem;
  const el    = document.getElementById("nextTree");
  el.textContent = left;
  el.style.color = left <= 3 ? "#c0392b" : left <= 5 ? "#e67e22" : "#2c3e50";
}

function updateForestLevel() {
  const trees  = Math.floor((count + boiled) / 10);
  const levels = ["まだ森はない", "🌱 小さな森", "🌿 若い森", "🌳 深い森"];
  const idx    = trees === 0 ? 0 : trees <= 3 ? 1 : trees <= 7 ? 2 : 3;
  document.getElementById("forestLevel").textContent = levels[idx];
}

function showForestMessage(text) {
  ["forest-message", "map-forest-message"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.textContent = ""; }, 3000);
  });
}

// ===========================
// 地図（森ページ）
// ===========================

function initMap() {
  map = L.map("map").setView([35.6895, 139.6917], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  setTimeout(() => { map.invalidateSize(); }, 300);

  showMapMessage("📍 現在地を取得中...");
  map.on("locationfound", onLocationFound);
  map.on("locationerror", onLocationError);

  // 位置情報同意確認後に監視開始
  checkLocationConsent();
}

function onLocationFound(e) {
  showMapMessage("");
  const lat = e.latitude;
  const lng = e.longitude;

  if (!playerMarker) {
    // 初回取得: プレイヤーマーカー・葉っぱ・店舗を配置
    const playerIcon = L.divIcon({ html: "🧍", className: "", iconSize: [30, 30] });
    playerMarker = L.marker([lat, lng], { icon: playerIcon })
      .addTo(map)
      .bindPopup("あなたの現在地");

    lastSpawnLat = lat;
    lastSpawnLng = lng;

    // 初期葉っぱを5枚スポーン
    for (let i = 0; i < 5; i++) spawnLeaf(lat, lng);

    // デモ店舗を配置
    spawnShops(lat, lng);

    if (!initialLocSet) {
      initialLocSet = true;
      map.setView([lat, lng], 17);
    }
  } else {
    // 位置更新: プレイヤーマーカーを移動
    playerMarker.setLatLng([lat, lng]);

    // 移動距離チェック → 一定距離で葉っぱ出現
    const dist = calcDistanceM(lat, lng, lastSpawnLat, lastSpawnLng);
    if (dist >= SPAWN_DIST_M) {
      lastSpawnLat = lat;
      lastSpawnLng = lng;

      const n = 2 + Math.floor(Math.random() * 2); // 2〜3枚
      for (let i = 0; i < n; i++) spawnLeaf(lat, lng);

      // 33%の確率でどんぐりもランダム出現（仕様書「ランダム取得」）
      if (Math.random() < 0.33) spawnAcornOnMap(lat, lng);

      logEvent("movement_spawn", { lat, lng });
      showForestMessage("🌿 新しい葉っぱが出てきた！");
    }
  }
}

function onLocationError(e) {
  let msg = "📍 現在地を取得できませんでした";
  if (e.code === 1) msg = "📍 位置情報の許可が必要です";
  if (e.code === 3) msg = "📍 タイムアウト。再度お試しください";
  showMapMessage(msg);
}

function showMapMessage(text) {
  let el = document.getElementById("map-message");
  if (!el) {
    el = document.createElement("p");
    el.id = "map-message";
    el.style.cssText = "font-size:14px; color:#666; margin:8px 0;";
    document.getElementById("map").insertAdjacentElement("beforebegin", el);
  }
  el.textContent = text;
}

// ===========================
// 位置情報同意
// ===========================

function checkLocationConsent() {
  const consent = localStorage.getItem("locationConsent");
  if (consent === "granted") {
    startGeolocation();
  } else if (consent === "denied") {
    showMapMessage("📍 位置情報の利用が許可されていません");
    document.getElementById("locationAllowBtn").style.display = "block";
  } else {
    document.getElementById("locationConsentModal").style.display = "block";
    document.getElementById("locationConsentOverlay").style.display = "block";
  }
}

function acceptLocationConsent() {
  localStorage.setItem("locationConsent", "granted");
  document.getElementById("locationConsentModal").style.display = "none";
  document.getElementById("locationConsentOverlay").style.display = "none";
  document.getElementById("locationAllowBtn").style.display = "none";
  startGeolocation();
}

function declineLocationConsent() {
  localStorage.setItem("locationConsent", "denied");
  document.getElementById("locationConsentModal").style.display = "none";
  document.getElementById("locationConsentOverlay").style.display = "none";
  showMapMessage("📍 位置情報の利用が許可されていません");
  document.getElementById("locationAllowBtn").style.display = "block";
}

function startGeolocation() {
  map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

// 葉っぱをスポーン
function spawnLeaf(lat, lng) {
  const icon = L.divIcon({ html: "🌿", className: "", iconSize: [30, 30] });
  const m = L.marker(
    [lat + (Math.random() - 0.5) * SPAWN_RADIUS * 2,
     lng + (Math.random() - 0.5) * SPAWN_RADIUS * 2],
    { icon, bubblingMouseEvents: false }
  ).addTo(map);
  m.on("click", async function (e) {
    L.DomEvent.stopPropagation(e);
    const pos = m.getLatLng();
    leaf++;
    map.removeLayer(m);
    document.getElementById("leafCount").textContent = leaf;
    showForestMessage("🌿 葉っぱをゲット！（合計 " + leaf + " 枚）");
    logEvent("leaf_collected", { lat: pos.lat, lng: pos.lng });
    await saveData();
  });
}

// どんぐりをランダムスポーン（ランダム取得）
function spawnAcornOnMap(lat, lng) {
  const icon = L.divIcon({ html: "🌰", className: "", iconSize: [30, 30] });
  const m = L.marker(
    [lat + (Math.random() - 0.5) * SPAWN_RADIUS * 2,
     lng + (Math.random() - 0.5) * SPAWN_RADIUS * 2],
    { icon, bubblingMouseEvents: false }
  ).addTo(map);
  m.on("click", async function (e) {
    L.DomEvent.stopPropagation(e);
    const pos = m.getLatLng();
    count++;
    map.removeLayer(m);
    document.getElementById("count").textContent = count;
    updateForest();
    showForestMessage("🌰 どんぐりをゲット！");
    logEvent("acorn_collected_map", { lat: pos.lat, lng: pos.lng });
    await saveData();
  });
}

// 店舗マーカーを地図上に配置
let shopMarkers = [];

function spawnShops() {
  redrawShopsOnMap();
}

function redrawShopsOnMap() {
  // 既存の店舗マーカーを除去
  shopMarkers.forEach(m => map.removeLayer(m));
  shopMarkers = [];

  const shopIcon = L.divIcon({ html: "🌰", className: "", iconSize: [32, 32] });

  // 登録済みで座標があるお店のみマーカーを配置
  shops.filter(s => s.lat != null && s.lng != null).forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: shopIcon })
      .addTo(map)
      .bindPopup(`<b>${s.name}</b><br>🌰 QRコードでどんぐりゲット！`);
    shopMarkers.push(m);
  });
}

// 2点間の距離（メートル）
function calcDistanceM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===========================
// QRスキャナー
// ===========================

async function startScanner() {
  showQrMessage("📷 カメラを起動中...");
  document.getElementById("scanStartBtn").style.display = "none";

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });
  } catch (err) {
    showQrMessage(
      (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
        ? "📷 カメラへのアクセスを許可してください"
        : "📷 カメラの起動に失敗しました"
    );
    document.getElementById("scanStartBtn").style.display = "inline-block";
    return;
  }

  scanStream = stream;
  const video = document.getElementById("scanner-video");
  video.srcObject = stream;

  try {
    await video.play();
  } catch (err) {
    showQrMessage("📷 映像の表示に失敗しました");
    stopScanner();
    return;
  }

  document.getElementById("scanner-wrap").style.display = "block";
  document.getElementById("scanStopBtn").style.display  = "inline-block";
  showQrMessage("📷 QRコードをカメラに向けてください");

  const canvas = document.getElementById("scanner-canvas");
  const ctx    = canvas.getContext("2d", { willReadFrequently: true });
  scanTick(video, canvas, ctx);
}

function scanTick(video, canvas, ctx) {
  if (video.readyState >= video.HAVE_ENOUGH_DATA) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert"
    });
    if (code && code.data) {
      handleQrResult(code.data);
      return;
    }
  }
  scanAnimFrame = requestAnimationFrame(() => scanTick(video, canvas, ctx));
}

async function handleQrResult(text) {
  stopScanner();

  // QRフォーマット: "donguri:店舗ID:時間窓"
  if (!text.startsWith("donguri:")) {
    showQrMessage("❌ このQRは加盟店のものではありません");
    return;
  }

  const parts = text.split(":");
  if (parts.length < 2) {
    showQrMessage("❌ QRコードの形式が正しくありません");
    return;
  }

  const shopId   = parts[1];
  const qrWindow = parts.length >= 3 ? parseInt(parts[2]) : null;

  // 時間窓の検証（±1窓 = 最大10分の余裕）
  if (qrWindow !== null) {
    const diff = Math.abs(currentQrWindow() - qrWindow);
    if (diff > 1) {
      showQrMessage("⏰ このQRコードは期限切れです。お店の画面を再度ご確認ください");
      return;
    }
  }

  const today   = new Date().toISOString().slice(0, 10);
  const scanKey = "qr_scan_" + shopId;

  // 1店舗1日1回制限
  if (localStorage.getItem(scanKey) === today) {
    showQrMessage("⏰ 【" + shopId + "】は今日すでに訪問済みです（1日1回）");
    return;
  }

  localStorage.setItem(scanKey, today);
  count++;

  // 5%の確率で金どんぐり
  if (Math.random() < 0.05) {
    gold++;
    document.getElementById("gold").textContent = gold;
    showQrMessage("✨🌰 【" + shopId + "】で金どんぐりをゲット！");
    logEvent("gold_acorn_qr", { shopId });
  } else {
    showQrMessage("🌰 【" + shopId + "】でどんぐりをゲット！");
    logEvent("acorn_qr", { shopId });
  }

  document.getElementById("count").textContent = count;
  updateForest();
  await saveData();
}

function stopScanner() {
  if (scanAnimFrame) {
    cancelAnimationFrame(scanAnimFrame);
    scanAnimFrame = null;
  }
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  const video = document.getElementById("scanner-video");
  if (video) video.srcObject = null;
  document.getElementById("scanner-wrap").style.display = "none";
  document.getElementById("scanStartBtn").style.display = "inline-block";
  document.getElementById("scanStopBtn").style.display  = "none";
}

// ===========================
// 認証（お店管理用）
// ===========================

let shopOwnerToken = sessionStorage.getItem("shopOwnerToken") || null;
let shopOwnerEmail = sessionStorage.getItem("shopOwnerEmail") || null;

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
  return !!shopOwnerToken;
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
        sessionStorage.setItem("shopOwnerToken", shopOwnerToken);
        sessionStorage.setItem("shopOwnerEmail", shopOwnerEmail);
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
      sessionStorage.setItem("shopOwnerToken", shopOwnerToken);
      sessionStorage.setItem("shopOwnerEmail", shopOwnerEmail);
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
  shopOwnerToken = null;
  shopOwnerEmail = null;
  sessionStorage.removeItem("shopOwnerToken");
  sessionStorage.removeItem("shopOwnerEmail");
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

// ===========================
// お店管理
// ===========================

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
  const list = document.getElementById("shop-list");
  const empty = document.getElementById("shop-empty");
  list.innerHTML = "";

  if (shops.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  shops.forEach(shop => {
    const card = document.createElement("div");
    card.className = "shop-mgmt-card";
    card.innerHTML = `
      <div class="shop-mgmt-info">
        <span class="shop-mgmt-name">${escapeHtml(shop.name)}</span>
        <span class="shop-mgmt-id">ID: ${escapeHtml(shop.id)}</span>
      </div>
      <div class="shop-mgmt-actions">
        <button class="shop-action-btn qr-btn" onclick="showShopQR('${escapeHtml(shop.id)}')">QR</button>
        <button class="shop-action-btn edit-btn" onclick="openEditShopModal('${escapeHtml(shop.id)}')">編集</button>
        <button class="shop-action-btn del-btn" onclick="deleteShop('${escapeHtml(shop.id)}')">削除</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    locMsg.textContent = "「📍 現在地を取得」ボタンで位置を設定できます";
  }
  document.getElementById("addShopModal").style.display = "block";
  document.getElementById("addShopOverlay").style.display = "block";
  document.getElementById("shopNameInput").focus();
}

function closeAddShopModal() {
  document.getElementById("addShopModal").style.display = "none";
  document.getElementById("addShopOverlay").style.display = "none";
}

function saveShop() {
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
      msg.textContent = "❌ 「📍 現在地を取得」ボタンで位置を設定してください";
      return;
    }
    shops.push({ id, name, lat: shopModalLat, lng: shopModalLng, createdAt: Date.now() });
  } else {
    const shop = shops.find(s => s.id === editingShopId);
    if (shop) shop.name = name;
  }

  saveShopsToStorage();
  renderShopList();
  closeAddShopModal();

  // 地図が初期化済みなら店舗マーカーを再描画
  if (mapInitialized) {
    redrawShopsOnMap();
  }
}

function deleteShop(shopId) {
  if (!isShopOwnerLoggedIn()) { openAuthModal(false); return; }
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  if (!confirm(`「${shop.name}」を削除しますか？`)) return;
  shops = shops.filter(s => s.id !== shopId);
  saveShopsToStorage();
  renderShopList();
  if (mapInitialized) {
    redrawShopsOnMap();
  }
}

// QRコードの時間窓（5分 = 300秒）
const QR_WINDOW_SEC = 300;

function currentQrWindow() {
  return Math.floor(Date.now() / (QR_WINDOW_SEC * 1000));
}

let qrCountdownTimer  = null;
let qrRefreshShopId   = null;

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
    const elapsed = Math.floor(Date.now() / 1000) % QR_WINDOW_SEC;
    const remaining = QR_WINDOW_SEC - elapsed;
    countEl.textContent = `🔄 ${remaining}秒後に更新`;

    if (remaining <= 1) {
      renderTimedQR(shop);
    }
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
// プライバシーポリシー
// ===========================

function openPrivacyModal() {
  document.getElementById("privacyModal").style.display = "block";
  document.getElementById("privacyOverlay").style.display = "block";
}

function closePrivacyModal() {
  document.getElementById("privacyModal").style.display = "none";
  document.getElementById("privacyOverlay").style.display = "none";
}

// ===========================
// データ削除
// ===========================

async function deleteUserData() {
  if (!confirm(
    "すべてのデータ（どんぐり・金どんぐり・ゆで済みなど）を完全に削除しますか？\n" +
    "この操作は取り消せません。"
  )) return;

  showMessage("🗑️ データを削除中...");

  try {
    await ensureAuth();
    await sbDelete(authUserId);
  } catch (e) {
    console.warn("Supabaseからの削除に失敗（ローカルデータは削除します）:", e);
  }

  // ローカルデータを全消去
  const keysToRemove = [
    "authToken", "authRefreshToken", "authUserId",
    "acornCount", "goldCount", "leafCount", "boiledCount",
    "shieldEnd", "lastVisit", "locationConsent", "eventLog", "managedShops"
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // QRスキャン記録も消去
  Object.keys(localStorage)
    .filter(k => k.startsWith("qr_scan_"))
    .forEach(k => localStorage.removeItem(k));

  showMessage("✅ データを削除しました。ページを再読み込みします...");
  setTimeout(() => location.reload(), 2000);
}

// ===========================
// 起動
// ===========================

window.onload = function () {
  loadShops();
  renderShopOwnerUI();
  initApp();
};
