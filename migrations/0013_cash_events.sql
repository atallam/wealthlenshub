-- 0013_cash_events.sql
-- Adds cash event support to the transactions table.
--
-- New txn_type values:
--   DIVIDEND  — cash dividend received (uses `amount` for total cash; units = shares held at ex-date)
--   BONUS     — bonus / stock dividend (units = shares received; price = 0; no cash)
--   RIGHTS    — rights issue exercised  (units = rights taken up; price = exercise price per unit)
--   SWP       — systematic withdrawal from MF (distinct from ad-hoc SELL)
--
-- `amount` stores the total cash received for DIVIDEND events.
-- For BUY/SELL/BONUS/RIGHTS, amount is NULL and total is derived from units × price as before.
--
-- Safe to run multiple times.

BEGIN;

-- 1. Total cash amount column (for DIVIDEND and future cash-flow events)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount numeric;

-- 2. Refresh the txn_type comment to document all valid values
COMMENT ON COLUMN transactions.txn_type IS
  'BUY | SELL | DIVIDEND | BONUS | RIGHTS | SWP';

-- 3. Index on txn_type for quick cash-event queries (e.g. "all dividends for this holding")
CREATE INDEX IF NOT EXISTS idx_txns_type ON transactions(holding_id, txn_type);

COMMIT;
