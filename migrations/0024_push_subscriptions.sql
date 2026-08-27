-- ─────────────────────────────────────────────────────────────────
-- WealthLens — Push Subscriptions Table
-- Run in Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text default '',
  created_at  timestamptz default now(),
  unique(user_id, endpoint)
);

alter table push_subscriptions disable row level security;
create index if not exists push_sub_user_idx on push_subscriptions(user_id);
