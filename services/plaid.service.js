/**
 * services/plaid.service.js — data access for routes/plaid.js (Plaid US bank sync).
 * Moved out (P3-2) — same queries, same scoping, same batch size and
 * continue-on-error behavior for transaction inserts. All Plaid API calls,
 * token encryption/decryption, and response shaping stay in the route.
 */
import { supabase } from "../lib/db.js";

/**
 * The user's Plaid connections, newest first (for /status). Returns the raw
 * { data, error } shape — the route branches on `error` itself (distinct
 * "configured but query failed" response), so this doesn't throw.
 */
export async function listConnections(userId) {
  return supabase
    .from("plaid_connections")
    .select("id, institution_name, accounts, last_synced, status, error_code")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

/** One connection, scoped to the owning user (used by both sync and delete routes). */
export async function getConnection(userId, connectionId) {
  const { data } = await supabase
    .from("plaid_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .single();
  return data || null;
}

/** Upsert a connection row after a successful token exchange. Errors are not checked — matches original fire-and-forget behavior. */
export async function upsertConnection(row) {
  await supabase.from("plaid_connections").upsert(row, { onConflict: "id" });
}

/** Insert a budget_statements row for a sync batch. Errors are not checked — matches original fire-and-forget behavior. */
export async function insertStatement(row) {
  await supabase.from("budget_statements").insert(row);
}

/** Insert transactions in chunks of 100, logging (not throwing) per-batch errors. */
export async function insertTransactionsBatched(txns) {
  for (let i = 0; i < txns.length; i += 100) {
    const { error } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100));
    if (error) console.error("Plaid txn insert batch error:", error.message);
  }
}

/** Delete budget_transactions rows by id (Plaid-reported removals). Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteTransactionsByIds(ids) {
  await supabase.from("budget_transactions").delete().in("id", ids);
}

/** Update a connection by id only (success path — id was already ownership-verified). Errors are not checked — matches original fire-and-forget behavior. */
export async function updateConnectionById(id, patch) {
  await supabase.from("plaid_connections").update(patch).eq("id", id);
}

/** Update a connection's error status, scoped by user (catch-block path, no prior fetch). Errors are not checked — matches original fire-and-forget behavior. */
export async function updateConnectionError(userId, connectionId, patch) {
  await supabase
    .from("plaid_connections")
    .update(patch)
    .eq("id", connectionId)
    .eq("user_id", userId);
}

/** Delete a connection by id. Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteConnection(id) {
  await supabase.from("plaid_connections").delete().eq("id", id);
}
