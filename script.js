// ===========================
// Supabase 設定
// ===========================

const SUPABASE_URL = "https://qqibyplvoeatjuyklqnp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxaWJ5cGx2b2VhdGp1eWtscW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mjc2NTAsImV4cCI6MjA4ODIwMzY1MH0.a-pJtRp3UXHSlyGwPD8STIH86tvrfjxAow9_C6uVtU4";

// Supabase REST API ヘルパー
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

let count     = 0;
let gold      = 0;
let leaf      = 0;
let boiled    = 0;
let shieldEnd = 0;

let previousTrees  = 0;
let map;
let mapInitialized = false;
let qrScanner      = null;
let scannerRunning = false;

// ===========================
// 起動：Supabaseからデータ読み込み
// ===========================

async function initApp() {
  showMessage("📡 データを読み込み中...");

  try {
    const row = await sbGet(USER_KEY);

    if (row) {
      // 既存ユーザー：DBから復元
      count     = row.acorn_count  || 0;
      gold      = row.gold_count   || 0;
      leaf      = row.leaf_count   || 0;
      boiled    = row.boiled_count || 0;
      shieldEnd = row.shield_end   || 0;
      // 時間減衰をDBのlast_visitで計算
      applyTimeDecay(row.last_visit || 0);
    } else {
      // 新規ユーザー：DBに初期レコード作成
      await sbUpsert(USER_KEY, {
        acorn_count: 0, gold_count: 0, leaf_count: 0,
        boiled_count: 0, last_visit: Date.now(), shield_end: 0
      });
    }
  } catch (e) {
    // オフライン時はlocalStorageにフォールバック
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
  updateNextTree();
  updateForest();
  checkShieldWarning();
  showMessage("");
}

// ===========================
// DBへの保存（localStorageにも同時保存）
// ===========================

async function saveData() {
  const now = Date.now();

  // localStorageにも保存（オフライン対策）
  localStorage.setItem("acornCount",  count);
  localStorage.setItem("goldCount",   gold);
  localStorage.setItem("leafCount",   leaf);
  localStorage.setItem("boiledCount", boiled);
  localStorage.setItem("shieldEnd",   shieldEnd);
  localStorage.setItem("lastVisit",   now);

  // Supabaseに非同期保存
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
    console.warn("保存失敗（次回起動時に同期されます）:", e);
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
  if (name !== "qr" && scannerRunning) stopScanner();
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
// どんぐりを拾う → QRページへ
// ===========================

function addAcorn() {
  showPage("qr");
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
// 葉っぱ交換
// ===========================

async function exchangeLeaf() {
  if (leaf >= 5) {
    leaf -= 5;
    count += 1;
    refreshUI();
    updateForest();
    showMessage("🌰 はっぱ5枚でどんぐりと交換！");
    await saveData();
  } else {
    showMessage("🌿 はっぱが足りない（あと" + (5 - leaf) + "枚必要）");
  }
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

// ===========================
// リセット
// ===========================

async function resetAcorn() {
  if (!confirm("本当にリセットしますか？")) return;
  count = 0; gold = 0; boiled = 0;
  refreshUI();
  updateForest();
  showMessage("");
  await saveData();
}

// ===========================
// 時間減衰（毛虫）
// ===========================

function applyTimeDecay(lastVisitMs) {
  if (!lastVisitMs) return;
  if (Date.now() < shieldEnd) return;

  const diff = Date.now() - lastVisitMs;
  // 1時間ごとに1個
  const decayCount = Math.floor(diff / (60 * 60 * 1000));

  if (decayCount > 0 && count > 0) {
    const eaten = Math.min(decayCount, count);
    count = Math.max(0, count - eaten);
    showMessage("🐛 " + eaten + "個食べられた！「ゆでる」で守れるよ");
    document.getElementById("caterpillar").textContent = "🐛";
    document.getElementById("caterpillarWarning").style.display = "block";
  }
}

function checkShieldWarning() {
  if (Date.now() < shieldEnd) {
    const remaining = Math.ceil((shieldEnd - Date.now()) / (60 * 60 * 1000));
    document.getElementById("caterpillarWarning").style.display = "none";
    showMessage("🛡️ バリア有効中（残り約" + remaining + "時間）");
  }
}

// ===========================
// 森の更新
// ===========================

function updateForest() {
  const total = count + boiled;
  const trees = Math.floor(total / 10);
  let display = "";
  for (let i = 0; i < trees; i++) display += "🌳";
  document.getElementById("forest").textContent = display;
  if (trees > previousTrees) showMessage("🌳 新しい木が育った！");
  previousTrees = trees;
  updateNextTree();
  updateForestLevel();
}

function updateNextTree() {
  const total = count + boiled;
  const rem  = total % 10;
  const left = rem === 0 ? 10 : 10 - rem;
  const el   = document.getElementById("nextTree");
  el.textContent = left;
  el.style.color = left <= 3 ? "#c0392b" : left <= 5 ? "#e67e22" : "#2c3e50";
}

function updateForestLevel() {
  const trees  = Math.floor((count + boiled) / 10);
  const levels = ["まだ森はない", "🌱 小さな森", "🌿 若い森", "🌳 深い森"];
  const idx    = trees === 0 ? 0 : trees <= 3 ? 1 : trees <= 7 ? 2 : 3;
  document.getElementById("forestLevel").textContent = levels[idx];
}

// ===========================
// 地図（森ページ）
// ===========================

function initMap() {
  map = L.map("map").setView([35.6895, 139.6917], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  setTimeout(() => { map.invalidateSize(); }, 300);

  showMapMessage("📍 現在地を取得中...");
  map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });

  let locationInitialized = false;
  map.on("locationfound", function (e) {
    showMapMessage("");
    const lat = e.latitude, lng = e.longitude;
    if (!locationInitialized) {
      locationInitialized = true;
      L.circle([lat, lng], { radius: e.accuracy / 2, color: "#4a90d9", fillOpacity: 0.1 }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindPopup("あなたの現在地").openPopup();
      const shopIcon = L.divIcon({ html: "🏪", className: "", iconSize: [30, 30] });
      L.marker([lat + 0.001, lng + 0.001], { icon: shopIcon }).addTo(map)
        .bindPopup("【加盟店】どんぐりQRがあります 🌰");
      for (let i = 0; i < 3; i++) spawnLeaf(lat, lng);
    }
    map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 10000 });
  });
  map.on("locationerror", function (e) {
    let msg = "📍 現在地を取得できませんでした";
    if (e.code === 1) msg = "📍 位置情報の許可が必要です";
    if (e.code === 3) msg = "📍 タイムアウトしました。再度お試しください";
    showMapMessage(msg);
  });
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

function spawnLeaf(lat, lng) {
  const icon = L.divIcon({ html: "🌿", className: "", iconSize: [30, 30] });
  const m = L.marker(
    [lat + (Math.random() - 0.5) * 0.001, lng + (Math.random() - 0.5) * 0.001],
    { icon }
  ).addTo(map);
  m.on("click", async function () {
    leaf++;
    document.getElementById("leafCount").textContent = leaf;
    map.removeLayer(m);
    showMessage("🌿 はっぱをゲット！");
    await saveData();
  });
}

// ===========================
// QRスキャナー
// ===========================

const VALID_QR_PREFIX = "DONGURI_SHOP_";

function startScanner() {
  if (scannerRunning) return;
  document.getElementById("scanStartBtn").style.display = "none";
  document.getElementById("scanStopBtn").style.display  = "inline-block";
  showQrMessage("📷 QRコードをカメラに向けてください");

  if (qrScanner) qrScanner.stop().catch(() => {});
  qrScanner = new Html5Qrcode("reader");
  let lastScanned = null;

  qrScanner.start(
    { facingMode: { ideal: "environment" } },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    async (decodedText) => {
      if (lastScanned === decodedText) return;
      lastScanned = decodedText;
      setTimeout(() => { lastScanned = null; }, 2000);

      if (decodedText.startsWith(VALID_QR_PREFIX)) {
        const shopName  = decodedText.replace(VALID_QR_PREFIX, "").replace("_PREMIUM", "") || "加盟店";
        const isPremium = decodedText.includes("_PREMIUM");
        count++;
        if (isPremium && Math.random() < 0.10) {
          gold++;
          document.getElementById("gold").textContent = gold;
          showQrMessage("✨ 【" + shopName + "】で金どんぐりもゲット！");
        } else {
          showQrMessage("🌰 【" + shopName + "】でどんぐりをゲット！");
        }
        document.getElementById("count").textContent = count;
        updateForest();
        await saveData();
      } else {
        showQrMessage("❌ このQRは加盟店のものではありません");
      }
      stopScanner();
    },
    () => {}
  ).then(() => { scannerRunning = true; })
  .catch(err => {
    const msg = (err && err.message && err.message.includes("Permission"))
      ? "📷 カメラへのアクセスを許可してください"
      : "📷 カメラの起動に失敗しました";
    showQrMessage(msg);
    console.error(err);
    resetScannerUI();
  });
}

function stopScanner() {
  if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; }
  scannerRunning = false;
  resetScannerUI();
}

function resetScannerUI() {
  document.getElementById("scanStartBtn").style.display = "inline-block";
  document.getElementById("scanStopBtn").style.display  = "none";
  scannerRunning = false;
}

// ===========================
// 起動
// ===========================

window.onload = function () {
  initApp();
};
