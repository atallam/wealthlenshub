/**
 * services/analytics.service.js — ledger-derived data access for /api/analytics.
 * Moved out of routes/analytics.js (P3-2) — same queries, same filters.
 * XIRR/FIFO math (lib/xirr.js, lib/tax.js) and the pooled-return aggregation
 * stay in the route — this module only owns the two Supabase reads.
 */
import { supabase } from "../lib/db.js";

const ACTIVE = "holding_status.is.null,holding_status.neq.exited";
const NOT_CLOSED = "maturity_status.is.null,maturity_status.neq.closed";
const LEDGER_TYPES = new Set(["IN_STOCK", "IN_ETF", "MF", "US_STOCK", "US_ETF", "CRYPTO"]);

/** Active, non-closed holdings of ledger-eligible types, optionally filtered by member. */
export async function loadHoldings(userId, member) {
  let q = supabase.from("holdings")
    .select("id, member_id, name, type, asset_class, units, current_price, current_nav, current_value, purchase_value, start_date, currency, source, depository, holding_status")
    .eq("user_id", userId).or(ACTIVE).or(NOT_CLOSED);
  if (member && member !== "all") q = q.eq("member_id", member);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).filter((h) => LEDGER_TYPES.has(h.type));
}

/** Transaction ledger for a set of holdings, grouped by holding_id. */
export async function loadLedger(userId, holdingIds) {
  if (!holdingIds.length) return {};
  const { data, error } = await supabase.from("transactions")
    .select("holding_id, txn_type, units, price, amount, txn_date, source, source_type")
    .eq("user_id", userId).in("holding_id", holdingIds).order("txn_date", { ascending: true });
  if (error) throw new Error(error.message);
  const map = {};
  for (const t of data || []) (map[t.holding_id] ||= []).push(t);
  return map;
}

/** Single holding, scoped to the caller, with the fields /holdings/:id needs. */
export async function getHolding(userId, holdingId) {
  const { data, error } = await supabase.from("holdings")
    .select("id, member_id, name, type, asset_class, units, current_price, current_nav, current_value, purchase_value, start_date, currency, holding_status, depository, source")
    .eq("id", holdingId).eq("user_id", userId).single();
  if (error || !data) return null;
  return data;
}
