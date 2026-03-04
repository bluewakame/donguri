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

let count = 0;  // どんぐり
let gold  = 0;  // 金どんぐり
let leaf  = 0;  // 葉っぱ

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
      count = row.acorn_count || 0;
      gold  = row.gold_count  || 0;
      leaf  = row.leaf_count  || 0;
      applyTimeDecay(row.last_visit || 0);
    } else {
      await sbUpsert(USER_KEY, {
        acorn_count: 0, gold_count: 0, leaf_count: 0, last_visit: Date.now()
      });
    }
  } catch (e) {
    console.warn("Supabase接続失敗、ローカルデータを使用:", e);
    count = parseInt(localStorage.getItem("acornCount")) || 0;
    gold  = parseInt(localStorage.getItem("goldCount"))  || 0;
    leaf  = parseInt(localStorage.getItem("leafCount"))  || 0;
    applyTimeDecay(parseInt(localStorage.getItem("lastVisit")) || 0);
  }

  previousTrees = Math.floor(count / 10);
  refreshUI();
  updateForest();
  showMessage("");
}

// ===========================
// 保存（localStorage + Supabase）
// ===========================

async function saveData() {
  const now = Date.now();
  localStorage.setItem("acornCount", count);
  localStorage.setItem("goldCount",  gold);
  localStorage.setItem("leafCount",  leaf);
  localStorage.setItem("lastVisit",  now);

  try {
    await sbUpsert(USER_KEY, {
      acorn_count: count,
      gold_count:  gold,
      leaf_count:  leaf,
      last_visit:  now
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
  document.getElementById("count").textContent     = count;
  document.getElementById("gold").textContent      = gold;
  document.getElementById("leafCount").textContent = leaf;
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
  count = 0;
  gold  = 0;
  leaf  = 0;
  refreshUI();
  updateForest();
  showMessage("");
  await saveData();
}

// ===========================
// 時間減衰（🐛 虫に食べられる）
// ===========================

function applyTimeDecay(lastVisitMs) {
  if (!lastVisitMs || count <= 0) return;
  const diff       = Date.now() - lastVisitMs;
  const decayCount = Math.floor(diff / (60 * 60 * 1000)); // 1時間ごとに1個
  if (decayCount <= 0) return;

  const eaten = Math.min(decayCount, count);
  count = Math.max(0, count - eaten);
  showMessage("🐛 " + eaten + " 個食べられた！");
  document.getElementById("bugWarning").style.display = "block";
  setTimeout(() => {
    document.getElementById("bugWarning").style.display = "none";
    showMessage("");
  }, 6000);
}

// ===========================
// 森の更新
// ===========================

function updateForest() {
  const trees = Math.floor(count / 10);
  let display = "";
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
  const rem  = count % 10;
  const left = rem === 0 ? 10 : 10 - rem;
  const el   = document.getElementById("nextTree");
  el.textContent = left;
  el.style.color = left <= 3 ? "#c0392b" : left <= 5 ? "#e67e22" : "#2c3e50";
}

function updateForestLevel() {
  const trees  = Math.floor(count / 10);
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

// デモ店舗マーカーを配置
function spawnShops(lat, lng) {
  const shops = [
    { offset: [0.0012,  0.0008], name: "カフェ くぬぎ" },
    { offset: [-0.0008, 0.0015], name: "雑貨店 もみじ" },
    { offset: [0.0005, -0.0012], name: "ベーカリー どんぐり屋" },
  ];
  const shopIcon = L.divIcon({ html: "🏪", className: "", iconSize: [32, 32] });
  shops.forEach(s => {
    L.marker([lat + s.offset[0], lng + s.offset[1]], { icon: shopIcon })
      .addTo(map)
      .bindPopup(`<b>${s.name}</b><br>🌰 QRコードでどんぐりゲット！`);
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
// 起動
// ===========================

window.onload = function () {
  initApp();
};
