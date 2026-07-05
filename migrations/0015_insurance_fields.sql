-- 0015_insurance_fields.sql
-- Adds insurance-specific columns to the holdings table.
--
-- Policy types:
--   TERM        — pure protection, no maturity value (current_value = 0)
--   ENDOWMENT   — protection + savings (current_value = surrender/maturity value)
--   ULIP        — unit-linked, market-linked current_value
--   WHOLE_LIFE  — lifelong cover, builds cash value over time
--   HEALTH      — medical/hospitalisation cover (current_value = 0)
--   VEHICLE     — motor insurance (current_value = 0)
--
-- Premium fields replace the CalendarTab hacks that stored frequency in `ticker`
-- and premium amount in `interest_rate`.
--
-- principal  → total premiums paid to date (reused existing column)
-- current_value → surrender/fund value for savings-type policies
-- sum_assured, premium, premium_frequency, policy_type → new
--
-- Safe to run multiple times.

BEGIN;

ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS policy_type       text,
  ADD COLUMN IF NOT EXISTS sum_assured       numeric,
  ADD COLUMN IF NOT EXISTS premium           numeric,
  ADD COLUMN IF NOT EXISTS premium_frequency text DEFAULT 'ANNUAL';

COMMENT ON COLUMN holdings.policy_type IS
  'TERM | ENDOWMENT | ULIP | WHOLE_LIFE | HEALTH | VEHICLE';
COMMENT ON COLUMN holdings.sum_assured IS
  'Total coverage / death benefit amount (₹)';
COMMENT ON COLUMN holdings.premium IS
  'Periodic premium amount in the chosen frequency currency';
COMMENT ON COLUMN holdings.premium_frequency IS
  'ANNUAL | SEMI | QUARTERLY | MONTHLY';

COMMIT;
