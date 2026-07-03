/**
 * services/snapshots.service.js — net-worth snapshot reads/deletes.
 * (Creation lives in lib/snapshot.js takeSnapshot; the route calls that directly.)
 */
import { supabase } from "../lib/db.js";

export async function list(userId, months = 24) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - parseInt(months, 10));
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
  const { data, error } = await supabase.from("net_worth_snapshots")
    .select("*").eq("user_id", userId).gte("snapshot_month", cutoffMonth)
    .order("snapshot_month", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function remove(userId, id) {
  const { error } = await supabase.from("net_worth_snapshots").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
}

/**
 * Delete all snapshots for a user except the most recent one.
 * Used to wipe bad historical data from erroneous CAS imports.
 */
export async function resetHistory(userId) {
  // Find the latest snapshot_month for this user
  const { data: latest, error: fetchErr } = await supabase
    .from("net_worth_snapshots")
    .select("snapshot_month")
    .eq("user_id", userId)
    .order("snapshot_month", { ascending: false })
    .limit(1)
    .single();

  if (fetchErr || !latest) return { ok: true, deleted: 0 };

  // Delete everything older than the latest month
  const { error, count } = await supabase
    .from("net_worth_snapshots")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .lt("snapshot_month", latest.snapshot_month);

  if (error) throw error;
  return { ok: true, deleted: count ?? 0, kept: latest.snapshot_month };
}
