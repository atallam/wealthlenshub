-- 0011: remove portfolio sharing feature.
-- Sharing was non-functional (frontend never loaded shares; shared-portfolio
-- route path mismatched after the router refactor) and unused. Managing family
-- portfolios via members under one account instead. Rebuild later if needed.

-- Drop the shared-read policy on holdings that referenced portfolio_shares.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holdings' AND policyname = 'holdings_shared_read') THEN
    EXECUTE 'DROP POLICY holdings_shared_read ON holdings';
  END IF;
END $$;

DROP TABLE IF EXISTS portfolio_shares;

NOTIFY pgrst, 'reload schema';
