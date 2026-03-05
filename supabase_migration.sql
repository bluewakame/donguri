-- ===========================
-- visit_logs テーブル
-- QRスキャンによる来店記録（社会実験データ）
-- ===========================
-- Supabase ダッシュボードの SQL Editor で実行してください。

create table if not exists visit_logs (
  id          uuid default gen_random_uuid() primary key,
  shop_id     text not null,
  reward_type text not null,  -- 'acorn' または 'gold_acorn'
  scanned_at  timestamptz default now()
);

-- 個人を特定するデータは一切保存しない（ユーザーIDなし）
-- shop_id と来店日時のみを記録

-- インデックス（集計クエリを高速化）
create index if not exists visit_logs_shop_id_idx    on visit_logs(shop_id);
create index if not exists visit_logs_scanned_at_idx on visit_logs(scanned_at);

-- RLS 有効化
alter table visit_logs enable row level security;

-- 誰でも来店ログを書き込める（匿名ユーザー含む）
create policy "anyone can insert visit_logs"
  on visit_logs for insert
  with check (true);

-- 誰でも来店集計を読める（個人情報なし）
create policy "anyone can read visit_logs"
  on visit_logs for select
  using (true);
