// ===========================
// QRスキャナー
// ===========================

let scanStream    = null;
let scanAnimFrame = null;

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

// ===========================
// QR結果処理（セキュリティ強化版）
// ===========================
//
// 多層防御:
//   1. QRフォーマット検証
//   2. 時間窓検証（5分で期限切れ）
//   3. GPS近接チェック（店舗座標が登録済みの場合）
//   4. クライアント側1日1回チェック（UX向上・即時フィードバック）
//   5. サーバー側unique制約による重複排除（主防御ライン）

async function handleQrResult(text) {
  stopScanner();

  // ① QRフォーマット検証
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

  // ② 時間窓の検証（±1窓 = 最大10分の余裕）
  if (qrWindow !== null) {
    const diff = Math.abs(currentQrWindow() - qrWindow);
    if (diff > 1) {
      showQrMessage("⏰ このQRコードは期限切れです。お店の画面を再度ご確認ください");
      return;
    }
  }

  // 店舗情報を検索（GPS検証・表示名用）
  const shop = shops.find(s => s.id === shopId);
  const shopName = shop ? shop.name : shopId;

  // ③ GPS近接チェック（店舗座標が登録済みの場合のみ）
  //    偽装GPSは完全には防げないが、カジュアルな不正を抑止する
  if (shop && shop.lat != null && playerMarker) {
    const pos  = playerMarker.getLatLng();
    const dist = calcDistanceM(pos.lat, pos.lng, shop.lat, shop.lng);
    if (dist > SHOP_VISIT_RADIUS_M) {
      showQrMessage(
        `📍 【${shopName}】から離れすぎています（約${Math.round(dist)}m）。\nお店に近づいてからスキャンしてください`
      );
      logEvent("qr_distance_fail", { shopId, dist: Math.round(dist) });
      return;
    }
  }

  // ④ クライアント側先行チェック（オフライン対応・UX向上）
  const today   = new Date().toISOString().slice(0, 10);
  const scanKey = "qr_scan_" + shopId;
  if (localStorage.getItem(scanKey) === today) {
    showQrMessage(`⏰ 【${shopName}】は今日すでに訪問済みです（1日1回）`);
    return;
  }

  showQrMessage("📡 来店を確認中...");

  // ⑤ サーバー側来店記録（unique制約で重複を原子的に排除）
  const latLng      = playerMarker ? playerMarker.getLatLng() : null;
  const visitResult = await sbLogVisit(shopId, "pending", latLng);

  if (visitResult.alreadyVisited) {
    showQrMessage(`⏰ 【${shopName}】は今日すでに訪問済みです（1日1回）`);
    return;
  }

  if (!visitResult.success) {
    // サーバー記録失敗（オフライン等）→ クライアント側のみで続行
    console.warn("サーバー記録失敗。クライアント側のみで処理を継続します。");
  }

  // localStorageにも記録（次回のクライアント側チェック用）
  localStorage.setItem(scanKey, today);

  // 報酬抽選（バリエーション付き）
  const reward  = weightedRandom(QR_REWARD_TYPES);
  count        += reward.acorn;
  gold         += reward.gold;

  // 発見メッセージ（種類によって演出を変える）
  let message;
  if (reward.type === "gold_acorn") {
    message = `✨ 【${shopName}】で${reward.label}をゲット！超ラッキー！`;
  } else if (reward.type === "triple_acorn") {
    message = `🎉 【${shopName}】で${reward.label}をゲット！（+${reward.acorn}個）`;
  } else if (reward.type === "big_acorn") {
    message = `🌰 【${shopName}】で${reward.label}をゲット！（+${reward.acorn}個）`;
  } else {
    message = `🌰 【${shopName}】でどんぐりをゲット！`;
  }
  showQrMessage(message);

  // 発見アニメーション
  showDiscoveryEffect(reward.emoji, reward.label, reward.rare);

  logEvent("qr_scanned", { shopId, rewardType: reward.type, acorn: reward.acorn, gold: reward.gold });

  refreshUI();
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
// QR時間窓（5分 = 300秒）
// ===========================

function currentQrWindow() {
  return Math.floor(Date.now() / (QR_WINDOW_SEC * 1000));
}
