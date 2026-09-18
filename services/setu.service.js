/**
 * services/setu.service.js — data access for routes/setu.js (Setu Account
 * Aggregator wealth + budget import). Moved out (P3-2) — same queries, same
 * scoping, same error handling (checked where the route checked it,
 * fire-and-forget where it didn't). All Setu API calls, token/session
 * handling, and FI-data parsing stay in the route.
 */
import { supabase } from "../lib/db.js";

/** Insert a new setu_consents row (used by both wealth and budget consent flows). Errors are not checked — matches original fire-and-forget behavior. */
export async function insertConsent(row) {
  await supabase.from("setu_consents").insert(row);
}

/** One consent, scoped to the owning user (used by /fetch and /fetch-transactions). Errors are not checked — matches original (route only used `data`). */
export async function getConsent(userId, consentId) {
  const { data } = await supabase.from("setu_consents").select("*").eq("consent_id", consentId).eq("user_id", userId).single();
  return data || null;
}

/** Consent id looked up by session id, scoped to the owning user (for the raw-session debug route). */
export async function getConsentBySessionId(userId, sessionId) {
  const { data } = await supabase.from("setu_consents").select("consent_id").eq("session_id", sessionId).eq("user_id", userId).maybeSingle();
  return data || null;
}

/** Generic patch update, scoped by consent_id + user_id. Errors are not checked — matches original fire-and-forget behavior. */
export async function updateConsent(userId, consentId, patch) {
  await supabase.from("setu_consents").update(patch).eq("consent_id", consentId).eq("user_id", userId);
}

/** Same update, unscoped by user — used only by the webhook route (no authenticated user on that request). Errors are not checked — matches original fire-and-forget behavior. */
export async function updateConsentUnscoped(consentId, patch) {
  await supabase.from("setu_consents").update(patch).eq("consent_id", consentId);
}

/** Upsert parsed holdings from a completed FI session. Returns the raw { error } — the route branches on it. */
export async function upsertHoldings(rows) {
  const { error } = await supabase.from("holdings").upsert(rows, { onConflict: "id" });
  return { error };
}

/** All of the user's consents, newest first. Returns the raw { data, error } — the route branches on error. */
export async function listConsents(userId) {
  return supabase.from("setu_consents").select("*").eq("user_id", userId).order("created_at", { ascending: false });
}

/** Insert a budget_statements row for one imported source. Errors are not checked — matches original fire-and-forget behavior. */
export async function insertBudgetStatement(row) {
  await supabase.from("budget_statements").insert(row);
}

/** Look up an existing budget_transactions row by dedup fingerprint. Errors are not checked — matches original (route only used `data`). */
export async function findDuplicateBudgetTxn(userId, fingerprint) {
  const { data } = await supabase.from("budget_transactions").select("id").eq("user_id", userId).eq("fingerprint", fingerprint).maybeSingle();
  return data || null;
}

/** Insert one budget_transactions row. Errors are not checked — matches original fire-and-forget behavior. */
export async function insertBudgetTransaction(row) {
  await supabase.from("budget_transactions").insert(row);
}

/** Upsert a setu_connections row (for future re-sync). Errors are not checked — matches original fire-and-forget behavior. */
export async function upsertConnection(row) {
  await supabase.from("setu_connections").upsert(row, { onConflict: "id" });
}

/** The user's saved connections, joined with their consent's status/date-range. Returns the raw { data, error } — the route branches on error. */
export async function listConnections(userId) {
  return supabase
    .from("setu_connections")
    .select("*, setu_consents(status, data_range_from, data_range_to)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

/** Delete a saved connection, scoped to the owning user. Returns the raw { error } — the route branches on it. */
export async function deleteConnection(userId, id) {
  const { error } = await supabase.from("setu_connections").delete().eq("id", id).eq("user_id", userId);
  return { error };
}
