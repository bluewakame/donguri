# どんぐり

位置情報×ゲームメカニクスで街の回遊を促す社会実験型PWAアプリ。

ユーザーは歩いて葉っぱ・どんぐりを集め、加盟店のQRコードをスキャンしてどんぐりを獲得します。集めたどんぐりは「森」として可視化され、街の活性化につながる行動変容を検証します。

---

## 機能

- 🌰 **どんぐり収集** – 歩くと葉っぱが出現し、交換でどんぐりを獲得
- 🏪 **QRスキャン** – 加盟店のQRコードを読み取ってどんぐりをゲット（1店舗1日1回）
- 🌳 **森の成長** – どんぐりが10個貯まると木が1本育つ
- 🐛 **時間減衰** – 放置すると毛虫に食べられる（ゆでることで保護）
- ✨ **金どんぐりショップ** – 特別アイテムと交換
- 📍 **地図探索** – OpenStreetMapでリアルタイム位置確認

---

## 技術スタック

- **フロントエンド**: HTML / CSS / Vanilla JS（フレームワーク不使用）
- **データベース**: [Supabase](https://supabase.com/)（PostgreSQL）
- **地図**: [Leaflet.js](https://leafletjs.com/) v1.9.4
- **QR生成**: [QRCode.js](https://github.com/davidshimjs/qrcodejs) v1.0.0
- **QR読取**: [jsQR](https://github.com/cozmo/jsQR) v1.4.0
- **PWA**: Service Worker でオフラインキャッシュ対応

---

## デプロイ

このアプリはバックエンドサーバー不要の静的ファイルです。GitHub Pages、Netlify、Vercel など任意のホスティングサービスにそのままデプロイできます。

### GitHub Pages の例

```bash
# リポジトリを public にして Settings > Pages から main ブランチを指定するだけ
```

### ローカルで確認

```bash
# Python の簡易サーバー
python3 -m http.server 8080

# または Node.js
npx serve .
```

---

## Supabase セットアップ

### 1. プロジェクト作成

[Supabase ダッシュボード](https://supabase.com/dashboard) でプロジェクトを作成します。

### 2. テーブル作成

SQL エディタで以下を実行してください：

```sql
create table users (
  user_key     text primary key,
  acorn_count  integer default 0,
  gold_count   integer default 0,
  leaf_count   integer default 0,
  boiled_count integer default 0,
  shield_end   bigint  default 0,
  last_visit   bigint  default 0
);
```

### 3. Row Level Security（RLS）の設定 ⚠️ 必須

**RLS を有効化しないとすべてのユーザーデータが誰でも読み書きできる状態になります。**

```sql
-- RLS を有効化
alter table users enable row level security;

-- 自分のデータのみ読み取り可能
create policy "users can read own data"
  on users for select
  using (user_key = current_user);

-- 自分のデータのみ書き込み可能
create policy "users can insert own data"
  on users for insert
  with check (user_key = current_user);

-- 自分のデータのみ更新可能
create policy "users can update own data"
  on users for update
  using (user_key = current_user);

-- 自分のデータのみ削除可能
create policy "users can delete own data"
  on users for delete
  using (user_key = current_user);
```

> 参考: [Supabase RLS ドキュメント](https://supabase.com/docs/guides/auth/row-level-security)

### 4. 接続情報の設定

`script.js` の先頭にある以下の値を自分のプロジェクトの値に書き換えます：

```javascript
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_KEY = "your-anon-key";  // anonymous (公開) キー
```

接続情報は Supabase ダッシュボードの **Settings > API** で確認できます。

> `SUPABASE_KEY` は anonymous (公開) キーであり、フロントエンドに含めることが想定された設計です。RLS を正しく設定することで不正アクセスを防ぎます。

---

## プライバシーについて

- **位置情報**: 地図表示・葉っぱスポーンのためにデバイス上でのみ使用します。サーバーには送信されません。
- **ゲームデータ**: どんぐり数等のゲーム進捗は Supabase（米国サーバー）に保存されます。
- **認証情報**: お店管理機能のパスワードは Supabase Auth で管理され、このアプリ側では保持しません。
- **データ削除**: アプリ内の「設定 > データを削除」からいつでも全データを削除できます。

詳しくは [プライバシーポリシー](#) をご確認ください（アプリ内から参照可能）。

---

## ライセンス

MIT
