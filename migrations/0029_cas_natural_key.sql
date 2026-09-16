-- 0029_cas_natural_key.sql
-- CAS import: replace "flush-and-fill" with an atomic, keyed reconcile.
--
-- Problems this fixes (see services/holdings.service.js history):
--   * Importing a CDSL CAS after an NSDL CAS (or a CAMS CAS after either) for the
--     same member deleted the earlier file's holdings — the flush was keyed on
--     (member, source='cas') only.
--   * Every re-import regenerated holding ids, so transactions / artifacts /
--     concall_analyses (all ON DELETE CASCADE) were silently wiped each month.
--   * DELETE + INSERT ran as two separate calls: a failed insert left the member
--     with an empty portfolio.
--
-- New model
--   Natural key for a CAS row:  (user_id, member_id, depository, account_id, isin)
--     depository  'NSDL' | 'CDSL' | 'CAMS' | 'KFINTECH' | 'LEGACY' (pre-migration rows)
--     account_id  demat "dpid/clientid" for NSDL/CDSL, folio number for CAMS/KFin,
--                 'MF-FOLIOS' for the MF section inside a depository CAS
--     isin        ISIN of the instrument
--   holding_status 'active' | 'exited'  — a holding that disappears from the
--     latest statement of its account is marked exited (units/values zeroed,
--     prior numbers kept in exit_snapshot) instead of deleted, so anything that
--     references its id survives. Rows with no dependents are hard-deleted.
--
--   apply_cas_snapshot()  — single-transaction reconcile used by both the manual
--     upload path and the Gmail auto-import cron.
--
-- Safe to run multiple times.

BEGIN;

-- ── 1. Columns ────────────────────────────────────────────────────────────────
ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS depository       text,
  ADD COLUMN IF NOT EXISTS account_id       text,
  ADD COLUMN IF NOT EXISTS isin             text,
  ADD COLUMN IF NOT EXISTS holding_status   text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS exited_at        date,
  ADD COLUMN IF NOT EXISTS exit_snapshot    jsonb,
  ADD COLUMN IF NOT EXISTS last_import_id   text;

COMMENT ON COLUMN holdings.depository     IS 'NSDL | CDSL | CAMS | KFINTECH | LEGACY — which statement family this CAS row came from';
COMMENT ON COLUMN holdings.account_id     IS 'dpid/clientid (demat) or folio number (RTA) — scopes exit detection on re-import';
COMMENT ON COLUMN holdings.isin           IS 'Instrument ISIN — part of the CAS natural key';
COMMENT ON COLUMN holdings.holding_status IS 'active | exited — exited rows are kept (zeroed) so transactions/artifacts survive';

ALTER TABLE import_logs
  ADD COLUMN IF NOT EXISTS statement_hash text,
  ADD COLUMN IF NOT EXISTS depository     text,
  ADD COLUMN IF NOT EXISTS statement_date date,
  ADD COLUMN IF NOT EXISTS summary        jsonb;

CREATE INDEX IF NOT EXISTS idx_import_logs_hash ON import_logs(user_id, statement_hash) WHERE statement_hash IS NOT NULL;

-- ── 2. Backfill existing CAS rows so they participate in the key ─────────────
UPDATE holdings
   SET isin = COALESCE(NULLIF(ticker, ''), NULLIF(scheme_code, ''))
 WHERE source = 'cas' AND isin IS NULL;

UPDATE holdings SET depository = 'LEGACY' WHERE source = 'cas' AND depository IS NULL;
UPDATE holdings SET account_id = ''       WHERE source = 'cas' AND account_id IS NULL;
UPDATE holdings SET holding_status = 'active' WHERE holding_status IS NULL;

-- Defensive: collapse any pre-existing duplicates on the key (keep newest).
DELETE FROM holdings h
 USING holdings h2
 WHERE h.source = 'cas' AND h2.source = 'cas'
   AND h.user_id = h2.user_id
   AND h.member_id IS NOT DISTINCT FROM h2.member_id
   AND h.depository = h2.depository
   AND h.account_id = h2.account_id
   AND h.isin = h2.isin
   AND h.isin IS NOT NULL
   AND h.created_at < h2.created_at;

-- ── 3. Natural-key uniqueness (CAS rows only) ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_holdings_cas_key
  ON holdings (user_id, COALESCE(member_id, ''), depository, account_id, isin)
  WHERE source = 'cas' AND isin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_holdings_status ON holdings(user_id, holding_status);

-- ── 4a. Helper: retire a set of CAS rows ─────────────────────────────────────
-- Rows nothing references (transactions / artifacts / concall_analyses) are
-- hard-deleted; the rest are soft-exited with their numbers zeroed and kept in
-- exit_snapshot. Returns {deleted, exited}.
CREATE OR REPLACE FUNCTION _retire_cas_rows(p_ids text[], p_statement_date date, p_import_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_free    text[];
  v_deleted int := 0;
  v_exited  int := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0, 'exited', 0);
  END IF;

  SELECT array_agg(u.hid) INTO v_free FROM unnest(p_ids) AS u(hid)
   WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.holding_id = u.hid)
     AND NOT EXISTS (SELECT 1 FROM artifacts   a WHERE a.holding_id = u.hid);
  IF v_free IS NOT NULL AND to_regclass('public.concall_analyses') IS NOT NULL THEN
    EXECUTE 'SELECT array_agg(u.hid) FROM unnest($1) AS u(hid) WHERE NOT EXISTS (SELECT 1 FROM concall_analyses c WHERE c.holding_id::text = u.hid)'
       INTO v_free USING v_free;
  END IF;
  IF v_free IS NOT NULL THEN
    DELETE FROM holdings WHERE id = ANY(v_free);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  UPDATE holdings h
     SET holding_status = 'exited',
         exited_at      = COALESCE(p_statement_date, CURRENT_DATE),
         exit_snapshot  = jsonb_build_object(
                            'units', h.units, 'current_value', h.current_value,
                            'purchase_value', h.purchase_value, 'current_price', h.current_price,
                            'current_nav', h.current_nav, 'source_date', h.source_date,
                            'depository', h.depository),
         units = 0, current_value = 0, purchase_value = 0,
         last_import_id = p_import_id, updated_at = now()
   WHERE h.id = ANY(p_ids) AND NOT (h.id = ANY(COALESCE(v_free, ARRAY[]::text[])))
     AND h.holding_status = 'active';
  GET DIAGNOSTICS v_exited = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'exited', v_exited);
END;
$$;

-- ── 4b. Atomic reconcile RPC ──────────────────────────────────────────────────
-- p_groups: [
--   { "member_id": "...", "account_ids": ["12345678/00012345", ...],
--     "rows": [ { "isin","account_id","name","type","ticker","scheme_code","units",
--                 "purchase_nav","current_nav","purchase_price","current_price",
--                 "purchase_value","current_value","brokerage_name","currency",
--                 "start_date" } ... ] }
-- ]
-- Every row is upserted on the natural key (ids are preserved across re-imports).
-- Any ACTIVE CAS row for (member, depository, account_id ∈ account_ids) whose ISIN
-- is not in the incoming set is marked exited (or deleted if nothing references it).
-- p_retire_legacy: also retire the member's pre-migration rows (depository='LEGACY')
-- — they are the old flush-and-fill snapshot this import supersedes.
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
        name, type, ticker, scheme_code,
        units, purchase_nav, current_nav, purchase_price, current_price,
        purchase_value, current_value,
        brokerage_name, currency, start_date,
        source, import_method, source_date, cas_period_start, cas_period_end,
        holding_status, exited_at, exit_snapshot, last_import_id, updated_at, created_at
      ) VALUES (
        'h_' || replace(gen_random_uuid()::text, '-', ''),
        p_user_id, v_member, p_depository, COALESCE(r->>'account_id', ''), r->>'isin',
        COALESCE(NULLIF(r->>'name', ''), r->>'isin'), COALESCE(r->>'type', 'IN_STOCK'),
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
      RETURNING (xmax = 0) INTO v_is_insert;

      IF v_is_insert IS NULL THEN
        v_skipped := v_skipped + 1;           -- rejected: DB already has a newer statement
      ELSIF v_is_insert THEN
        v_inserted := v_inserted + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
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
    'exited', v_exited, 'deleted', v_deleted, 'legacy_retired', v_legacy
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION apply_cas_snapshot(uuid, text, jsonb, date, date, date, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION _retire_cas_rows(text[], date, text) FROM public;

COMMIT;
