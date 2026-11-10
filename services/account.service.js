/**
 * services/account.service.js - "delete my account and all my data".
 *
 * Order matters and nothing is trusted to cascade: the database has ON DELETE CASCADE on most
 * (not all) tables, and uploaded files live in Storage where no cascade exists. So we
 *   1. best-effort revoke third-party links (Plaid items, SnapTrade user),
 *   2. remove uploaded files from Storage,
 *   3. delete the user's rows table by table (children first),
 *   4. only if every table succeeded, delete the auth user (which ends the login for good).
 * If step 3 fails part-way the auth user is KEPT, so the user can simply try again; every step
 * is safe to repeat.
 */
import { supabase, describeDbError } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";

const BUCKET = "artifacts";

// [table, owner column]. Children before parents.
export const USER_TABLES = [
  ["concall_analyses", "user_id"],
  ["budget_transaction_splits", "user_id"],
  ["budget_category_limits", "user_id"],
  ["budget_transactions", "user_id"],
  ["budget_statements", "user_id"],
  ["budget_categories", "user_id"],
  ["budget_goals", "user_id"],
  ["budget_account_aliases", "user_id"],
  ["transactions", "user_id"],
  ["artifacts", "user_id"],
  ["holdings", "user_id"],
  ["net_worth_snapshots", "user_id"],
  ["notifications", "user_id"],
  ["push_subscriptions", "user_id"],
  ["asset_types", "user_id"],
  ["import_logs", "user_id"],
  ["audit_logs", "user_id"],
  ["setu_consents", "user_id"],
  ["setu_connections", "user_id"],
  ["plaid_connections", "user_id"],
  ["snaptrade_connections", "owner_id"],
  ["portfolio", "user_id"],
  ["profiles", "id"],
];

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Revoke Plaid items and the SnapTrade user at the providers. Never throws. */
export async function revokeExternal(userId) {
  try {
    if (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) {
      const { data } = await supabase.from("plaid_connections").select("access_token").eq("user_id", userId);
      if (data?.length) {
        const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");
        const plaid = new PlaidApi(new Configuration({
          basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"] || PlaidEnvironments.sandbox,
          baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID, "PLAID-SECRET": process.env.PLAID_SECRET } },
        }));
        for (const c of data) {
          try { await plaid.itemRemove({ access_token: decrypt(c.access_token) }); } catch { /* already gone */ }
        }
      }
    }
  } catch (e) { console.error("[account] plaid revoke failed:", e.message); }
  try {
    if (process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY) {
      const { data } = await supabase.from("snaptrade_connections").select("snaptrade_user_id").eq("owner_id", userId);
      if (data?.length) {
        const { Snaptrade } = await import("snaptrade-typescript-sdk");
        const snap = new Snaptrade({ clientId: process.env.SNAPTRADE_CLIENT_ID, consumerKey: process.env.SNAPTRADE_CONSUMER_KEY });
        for (const c of data) {
          try { await snap.authentication.deleteSnapTradeUser({ userId: c.snaptrade_user_id }); } catch { /* already gone */ }
        }
      }
    }
  } catch (e) { console.error("[account] snaptrade revoke failed:", e.message); }
}

/** Remove every stored file belonging to the user (by user_id, and via their holdings for legacy rows). */
async function removeStoredFiles(userId) {
  const paths = new Set();
  const byUser = await supabase.from("artifacts").select("storage_path").eq("user_id", userId);
  if (byUser.error && !describeDbError(byUser.error).isSchemaDrift) throw new Error(byUser.error.message);
  for (const r of byUser.data || []) if (r.storage_path) paths.add(r.storage_path);

  const hs = await supabase.from("holdings").select("id").eq("user_id", userId);
  if (hs.error && !describeDbError(hs.error).isSchemaDrift) throw new Error(hs.error.message);
  for (const ids of chunk((hs.data || []).map((h) => h.id), 100)) {
    const legacy = await supabase.from("artifacts").select("storage_path").in("holding_id", ids);
    for (const r of legacy.data || []) if (r.storage_path) paths.add(r.storage_path);
  }
  let removed = 0;
  for (const batch of chunk([...paths], 100)) {
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`storage: ${error.message}`);
    removed += batch.length;
  }
  return removed;
}

/**
 * @returns {{ ok: true, deleted: Record<string, number>, files: number }}
 * @throws Error with .failed = [tables] when something could not be deleted (auth user is kept)
 */
export async function deleteAccount(userId, { revoke = revokeExternal } = {}) {
  if (!userId || typeof userId !== "string") throw new Error("userId required");

  await revoke(userId);
  const files = await removeStoredFiles(userId);

  // Legacy artifact rows with no user_id hang off the user's holdings; delete those first.
  const hs = await supabase.from("holdings").select("id").eq("user_id", userId);
  for (const ids of chunk((hs.data || []).map((h) => h.id), 100)) {
    await supabase.from("artifacts").delete().in("holding_id", ids);
  }

  const deleted = {}, failed = [];
  for (const [table, col] of USER_TABLES) {
    const { error, count } = await supabase.from(table).delete({ count: "exact" }).eq(col, userId);
    if (error) {
      if (describeDbError(error).isSchemaDrift) continue;     // optional feature not installed here
      console.error(`[account] delete from ${table} failed:`, error.message);
      failed.push(table);
    } else if (count) deleted[table] = count;
  }
  if (failed.length) {
    const e = new Error(`Could not delete all data (${failed.join(", ")}). Your login was kept - please try again.`);
    e.failed = failed;
    throw e;
  }

  const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
  if (authErr) throw new Error(`Data removed but the login could not be deleted: ${authErr.message}`);

  console.warn(`[account] deleted account ${userId.slice(0, 8)}… (${Object.keys(deleted).length} tables, ${files} files)`);
  return { ok: true, deleted, files };
}
