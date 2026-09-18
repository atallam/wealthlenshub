/**
 * services/brokers/persistSync.js
 *
 * DEPRECATED / DEAD CODE (2026-09-18) — nothing imports persistBrokerSync anymore.
 * It was written as a shared tail for broker syncs using upsert-on-id semantics
 * (Kite, Breeze), but both integrations have since been decommissioned
 * (see src/App.jsx's "KiteImport and BreezeImport decommissioned" comment) and
 * SnapTrade — the only broker left — was intentionally never routed through here
 * (see the original note below). Safe to delete this file and the now-empty
 * services/brokers/ directory: `rm services/brokers/persistSync.js && rmdir
 * services/brokers`. Left in place only because the machine this was found on
 * couldn't run shell commands to delete it at the time — see RESTRUCTURE_PLAN.md's
 * P3-3 entry for the full context. If a new broker integration is ever added,
 * reconsider a shared sync-runner pattern designed against what actually exists
 * then, rather than reviving this file as-is.
 *
 * ── Original header ─────────────────────────────────────────────────────────
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
