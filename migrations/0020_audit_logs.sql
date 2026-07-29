-- =============================================================================
-- 0020_audit_logs.sql
-- WealthLens Hub — Universal audit trail
--
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_logs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What happened
  action          text          NOT NULL,  -- e.g. HOLDING_CREATE, TXN_DELETE, PROFILE_UPDATE
  entity_type     text,                    -- 'holding' | 'transaction' | 'profile' | 'share' | ...
  entity_id       text,                    -- PK of the affected row (nullable)

  -- HTTP context
  method          text          NOT NULL,  -- POST | PUT | PATCH | DELETE
  path            text          NOT NULL,  -- /api/holdings/abc123
  status_code     integer,                 -- 200 | 400 | 500

  -- Payload snapshots (kept small — avoid storing full blobs)
  before_snapshot jsonb,                   -- state before UPDATE/DELETE (opt-in per route)
  after_snapshot  jsonb,                   -- request body or created record

  -- Client context
  ip_address      text,
  user_agent      text,
  duration_ms     integer,

  created_at      timestamptz   DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx
  ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON audit_logs (user_id, action);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (user_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — users can only read their own logs
--    (server uses service key to insert, bypassing RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own audit logs" ON audit_logs;
CREATE POLICY "Users read own audit logs"
  ON audit_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for end-users — only service role inserts.

-- ---------------------------------------------------------------------------
-- 4. Auto-prune: keep 12 months of history per user (optional, avoids bloat)
--    Uncomment to enable. Runs nightly via Supabase cron or pg_cron.
-- ---------------------------------------------------------------------------
-- SELECT cron.schedule(
--   'prune-audit-logs',
--   '0 3 * * *',
--   $$DELETE FROM audit_logs WHERE created_at < now() - interval '12 months'$$
-- );
