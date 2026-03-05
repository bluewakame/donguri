// ===========================
// ゲーム状態変数
// ===========================

let count     = 0;  // どんぐり
let gold      = 0;  // 金どんぐり
let leaf      = 0;  // 葉っぱ
let boiled    = 0;  // ゆで済みどんぐり
let shieldEnd = 0;  // バリア終了時刻（ms）

let previousTrees = 0;

// ===========================
// レートリミット（連打防止）
// ===========================

const _actionTimestamps = {};

function isOnCooldown(action) {
  const now = Date.now();
  if (_actionTimestamps[action] && now - _actionTimestamps[action] < ACTION_COOLDOWN_MS) return true;
  _actionTimestamps[action] = now;
  return false;
}

// ===========================
// 行動ログ（端末内のみ・社会実験データ収集）
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
      // Supabaseにデータがない場合: localStorageから復元してSupabaseに移行
      count     = parseInt(localStorage.getItem("acornCount"))  || 0;
      gold      = parseInt(localStorage.getItem("goldCount"))   || 0;
      leaf      = parseInt(localStorage.getItem("leafCount"))   || 0;
      boiled    = parseInt(localStorage.getItem("boiledCount")) || 0;
      shieldEnd = parseInt(localStorage.getItem("shieldEnd"))   || 0;
      const localLastVisit = parseInt(localStorage.getItem("lastVisit")) || 0;
      applyTimeDecay(localLastVisit);
      await sbUpsert(authUserId, {
        acorn_count:  count,
        gold_count:   gold,
        leaf_count:   leaf,
        boiled_count: boiled,
        shield_end:   shieldEnd,
        last_visit:   localLastVisit || Date.now()
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

  // アイテムを1つも持っていない場合のみチュートリアルを表示
  initTutorial(count + gold + leaf + boiled > 0);
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
