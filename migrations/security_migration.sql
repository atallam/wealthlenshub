-- =============================================================================
-- security_migration.sql
-- WealthLens Hub — Security hardening migration
--
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New Query).
-- Safe to run multiple times (uses IF NOT EXISTS / OR REPLACE patterns).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add sha256 column to artifacts (file integrity)
-- ---------------------------------------------------------------------------
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS sha256 text;

-- ---------------------------------------------------------------------------
-- 2. Import audit log table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_logs (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source       text    NOT NULL,   -- 'CAS_PDF' | 'CSV' | 'EXCEL' | 'SNAPTRADE' | 'PLAID' | 'MANUAL'
  status       text    NOT NULL,   -- 'SUCCESS' | 'PARTIAL' | 'FAILED'
  rows_in      integer DEFAULT 0,
  rows_ok      integer DEFAULT 0,
  rows_failed  integer DEFAULT 0,
  error_detail jsonb,
  created_at   timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security on all user-data tables
-- ---------------------------------------------------------------------------
ALTER TABLE portfolio              ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_logs            ENABLE ROW LEVEL SECURITY;

-- Enable RLS on tables that may exist from migration files
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'profiles') THEN
    EXECUTE 'ALTER TABLE profiles ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'asset_types') THEN
    EXECUTE 'ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'portfolio_shares') THEN
    EXECUTE 'ALTER TABLE portfolio_shares ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'net_worth_snapshots') THEN
    EXECUTE 'ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'snaptrade_connections') THEN
    EXECUTE 'ALTER TABLE snaptrade_connections ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'plaid_connections') THEN
    EXECUTE 'ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'budget_statements') THEN
    EXECUTE 'ALTER TABLE budget_statements ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'budget_transactions') THEN
    EXECUTE 'ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — portfolio
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "portfolio_owner" ON portfolio;
CREATE POLICY "portfolio_owner" ON portfolio
  FOR ALL USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. RLS Policies — holdings (owner + shared viewer/editor)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "holdings_owner" ON holdings;
CREATE POLICY "holdings_owner" ON holdings
  FOR ALL USING (user_id = auth.uid());

-- Shared read access: a user can read holdings if they appear in portfolio_shares
DROP POLICY IF EXISTS "holdings_shared_read" ON holdings;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'portfolio_shares') THEN
    EXECUTE $p$
      CREATE POLICY "holdings_shared_read" ON holdings
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM portfolio_shares ps
            WHERE ps.owner_id = holdings.user_id
              AND ps.shared_with = auth.uid()
          )
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. RLS Policies — transactions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "transactions_owner" ON transactions;
CREATE POLICY "transactions_owner" ON transactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM holdings h
      WHERE h.id = transactions.holding_id
        AND h.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 7. RLS Policies — artifacts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "artifacts_owner" ON artifacts;
CREATE POLICY "artifacts_owner" ON artifacts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM holdings h
      WHERE h.id = artifacts.holding_id
        AND h.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 8. RLS Policies — profiles
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'profiles') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "profiles_owner" ON profiles;
      CREATE POLICY "profiles_owner" ON profiles
        FOR ALL USING (id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. RLS Policies — asset_types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'asset_types') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "asset_types_owner" ON asset_types;
      CREATE POLICY "asset_types_owner" ON asset_types
        FOR ALL USING (user_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. RLS Policies — net_worth_snapshots
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'net_worth_snapshots') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "snapshots_owner" ON net_worth_snapshots;
      CREATE POLICY "snapshots_owner" ON net_worth_snapshots
        FOR ALL USING (user_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. RLS Policies — snaptrade_connections
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'snaptrade_connections') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "snaptrade_owner" ON snaptrade_connections;
      CREATE POLICY "snaptrade_owner" ON snaptrade_connections
        FOR ALL USING (owner_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 12. RLS Policies — plaid_connections
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'plaid_connections') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "plaid_owner" ON plaid_connections;
      CREATE POLICY "plaid_owner" ON plaid_connections
        FOR ALL USING (user_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. RLS Policies — import_logs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "import_logs_owner" ON import_logs;
CREATE POLICY "import_logs_owner" ON import_logs
  FOR ALL USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 14. RLS Policies — budget tables (if they exist)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'budget_statements') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "budget_statements_owner" ON budget_statements;
      CREATE POLICY "budget_statements_owner" ON budget_statements
        FOR ALL USING (user_id = auth.uid())
    $p$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'budget_transactions') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "budget_transactions_owner" ON budget_transactions;
      CREATE POLICY "budget_transactions_owner" ON budget_transactions
        FOR ALL USING (user_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Done
-- ---------------------------------------------------------------------------
SELECT 'security_migration complete' AS status;
