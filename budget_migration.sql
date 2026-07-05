-- ── WealthLens Pro: Budget Module Migration ──────────────────────
-- Run in Supabase SQL Editor

-- Budget statements — one row per file upload
CREATE TABLE IF NOT EXISTS budget_statements (
  id            text PRIMARY KEY,
  user_id       text,
  source        text NOT NULL,          -- "HDFC Savings", "ICICI Credit Card", etc.
  statement_type text NOT NULL,          -- "BANK" | "CREDIT_CARD" | "UPI" | "OTHER"
  filename      text NOT NULL,
  file_size     integer,
  period_start  date,
  period_end    date,
  txn_count     integer DEFAULT 0,
  upload_date   timestamptz DEFAULT now(),
  notes         text DEFAULT ''
);

-- Budget transactions — parsed from statements
CREATE TABLE IF NOT EXISTS budget_transactions (
  id            text PRIMARY KEY,
  statement_id  text NOT NULL REFERENCES budget_statements(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  txn_date      date NOT NULL,
  description   text NOT NULL,           -- AES-256 encrypted
  search_text   text,                    -- lowercased plaintext for ilike search (not sensitive enough to encrypt)
  fingerprint   text,                    -- dedup key: txn_date|amount|txn_type|desc_prefix
  amount        numeric NOT NULL,
  txn_type      text NOT NULL,           -- "DEBIT" | "CREDIT"
  category      text NOT NULL DEFAULT 'Uncategorised',
  raw_desc      text,                    -- encrypted original description
  balance       numeric,                 -- AES-256 encrypted
  ref_number    text,
  currency      text DEFAULT 'INR',
  created_at    timestamptz DEFAULT now()
);

-- Budget categories — family-defined spending buckets
CREATE TABLE IF NOT EXISTS budget_categories (
  id            text PRIMARY KEY,
  user_id       text,                    -- NULL = system default (visible to all); set on user-created categories
  name          text NOT NULL,
  color         text DEFAULT '#c9a84c',
  icon          text DEFAULT '📁',
  monthly_limit numeric DEFAULT 0,
  keywords      text DEFAULT ''          -- comma-separated auto-match keywords
);

-- Disable RLS for simplicity (single-family app)
ALTER TABLE budget_statements  DISABLE ROW LEVEL SECURITY;
ALTER TABLE budget_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE budget_categories  DISABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_budget_txns_statement  ON budget_transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_budget_txns_date        ON budget_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_budget_txns_category    ON budget_transactions(category);
CREATE INDEX IF NOT EXISTS idx_budget_txns_user        ON budget_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_txns_search      ON budget_transactions(search_text);
CREATE INDEX IF NOT EXISTS idx_budget_txns_fingerprint ON budget_transactions(user_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_budget_cats_user        ON budget_categories(user_id);

-- Migration patch: add new columns if upgrading from older schema
ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS search_text  text;
ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS fingerprint  text;
ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS currency     text DEFAULT 'INR';

-- Migration patch: add user_id to budget_categories if upgrading from an older schema
ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS user_id text;

-- user_id = NULL means system default category (seeded defaults, visible to all users via OR IS NULL logic in service)
-- user_id = <uuid> means user-created category, scoped only to that user

-- Auto-expire statements older than 1 year (run as a scheduled function or cron)
-- DELETE FROM budget_statements WHERE upload_date < now() - interval '1 year';

-- Seed default categories
INSERT INTO budget_categories (id, name, color, icon, monthly_limit, keywords) VALUES
  ('cat_food',      'Food & Dining',      '#e07c5a', '🍽️',  15000, 'swiggy,zomato,restaurant,cafe,hotel,dining,food,pizza,burger'),
  ('cat_grocery',   'Groceries',          '#4caf9a', '🛒',  12000, 'bigbasket,blinkit,dmart,reliance fresh,more,grocery,supermarket,vegetables'),
  ('cat_tra