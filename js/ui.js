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
// 発見アニメーション（宝探しの特別感）
// ===========================

/**
 * アイテム取得時にフローティングテキストを表示する。
 * レアアイテムのときは演出を強調（大きく・光る）。
 *
 * @param {string} emoji - 表示する絵文字
 * @param {string} label - 報酬ラベル
 * @param {boolean} isRare - レアなら true
 */
function showDiscoveryEffect(emoji, label, isRare) {
  const el = document.createElement("div");
  el.className = "discovery-float" + (isRare ? " discovery-float--rare" : "");
  el.textContent = emoji + " " + label + (isRare ? " ✨" : "");
  // 画面中央上部に表示
  el.style.left = "50%";
  document.body.appendChild(el);
  // アニメーション終了後に除去
  setTimeout(() => el.remove(), 1600);
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
// ユーティリティ
// ===========================

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 重み付きランダム選択。
 * 各要素が { weight: number } を持つ配列から1つを選ぶ。
 *
 * @param {Array<{weight: number}>} items
 * @returns {*} 選ばれた要素
 */
function weightedRandom(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
