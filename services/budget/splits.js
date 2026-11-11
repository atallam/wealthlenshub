import { fetchAll } from "../../lib/utils.js";
import { randomUUID } from "crypto";
import { supabase } from "../../lib/db.js";
import { err } from "./shared.js";

// ── Family Budget — new service functions ─────────────────────────────────────
// These power the FamilyBudgetTab (Phases 1-5). They extend the existing budget
// service by adding member_id filtering (via statement join), merchant rollup,
// and recurring-transaction detection.

/** Resolve statement IDs that belong to a given member (or all statements for
 *  the user when memberId is falsy). Used to scope analytics + transactions to
 *  a specific family member without duplicating filter logic. */
export async function resolveStatementIds(userId, memberId) {
  const q = supabase.from("budget_statements").select("id").eq("user_id", userId);
  if (memberId) {
    // Explicit member filter — only their statements
    const { data } = await q.eq("member_id", memberId);
    return (data || []).map(r => r.id);
  }
  // No filter — all statements; return null to signal "don't filter"
  return null;
}

// ── Split transactions (migrations/0033) ──────────────────────────────────────
// A transaction normally belongs wholly to its statement's member. A split
// transaction instead contributes one allocation per share. Every reader that
// attributes spend to members goes through resolveTransactionAllocations() so
// the rule lives in exactly one place.

/** Turn transactions into per-member allocations.
 *  - unsplit txn  → one allocation for the parent statement's member (may be null = unassigned)
 *  - split txn    → one allocation per share (category stays the parent's)
 *  Pure function — no I/O. */
export function resolveTransactionAllocations(txns, splitsByTxn, memberByStatement) {
  const out = [];
  for (const t of txns) {
    const shares = splitsByTxn.get(t.id);
    if (shares?.length) {
      for (const sh of shares) out.push({ ...t, amount: Number(sh.amount), member_id: sh.member_id, is_split: true });
    } else {
      out.push({ ...t, member_id: memberByStatement.get(t.statement_id) ?? null, is_split: false });
    }
  }
  return out;
}

/** All of a user's splits grouped by transaction id. Degrades to "no splits"
 *  (with a warning) if migration 0033 hasn't been applied, so analytics keep
 *  working instead of failing every Family Budget view. */
export async function loadSplitsByTxn(userId) {
  let rows;
  try {
    rows = await fetchAll(() => supabase.from("budget_transaction_splits")
      .select("id, transaction_id, member_id, amount, note").eq("user_id", userId));
  } catch (e) {
    console.warn("[budget] split transactions unavailable (migration 0033 not applied?):", e.message);
    return new Map();
  }
  const m = new Map();
  for (const r of rows) { if (!m.has(r.transaction_id)) m.set(r.transaction_id, []); m.get(r.transaction_id).push(r); }
  return m;
}

async function loadMemberByStatement(userId) {
  const rows = await fetchAll(() => supabase.from("budget_statements").select("id, member_id").eq("user_id", userId));
  return new Map(rows.map(r => [r.id, r.member_id || null]));
}

/** Member-attributed allocations for a date window. memberId=null → everyone.
 *  `extraCols` adds columns (e.g. "description, search_text") to the txn select. */
export async function loadAllocations(userId, memberId, { from, to, txnType, extraCols = "" } = {}) {
  const cols = ["id", "statement_id", "amount", "txn_type", "category", "txn_date", extraCols].filter(Boolean).join(", ");
  const [txns, memberByStatement, splitsByTxn] = await Promise.all([
    fetchAll(() => {
      let q = supabase.from("budget_transactions").select(cols).eq("user_id", userId);
      if (txnType) q = q.eq("txn_type", txnType);
      if (from) q = q.gte("txn_date", from);
      if (to)   q = q.lte("txn_date", to);
      return q;
    }),
    loadMemberByStatement(userId),
    loadSplitsByTxn(userId),
  ]);
  const allocs = resolveTransactionAllocations(txns, splitsByTxn, memberByStatement);
  return memberId ? allocs.filter(a => a.member_id === memberId) : allocs;
}

export async function getSplits(userId, transactionId) {
  const { data, error } = await supabase.from("budget_transaction_splits")
    .select("id, member_id, amount, note").eq("user_id", userId).eq("transaction_id", transactionId);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Replace-all: set the member shares of one transaction. An empty array
 *  un-splits it. Shares must total the transaction amount (to the paisa). */
export async function setSplits(userId, transactionId, splits) {
  if (!Array.isArray(splits)) throw err("splits must be an array", 400);
  const { data: txn, error: tErr } = await supabase.from("budget_transactions")
    .select("id, amount, category").eq("id", transactionId).eq("user_id", userId).maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!txn) throw err("Transaction not found", 404);

  const before = await getSplits(userId, transactionId);
  const clear = () => supabase.from("budget_transaction_splits").delete().eq("user_id", userId).eq("transaction_id", transactionId);

  if (splits.length === 0) {
    const { error } = await clear();
    if (error) throw new Error(error.message);
    return { ok: true, splits: [] };
  }

  if (splits.length < 2) throw err("A split needs at least two members", 400);
  const { data: pf } = await supabase.from("portfolio").select("members").eq("user_id", userId).maybeSingle();
  const validMembers = new Set((pf?.members || []).map(m => m.id));
  const seen = new Set();
  let cents = 0;
  const rows = splits.map(sh => {
    const amount = Math.round(Number(sh.amount) * 100) / 100;
    if (!sh.member_id || !validMembers.has(sh.member_id)) throw err("Each share needs a valid family member", 400);
    if (seen.has(sh.member_id)) throw err("A member can only appear once in a split", 400);
    if (!(amount > 0)) throw err("Each share must be greater than zero", 400);
    seen.add(sh.member_id);
    cents += Math.round(amount * 100);
    return { id: "spl_" + randomUUID().replace(/-/g, "").slice(0, 16), transaction_id: transactionId, user_id: userId,
             member_id: sh.member_id, category: txn.category, amount, note: String(sh.note || "").slice(0, 200) };
  });
  const total = Math.round(Number(txn.amount) * 100);
  if (cents !== total) {
    throw err(`Shares total ${(cents / 100).toFixed(2)} but the transaction is ${(total / 100).toFixed(2)} (difference ${((total - cents) / 100).toFixed(2)})`, 400);
  }

  const { error: dErr } = await clear();
  if (dErr) throw new Error(dErr.message);
  const { error: iErr } = await supabase.from("budget_transaction_splits").insert(rows);
  if (iErr) {
    // put the previous shares back so a failed save never loses a split
    if (before.length) {
      await supabase.from("budget_transaction_splits").insert(before.map(b => ({
        id: b.id, transaction_id: transactionId, user_id: userId, member_id: b.member_id, category: txn.category, amount: b.amount, note: b.note || "",
      })));
    }
    throw new Error(iErr.message);
  }
  return { ok: true, splits: rows.map(r => ({ id: r.id, member_id: r.member_id, amount: r.amount, note: r.note })) };
}
