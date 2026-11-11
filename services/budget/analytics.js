import { decrypt } from "../../lib/crypto.js";
import { supabase } from "../../lib/db.js";
import { loadAllocations, loadSplitsByTxn, resolveStatementIds } from "./splits.js";

/** Full analytics for FamilyBudget — supports member_id, custom date range,
 *  and returns both KPIs (totalDebit, totalCredit, savingsRate, byCategory)
 *  and trend data (monthly cashflow for 12 months, per-member comparison).
 *  The `memberId` param scopes everything through the statements join. */
export async function familyAnalytics(userId, memberId, month, { from: rangeFrom, to: rangeTo } = {}) {
  // Determine date window
  let qFrom, qTo;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    qFrom = `${month}-01`;
    qTo   = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else if (rangeFrom) {
    qFrom = rangeFrom;
    qTo   = rangeTo || new Date().toISOString().slice(0, 10);
  } else {
    // Default: current calendar month
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    qFrom = `${y}-${m}-01`;
    qTo   = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  }

  // Everyone's allocations in the window (split-aware); the member view is a filter on top
  const windowAllocs = await loadAllocations(userId, null, { from: qFrom, to: qTo });
  const scoped = memberId ? windowAllocs.filter(a => a.member_id === memberId) : windowAllocs;

  const byCategory = {}; let totalDebit = 0, totalCredit = 0;
  for (const t of scoped) {
    if (t.txn_type === "DEBIT") {
      totalDebit += t.amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    } else {
      totalCredit += t.amount;
    }
  }
  const savingsRate = totalCredit > 0 ? Math.max(0, ((totalCredit - totalDebit) / totalCredit) * 100) : 0;

  // 12-month cashflow trend
  const cfFrom = new Date(Date.now() - 365 * 24 * 3600_000).toISOString().slice(0, 10);
  const cfAllocs = await loadAllocations(userId, memberId || null, { from: cfFrom });
  const cashflow = {}, monthly = {};
  for (const t of cfAllocs) {
    const mo = t.txn_date.slice(0, 7);
    if (!cashflow[mo]) cashflow[mo] = { debit: 0, credit: 0 };
    if (t.txn_type === "DEBIT") { cashflow[mo].debit += t.amount; monthly[mo] = (monthly[mo] || 0) + t.amount; }
    else cashflow[mo].credit += t.amount;
  }

  // Per-member breakdown (only when viewing "All") — split shares count toward the member who owns them
  let memberBreakdown = [];
  if (!memberId) {
    const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
    for (const mem of portfolioRow?.members || []) {
      let mDebit = 0, mCredit = 0;
      for (const t of windowAllocs) {
        if (t.member_id !== mem.id) continue;
        if (t.txn_type === "DEBIT") mDebit += t.amount; else mCredit += t.amount;
      }
      if (mDebit > 0 || mCredit > 0) memberBreakdown.push({ id: mem.id, name: mem.name, avatar: mem.avatar, debit: mDebit, credit: mCredit });
    }
  }

  return { byCategory, totalDebit, totalCredit, savingsRate, monthly, cashflow, memberBreakdown, qFrom, qTo };
}

/** Transactions endpoint for FamilyBudget — same as listTransactions but adds
 *  member_id filtering via statement join, and accepts an `offset` for pagination. */
export async function familyTransactions(userId, query) {
  const { member_id, category, month, search, from, limit, offset } = query;
  const stmtIds = await resolveStatementIds(userId, member_id || null);
  const splitsByTxn = await loadSplitsByTxn(userId);
  // Transactions where this member holds a share, even when charged to someone else's statement
  const sharedTxnIds = member_id
    ? [...splitsByTxn.entries()].filter(([, shares]) => shares.some(sh => sh.member_id === member_id)).map(([tid]) => tid)
    : [];
  if (Array.isArray(stmtIds) && stmtIds.length === 0 && sharedTxnIds.length === 0) return [];

  let q = supabase.from("budget_transactions").select("*").eq("user_id", userId).order("txn_date", { ascending: false });
  if (Array.isArray(stmtIds)) {
    const quote = (ids) => ids.map(i => `"${String(i).replace(/"/g, "")}"`).join(",");
    if (sharedTxnIds.length && stmtIds.length) q = q.or(`statement_id.in.(${quote(stmtIds)}),id.in.(${quote(sharedTxnIds)})`);
    else if (sharedTxnIds.length) q = q.in("id", sharedTxnIds);
    else q = q.in("statement_id", stmtIds);
  }
  if (category && category !== "All") q = q.eq("category", category);
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-${String(lastDay).padStart(2, "0")}`);
  } else if (from) {
    q = q.gte("txn_date", from);
  }
  if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);
  const maxRows = Math.min(Number(limit) || 500, 2000);
  const startRow = Number(offset) || 0;
  q = q.range(startRow, startRow + maxRows - 1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || [])
    // In a member's view, hide split transactions on their statement that they hold no share of
    .filter(t => !(member_id && splitsByTxn.has(t.id) && !splitsByTxn.get(t.id).some(sh => sh.member_id === member_id)))
    .map(t => {
      const shares = splitsByTxn.get(t.id);
      const row = { ...t, description: decrypt(t.description), balance: t.balance ? decrypt(t.balance) : null };
      if (shares) {
        row.is_split = true;
        row.splits = shares.map(sh => ({ member_id: sh.member_id, amount: Number(sh.amount), note: sh.note || "" }));
        if (member_id) row.member_share = row.splits.find(sh => sh.member_id === member_id)?.amount ?? 0;
      }
      return row;
    });
}
