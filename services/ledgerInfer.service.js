/**
 * services/ledgerInfer.service.js — fill ledger gaps after a CAS import.
 *
 * Runs right after apply_cas_snapshot() for the holdings that import touched.
 * For each one, compares the units the statement printed with what the ledger
 * explains as of the statement date and, when they differ, writes one
 * source_type='INFERRED' row (see lib/ledgerInfer.js for the rules).
 *
 * Idempotent: the row is keyed INFER|<holding>|<statement date>, so re-running
 * for the same statement updates rather than duplicates. A later detailed CAS
 * deletes inferred rows inside its window (migration 0031).
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { planInference, inferredKey } from "../lib/ledgerInfer.js";
import { fetchMfNavOn, schemeCodeForIsin } from "../lib/prices.js";

const tId = () => "t_" + randomUUID().replace(/-/g, "").slice(0, 16);
const CONCURRENCY = 4;

async function priceFor(h, date, fallback) {
  if (h.type === "MF") {
    try {
      const code = h.scheme_code || (await schemeCodeForIsin(h.isin));
      if (code) {
        const hit = await fetchMfNavOn(code, date);
        if (hit?.nav) return { price: hit.nav, price_date: hit.date, estimated: hit.offset !== 0 };
      }
    } catch { /* fall through to statement NAV */ }
  }
  return { price: fallback || 0, price_date: null, estimated: true };
}

/**
 * @param {string} userId
 * @param {string} importId   last_import_id stamped by apply_cas_snapshot
 * @param {{ statementDate: string, periodStart?: string }} stmt
 * @returns {{ inferred: number, updated: number, skipped: number, details: Array }}
 */
export async function inferLedgerGaps(userId, importId, { statementDate, periodStart = null }) {
  const out = { inferred: 0, updated: 0, skipped: 0, details: [] };
  if (!importId || !statementDate) return out;

  const { data: holdings, error } = await supabase.from("holdings")
    .select("id, name, type, isin, scheme_code, units, current_nav, current_price, holding_status")
    .eq("user_id", userId).eq("last_import_id", importId)
    .in("type", ["MF", "IN_STOCK", "IN_ETF"]);
  if (error || !holdings?.length) return out;
  const active = holdings.filter((h) => h.holding_status !== "exited");
  if (!active.length) return out;

  const { data: txns } = await supabase.from("transactions")
    .select("id, holding_id, txn_type, units, txn_date, source, source_type, external_key")
    .eq("user_id", userId).in("holding_id", active.map((h) => h.id));
  const byHolding = {};
  for (const t of txns || []) (byHolding[t.holding_id] ||= []).push(t);

  const queue = [...active];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const h = queue.shift();
      const rows = byHolding[h.id] || [];
      const plan = planInference({
        statementUnits: h.units, statementDate, periodStart, txns: rows,
        statementNav: Number(h.current_nav) || Number(h.current_price) || null,
      });
      if (!plan) { out.skipped++; continue; }

      const { price, price_date, estimated } = await priceFor(h, plan.txn_date, plan.fallback_price);
      const key = inferredKey(h.id, statementDate);
      const existing = rows.find((t) => t.external_key === key);
      const payload = {
        txn_type: plan.txn_type, units: plan.units, price, amount: Math.round(plan.units * price * 100) / 100,
        txn_date: plan.txn_date, source: "cas", source_type: "INFERRED", external_key: key, import_id: importId,
        description: `Inferred from unit change on ${statementDate} statement — ${plan.reason}${price_date ? `; NAV of ${price_date}` : "; statement NAV"}`,
        notes: `Inferred ${plan.txn_type.toLowerCase()} (statement ${statementDate})${estimated ? " · est. price" : ""}`,
      };
      let err;
      if (existing) {
        ({ error: err } = await supabase.from("transactions").update(payload).eq("id", existing.id).eq("user_id", userId));
        if (!err) out.updated++;
      } else {
        ({ error: err } = await supabase.from("transactions").insert({ id: tId(), user_id: userId, holding_id: h.id, ...payload }));
        if (!err) out.inferred++;
      }
      if (err) console.warn(`[ledgerInfer] ${h.name}: ${err.message}`);
      else out.details.push({ holding_id: h.id, name: h.name, ...plan, price, estimated });
    }
  });
  await Promise.all(workers);
  return out;
}
