/**
 * services/snaptrade.service.js — data access for routes/snaptrade.js (SnapTrade
 * broker sync). Moved out (P3-2) — same queries, same scoping, same error
 * handling (checked where the route checked it, fire-and-forget where it didn't).
 * All SnapTrade API calls, token decryption, and response shaping stay in the route.
 */
import { supabase } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";

/** The user's SnapTrade connection (decrypted secret). Throws if missing — same as before. */
export async function getSnapConn(userId) {
  const { data, error } = await supabase.from("snaptrade_connections").select("*").eq("owner_id", userId).single();
  if (error || !data) throw new Error("No SnapTrade connection found — register first.");
  return { ...data, user_secret: decrypt(data.user_secret_enc) };
}

/** Existing registration row, if any (for /register's early-return path). */
export async function getExistingRegistration(userId) {
  const { data } = await supabase.from("snaptrade_connections").select("snaptrade_user_id").eq("owner_id", userId).single();
  return data || null;
}

/** Insert a new snaptrade_connections row. Errors are not checked — matches original fire-and-forget behavior. */
export async function insertConnection(row) {
  await supabase.from("snaptrade_connections").insert(row);
}

/** Holdings needed for the /holdings/:accountId dup-detection diff. */
export async function listHoldingsForDiff(userId) {
  const { data } = await supabase.from("holdings")
    .select("id, ticker, units, name, source, source_account")
    .eq("user_id", userId);
  return data || [];
}

/** Flush this account's previous SnapTrade snapshot before a fresh import. Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteAccountHoldings(userId, accountId) {
  await supabase.from("holdings").delete()
    .eq("user_id", userId)
    .eq("source", "snaptrade")
    .eq("source_account", accountId);
}

/** Insert freshly-built holding rows. Returns the raw { error } — the route branches on it (detailed error response). */
export async function insertHoldings(rows) {
  const { error } = await supabase.from("holdings").insert(rows);
  return { error };
}

/** Update the connection's last_synced_at. Errors are not checked — matches original fire-and-forget behavior. */
export async function updateLastSynced(userId, now) {
  await supabase.from("snaptrade_connections").update({ last_synced_at: now }).eq("owner_id", userId);
}

/** SnapTrade-sourced holding ids + their account, for post-disconnect pruning. */
export async function listSnaptradeHoldingRefs(userId) {
  const { data } = await supabase.from("holdings")
    .select("id, source_account")
    .eq("user_id", userId)
    .eq("source", "snaptrade");
  return data || [];
}

/** Delete specific holdings by id, scoped to the user. Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteHoldingsByIds(userId, ids) {
  await supabase.from("holdings").delete().eq("user_id", userId).in("id", ids);
}

/** Delete the user's snaptrade_connections row (full disconnect). Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteConnectionRow(userId) {
  await supabase.from("snaptrade_connections").delete().eq("owner_id", userId);
}

/** Delete all of the user's SnapTrade-sourced holdings (full disconnect). Errors are not checked — matches original fire-and-forget behavior. */
export async function deleteAllSnaptradeHoldings(userId) {
  await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "snaptrade");
}
