/**
 * services/import.service.js — data access for routes/import.js's CAS/CSV/PDF
 * detect-and-parse endpoint. Moved out (P3-2) — same queries, same behavior.
 * The parsing/branching logic itself stays in the route; this module only
 * owns the raw reads used for CAS password unlock and duplicate detection.
 */
import { supabase } from "../lib/db.js";

/** Rows needed to build the CAS-unlock PAN candidate list (P1-2 — server-side only). */
export async function getUnlockContextRows(userId) {
  const [{ data: prof }, { data: port }] = await Promise.all([
    supabase.from("profiles").select("encrypted_pan").eq("id", userId).single(),
    supabase.from("portfolio").select("members").eq("user_id", userId).single(),
  ]);
  return { prof, port };
}

/** Count of the user's existing CAS-sourced holdings (for the flush-and-fill warning). */
export async function countCasHoldings(userId) {
  const { data } = await supabase.from("holdings").select("id").eq("user_id", userId).eq("source", "cas");
  return (data || []).length;
}

/** Existing holdings, minimal columns — used for Fidelity-import duplicate flagging. */
export async function listHoldingsBasic(userId) {
  const { data } = await supabase.from("holdings")
    .select("name, ticker, scheme_code, type").eq("user_id", userId);
  return data || [];
}

/** Existing holdings with price/value fields — used for generic CSV/XLSX duplicate flagging. */
export async function listHoldingsWithValues(userId) {
  const { data } = await supabase.from("holdings")
    .select("name, ticker, scheme_code, type, units, purchase_price, current_price, purchase_value, current_value")
    .eq("user_id", userId);
  return data || [];
}
