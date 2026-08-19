-- 0022_holdings_cas_import_columns.sql
-- Adds columns required by the Gmail CAS auto-import cron.
-- Safe to run multiple times (IF NOT EXISTS guards on every ALTER).

ALTER TABLE holdings ADD COLUMN IF NOT EXISTS units          numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS purchase_nav   numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS net_units      numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS avg_cost       numeric;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS source         text;       -- 'cas' | 'snaptrade' | null (manual)
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS import_method  text;       -- 'manual_upload' | 'gmail_auto' | null
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS source_date    date;       -- "as-of" date shown on Data Freshness card
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS cas_period_start date;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS cas_period_end   date;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

-- Index for flush-and-fill delete (used by Gmail CAS import cron)
CREATE INDEX IF NOT EXISTS idx_holdings_source    ON holdings(user_id, source);
CREATE INDEX IF NOT EXISTS idx_holdings_member_src ON holdings(user_id, member_id, source);
