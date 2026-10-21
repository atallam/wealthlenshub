-- 0035_cas_retire_overlap.sql
-- "Keep newest only": after a multi-statement import the user can retire the OLDER copy
-- of a mutual fund that two depositories/RTAs both list (the same folio seen twice).
--   * only the caller's own, active, CAS-sourced MF rows are touched
--   * rows with no dependents are deleted; the rest are soft-exited (units zeroed, numbers
--     kept in exit_snapshot) so their transactions / documents survive — same as _retire_cas_rows
-- Requires 0029. Safe to run multiple times.

BEGIN;

CREATE OR REPLACE FUNCTION retire_cas_overlap_rows(
  p_user_id        uuid,
  p_ids            text[],
  p_statement_date date,
  p_import_id      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT array_agg(h.id) INTO v_ids
    FROM holdings h
   WHERE h.id = ANY(p_ids)
     AND h.user_id = p_user_id
     AND h.source = 'cas'
     AND h.type = 'MF'
     AND h.holding_status = 'active';
  RETURN _retire_cas_rows(v_ids, p_statement_date, p_import_id);
END;
$$;

REVOKE ALL ON FUNCTION retire_cas_overlap_rows(uuid, text[], date, text) FROM public;
GRANT EXECUTE ON FUNCTION retire_cas_overlap_rows(uuid, text[], date, text) TO service_role;

COMMIT;
