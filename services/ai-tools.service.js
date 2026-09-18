/**
 * services/ai-tools.service.js — data access for the AI Advisor's tool-use
 * executors in routes/ai.js. Moved out (P3-2) — same queries, same filters,
 * same column lists. All response shaping / math stays in the route (execTool);
 * this module only owns the raw Supabase reads, one function per tool.
 */
import { supabase } from "../lib/db.js";

export async function getPortfolioSummaryData(userId) {
  const { data } = await supabase
    .from("holdings")
    .select("type, current_value, invested_value, member_name")
    .eq("user_id", userId);
  return data || [];
}

export async function getHoldingsData(userId, { asset_type, member_id } = {}) {
  let q = supabase.from("holdings")
    .select("id, name, ticker, symbol, type, units, current_price, current_nav, current_value, invested_value, member_name")
    .eq("user_id", userId)
    .order("current_value", { ascending: false })
    .limit(500);   // no practical limit — surface all holdings to the AI
  if (asset_type) q = q.eq("type", asset_type);
  if (member_id)  q = q.eq("member_id", member_id);
  const { data } = await q;
  return data || [];
}

/** IDOR guard: scope to the caller's own transactions (see routes/ai.js comment). */
export async function getTransactionsData(userId, holdingId) {
  const { data } = await supabase
    .from("transactions")
    .select("txn_type, units, price, txn_date, notes")
    .eq("holding_id", holdingId)
    .eq("user_id", userId)
    .order("txn_date", { ascending: false })
    .limit(25);
  return data || [];
}

export async function getGoalsData(userId) {
  const { data } = await supabase
    .from("portfolio").select("goals").eq("user_id", userId).single();
  return data?.goals || [];
}

/** Equity/MF holdings + their transactions, for the tax-summary tool's FIFO math. */
export async function getTaxSummaryData(userId) {
  const { data: holdings } = await supabase
    .from("holdings").select("id, name, type").eq("user_id", userId)
    .in("type", ["IN_STOCK", "IN_ETF", "MF"]);
  if (!holdings?.length) return { holdings: [], txnMap: {} };
  const { data: txns } = await supabase
    .from("transactions").select("holding_id, txn_type, units, price, txn_date")
    .in("holding_id", holdings.map(h => h.id));
  const txnMap = {};
  for (const t of (txns || [])) (txnMap[t.holding_id] ||= []).push(t);
  return { holdings, txnMap };
}

export async function getBudgetTransactionsData(userId, sinceStr) {
  const { data } = await supabase
    .from("budget_transactions")
    .select("category, amount, txn_type, txn_date, description")
    .eq("user_id", userId)
    .gte("txn_date", sinceStr)
    .order("txn_date", { ascending: false })
    .limit(2000);
  return data || [];
}

export async function getWatchlistData(userId) {
  const { data } = await supabase
    .from("watchlist")
    .select("id, name, ticker, asset_type, target_price, notes, current_price, price_change_pct, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getSnapshotHistoryData(userId, cutoffMonth) {
  const { data } = await supabase
    .from("net_worth_snapshots")
    .select("snapshot_month, total_invested, total_current, source")
    .eq("user_id", userId)
    .gte("snapshot_month", cutoffMonth)
    .order("snapshot_month", { ascending: true });
  return data || [];
}

/**
 * FDs maturing in the look-ahead window, plus already-matured-but-unresolved FDs.
 * The primary query filters on maturity_status; if that column is missing
 * (migration 0028 not yet run) it degrades to an unfiltered query — same
 * fallback the original inline code had.
 */
export async function getFdMaturitiesData(userId, today, maxDate) {
  let { data: fds, error: fdErr } = await supabase
    .from("holdings")
    .select("name, member_name, principal, current_value, interest_rate, start_date, maturity_date, currency")
    .eq("user_id", userId)
    .eq("type", "FD")
    .or("maturity_status.is.null,maturity_status.eq.active")
    .gte("maturity_date", today)
    .lte("maturity_date", maxDate)
    .order("maturity_date", { ascending: true });
  if (fdErr) ({ data: fds } = await supabase   // column missing → unfiltered
    .from("holdings")
    .select("name, member_name, principal, current_value, interest_rate, start_date, maturity_date, currency")
    .eq("user_id", userId)
    .eq("type", "FD")
    .gte("maturity_date", today)
    .lte("maturity_date", maxDate)
    .order("maturity_date", { ascending: true }));

  // Already matured but the user hasn't renewed / converted / closed it — idle money.
  const { data: maturedRows } = await supabase   // errors → null → [] (column missing = nothing to report)
    .from("holdings")
    .select("name, member_name, principal, current_value, maturity_amount, interest_rate, maturity_date, currency")
    .eq("user_id", userId)
    .eq("type", "FD")
    .or("maturity_status.is.null,maturity_status.eq.active")
    .lt("maturity_date", today)
    .order("maturity_date", { ascending: true });

  return { fds: fds || [], maturedRows: maturedRows || [] };
}
