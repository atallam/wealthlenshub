/**
 * services/transactions.service.js — all DB access for transactions.
 * Every query is scoped to the owning user (service key bypasses RLS).
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { assertOwnsHolding } from "../lib/guards.js";

const txnId = () => "t_" + randomUUID().replace(/-/g, "").slice(0, 16);

/** Transactions for one holding, newest first, scoped to the user. */
export async function listForHolding(userId, holdingId) {
  const { data, error } = await supabase.from("transactions")
    .select("*").eq("holding_id", holdingId).eq("user_id", userId)
    .order("txn_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Insert a single transaction after verifying the parent holding is owned. */
export async function add(userId, body) {
  const { holding_id, txn_type, units, price, price_usd, txn_date, notes } = body;
  if (!holding_id) { const e = new Error("holding_id is required"); e.status = 400; throw e; }
  await assertOwnsHolding(userId, holding_id);
  const { error } = await supabase.from("transactions").insert({
    id: txnId(), holding_id, user_id: userId,
    txn_type: txn_type || "BUY",
    units: Number(units) || 0, price: Number(price) || 0,
    ...(price_usd !== undefined ? { price_usd: Number(price_usd) } : {}),
    txn_date: txn_date || new Date().toISOString().slice(0, 10),
    notes: notes || "",
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Bulk import, matching rows to the user's holdings by symbol/scheme/name. */
export async function importRows(userId, transactions) {
  const { data: userHoldings } = await supabase.from("holdings")
    .select("id, name, ticker, scheme_code, type").eq("user_id", userId);
  const holdingMap = {};
  for (const h of (userHoldings || [])) {
    if (h.ticker) holdingMap[h.ticker.toLowerCase()] = h.id;
    if (h.scheme_code) holdingMap[h.scheme_code.toLowerCase()] = h.id;
    holdingMap[h.name.toLowerCase()] = h.id;
  }
  const imported = [], unmatched = [], errors = [];
  for (const t of transactions) {
    const sym = (t._symbol || "").toLowerCase();
    const holdingId = holdingMap[sym] || holdingMap[sym.replace(/\s+/g, "")]
      || Object.entries(holdingMap).find(([k]) => k.includes(sym))?.[1];
    if (!holdingId) { unmatched.push(t._symbol); continue; }
    const { error } = await supabase.from("transactions").insert({
      id: txnId(), holding_id: holdingId, user_id: userId,
      txn_type: t.txn_type || "BUY", units: Number(t.units) || 0, price: Number(t.price) || 0,
      txn_date: t.txn_date || new Date().toISOString().slice(0, 10), notes: t.notes || "Bulk import",
    });
    if (error) errors.push(`${t._symbol}: ${error.message}`);
    else imported.push(t._symbol);
  }
  return {
    ok: true, imported_count: imported.length, unmatched_count: unmatched.length,
    error_count: errors.length, unmatched: [...new Set(unmatched)], errors,
  };
}

/** Delete one of the user's own transactions. */
export async function remove(userId, id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
