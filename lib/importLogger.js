/**
 * importLogger.js — Audit logging for data import operations.
 *
 * Writes a row to the `import_logs` table after each import attempt.
 * Table is created by security_migration.sql.
 *
 * Usage in a route:
 *   import { logImport } from "../lib/importLogger.js";
 *
 *   await logImport(supabase, req.user.id, {
 *     source: "CAS_PDF",
 *     status: "SUCCESS",
 *     rowsIn: holdings.length,
 *     rowsOk: inserted,
 *     rowsFailed: skipped,
 *   });
 */

import { supabase } from "./db.js";

/**
 * @param {object} supabaseClient  — pass the shared supabase client
 * @param {string} userId          — req.user.id
 * @param {object} opts
 * @param {string} opts.source     — 'CAS_PDF'|'CSV'|'EXCEL'|'SNAPTRADE'|'PLAID'|'MANUAL'
 * @param {string} opts.status     — 'SUCCESS'|'PARTIAL'|'FAILED'
 * @param {number} [opts.rowsIn]
 * @param {number} [opts.rowsOk]
 * @param {number} [opts.rowsFailed]
 * @param {object} [opts.errorDetail]  — any extra context for failures
 */
export async function logImport(supabaseClient, userId, {
  source,
  status,
  rowsIn = 0,
  rowsOk = 0,
  rowsFailed = 0,
  errorDetail = null,
} = {}) {
  try {
    await supabaseClient.from("import_logs").insert({
      user_id:      userId,
      source,
      status,
      rows_in:      rowsIn,
      rows_ok:      rowsOk,
      rows_failed:  rowsFailed,
      error_detail: errorDetail,
    });
  } catch (err) {
    // Never let audit logging break the import flow.
    console.error("[importLogger] Failed to write audit log:", err.message);
  }
}

/**
 * Express middleware factory for automatic import audit logging.
 *
 * Wraps the route handler; logs SUCCESS or FAILED based on response status.
 * Attach counts via res.locals.importStats before the handler finishes:
 *   res.locals.importStats = { rowsIn: 10, rowsOk: 8, rowsFailed: 2 };
 *
 * @param {string} source — import source label
 */
export function auditImport(source) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const stats = res.locals.importStats || {};
      const status = res.statusCode < 400 ? "SUCCESS" : "FAILED";
      logImport(supabase, req.user?.id, {
        source,
        status,
        rowsIn:     stats.rowsIn || 0,
        rowsOk:     stats.rowsOk || 0,
        rowsFailed: stats.rowsFailed || 0,
        errorDetail: status === "FAILED" ? { responseBody: body, statusCode: res.statusCode } : null,
      });
      return originalJson(body);
    };
    next();
  };
}
