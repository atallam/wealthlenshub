-- ── WealthLens Hub: Setu Account Aggregator Tables ───────────────────────────
-- Run in Supabase SQL Editor before enabling SETU_ENABLED=true

-- setu_consents — one row per RBI AA consent request
CREATE TABLE IF NOT EXISTS setu_consents (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         text NOT NULL,
  consent_id      text NOT NULL UNIQUE,         -- Setu consent UUID
  status          text NOT NULL DEFAULT 'PENDING', -- PENDING | ACTIVE | REJECTED | EXPIRED | REVOKED
  fi_types        text[] DEFAULT ARRAY['DEPOSIT','TERM_DEPOSIT','MUTUAL_FUNDS','EQUITIES','ETF','EPF','PPF'],
  purpose         text DEFAULT 'wealth',          -- "wealth" | "budget" | "both"
  session_id      text,                           -- Setu data session UUID
  fi_data_status  text,                           -- PENDING | COMPLETED | PARTIAL | FAILED
  data_range_from timestamptz,
  data_range_to   timestamptz,
  redirect_url    text,                           -- Setu consent screen URL
  holdings_count  integer DEFAULT 0,
  txn_count       integer DEFAULT 0,              -- budget transactions imported
  last_fetched_at timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- setu_connections — persistent linked accounts (like plaid_connections)
-- One row per active Setu consent kept for recurring re-sync
CREATE TABLE IF NOT EXISTS setu_connections (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           text NOT NULL,
  consent_id        text NOT NULL REFERENCES setu_consents(consent_id) ON DELETE CASCADE,
  mobile_masked     text,                         -- last 4 digits: ******6789
  institution_names text[],                       -- e.g. ["HDFC Bank","ICICI Bank"]
  fi_types          text[],
  purpose           text DEFAULT 'wealth',        -- "wealth" | "budget" | "both"
  member_id         text DEFAULT '',              -- portfolio member to assign wealth holdings
  status            text DEFAULT 'active',        -- active | expired | revoked
  last_synced_at    timestamptz,
  txn_count         integer DEFAULT 0,
  holdings_count    integer DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Disable RLS (single-family app pattern matches budget tables)
ALTER TABLE setu_consents    DISABLE ROW LEVEL SECURITY;
ALTER TABLE setu_connections DISABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_setu_consents_user    ON setu_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_setu_consents_status  ON setu_consents(status);
CREATE INDEX IF NOT EXISTS idx_setu_connections_user ON setu_connections(user_id);

-- Add budget-related columns to setu_consents if upgrading from older schema
ALTER TABLE setu_consents ADD COLUMN IF NOT EXISTS purpose      text DEFAULT 'wealth';
ALTER TABLE setu_consents ADD COLUMN IF NOT EXISTS txn_count    integer DEFAULT 0;
