/**
 * services/profile.service.js — user profile + asset-types + CAS credential status.
 * PAN/DOB are encrypted here; plaintext never leaves the service (P1-2).
 */
import { supabase } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";

export async function get(user) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  if (!data) {
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User", currency: "INR" })
      .select().single();
    return created || { id: user.id, currency: "INR" };
  }
  return data;
}

export async function update(userId, body) {
  const { display_name, currency, pan, dob, settings } = body;
  const patch = { id: userId, updated_at: new Date().toISOString() };
  if (display_name !== undefined) patch.display_name = display_name;
  if (currency !== undefined) patch.currency = currency;
  if (pan !== undefined) patch.encrypted_pan = pan ? encrypt(pan.toUpperCase().trim()) : null;
  if (dob !== undefined) patch.encrypted_dob = dob ? encrypt(dob.trim()) : null;
  if (settings !== undefined) patch.settings = settings; // JSONB prefs (ppf_rate, epf_rate…)
  const { error } = await supabase.from("profiles").upsert(patch);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** CAS credential status — masked PAN only, never plaintext (P1-2). */
export async function casCredentials(userId) {
  const { data, error } = await supabase.from("profiles").select("encrypted_pan, encrypted_dob").eq("id", userId).single();
  if (error) return { pan: null, dob: null, has_credentials: false };
  const pan = data?.encrypted_pan ? decrypt(data.encrypted_pan) : null;
  if (!pan || pan === "[encrypted]") return { pan: null, dob: null, has_credentials: false };
  const maskedPan = pan.length >= 10 ? pan.slice(0, 4) + "****" + pan.slice(-1) : "****";
  return { pan_masked: maskedPan, has_credentials: true };
}

const atId = (userId) => "at_" + Date.now().toString(36) + "_" + userId.slice(0, 8);

export async function listAssetTypes(userId) {
  const { data, error } = await supabase.from("asset_types").select("*").eq("user_id", userId).order("label");
  if (error) throw new Error(error.message);
  return data || [];
}
export async function createAssetType(userId, body) {
  const id = atId(userId);
  const { error } = await supabase.from("asset_types").insert({ id, user_id: userId, ...body });
  if (error) throw new Error(error.message);
  return { ok: true, id };
}
export async function updateAssetType(userId, id, body) {
  const { error } = await supabase.from("asset_types").update(body).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
export async function removeAssetType(userId, id) {
  await supabase.from("asset_types").delete().eq("id", id).eq("user_id", userId);
  return { ok: true };
}
