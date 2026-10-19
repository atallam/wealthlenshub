/**
 * services/ai-tools.service.js — data access for the AI Advisor's tool-use
 * executors in routes/ai.js. Moved out (P3-2) — same queries, same filters,
 * same column lists. All response shaping / math stays in the route (execTool);
 * this module only owns the raw Supabase reads, one function per tool.
 */
import { supabase } from "../lib/db.js";
import { fetchAll } from "../lib/utils.js";

/**
 * The user's live holdings, shaped for the advisor tools.
 * Reads `*` on purpose: this used to select invested_value / member_name / symbol,
 * none of which are holdings columns, so PostgREST rejected the query and the old
 * `const { data }` destructure swallowed it — the advisor was told "No holdings found".
 * Cost basis is purchase_value; the member's name comes from portfolio.members.
 * Exited (dropped off the latest CAS) and closed (matured, resolved) rows are excluded,
 * matching every other portfolio view.
 */
async function loadLiveHoldings(userId) {
  const { data, error } = await supabase.from("holdings").select("*").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const { data: pf } = await supabase.from("portfolio").select("members").eq("user_id", userId).maybeSingle();
  const memberName = new Map((pf?.members || []).map((m) => [m.id, m.name]));
  return (data || [])
    .filter((h) => h.holding_status !== "exited" && h.maturity_status !== "closed")
    .map((h) => ({
      ...h,
      invested_value: Number(h.invested_value) || Number(h.purchase_value) || 0,
      member_name: h.member_name || memberName.get(h.member_id) || "Unknown",
    }));
}

export async function getPortfolioSummaryData(userId) {
  const rows = await loadLiveHoldings(userId);
  return rows.map(({ type, current_value, invested_value, member_name }) => ({ type, current_value, invested_value, member_name }));
}

export async function getHoldingsData(userId, { asset_type, member_id } = {}) {
  let rows = await loadLiveHoldings(userId);
  if (asset_type) rows = rows.filter((h) => h.type === asset_type);
  if (member_id)  rows = rows.filter((h) => h.member_id === member_id);
  return rows
    .sort((a, b) => (Number(b.current_value) || 0) - (Number(a.current_value) || 0))
    .slice(0, 500)   // surface (practically) all holdings to the AI
    .map(({ id, name, ticker, symbol, type, units, current_price, current_nav, current_value, invested_value, member_name }) =>
      ({ id, name, ticker, symbol, type, units, current_price, current_nav, current_value, invested_value, member_name }));
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
  const txns = await fetchAll(() => supabase
    .from("transactions").select("id, holding_id, txn_type, units, price, txn_date")
    .eq("user_id", userId)
    .in("holding_id", holdings.map(h => h.id)));
  const txnMap = {};
  for (const t of (txns || [])) (txnMap[t.holding_id] ||= []).push(t);
  return { holdings, txnMap };
}

export async function getBudgetTransactionsData(userId, sinceStr) {
  return fetchAll(() => supabase
    .from("budget_transactions")
    .select("id, category, amount, txn_type, txn_date, description")
    .eq("user_id", userId)
    .gte("txn_date", sinceStr)
    .order("txn_date", { ascending: false }));
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
