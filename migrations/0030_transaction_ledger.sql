-- 0030_transaction_ledger.sql
-- Phase 3: treat transactions as the ledger and holdings as the derived view.
--
--   * Detailed CAMS/KFintech CAS statements carry every purchase / SIP /
--     redemption / switch / dividend. The parser now emits them as ledger rows
--     and apply_cas_snapshot() upserts them alongside the holding, keyed by
--     external_key (hash of folio|isin|date|type|units|amount) so overlapping or
--     repeated statements never double-book.
--   * holdings.asset_class (EQUITY | DEBT | HYBRID | UNKNOWN) drives the
--     capital-gains rules (debt MF bought on/after 1-Apr-2023 is taxed at slab
--     regardless of holding period).
--   * XIRR and FIFO tax lots are computed from this ledger (lib/xirr.js, lib/tax.js).
--
-- Requires 0029. Safe to run multiple times.

BEGIN;

ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS asset_class text;
COMMENT ON COLUMN holdings.asset_class IS 'EQUITY | DEBT | HYBRID | UNKNOWN — from CAS scheme type; drives LTCG/STCG rules';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount         numeric,
  ADD COLUMN IF NOT EXISTS source         text,       -- 'cas' | NULL (manual)
  ADD COLUMN IF NOT EXISTS source_type    text,       -- raw CAS type: PURCHASE_SIP, REDEMPTION, SWITCH_IN, OPENING ...
  ADD COLUMN IF NOT EXISTS external_key   text,       -- idempotency key for imported rows
  ADD COLUMN IF NOT EXISTS description    text,       -- statement narration
  ADD COLUMN IF NOT EXISTS balance_after  numeric,    -- units after this row, as printed on the statement
  ADD COLUMN IF NOT EXISTS import_id      text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_external_key
  ON transactions (holding_id, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_holding_date ON transactions (holding_id, txn_date);

-- Re-create the reconcile RPC with ledger support (same signature as 0029).
CREATE OR REPLACE FUNCTION apply_cas_snapshot(
  p_user_id        uuid,
  p_depository     text,
  p_groups         jsonb,
  p_statement_date date,
  p_period_start   date,
  p_period_end     date,
  p_import_method  text,
  p_import_id      text,
  p_retire_legacy  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g            jsonb;
  r            jsonb;
  v_member     text;
  v_accounts   text[];
  v_isins      text[];
  v_gone       text[];
  v_res        jsonb;
  v_legacy     int := 0;
  v_inserted   int := 0;
  v_updated    int := 0;
  v_skipped    int := 0;
  v_exited     int := 0;
  v_deleted    int := 0;
  v_is_insert  boolean;
  v_hid        text;
  t            jsonb;
  v_txn_in     int := 0;
  v_txn_dup    int := 0;
  v_open_date  date;
  v_has_open   boolean;
  v_min_exist  date;
  v_now        timestamptz := now();
BEGIN
  IF p_depository IS NULL OR p_depository = '' THEN
    RAISE EXCEPTION 'apply_cas_snapshot: depository is required';
  END IF;

  FOR g IN SELECT * FROM jsonb_array_elements(p_groups) LOOP
    v_member   := g->>'member_id';
    v_accounts := ARRAY(SELECT jsonb_array_elements_text(COALESCE(g->'account_ids', '[]'::jsonb)));
    v_isins    := ARRAY(SELECT DISTINCT x->>'isin' FROM jsonb_array_elements(COALESCE(g->'rows', '[]'::jsonb)) x WHERE COALESCE(x->>'isin', '') <> '');

    -- Upsert every incoming row (ids are preserved on conflict).
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(g->'rows', '[]'::jsonb)) LOOP
      CONTINUE WHEN COALESCE(r->>'isin', '') = '';
      v_is_insert := NULL;

      INSERT INTO holdings AS h (
        id, user_id, member_id, depository, account_id, isin,
        name, type, asset_class, ticker, scheme_code,
        units, purchase_nav, current_nav, purchase_price, current_price,
        purchase_value, current_value,
        brokerage_name, currency, start_date,
        source, import_method, source_date, cas_period_start, cas_period_end,
        holding_status, exited_at, exit_snapshot, last_import_id, updated_at, created_at
      ) VALUES (
        'h_' || replace(gen_random_uuid()::text, '-', ''),
        p_user_id, v_member, p_depository, COALESCE(r->>'account_id', ''), r->>'isin',
        COALESCE(NULLIF(r->>'name', ''), r->>'isin'), COALESCE(r->>'type', 'IN_STOCK'),
        NULLIF(r->>'asset_class', ''),
        COALESCE(r->>'ticker', ''), COALESCE(r->>'scheme_code', ''),
        COALESCE((r->>'units')::numeric, 0),
        (r->>'purchase_nav')::numeric, (r->>'current_nav')::numeric,
        (r->>'purchase_price')::numeric, (r->>'current_price')::numeric,
        COALESCE((r->>'purchase_value')::numeric, 0), COALESCE((r->>'current_value')::numeric, 0),
        r->>'brokerage_name', COALESCE(r->>'currency', 'INR'), NULLIF(r->>'start_date', '')::date,
        'cas', p_import_method, p_statement_date, p_period_start, p_period_end,
        'active', NULL, NULL, p_import_id, v_now, v_now
      )
      ON CONFLICT (user_id, COALESCE(member_id, ''), depository, account_id, isin)
        WHERE source = 'cas' AND isin IS NOT NULL
      DO UPDATE SET
        name             = EXCLUDED.name,
        type             = EXCLUDED.type,
        asset_class      = COALESCE(EXCLUDED.asset_class, h.asset_class),
        ticker           = EXCLUDED.ticker,
        scheme_code      = CASE WHEN EXCLUDED.scheme_code <> '' THEN EXCLUDED.scheme_code ELSE h.scheme_code END,
        units            = EXCLUDED.units,
        purchase_nav     = COALESCE(EXCLUDED.purchase_nav,   h.purchase_nav),
        current_nav      = COALESCE(EXCLUDED.current_nav,    h.current_nav),
        purchase_price   = COALESCE(EXCLUDED.purchase_price, h.purchase_price),
        current_price    = COALESCE(EXCLUDED.current_price,  h.current_price),
        purchase_value   = CASE WHEN EXCLUDED.purchase_value > 0 THEN EXCLUDED.purchase_value ELSE h.purchase_value END,
        current_value    = EXCLUDED.current_value,
        brokerage_name   = COALESCE(EXCLUDED.brokerage_name, h.brokerage_name),
        currency         = EXCLUDED.currency,
        import_method    = EXCLUDED.import_method,
        source_date      = EXCLUDED.source_date,
        cas_period_start = EXCLUDED.cas_period_start,
        cas_period_end   = EXCLUDED.cas_period_end,
        holding_status   = 'active',
        exited_at        = NULL,
        exit_snapshot    = NULL,
        last_import_id   = EXCLUDED.last_import_id,
        updated_at       = v_now
      -- Never let an older statement regress a newer one.
      WHERE h.source_date IS NULL OR EXCLUDED.source_date IS NULL OR EXCLUDED.source_date >= h.source_date
      RETURNING (xmax = 0), h.id INTO v_is_insert, v_hid;

      IF v_is_insert IS NULL THEN
        v_skipped := v_skipped + 1;           -- rejected: DB already has a newer statement
        CONTINUE;
      ELSIF v_is_insert THEN
        v_inserted := v_inserted + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;

      -- ── Transaction ledger (detailed CAMS/KFin CAS) ───────────────────────
      -- Rows are keyed by external_key so overlapping statements are idempotent.
      -- An OPENING row stands in for units held before the statement window; a
      -- later statement that reaches further back (or to inception) replaces it.
      CONTINUE WHEN jsonb_typeof(r->'transactions') IS DISTINCT FROM 'array'
                 OR jsonb_array_length(r->'transactions') = 0;

      SELECT bool_or(x->>'source_type' = 'OPENING'), min((x->>'txn_date')::date) FILTER (WHERE x->>'source_type' = 'OPENING')
        INTO v_has_open, v_open_date
        FROM jsonb_array_elements(r->'transactions') x;

      -- Drop an existing OPENING placeholder when this statement reaches further back.
      DELETE FROM transactions tx
       WHERE tx.holding_id = v_hid AND tx.source = 'cas' AND tx.source_type = 'OPENING'
         AND (NOT COALESCE(v_has_open, false) OR (v_open_date IS NOT NULL AND v_open_date < tx.txn_date));

      -- Earliest ledger row already stored (real or OPENING) — an incoming OPENING
      -- that starts later than this adds nothing and would double-count.
      SELECT min(tx.txn_date) INTO v_min_exist FROM transactions tx
       WHERE tx.holding_id = v_hid AND tx.source = 'cas';

      FOR t IN SELECT * FROM jsonb_array_elements(r->'transactions') LOOP
        CONTINUE WHEN COALESCE(t->>'external_key', '') = '' OR COALESCE(t->>'txn_date', '') = '';
        CONTINUE WHEN t->>'source_type' = 'OPENING' AND v_min_exist IS NOT NULL AND v_min_exist < (t->>'txn_date')::date;
        INSERT INTO transactions AS tx (
          id, user_id, holding_id, txn_type, units, price, amount, txn_date, notes,
          source, source_type, external_key, description, balance_after, import_id, created_at
        ) VALUES (
          't_' || replace(gen_random_uuid()::text, '-', ''),
          p_user_id, v_hid, COALESCE(t->>'txn_type', 'BUY'),
          COALESCE((t->>'units')::numeric, 0), COALESCE((t->>'price')::numeric, 0),
          (t->>'amount')::numeric, (t->>'txn_date')::date,
          CASE WHEN t->>'source_type' = 'OPENING' THEN COALESCE(t->>'description', '') ELSE 'Imported from CAS (' || COALESCE(t->>'source_type', '') || ')' END,
          'cas', t->>'source_type', t->>'external_key', t->>'description',
          (t->>'balance_after')::numeric, p_import_id, v_now
        )
        ON CONFLICT (holding_id, external_key) WHERE external_key IS NOT NULL
        DO UPDATE SET
          units = EXCLUDED.units, price = EXCLUDED.price, amount = EXCLUDED.amount,
          balance_after = EXCLUDED.balance_after, description = EXCLUDED.description,
          import_id = EXCLUDED.import_id
        WHERE tx.source = 'cas'
        RETURNING (xmax = 0) INTO v_is_insert;
        IF v_is_insert THEN v_txn_in := v_txn_in + 1; ELSE v_txn_dup := v_txn_dup + 1; END IF;
      END LOOP;
    END LOOP;

    -- Exit detection, scoped to the accounts present in this statement.
    IF array_length(v_accounts, 1) IS NOT NULL THEN
      SELECT array_agg(h.id) INTO v_gone
        FROM holdings h
       WHERE h.user_id = p_user_id AND h.source = 'cas'
         AND h.member_id IS NOT DISTINCT FROM v_member
         AND h.depository = p_depository
         AND h.account_id = ANY(v_accounts)
         AND h.holding_status = 'active'
         AND NOT (h.isin = ANY(v_isins))
         AND (h.source_date IS NULL OR p_statement_date IS NULL OR p_statement_date >= h.source_date);
      v_res := _retire_cas_rows(v_gone, p_statement_date, p_import_id);
      v_deleted := v_deleted + (v_res->>'deleted')::int;
      v_exited  := v_exited  + (v_res->>'exited')::int;
    END IF;

    -- Pre-migration rows for this member (old flush-and-fill snapshot) are superseded.
    IF p_retire_legacy THEN
      SELECT array_agg(h.id) INTO v_gone
        FROM holdings h
       WHERE h.user_id = p_user_id AND h.source = 'cas'
         AND h.member_id IS NOT DISTINCT FROM v_member
         AND h.depository = 'LEGACY' AND h.holding_status = 'active';
      v_res := _retire_cas_rows(v_gone, p_statement_date, p_import_id);
      v_legacy := v_legacy + (v_res->>'deleted')::int + (v_res->>'exited')::int;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped_older', v_skipped,
    'exited', v_exited, 'deleted', v_deleted, 'legacy_retired', v_legacy,
    'txns_inserted', v_txn_in, 'txns_existing', v_txn_dup
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) TO service_role;

COMMIT;
