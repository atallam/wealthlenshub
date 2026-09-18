/**
 * services/export.service.js — data access for routes/export.js (CSV/XLSX/report
 * exports). Moved out (P3-2) — same queries as before, with one deliberate
 * behavior change: the Excel export's FD sheet now applies the same
 * NOT_CLOSED/NOT_EXITED soft-delete filters as holdings.service.js's list(),
 * so it matches the live Holdings view instead of including closed/matured FDs
 * (explicit decision, 2026-09-18 — previously unfiltered).
 */
import { supabase } from "../lib/db.js";

const NOT_CLOSED = "maturity_status.is.null,maturity_status.neq.closed";
const NOT_EXITED = "holding_status.is.null,holding_status.neq.exited";

/** All of the user's transactions, joined with their holding's name/type/ticker/etc. */
export async function listAllTransactions(userId) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, holdings(name, type, ticker, scheme_code, member_id)")
    .eq("user_id", userId)
    .order("txn_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** The user's profile email, for the printed report header. */
export async function getProfileEmail(userId) {
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).single();
  return data?.email || null;
}

/**
 * Active FDs for the Excel export's FD sheet — same soft-delete filters and
 * graceful-degradation fallback as holdings.service.js's list(), so exports stay
 * consistent with what the app itself shows if migrations 0028/0029 haven't run.
 */
export async function listActiveFds(userId) {
  const q = (withFilter, withExited) => {
    let b = supabase.from("holdings").select("*").eq("user_id", userId).eq("type", "FD");
    if (withFilter) b = b.or(NOT_CLOSED);
    if (withExited) b = b.or(NOT_EXITED);
    return b.order("maturity_date", { ascending: true });
  };
  let { data, error } = await q(true, true);
  if (error) ({ data, error } = await q(true, false));
  if (error) ({ data, error } = await q(false, false));
  if (error) throw new Error(error.message);
  return data || [];
}
