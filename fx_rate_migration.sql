-- Migration: Remove stale 83.2 default from usd_inr_rate
-- The live rate is now always sourced from /api/forex/usdinr and set at runtime.
-- Existing rows keep their stored value; only new inserts are affected.
-- After this migration, new holdings without an explicit usd_inr_rate will store NULL,
-- and the app will use the live rate (_liveUsdInr) for all conversions.

ALTER TABLE holdings ALTER COLUMN usd_inr_rate DROP DEFAULT;
