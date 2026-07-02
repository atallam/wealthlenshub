/**
 * guards.js — ownership assertions for the service-key data layer.
 *
 * WHY THIS EXISTS
 * The server talks to Supabase with the SERVICE-ROLE key (see lib/db.js),
 * which BYPASSES Row-Level Security. That means the RLS policies in the SQL
 * migrations do nothing at runtime, and every "does this row belong to the
 * caller?" check must be enforced here, in code. Skipping one of these is an
 * IDOR (Insecure Direct Object Reference).
 *
 * Each guard returns the row (or a minimal projection) when ownership holds,
 * and throws an Error tagged with `.status` when it does not — so callers can
 * do:  `const h = await assertOwnsHolding(userId, id);`  inside try/catch and
 * let sendError() / the global handler translate the status.
 */

import { supabase } from "./db.js";

/** Build an Error carrying an HTTP status code. */
function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Assert the given holding belongs to the user.
 * @param {string} userId    - req.user.id
 * @param {string} holdingId - client-supplied holding id
 * @returns {Promise<{id:string}>} the holding row (id only)
 * @throws  {Error} 400 if missing id, 404/403 if not owned
 */
export async function assertOwnsHolding(userId, holdingId) {
  if (!holdingId) throw httpError("holding id is required", 400);
  const { data, error } = await supabase
    .from("holdings")
    .select("id")
    .eq("id", holdingId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw httpError("Holding not found or access denied", 404);
  return data;
}

/**
 * Assert the given artifact belongs to the user (via its parent holding).
 * Works whether or not the artifacts table has its own user_id column,
 * because ownership is derived from the holding.
 * @param {string} userId
 * @param {string} artifactId
 * @returns {Promise<{id:string, storage_path:string, file_name:string, sha256?:string, holding_id:string}>}
 * @throws  {Error} 400/404/403
 */
export async function assertOwnsArtifact(userId, artifactId) {
  if (!artifactId) throw httpError("artifact id is required", 400);
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, storage_path, file_name, sha256, holding_id")
    .eq("id", artifactId)
    .single();
  if (error || !data) throw httpError("Not found", 404);
  // Derive ownership from the parent holding.
  await assertOwnsHolding(userId, data.holding_id);
  return data;
}
