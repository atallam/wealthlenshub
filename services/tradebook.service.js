/**
 * services/tradebook.service.js — DB side of the broker tradebook import.
 *
 * preview(): parse + plan, writes nothing, returns the per-stock reconciliation.
 * commit():  same plan, then inserts the new orders as exact BUY/SELL ledger rows
 *            and retires superseded estimate rows (typed-in cost / inferred gaps).
 *
 * Every query is scoped to the caller (service key bypasses RLS).
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { fetchAll } from "../lib/utils.js";
import { parseTradebook, aggregateFills, planTradebookImport } from "../lib/tradebook.js";

const txnId = () => "t_" + randomUUID().replace(/-/g, "").slice(0, 16);
const EQUITY_TYPES = ["IN_STOCK", "IN_ETF"];
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function loadHoldings(userId) {
  let { data, error } = await supabase.from("holdings")
    .select("id, name, type, ticker, isin, scheme_code, units, member_id, holding_status")
    .eq("user_id", userId).in("type", EQUITY_TYPES);
  if (error) {   // isin / holding_status columns arrive with migration 0029
    ({ data, error } = await supabase.from("holdings")
      .select("id, name, type, ticker, scheme_code, units, member_id")
      .eq("user_id", userId).in("type", EQUITY_TYPES));
  }
  if (error) throw new Error(error.message);
  return (data || []).filter((h) => h.holding_status !== "exited");
}

async function loadLedger(userId, holdingIds) {
  const out = [];
  for (const ids of chunk(holdingIds, 100)) {
    const rows = await fetchAll(() => supabase.from("transactions")
      .select("id, holding_id, txn_type, units, price, txn_date, source_type, external_key")
      .eq("user_id", userId).in("holding_id", ids));
    out.push(...rows);
  }
  return out;
}

async function prepare(userId, csv, memberId) {
  if (!csv || !String(csv).trim()) throw bad("The file is empty");
  const parsed = parseTradebook(csv);
  if (!parsed.fills.length) {
    throw bad(parsed.warnings[0] || "No buy/sell trades found in this file");
  }
  const orders = aggregateFills(parsed.fills);
  const holdings = await loadHoldings(userId);
  const ledger = await loadLedger(userId, holdings.map((h) => h.id));
  const plan = planTradebookImport({ orders, holdings, existingTxns: ledger, memberId: memberId || null });
  const dates = parsed.fills.map((f) => f.date).sort();
  return {
    parsed, orders, plan,
    meta: {
      broker: parsed.broker, fills: parsed.fills.length, skipped_rows: parsed.skipped,
      period: { from: dates[0], to: dates[dates.length - 1] },
      warnings: parsed.warnings.slice(0, 20),
    },
  };
}

function summarise(plan) {
  const sym = plan.symbols;
  return {
    ...plan.totals,
    stocks: sym.length,
    explained: sym.filter((s) => s.reconcile === "explained").length,
    gaps: sym.filter((s) => s.reconcile === "gap").length,
    incomplete: sym.filter((s) => s.reconcile === "incomplete").length,
    over: sym.filter((s) => s.reconcile === "over").length,
    unmatched: sym.filter((s) => s.status === "unmatched").length,
    ambiguous: sym.filter((s) => s.status === "ambiguous").length,
    estimates_replaced: plan.deletes.length,
  };
}

export async function preview(userId, { csv, memberId }) {
  const { plan, meta } = await prepare(userId, csv, memberId);
  return { ok: true, ...meta, summary: summarise(plan), symbols: plan.symbols };
}

export async function commit(userId, { csv, memberId, filename }) {
  const { plan, meta, parsed } = await prepare(userId, csv, memberId);
  const importId = "tb_" + randomUUID().replace(/-/g, "").slice(0, 12);

  const rows = plan.inserts.map((t) => ({
    id: txnId(), holding_id: t.holding_id, user_id: userId,
    txn_type: t.txn_type, units: t.units, price: t.price,
    amount: Math.round(t.units * t.price * 100) / 100,
    txn_date: t.txn_date, source: "tradebook", source_type: "TRADEBOOK",
    external_key: t.external_key, import_id: importId,
    description: `${meta.broker} tradebook${filename ? ` (${filename})` : ""}${t.fills > 1 ? ` · ${t.fills} fills` : ""}`,
    notes: "Imported from tradebook",
  }));

  let inserted = 0;
  const errors = [];
  for (const batch of chunk(rows, 200)) {
    const { error } = await supabase.from("transactions").insert(batch);
    if (error) errors.push(error.message); else inserted += batch.length;
  }

  // Retire estimates only if every trade landed — otherwise keep them so the position is never left unpriced.
  let retired = 0;
  if (plan.deletes.length && !errors.length) {
    for (const ids of chunk(plan.deletes, 100)) {
      const { error } = await supabase.from("transactions").delete().eq("user_id", userId).in("id", ids);
      if (error) errors.push(error.message); else retired += ids.length;
    }
  }

  return {
    ok: errors.length === 0, import_id: importId, inserted, retired_estimates: retired,
    errors, ...meta, summary: summarise(plan), symbols: plan.symbols,
    fills_parsed: parsed.fills.length,
  };
}
