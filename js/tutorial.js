// ===========================
// チュートリアル
// ===========================

const TUTORIAL_STEPS = [
  {
    emoji: "🌰",
    title: "どんぐりへようこそ！",
    body: `
      <p>これは<strong>街を歩いてどんぐりを集める</strong>ゲームです。</p>
      <p>歩けば歩くほど、どんぐりが集まります。<br>たくさん集めて、自分だけの森を育てよう！</p>
      <div class="tutorial-items">
        <div class="tutorial-item">🌿 <span>葉っぱを拾う</span></div>
        <div class="tutorial-item">🌰 <span>どんぐりに交換</span></div>
        <div class="tutorial-item">🌳 <span>森を育てる</span></div>
      </div>
    `,
  },
  {
    emoji: "🗺️",
    title: "地図を歩いて葉っぱを集めよう",
    body: `
      <p>「地図」タブを開いて街を歩くと、地図上に<strong>葉っぱが出現</strong>します。</p>
      <p>葉っぱをタップして収集しましょう！</p>
      <div class="tutorial-items">
        <div class="tutorial-item">🌿 <span>葉っぱ（よくある）</span></div>
        <div class="tutorial-item">🍂 <span>紅葉（ちょっとレア、2枚分）</span></div>
        <div class="tutorial-item">🌸 <span>花びら（レア！3枚分）</span></div>
      </div>
      <p class="tutorial-note">📍 位置情報の許可が必要です</p>
    `,
  },
  {
    emoji: "🌰",
    title: "葉っぱをどんぐりに交換しよう",
    body: `
      <p>「どんぐり」タブでは、集めた葉っぱをどんぐりに交換できます。</p>
      <div class="tutorial-exchange">
        <span class="tutorial-big">🌿×5</span>
        <span class="tutorial-arrow">→</span>
        <span class="tutorial-big">🌰×1</span>
      </div>
      <p>どんぐりが<strong>10個</strong>貯まると、<strong>木が1本</strong>育ちます🌳</p>
    `,
  },
  {
    emoji: "📷",
    title: "お店でQRをスキャンしよう",
    body: `
      <p>加盟店に設置されたQRコードをスキャンすると、<strong>どんぐりがもらえます！</strong></p>
      <div class="tutorial-items">
        <div class="tutorial-item">🌰 <span>どんぐり（よくある）</span></div>
        <div class="tutorial-item">🌰🌰 <span>大きいどんぐり（ちょっとレア）</span></div>
        <div class="tutorial-item">✨🌰 <span>金どんぐり（超レア！）</span></div>
      </div>
      <p class="tutorial-note">⏰ 1店舗につき1日1回まで</p>
    `,
  },
  {
    emoji: "🏪",
    title: "お店を登録して管理しよう",
    body: `
      <p>「お店」タブでは、<strong>加盟店オーナーとしてお店を登録・管理</strong>できます。</p>
      <div class="tutorial-items">
        <div class="tutorial-item">📝 <span>アカウント登録／ログイン</span></div>
        <div class="tutorial-item">🏪 <span>お店を追加（名前・ID・位置を設定）</span></div>
        <div class="tutorial-item">📷 <span>QRコードを表示してお客さんにスキャンしてもらう</span></div>
        <div class="tutorial-item">📊 <span>来店数を確認（今日・昨日・累計）</span></div>
      </div>
      <p class="tutorial-note">🔄 QRコードは30秒ごとに自動更新され、不正スキャンを防ぎます</p>
    `,
  },
  {
    emoji: "🐛",
    title: "毛虫に気をつけて！",
    body: `
      <p>放っておくと<strong>毛虫がどんぐりを1時間ごとに1個食べてしまいます</strong>。</p>
      <p>「🫕 ゆでる」ボタンでどんぐりを守ろう！</p>
      <div class="tutorial-exchange">
        <span class="tutorial-big">🌰</span>
        <span class="tutorial-arrow">🫕</span>
        <span class="tutorial-big">🔒</span>
      </div>
      <p class="tutorial-note">🛡️ 金どんぐりで「毛虫バリア」を買うと<br>24時間まるごと守れます</p>
    `,
  },
  {
    emoji: "🌳",
    title: "さあ、冒険を始めよう！",
    body: `
      <p>街を歩き、葉っぱを集め、お店に立ち寄りながら<strong>あなただけの森を育てましょう！</strong></p>
      <div class="tutorial-forest-preview">🌱🌿🌳🌳🌳</div>
      <p>まずは地図タブを開いて、街に出かけてみよう🚶</p>
    `,
  },
];

function showTutorial() {
  const overlay = document.getElementById("tutorialOverlay");
  const modal = document.getElementById("tutorialModal");
  if (!overlay || !modal) return;
  overlay.style.display = "block";
  modal.style.display = "block";
  renderTutorialStep(0);
}

function closeTutorial() {
  document.getElementById("tutorialOverlay").style.display = "none";
  document.getElementById("tutorialModal").style.display = "none";
}

function renderTutorialStep(index) {
  const step = TUTORIAL_STEPS[index];
  const total = TUTORIAL_STEPS.length;

  document.getElementById("tutorialEmoji").textContent = step.emoji;
  document.getElementById("tutorialTitle").textContent = step.title;
  document.getElementById("tutorialBody").innerHTML = step.body;

  // ドット更新
  const dots = document.querySelectorAll(".tutorial-dot");
  dots.forEach((d, i) => {
    d.classList.toggle("active", i === index);
  });

  // ボタン更新
  const prevBtn = document.getElementById("tutorialPrev");
  const nextBtn = document.getElementById("tutorialNext");

  prevBtn.style.visibility = index === 0 ? "hidden" : "visible";
  prevBtn.onclick = () => renderTutorialStep(index - 1);

  if (index === total - 1) {
    nextBtn.textContent = "はじめる 🌰";
    nextBtn.onclick = closeTutorial;
  } else {
    nextBtn.textContent = "次へ →";
    nextBtn.onclick = () => renderTutorialStep(index + 1);
  }

  // カウンター
  document.getElementById("tutorialCounter").textContent =
    `${index + 1} / ${total}`;
}

// hasItems: initApp() のデータ読み込み後に呼ばれる
// アイテムを1つも持っていない場合のみ表示する
function initTutorial(hasItems) {
  if (!hasItems) {
    showTutorial();
  }
}
