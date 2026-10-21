/**
 * services/transactions.service.js — all DB access for transactions.
 * Every query is scoped to the owning user (service key bypasses RLS).
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { assertOwnsHolding } from "../lib/guards.js";
import { buildLots } from "../lib/lots.js";

const txnId = () => "t_" + randomUUID().replace(/-/g, "").slice(0, 16);

/** Transactions for one holding, newest first, scoped to the user. */
export async function listForHolding(userId, holdingId) {
  const { data, error } = await supabase.from("transactions")
    .select("*").eq("holding_id", holdingId).eq("user_id", userId)
    .order("txn_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// Transaction types that carry units (affect net position)
const UNIT_TYPES = new Set(["BUY", "SELL", "BONUS", "RIGHTS", "SWP"]);

/** Insert a single transaction after verifying the parent holding is owned. */
export async function add(userId, body) {
  const { holding_id, txn_type, units, price, price_usd, amount, txn_date, notes } = body;
  if (!holding_id) { const e = new Error("holding_id is required"); e.status = 400; throw e; }
  await assertOwnsHolding(userId, holding_id);

  const type = txn_type || "BUY";
  const isDividend = type === "DIVIDEND";

  const { error } = await supabase.from("transactions").insert({
    id: txnId(), holding_id, user_id: userId,
    txn_type: type,
    // DIVIDEND: units = shares held at ex-date (informational), price = per-unit dividend (optional)
    // BONUS/RIGHTS: units = new units received, price = exercise price (0 for bonus)
    units: UNIT_TYPES.has(type) ? (Number(units) || 0) : (Number(units) || 0),
    price: Number(price) || 0,
    ...(price_usd !== undefined ? { price_usd: Number(price_usd) } : {}),
    // amount = total cash for DIVIDEND; null for everything else
    ...(amount !== undefined && amount !== "" ? { amount: Number(amount) } : {}),
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
    const sym = (t._symbol || "").toLowerCase().trim();
    // An empty symbol would "match" every key via includes("") and book the row on a random holding;
    // fuzzy containment is only trusted for 3+ characters (so "ge" can't claim "tata elxsi").
    const holdingId = sym && (holdingMap[sym] || holdingMap[sym.replace(/\s+/g, "")]
      || (sym.length >= 3 ? Object.entries(holdingMap).find(([k]) => k.includes(sym))?.[1] : undefined));
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

/** Delete one of the user's own transactions (CAS ledger rows are import-owned). */
export async function remove(userId, id) {
  const { data: row } = await supabase.from("transactions").select("source").eq("id", id).eq("user_id", userId).maybeSingle();
  if (row?.source === "cas") {
    throw Object.assign(new Error("This transaction came from a CAS statement and would be re-created on the next import. Re-import a corrected statement instead."), { status: 403 });
  }
  const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * "Set cost basis" — for holdings whose purchase cost is unknown (typically CAS
 * demat stocks). Writes ONE manual OPENING BUY covering the units the ledger does
 * not already explain, so the lot engine (Holdings + Tax tabs) picks it up and the
 * holding is flagged cost_basis = "approx".
 *
 * Idempotent: keyed OPENING|<holding>, so saving again replaces the previous
 * estimate instead of stacking a second lot. source stays NULL (manual) so CAS
 * re-imports never delete it.
 *
 * @param {string} userId
 * @param {{holding_id:string, avg_price:number|string, units?:number|string, buy_date?:string}} body
 */
export async function setCostBasis(userId, body) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  const { holding_id } = body || {};
  const avgPrice = Number(body?.avg_price);
  if (!holding_id) throw bad("holding_id is required");
  if (!Number.isFinite(avgPrice) || avgPrice <= 0) throw bad("avg_price must be greater than 0");
  if (body?.buy_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.buy_date)) throw bad("buy_date must be YYYY-MM-DD");
  await assertOwnsHolding(userId, holding_id);

  const { data: h, error: hErr } = await supabase.from("holdings")
    .select("id, units, start_date, created_at").eq("id", holding_id).eq("user_id", userId).single();
  if (hErr || !h) throw bad("Holding not found");

  const { data: rows, error: tErr } = await supabase.from("transactions")
    .select("id, txn_type, units, price, txn_date, source, source_type, external_key")
    .eq("holding_id", holding_id).eq("user_id", userId);
  if (tErr) throw new Error(tErr.message);

  const key = `OPENING|${holding_id}`;
  const existing = (rows || []).find((t) => t.external_key === key);
  // Units the rest of the ledger already explains (excluding our own previous estimate).
  const others = (rows || []).filter((t) => t.external_key !== key);
  const covered = buildLots(others).netUnits;

  const held = Number(h.units) || 0;
  const units = body?.units !== undefined && body.units !== "" ? Number(body.units) : +(held - covered).toFixed(6);
  if (!Number.isFinite(units) || units <= 0) {
    throw bad("Nothing to price: the transaction ledger already accounts for every unit of this holding");
  }

  const txn_date = body?.buy_date || h.start_date || String(h.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const payload = {
    txn_type: "BUY", units, price: avgPrice, amount: Math.round(units * avgPrice * 100) / 100,
    txn_date, source: null, source_type: "OPENING", external_key: key,
    description: "User-entered average cost (cost basis was unknown)",
    notes: "Cost basis set manually" + (body?.buy_date ? "" : " · buy date approximate"),
  };

  if (existing) {
    const { error } = await supabase.from("transactions").update(payload).eq("id", existing.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, updated: true, units, avg_price: avgPrice, txn_date };
  }
  const { error } = await supabase.from("transactions").insert({ id: txnId(), holding_id, user_id: userId, ...payload });
  if (error) throw new Error(error.message);
  return { ok: true, updated: false, units, avg_price: avgPrice, txn_date };
}
