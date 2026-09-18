/**
 * services/notifications.service.js — In-App Notification Centre data access.
 * Every query is scoped to the owning user (service key bypasses RLS).
 * Moved out of routes/notifications.js (P3-2) — same queries, same behavior.
 */
import { supabase } from "../lib/db.js";

/** List notifications for a user, newest first. */
export async function list(userId, { limit = 50, unreadOnly = false } = {}) {
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.eq("read", false);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const unreadCount = unreadOnly
    ? data.length
    : (data || []).filter(n => !n.read).length;

  return { notifications: data || [], unreadCount };
}

/** Mark one notification as read (scoped to the caller). */
export async function markRead(userId, id) {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Mark all of a user's unread notifications as read. */
export async function markAllRead(userId) {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Delete all of a user's already-read notifications. */
export async function clearRead(userId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId)
    .eq("read", true);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Insert a notification (called from cron routes via routes/notifications.js). */
export async function insert(userId, kind, title, body = null, url = null) {
  try {
    await supabase.from("notifications").insert({ user_id: userId, kind, title, body, url });
  } catch (e) {
    console.error("insertNotification failed:", e.message);
  }
}
