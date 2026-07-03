-- 0010: liabilities column missed when liabilities tracking shipped (commit c8c5634).
-- Without it, POST /api/portfolio upserts fail (PGRST204) and liabilities never persist.
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS liabilities jsonb DEFAULT '[]';

-- Refresh PostgREST schema cache so Supabase sees the new column immediately.
NOTIFY pgrst, 'reload schema';
