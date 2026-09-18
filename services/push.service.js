/**
 * services/push.service.js — Web Push subscription data access.
 * Every query is scoped to the owning user (service key bypasses RLS).
 * Moved out of routes/push.js (P3-2) — same queries, same behavior. Web Push
 * itself (VAPID setup, webpush.sendNotification) stays in routes/push.js —
 * this service only owns the `push_subscriptions` table.
 */
import { supabase } from "../lib/db.js";

/** All subscriptions for a user (used to fan out a push). */
export async function getSubscriptions(userId) {
  const { data } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", userId);
  return data || [];
}

/** Remove a subscription by its endpoint (called when a push returns 410/404). */
export async function deleteByEndpoint(endpoint) {
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Save (or refresh) a subscription for a user. */
export async function upsertSubscription(userId, { endpoint, p256dh, authKey, userAgent }) {
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint, p256dh, auth_key: authKey, user_agent: userAgent },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
}

/** Remove a user's subscription by endpoint (explicit unsubscribe). */
export async function deleteSubscription(userId, endpoint) {
  await supabase.from("push_subscriptions")
    .delete().eq("user_id", userId).eq("endpoint", endpoint);
}
