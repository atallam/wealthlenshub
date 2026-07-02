-- 0009_reconcile_artifacts_and_security.sql
-- Reconciles schema drift between database.sql (artifacts WITHOUT user_id) and
-- hub_migration.sql (artifacts WITH user_id NOT NULL), and aligns RLS.
--
-- Safe to run multiple times. Run AFTER all legacy *_migration.sql files.
--
-- Context: the API stamps artifacts.user_id on upload as of the Phase 1 security
-- fix (routes/artifacts.js). This migration makes the column exist and backfills
-- any rows created before that change, deriving ownership from the parent holding.

BEGIN;

-- 1. Add user_id to artifacts if it is missing.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Backfill user_id from the parent holding for any rows missing it.
UPDATE artifacts a
SET    user_id = h.user_id
FROM   holdings h
WHERE  a.holding_id = h.id
  AND  a.user_id IS NULL;

-- 3. Add FK to auth.users (guarded — skip if it already exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_user_id_fkey'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Enforce NOT NULL only if no orphan rows remain (avoids failing on bad data).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM artifacts WHERE user_id IS NULL) THEN
    ALTER TABLE artifacts ALTER COLUMN user_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'artifacts has rows with NULL user_id (orphaned holdings?) — NOT NULL not enforced. Investigate before re-running.';
  END IF;
END $$;

-- 5. Index for owner lookups.
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id);

-- 6. Defense-in-depth RLS (no-op at runtime because the API uses the service key,
--    but protects against anon-key / direct access).
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifacts_owner ON artifacts;
CREATE POLICY artifacts_owner ON artifacts FOR ALL USING (auth.uid() = user_id);

COMMIT;
