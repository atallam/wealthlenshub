-- Migration 0017: Fix concall_analyses.holding_id type mismatch
--
-- holdings.id is `text` (format h_xxx), but concall_analyses.holding_id was
-- created as `uuid`, causing a PostgreSQL 22P02 cast error on every GET request.
-- This migration changes the column to `text` to match holdings.id.

-- 1. Drop the FK constraint if it exists (may not exist due to prior type mismatch)
ALTER TABLE concall_analyses
  DROP CONSTRAINT IF EXISTS concall_analyses_holding_id_fkey;

-- 2. Change column type from uuid → text
--    USING casting via text is safe here; the table is likely empty because
--    every write attempt also failed with the same cast error.
ALTER TABLE concall_analyses
  ALTER COLUMN holding_id TYPE text USING holding_id::text;

-- 3. Re-add the FK constraint now that types match
ALTER TABLE concall_analyses
  ADD CONSTRAINT concall_analyses_holding_id_fkey
  FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE;
