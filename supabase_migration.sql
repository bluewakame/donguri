-- ===========================
-- visit_logs テーブル（初期作成）
-- QRスキャンによる来店記録（社会実験データ）
-- ===========================
-- Supabase ダッシュボードの SQL Editor で実行してください。

create table if not exists visit_logs (
  id          uuid default gen_random_uuid() primary key,
  shop_id     text not null,
  reward_type text not null,  -- 'acorn', 'big_acorn', 'triple_acorn', 'gold_acorn', 'pending'
  scanned_at  timestamptz default now()
);

-- インデックス（集計クエリを高速化）
create index if not exists visit_logs_shop_id_idx    on visit_logs(shop_id);
create index if not exists visit_logs_scanned_at_idx on visit_logs(scanned_at);

-- RLS 有効化
alter table visit_logs enable row level security;

-- ===========================
-- セキュリティ強化マイグレーション
-- 既存テーブルへのカラム追加・制約追加
-- ===========================

-- ① user_id: Supabase Auth のユーザーIDを紐付け（サーバー側重複排除に使用）
alter table visit_logs
  add column if not exists user_id uuid references auth.users(id);

-- ② GPS座標: 来店位置の記録（不正来店の検証・分析用）
alter table visit_logs
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- ③ 1ユーザー・1店舗・1日1回のユニーク制約（JST換算）
--    user_id が NULL の古いレコードは制約対象外（WHERE句で除外）
create unique index if not exists visit_logs_user_shop_day_idx
  on visit_logs (user_id, shop_id, date(scanned_at + interval '9 hours'))
  where user_id is not null;

-- インデックス（user_id で絞り込む集計を高速化）
create index if not exists visit_logs_user_id_idx on visit_logs(user_id);

-- ===========================
-- RLS ポリシー更新
-- ===========================

-- 旧ポリシーを削除
drop policy if exists "anyone can insert visit_logs"     on visit_logs;
drop policy if exists "anyone can read visit_logs"       on visit_logs;

-- 新ポリシー: 自分のuser_idでのみ書き込み可
create policy "authenticated users can insert own visit_logs"
  on visit_logs for insert
  with check (
    auth.uid() = user_id
  );

-- 読み取り: 誰でも可（個人情報なし・集計用）
create policy "anyone can read visit_logs"
  on visit_logs for select
  using (true);

-- 更新・削除: 明示的に禁止（来店記録は変更不可）
create policy "no one can update visit_logs"
  on visit_logs for update
  using (false);

create policy "no one can delete visit_logs"
  on visit_logs for delete
  using (false);

-- ===========================
-- shops テーブル（お店登録・全プレイヤーへの公開）
-- ===========================

create table if not exists shops (
  id         text primary key,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  owner_id   uuid references auth.users(id),
  created_at timestamptz default now()
);

-- RLS 有効化
alter table shops enable row level security;

-- 誰でも読み取り可（マップ表示用）
create policy "anyone can read shops"
  on shops for select
  using (true);

-- オーナーのみ追加可
create policy "shop owners can insert"
  on shops for insert
  with check (auth.uid() = owner_id);

-- オーナーのみ更新可
create policy "shop owners can update"
  on shops for update
  using (auth.uid() = owner_id);

-- オーナーのみ削除可
create policy "shop owners can delete"
  on shops for delete
  using (auth.uid() = owner_id);

-- ===========================
-- APIレート制限補助（訪問記録の急増を検知するためのView）
-- ===========================
create or replace view visit_logs_daily_summary as
  select
    shop_id,
    date(scanned_at + interval '9 hours') as visit_day,
    count(*)                               as visit_count
  from visit_logs
  group by shop_id, visit_day;
