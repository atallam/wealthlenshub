-- 0014_fd_currency.sql
-- Adds multi-currency support for Fixed Deposits.
--
-- NRIs commonly hold FDs in USD, SGD, GBP, EUR (FCNR / RFC accounts).
-- The `currency` column stores the native currency of the deposit.
-- The existing `usd_inr_rate` column is reused as the "foreign → INR" rate
-- for non-INR FDs (principle of least schema change).
--
-- Default is INR so all existing FD rows remain valid without backfill.
-- Safe to run multiple times.

BEGIN;

ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR';

-- Document accepted values (enforced in application layer)
COMMENT ON COLUMN holdings.currency IS
  'INR | USD | SGD | GBP | EUR — native currency of the holding (relevant for FD/CASH)';

COMMIT;
