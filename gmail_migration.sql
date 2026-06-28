-- ─────────────────────────────────────────────────────────────────
-- WealthLens Hub — Gmail CAS Auto-Import Migration
-- Run in: Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────

-- Track which emails have already been processed (prevents duplicates)
create table if not exists email_imports (
  id            text primary key default gen_random_uuid()::text,
  user_id       text not null,
  email_id      text not null,           -- Gmail message ID
  email_from    text,                    -- Sender address
  email_subject text,                    -- Email subject line
  email_date    timestamptz,             -- When the email was received
  status        text default 'pending',  -- pending | success | error | skipped
  holdings_added    integer default 0,
  holdings_updated  integer default 0,
  holdings_skipped  integer default 0,
  error_message text,
  processed_at  timestamptz default now(),
  constraint email_imports_user_email_unique unique (user_id, email_id)
);

-- Gmail OAuth tokens stored encrypted on the profiles table
alter table profiles
  add column if not exists gmail_token text,           -- encrypted refresh token
  add column if not exists gmail_email text,           -- connected Gmail address
  add column if not exists gmail_connected_at timestamptz,
  add column if not exists gmail_last_check   timestamptz,
  add column if not exists gmail_auto_import  boolean default true;

-- Disable RLS (consistent with rest of app)
alter table email_imports disable row level security;
