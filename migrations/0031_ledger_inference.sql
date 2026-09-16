-- 0031_ledger_inference.sql
-- Phase 4: keep the ledger accurate from the monthly statements alone.
--
--   * transactions.superseded_by / superseded_snapshot — when a detailed CAS
--     brings the authoritative row for an event the user had typed by hand
--     (same type, ±3 days, units within 0.5%), the manual row is zeroed and
--     linked to the CAS row instead of being deleted. Zeroing means every
--     consumer (net units, FIFO lots, XIRR, tax) ignores it with no extra
--     filtering; the original values stay in superseded_snapshot.
--   * source_type = 'INFERRED' rows — created by the app (services/ledgerInfer.js)
--     when a summary / depository statement shows a unit change that no ledger
--     row explains. apply_cas_snapshot() deletes INFERRED rows inside the window
--     of any statement that carries real transactions, so a detailed CAS always
--     wins.
--
-- Requires 0030. Safe to run multiple times.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS superseded_by       text,
  ADD COLUMN IF NOT EXISTS superseded_snapshot jsonb;
CREATE INDEX IF NOT EXISTS idx_transactions_source_type ON transactions (holding_id, source_type) WHERE source_type IS NOT NULL;

-- Re-create the reconcile RPC (same signature as 0029/0030).
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
  v_n          int;
  v_cas_tid    text;
  v_mid        text;
  v_win_start  date;
  v_win_end    date;
  v_manual_sup int := 0;
  v_inf_del    int := 0;
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

      -- Real transactions for this window supersede any rows the app inferred
      -- from unit deltas between summary statements (source_type = 'INFERRED').
      v_win_start := COALESCE(p_period_start, '1900-01-01'::date);
      v_win_end   := COALESCE(p_period_end, p_statement_date, CURRENT_DATE);
      DELETE FROM transactions tx
       WHERE tx.holding_id = v_hid AND tx.source = 'cas' AND tx.source_type = 'INFERRED'
         AND tx.txn_date BETWEEN v_win_start AND v_win_end;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_inf_del := v_inf_del + v_n;

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
        RETURNING (xmax = 0), tx.id INTO v_is_insert, v_cas_tid;
        IF v_is_insert THEN v_txn_in := v_txn_in + 1; ELSE v_txn_dup := v_txn_dup + 1; END IF;

        -- A hand-entered row for the same event (same type, ±3 days, units within
        -- 0.5%) is now redundant: zero it and point it at the CAS row. Values are
        -- kept in superseded_snapshot so the user can see what was replaced.
        IF v_is_insert AND COALESCE(t->>'source_type', '') NOT IN ('OPENING', 'INFERRED')
           AND COALESCE((t->>'units')::numeric, 0) > 0 THEN
          SELECT m.id INTO v_mid FROM transactions m
           WHERE m.holding_id = v_hid AND m.source IS NULL AND m.superseded_by IS NULL
             AND m.txn_type = COALESCE(t->>'txn_type', 'BUY')
             AND abs(m.txn_date - (t->>'txn_date')::date) <= 3
             AND m.units > 0
             AND abs(m.units - (t->>'units')::numeric) / (t->>'units')::numeric <= 0.005
           ORDER BY abs(m.txn_date - (t->>'txn_date')::date), abs(m.units - (t->>'units')::numeric)
           LIMIT 1;
          IF v_mid IS NOT NULL THEN
            UPDATE transactions m
               SET superseded_by = v_cas_tid,
                   superseded_snapshot = jsonb_build_object('units', m.units, 'price', m.price, 'amount', m.amount, 'txn_date', m.txn_date, 'notes', m.notes),
                   units = 0, price = 0, amount = 0,
                   notes = 'Replaced by CAS statement row (' || COALESCE(t->>'source_type', 'CAS') || ' ' || (t->>'txn_date') || ')'
             WHERE m.id = v_mid;
            v_manual_sup := v_manual_sup + 1;
            v_mid := NULL;
          END IF;
        END IF;
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
    'txns_inserted', v_txn_in, 'txns_existing', v_txn_dup,
    'manual_superseded', v_manual_sup, 'inferred_replaced', v_inf_del
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) TO service_role;

COMMIT;
