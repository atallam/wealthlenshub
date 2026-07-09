-- 0018_holdings_user_id_backfill.sql
--
-- Ensures holdings.user_id exists and is populated.
--
-- Context: database.sql (original schema) has NO user_id on holdings.
-- hub_migration.sql uses CREATE TABLE IF NOT EXISTS, so if database.sql ran
-- first, user_id was never added. This migration adds it defensively and
-- backfills from portfolio.user_id via the member_id relationship.
--
-- Safe to run multiple times. Run after hub_migration.sql and database.sql.

BEGIN;

-- 1. Add user_id if missing (no-op when already present)
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Backfill from portfolio owner via member_id
--    Each holding links to a portfolio member; that portfolio has user_id.
--    Walk: holdings.member_id → portfolio.members[*].id → portfolio.user_id
UPDATE holdings h
SET    user_id = (
  SELECT p.user_id
  FROM   portfolio p
  WHERE  p.members @> jsonb_build_array(jsonb_build_object('id', h.member_id))
  LIMIT  1
)
WHERE  h.user_id IS NULL
  AND  h.member_id IS NOT NULL;

-- 3. For holdings without member_id, try to derive user from portfolio directly
--    (shouldn't be common, but handles edge cases like demo or manually inserted rows)
UPDATE holdings h
SET    user_id = (
  SELECT p.user_id
  FROM   portfolio p
  LIMIT  1
)
WHERE  h.user_id IS NULL;

-- 4. Add FK to auth.users (guarded — skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'holdings_user_id_fkey'
  ) THEN
    -- Only add FK if all rows have user_id set
    IF NOT EXISTS (SELECT 1 FROM holdings WHERE user_id IS NULL) THEN
      ALTER TABLE holdings
        ADD CONSTRAINT holdings_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    ELSE
      RAISE NOTICE 'holdings has rows with NULL user_id — FK not added. Check backfill above.';
    END IF;
  END IF;
END $$;

-- 5. Index for owner lookups (already present in hub_migration.sql on modern DBs,
--    but CREATE INDEX IF NOT EXISTS is a no-op when it exists)
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);

COMMIT;
