// ===========================
// Supabase 設定
// ===========================

const SUPABASE_URL = "https://qqibyplvoeatjuyklqnp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxaWJ5cGx2b2VhdGp1eWtscW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mjc2NTAsImV4cCI6MjA4ODIwMzY1MH0.a-pJtRp3UXHSlyGwPD8STIH86tvrfjxAow9_C6uVtU4";

async function sbGet(userKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?user_key=eq.${encodeURIComponent(userKey)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
  );
  const data = await res.json();
  return data[0] || null;
}

async function sbUpsert(userKey, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({ user_key: userKey, ...fields })
  });
}

// ===========================
// ユーザーキー（端末固有ID）
// ===========================

function getUserKey() {
  let key = localStorage.getItem("userKey");
  if (!key) {
    key = "user_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    localStorage.setItem("userKey", key);
  }
  return key;
}

const USER_KEY = getUserKey();

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
// 起動：Supabaseからデータ読み込み
// ===========================

async function initApp() {
  showMessage("📡 データを読み込み中...");

  try {
    const row = await sbGet(USER_KEY);
    if (row) {
      count     = row.acorn_count  || 0;
      gold      = row.gold_count   || 0;
      leaf      = row.leaf_count   || 0;
      boiled    = row.boiled_count || 0;
      shieldEnd = row.shield_end   || 0;
      applyTimeDecay(row.last_visit || 0);
    } else {
      await sbUpsert(USER_KEY, {
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
    await sbUpsert(USER_KEY, {
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
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  document.getElementById("nav-" + name).classList.add("active");

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
  if (leaf < 5) {
    showMessage("🌿 葉っぱが足りない（あと " + (5 - leaf) + " 枚必要）");
    return;
  }
  leaf  -= 5;
  count += 1;
  refreshUI();
  updateForest();
  showMessage("🌰 葉っぱ5枚をどんぐりと交換！");
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
  if (count <= 0) { showMessage("🌰 ゆでるどんぐりがない"); return; }
  const n = count;
  boiled += n;
  count = 0;
  refreshUI();
  updateForest();
  showMessage("🫕 " + n + "個ゆでた！毛虫から守られたよ");
  document.getElementById("caterpillarWarning").style.display = "none";
  document.getElementById("caterpillar").textContent = "";
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
  const el = document.getElementById("forest-message");
  el.textContent = text;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ""; }, 3000);
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

  // 継続的な位置監視
  map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
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
    leaf++;
    map.removeLayer(m);
    document.getElementById("leafCount").textContent = leaf;
    showForestMessage("🌿 葉っぱをゲット！（合計 " + leaf + " 枚）");
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
    count++;
    map.removeLayer(m);
    document.getElementById("count").textContent = count;
    updateForest();
    showForestMessage("🌰 どんぐりをゲット！");
    await saveData();
  });
}

// 店舗マーカーを地図上に配置
let shopMarkers = [];

function spawnShops(lat, lng) {
  redrawShopsOnMap(lat, lng);
}

function redrawShopsOnMap(lat, lng) {
  // 既存の店舗マーカーを除去
  shopMarkers.forEach(m => map.removeLayer(m));
  shopMarkers = [];

  const shopIcon = L.divIcon({ html: "🏪", className: "", iconSize: [32, 32] });

  // 登録済みお店がある場合はその中心付近にランダム配置
  const list = shops.length > 0 ? shops : [
    { id: "cafe-kunugi",    name: "カフェ くぬぎ" },
    { id: "zakka-momiji",   name: "雑貨店 もみじ" },
    { id: "bakery-donguri", name: "ベーカリー どんぐり屋" },
  ];

  const offsets = [
    [ 0.0012,  0.0008],
    [-0.0008,  0.0015],
    [ 0.0005, -0.0012],
    [ 0.0018, -0.0005],
    [-0.0015,  0.0010],
  ];

  list.forEach((s, i) => {
    const off = offsets[i % offsets.length];
    const m = L.marker([lat + off[0], lng + off[1]], { icon: shopIcon })
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

  // QRフォーマット: "donguri:店舗ID"
  if (!text.startsWith("donguri:")) {
    showQrMessage("❌ このQRは加盟店のものではありません");
    return;
  }

  const shopId  = text.slice("donguri:".length);
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
  } else {
    showQrMessage("🌰 【" + shopId + "】でどんぐりをゲット！");
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

function openAddShopModal() {
  editingShopId = null;
  document.getElementById("addShopTitle").textContent = "🏪 お店を追加";
  document.getElementById("shopNameInput").value = "";
  document.getElementById("shopIdInput").value = "";
  document.getElementById("shopIdInput").disabled = false;
  document.getElementById("shop-form-msg").textContent = "";
  document.getElementById("addShopModal").style.display = "block";
  document.getElementById("addShopOverlay").style.display = "block";
  document.getElementById("shopNameInput").focus();
}

function openEditShopModal(shopId) {
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  editingShopId = shopId;
  document.getElementById("addShopTitle").textContent = "🏪 お店を編集";
  document.getElementById("shopNameInput").value = shop.name;
  document.getElementById("shopIdInput").value = shop.id;
  document.getElementById("shopIdInput").disabled = true;
  document.getElementById("shop-form-msg").textContent = "";
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
  if (!editingShopId) {
    if (!id) { msg.textContent = "❌ お店のIDを入力してください"; return; }
    if (!/^[a-zA-Z0-9\-_]+$/.test(id)) {
      msg.textContent = "❌ IDは英数字・ハイフン・アンダースコアのみ使えます";
      return;
    }
    if (shops.some(s => s.id === id)) {
      msg.textContent = "❌ このIDはすでに使われています";
      return;
    }
    shops.push({ id, name, createdAt: Date.now() });
  } else {
    const shop = shops.find(s => s.id === editingShopId);
    if (shop) shop.name = name;
  }

  saveShopsToStorage();
  renderShopList();
  closeAddShopModal();

  // 地図が初期化済みなら店舗マーカーを再描画
  if (mapInitialized && playerMarker) {
    const latlng = playerMarker.getLatLng();
    redrawShopsOnMap(latlng.lat, latlng.lng);
  }
}

function deleteShop(shopId) {
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;
  if (!confirm(`「${shop.name}」を削除しますか？`)) return;
  shops = shops.filter(s => s.id !== shopId);
  saveShopsToStorage();
  renderShopList();
}

function showShopQR(shopId) {
  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;

  document.getElementById("qrShopName").textContent = shop.name;
  document.getElementById("qrShopId").textContent   = `donguri:${shop.id}`;

  const wrap = document.getElementById("qrCanvas");
  wrap.innerHTML = "";
  new QRCode(wrap, {
    text:   `donguri:${shop.id}`,
    width:  200,
    height: 200,
    colorDark:  "#2c3e50",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  document.getElementById("qrDisplayModal").style.display  = "block";
  document.getElementById("qrDisplayOverlay").style.display = "block";
}

function closeQrDisplay() {
  document.getElementById("qrDisplayModal").style.display  = "none";
  document.getElementById("qrDisplayOverlay").style.display = "none";
}

// ===========================
// 起動
// ===========================

window.onload = function () {
  loadShops();
  renderShopList();
  initApp();
};
