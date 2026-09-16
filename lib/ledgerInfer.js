/**
 * lib/ledgerInfer.js — pure logic for inferring ledger rows from unit deltas.
 *
 * A summary / depository CAS tells us "you hold N units as of <date>". If the
 * ledger (real CAS rows + manual rows + earlier inferred rows) accounts for a
 * different number of units on that date, something happened that no row
 * explains — typically a SIP instalment after the last detailed statement.
 *
 * We synthesise one INFERRED BUY (or SELL) for the difference, dated as well as
 * we can guess (the holding's known SIP day inside the statement window, else the
 * statement date) and priced at the historical NAV on that day. It is always
 * replaced when a detailed CAS covering the window arrives (migration 0031).
 *
 * Inference is deliberately conservative:
 *   • only when a baseline ledger already exists (≥1 non-inferred row) — with no
 *     baseline the "gap" would be the whole position and cost basis would be
 *     meaningless;
 *   • never for rows older than the statement (net units are computed as of the
 *     statement date, so later manual entries don't confuse it);
 *   • ignored when the delta is inside rounding tolerance.
 */
import { createHash } from "crypto";

const ADD = new Set(["BUY", "SIP", "BONUS", "RIGHTS"]);
const SUB = new Set(["SELL", "SWP", "REDEEM"]);

/** Net units from ledger rows dated on/before `asOf` (superseded rows are already zeroed). */
export function netUnitsAsOf(txns, asOf) {
  let n = 0;
  for (const t of txns || []) {
    if (asOf && t.txn_date > asOf) continue;
    const u = Math.abs(Number(t.units) || 0);
    if (ADD.has(t.txn_type)) n += u;
    else if (SUB.has(t.txn_type)) n -= u;
  }
  return n;
}

/**
 * Most recent SIP-like day-of-month from BUY rows (≥3 buys sharing a day ±1).
 * Returns null when no pattern.
 */
export function detectSipDay(txns) {
  const days = {};
  for (const t of txns || []) {
    if (!ADD.has(t.txn_type) || !t.txn_date) continue;
    const d = Number(t.txn_date.slice(8, 10));
    days[d] = (days[d] || 0) + 1;
  }
  const best = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? Number(best[0]) : null;
}

/**
 * Decide whether an inferred row is needed for one holding.
 *
 * @param {object} p
 * @param {number} p.statementUnits   units printed on the statement
 * @param {string} p.statementDate    ISO
 * @param {string} [p.periodStart]    ISO (statement window start)
 * @param {Array}  p.txns             ledger rows for the holding
 * @param {number} [p.statementNav]   NAV on the statement (fallback price)
 * @returns {null | { txn_type, units, txn_date, reason }}
 */
export function planInference({ statementUnits, statementDate, periodStart = null, txns, statementNav = null }) {
  const rows = (txns || []).filter((t) => t.txn_date);
  const baseline = rows.some((t) => t.source_type !== "INFERRED" && Math.abs(Number(t.units) || 0) > 0);
  if (!baseline) return null;

  const have = netUnitsAsOf(rows, statementDate);
  const want = Number(statementUnits) || 0;
  const delta = want - have;
  const tol = Math.max(0.001, Math.abs(want) * 0.0005);
  if (Math.abs(delta) <= tol) return null;

  // Date guess: SIP day inside the window if the fund has a SIP rhythm, else statement date.
  let txnDate = statementDate;
  const sipDay = delta > 0 ? detectSipDay(rows) : null;
  if (sipDay) {
    const [y, m] = statementDate.split("-").map(Number);
    const cand = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(sipDay, 28)).padStart(2, "0")}`;
    const lastKnown = rows.reduce((mx, t) => (t.txn_date > mx ? t.txn_date : mx), "");
    if (cand <= statementDate && cand > lastKnown && (!periodStart || cand >= periodStart)) txnDate = cand;
  }

  return {
    txn_type: delta > 0 ? "BUY" : "SELL",
    units: Math.round(Math.abs(delta) * 10000) / 10000,
    txn_date: txnDate,
    fallback_price: statementNav || null,
    reason: `statement shows ${want} units, ledger explains ${Math.round(have * 10000) / 10000}`,
  };
}

/** Stable key so re-running inference for the same statement is idempotent. */
export function inferredKey(holdingId, statementDate) {
  return "INFER|" + createHash("sha1").update(`${holdingId}|${statementDate}`).digest("hex").slice(0, 20);
}
