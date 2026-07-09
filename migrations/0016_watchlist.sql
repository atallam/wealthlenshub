-- Migration 0016: Watchlist feature
-- Tracks tickers the user wants to monitor (not yet in portfolio)

create table if not exists watchlist (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  ticker       text        not null,
  name         text,
  asset_type   text        not null default 'IN_STOCK', -- IN_STOCK | IN_ETF | US_STOCK | US_ETF | CRYPTO | MF
  target_price numeric,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists watchlist_user_id_idx on watchlist(user_id);

alter table watchlist enable row level security;

create policy "watchlist_own_rows" on watchlist
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
