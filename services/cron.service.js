/**
 * services/cron.service.js — data access for routes/cron.js (scheduled price
 * refresh, FD/insurance/goal alert emails). Moved out (P3-2) — same queries,
 * same scoping, same error handling (checked where the route checked it,
 * fire-and-forget where it didn't). All email sending, push notifications,
 * and alert-evaluation math stay in the route.
 */
import { supabase } from "../lib/db.js";

/** Every holdings row's user_id (route dedupes with a Set). Returns the raw { data } shape. */
export async function listHoldingUserIds() {
  const { data } = await supabase.from("holdings").select("user_id");
  return data || [];
}

/** Profiles with Gmail auto-import enabled and a connected Gmail account. Returns the raw { data, error } — the route branches on error. */
export async function listGmailAutoImportProfiles() {
  return supabase.from("profiles").select("id").eq("gmail_auto_import", true).not("gmail_token", "is", null);
}

/**
 * Active FDs with a maturity date, for the FD-expiry alert cron. Degrades
 * gracefully if maturity_status doesn't exist yet (migration 0028 not run) —
 * same fallback the original inline code had. Returns the raw { data, error }.
 */
export async function listFdsForAlerts() {
  let { data, error } = await supabase
    .from("holdings")
    .select("id, name, user_id, principal, interest_rate, maturity_date, maturity_amount")
    .eq("type", "FD")
    .or("maturity_status.is.null,maturity_status.eq.active")
    .not("maturity_date", "is", null);
  if (error) {
    ({ data, error } = await supabase.from("holdings")
      .select("id, name, user_id, principal, interest_rate, maturity_date")
      .eq("type", "FD").not("maturity_date", "is", null));
  }
  return { data, error };
}

/** A user's profile email, for the various alert-email routes. Errors are not checked — matches original (route only used `data`). */
export async function getProfileEmail(userId) {
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).single();
  return data?.email || null;
}

/** Manual/illiquid holdings across all users, for the stale-holdings nudge cron. Returns the raw { data, error } — the route branches on error. */
export async function listHoldingsForStaleCheck() {
  return supabase
    .from("holdings")
    .select("id, user_id, name, type, updated_at, created_at")
    .in("type", ["FD", "PPF", "EPF", "REAL_ESTATE", "CASH", "INSURANCE", "OTHER"]);
}

/** Every portfolio row (for alert-rule evaluation). Returns the raw { data, error } — the route branches on error. */
export async function listPortfoliosWithAlerts() {
  return supabase.from("portfolio").select("user_id, alerts, goals");
}

/** A user's holdings, columns needed for alert-rule math. Errors are not checked — matches original (route only used `data`). */
export async function listHoldingsForAlertCheck(userId) {
  const { data } = await supabase
    .from("holdings")
    .select("id, type, current_value, avg_cost, net_units, units, purchase_value, principal, usd_inr_rate")
    .eq("user_id", userId);
  return data || [];
}

/** INSURANCE holdings with premium fields, for the renewal-reminder cron. Returns the raw { data, error } — the route branches on error. */
export async function listInsurancePolicies() {
  return supabase
    .from("holdings")
    .select("id, name, user_id, premium, premium_frequency, start_date, maturity_date, sum_assured")
    .eq("type", "INSURANCE")
    .not("premium", "is", null)
    .not("start_date", "is", null);
}

/** Every portfolio row with goals (for the milestone cron). Returns the raw { data, error } — the route branches on error. */
export async function listPortfoliosWithGoals() {
  return supabase.from("portfolio").select("user_id, goals");
}

/** A user's holding current_value/type, for goal-progress totals. Errors are not checked — matches original (route only used `data`). */
export async function listHoldingValuesByUser(userId) {
  const { data } = await supabase.from("holdings").select("current_value, type").eq("user_id", userId);
  return data || [];
}

/**
 * Persist updated notified_milestone values on a portfolio's goals JSONB.
 * Returns the un-awaited query builder (thenable) — the route chains its own
 * `.catch(...)` on it, exactly as the original inline call did.
 */
export function updatePortfolioGoals(userId, goals) {
  return supabase.from("portfolio").update({ goals }).eq("user_id", userId);
}
