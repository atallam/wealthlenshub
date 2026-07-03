/**
 * services/artifacts.service.js — all DB/storage access for artifacts.
 *
 * Routes call these; they never touch supabase directly. Ownership is enforced
 * here via lib/guards.js (the service key bypasses RLS, so this is the only
 * authorization boundary).
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { hashFile } from "../lib/crypto.js";
import { assertOwnsHolding, assertOwnsArtifact } from "../lib/guards.js";

const BUCKET = "artifacts";

/** List artifacts for a holding the user owns. */
export async function listForHolding(userId, holdingId) {
  await assertOwnsHolding(userId, holdingId);
  const { data, error } = await supabase
    .from("artifacts").select("*")
    .eq("holding_id", holdingId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Upload a file to storage + insert the artifact row (owner-checked). */
export async function create(userId, holdingId, file, description = "") {
  await assertOwnsHolding(userId, holdingId);
  const sha256 = hashFile(file.buffer);
  const id = "art_" + Date.now() + randomUUID().replace(/-/g, "").slice(0, 4);
  const ext = file.originalname.split(".").pop().toLowerCase();
  const storagePath = `holdings/${holdingId}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error: dbErr } = await supabase.from("artifacts").insert({
    id, user_id: userId, holding_id: holdingId,
    file_name: file.originalname, storage_path: storagePath,
    file_type: file.mimetype, file_size: file.size,
    description: description || "", sha256,
  });
  if (dbErr) throw new Error(dbErr.message);
  return { id, file_name: file.originalname, sha256 };
}

/** Return a short-lived signed download URL (owner-checked). */
export async function getSignedUrl(userId, artifactId) {
  const art = await assertOwnsArtifact(userId, artifactId);
  const { data: signed } = await supabase.storage
    .from(BUCKET).createSignedUrl(art.storage_path, 300);
  return { url: signed?.signedUrl, file_name: art.file_name, sha256: art.sha256 || null };
}

/** Delete an artifact and its stored object (owner-checked). */
export async function remove(userId, artifactId) {
  const art = await assertOwnsArtifact(userId, artifactId);
  if (art.storage_path) await supabase.storage.from(BUCKET).remove([art.storage_path]);
  const { error } = await supabase.from("artifacts").delete().eq("id", artifactId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
