/**
 * services/audit.service.js — Audit log data access.
 * Moved out of routes/audit.js (P3-2) — same queries, same behavior.
 */
import { supabase } from "../lib/db.js";

/** Paginated, filterable audit log list for one user. */
export async function list(userId, { limit = 50, offset = 0, action, category, from, to, status } = {}) {
  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action)   query = query.eq("action", action);
  if (category) query = query.eq("entity_type", category);
  if (from)     query = query.gte("created_at", from);
  if (to)       query = query.lte("created_at", to);
  if (status === "ok")    query = query.lt("status_code", 400);
  if (status === "error") query = query.gte("status_code", 400);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    logs:     data || [],
    total:    count || 0,
    has_more: (offset + limit) < (count || 0),
  };
}

/** Action/category counts for the last 30 days — powers the UI filter chips. */
export async function summary(userId) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, entity_type, status_code")
    .eq("user_id", userId)
    .gte("created_at", since);

  if (error) throw error;

  const byAction   = {};
  const byCategory = {};
  let errors = 0;

  for (const row of data || []) {
    byAction[row.action]          = (byAction[row.action] || 0) + 1;
    if (row.entity_type) {
      byCategory[row.entity_type] = (byCategory[row.entity_type] || 0) + 1;
    }
    if (row.status_code >= 400) errors++;
  }

  return {
    total:       (data || []).length,
    errors,
    by_action:   byAction,
    by_category: byCategory,
    since,
  };
}
