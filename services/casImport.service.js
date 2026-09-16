/**
 * services/casImport.service.js — CAS (NSDL / CDSL / CAMS / KFintech) reconcile.
 *
 * Replaces the old flush-and-fill in holdings.service.js and routes/gmail.js.
 * Both the manual upload route and the Gmail auto-import cron call the same
 * two functions:
 *
 *   previewCasImport(userId, body) → diff only, nothing written
 *   applyCasImport(userId, body)   → one atomic apply_cas_snapshot() RPC
 *                                    (migrations/0029_cas_natural_key.sql)
 *
 * body: {
 *   holdings, account_map | member_id, depository,
 *   cas_statement_date, cas_period_start, cas_period_end,
 *   statement_hash?, import_method?, dup_actions?: { "<member>|<isin>": "skip"|"update" },
 *   retire_legacy?: boolean (default true)
 * }
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { groupByMember, diffCas, buildApplyGroups } from "../lib/casDiff.js";
import { inferLedgerGaps } from "./ledgerInfer.service.js";

const VALID_DEPOSITORIES = new Set(["NSDL", "CDSL", "CAMS", "KFINTECH"]);

function normDepository(d) {
  const v = String(d || "").trim().toUpperCase();
  if (VALID_DEPOSITORIES.has(v)) return v;
  if (v.startsWith("NSDL")) return "NSDL";
  if (v.startsWith("CDSL")) return "CDSL";
  if (v.startsWith("KFIN")) return "KFINTECH";
  if (v.startsWith("CAMS")) return "CAMS";
  return null;
}

async function loadExistingCas(userId, memberIds) {
  let q = supabase.from("holdings")
    .select("id, member_id, depository, account_id, isin, units, current_value, holding_status, source_date, source, name, type")
    .eq("user_id", userId).eq("source", "cas");
  if (memberIds?.length) q = q.in("member_id", memberIds);
  const { data, error } = await q;
  if (error) throw new Error(`load existing holdings: ${error.message}`);
  return data || [];
}

/** Has this exact statement (by content hash) already been applied for this user? */
export async function findPriorImport(userId, statementHash) {
  if (!statementHash) return null;
  const { data } = await supabase.from("import_logs")
    .select("id, created_at, summary, depository, statement_date")
    .eq("user_id", userId).eq("statement_hash", statementHash).eq("status", "SUCCESS")
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

function prepare(body) {
  const depository = normDepository(body.depository);
  if (!depository) {
    const err = new Error("depository is required (NSDL | CDSL | CAMS | KFINTECH) — re-upload the statement");
    err.status = 400; throw err;
  }
  const { groups, unmatched } = groupByMember(body.holdings || [], {
    account_map: body.account_map && Object.keys(body.account_map).length ? body.account_map : null,
    member_id:   body.member_id || null,
  });
  return { depository, groups, unmatched };
}

/** Diff-only. Safe to call repeatedly while the user adjusts member mapping. */
export async function previewCasImport(userId, body) {
  const { depository, groups, unmatched } = prepare(body);
  const existing = await loadExistingCas(userId, groups.map((g) => g.member_id));
  const diff = diffCas(groups, existing, { depository, statementDate: body.cas_statement_date || null });
  const prior = await findPriorImport(userId, body.statement_hash);
  return {
    ok: true,
    depository,
    statement_date: body.cas_statement_date || null,
    members: groups.map((g) => ({ member_id: g.member_id, accounts: g.account_ids, count: g.rows.length })),
    unmatched: unmatched.map((u) => ({ isin: u.isin, name: u.name, reason: u._reason, holder: u._holder_name })),
    already_imported: prior ? { at: prior.created_at, summary: prior.summary } : null,
    ...diff,
  };
}

/** Atomic apply. Returns the same shape the old importHoldings() returned so callers keep working. */
export async function applyCasImport(userId, body) {
  const { depository, groups, unmatched } = prepare(body);
  const importId = "imp_" + randomUUID().replace(/-/g, "").slice(0, 16);
  const applyGroups = buildApplyGroups(groups, body.dup_actions || {});

  if (applyGroups.length === 0) {
    return { ok: true, inserted_count: 0, updated_count: 0, skipped_count: unmatched.length, error_count: 0,
      inserted: [], updated: [], skipped: unmatched.map((u) => u.name), errors: [], exited_count: 0,
      needs_price_refresh: false, _cas_statement_date: body.cas_statement_date || null, import_id: importId };
  }

  const { data, error } = await supabase.rpc("apply_cas_snapshot", {
    p_user_id:        userId,
    p_depository:     depository,
    p_groups:         applyGroups,
    p_statement_date: body.cas_statement_date || null,
    p_period_start:   body.cas_period_start   || null,
    p_period_end:     body.cas_period_end     || null,
    p_import_method:  body.import_method      || "manual_upload",
    p_import_id:      importId,
    p_retire_legacy:  body.retire_legacy !== false,
  });
  if (error) {
    // Nothing was written — the RPC is one transaction.
    const err = new Error(`CAS import failed (no changes were made): ${error.message}`);
    err.status = 500; throw err;
  }
  const r = data || {};

  // Phase 4: fill ledger gaps the statement reveals (unit changes no row explains).
  // Best-effort — a NAV lookup failure prices the row at the statement NAV instead.
  let infer = { inferred: 0, updated: 0, skipped: 0, details: [] };
  if (body.infer_ledger !== false && body.cas_statement_date) {
    try {
      infer = await inferLedgerGaps(userId, importId, { statementDate: body.cas_statement_date, periodStart: body.cas_period_start || null });
    } catch (e) { console.warn("[casImport] ledger inference failed:", e.message); }
  }

  // Idempotency / audit trail (best-effort, never blocks the import).
  try {
    await supabase.from("import_logs").insert({
      user_id: userId, source: "CAS_PDF", status: "SUCCESS",
      rows_in: (body.holdings || []).length,
      rows_ok: (r.inserted || 0) + (r.updated || 0),
      rows_failed: unmatched.length,
      statement_hash: body.statement_hash || null,
      depository, statement_date: body.cas_statement_date || null,
      summary: { ...r, import_id: importId, import_method: body.import_method || "manual_upload",
                 members: applyGroups.map((g) => g.member_id), unmatched: unmatched.length,
                 inferred: infer.inferred + infer.updated },
    });
  } catch (e) { console.warn("[casImport] import_logs insert failed:", e.message); }

  return {
    ok: true,
    import_id: importId,
    depository,
    inserted_count: r.inserted || 0,
    updated_count:  r.updated  || 0,
    unchanged_count: 0,
    exited_count:   r.exited   || 0,
    txns_inserted:  r.txns_inserted || 0,
    txns_existing:  r.txns_existing || 0,
    manual_superseded: r.manual_superseded || 0,
    inferred_replaced: r.inferred_replaced || 0,
    inferred_count: infer.inferred + infer.updated,
    inferred: infer.details.map((d) => ({ name: d.name, txn_type: d.txn_type, units: d.units, txn_date: d.txn_date, estimated: d.estimated })),
    deleted_count:  r.deleted  || 0,
    legacy_retired: r.legacy_retired || 0,
    skipped_older:  r.skipped_older || 0,
    skipped_count:  unmatched.length,
    error_count: 0,
    inserted: [], updated: [], skipped: unmatched.map((u) => u.name), errors: [],
    needs_price_refresh: (r.inserted || 0) + (r.updated || 0) > 0,
    _cas_statement_date: body.cas_statement_date || null,
  };
}
