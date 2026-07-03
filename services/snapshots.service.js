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
