/**
 * services/brokers/persistSync.js — shared tail for broker syncs that use
 * upsert-on-id semantics (Kite, Breeze). Dedupes the identical
 * "upsert holdings → mark connection synced → snapshot → count" sequence.
 *
 * NOTE: SnapTrade is intentionally NOT routed through here — it uses per-account
 * flush-and-insert with a different response shape, so it stays in its own route.
 */
import { supabase } from "../../lib/db.js";
import { takeSnapshot } from "../../lib/snapshot.js";

/**
 * @param {string} userId
 * @param {Array}  rows       holdings rows to upsert (id is the conflict key)
 * @param {object} opts       { connTable, source }
 * @returns {{ synced, equity_count?, mf_count?, message? }}
 */
export async function persistBrokerSync(userId, rows, { connTable, source }) {
  if (!rows.length) return { synced: 0, message: "No holdings found." };
  const { error } = await supabase.from("holdings").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(error.message);
  await supabase.from(connTable).update({ last_synced_at: new Date().toISOString() }).eq("user_id", userId);
  // Snapshot directly (no fragile self-HTTP). Fire-and-forget.
  takeSnapshot(userId, { source }).catch((e) => console.error(`${source} snapshot:`, e.message));
  return {
    synced: rows.length,
    equity_count: rows.filter((r) => r.type !== "MF").length,
    mf_count: rows.filter((r) => r.type === "MF").length,
  };
}
