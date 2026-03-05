// ===========================
// Supabase 設定
// ===========================
//
// ⚠️  セキュリティ注意:
//   SUPABASE_KEY は Supabase の anonymous (公開) キーです。
//   ゲームユーザーは匿名認証（Anonymous Auth）を使用するため、
//   RLS ポリシーで auth.uid() による行レベル制御が有効に機能します。

const SUPABASE_URL = "https://qqibyplvoeatjuyklqnp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxaWJ5cGx2b2VhdGp1eWtscW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mjc2NTAsImV4cCI6MjA4ODIwMzY1MH0.a-pJtRp3UXHSlyGwPD8STIH86tvrfjxAow9_C6uVtU4";

// ===========================
// 移動・スポーン設定
// ===========================

const SPAWN_DIST_M      = 30;    // 何m移動したら葉っぱ出現
const SPAWN_RADIUS      = 0.001; // スポーン半径（約110m）
const SPAWN_INTERVAL_MS = 60000; // 葉っぱスポーンの最小間隔（60秒）

// ===========================
// QRコード設定
// ===========================

const QR_WINDOW_SEC       = 300; // QRコードの有効期間（5分）
const SHOP_VISIT_RADIUS_M = 300; // GPS近接チェック: QRスキャン有効半径（m）

// ===========================
// UI設定
// ===========================

const ACTION_COOLDOWN_MS = 800; // ボタン連打防止クールダウン（ms）

// ===========================
// 葉っぱの種類（収集バリエーション）
// ===========================
//
// weight: 出現確率の重み（合計100になるよう設定）
// amount: 取得枚数

const LEAF_TYPES = [
  { icon: "🌿", label: "葉っぱ",   amount: 1, weight: 75, message: "葉っぱをゲット！",         rare: false },
  { icon: "🍂", label: "紅葉",     amount: 2, weight: 20, message: "きれいな紅葉！（×2枚）",   rare: false },
  { icon: "🌸", label: "花びら",   amount: 3, weight:  5, message: "✨ レア！花びら発見！（×3枚）", rare: true  },
];

// ===========================
// QRスキャン報酬の種類
// ===========================
//
// 発見・特別感を高めるため、単純な +1 以外の報酬も抽選で出現する。
// weight の合計 = 100

const QR_REWARD_TYPES = [
  { type: "acorn",        label: "どんぐり",         acorn: 1, gold: 0, weight: 65, emoji: "🌰",    rare: false },
  { type: "big_acorn",    label: "大きいどんぐり",    acorn: 2, gold: 0, weight: 20, emoji: "🌰🌰",  rare: false },
  { type: "triple_acorn", label: "トリプルどんぐり",  acorn: 3, gold: 0, weight: 10, emoji: "🌰🌰🌰", rare: true  },
  { type: "gold_acorn",   label: "金どんぐり",        acorn: 0, gold: 1, weight:  5, emoji: "✨🌰",  rare: true  },
];
