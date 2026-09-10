-- 0028_fd_maturity.sql
-- Gives Fixed Deposits an explicit post-maturity lifecycle.
--
-- Before this, a matured FD simply froze in value and dropped out of every
-- "upcoming" view with no prompt to act. These columns let the app surface
-- "matured — action needed" and record how the user resolved it.
--
--   maturity_status      'active'    → still running / matured but unresolved
--                        'converted' → proceeds moved to CASH (row retyped to CASH)
--                        'closed'    → withdrawn / no longer tracked (hidden from portfolio)
--   maturity_amount      Bank-stated maturity value (from FD scan or manual entry).
--                        When present it is used instead of the compounding estimate
--                        once the FD has matured.
--   maturity_resolved_at When the user took the Renew / Convert / Close action.
--
-- Safe to run multiple times.

BEGIN;

ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS maturity_status      text        DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS maturity_amount      numeric,
  ADD COLUMN IF NOT EXISTS maturity_resolved_at timestamptz;

COMMENT ON COLUMN holdings.maturity_status IS
  'active | converted | closed — post-maturity state for FD rows (enforced in application layer)';

COMMIT;
