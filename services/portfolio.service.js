/**
 * services/portfolio.service.js — portfolio doc (members/goals/alerts/liabilities).
 * Handles auto-provisioning, "Self" member self-repair, and PAN/DOB masking so
 * plaintext PII never leaves the service boundary.
 */
import { supabase } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const newMemberId = () => "m_" + Date.now().toString(36);

async function displayNameFor(user) {
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  return profile?.display_name || user.email?.split("@")[0] || "Me";
}

function maskMembers(members) {
  return (members || []).map((m) => {
    const out = { ...m };
    if (out.encrypted_pan) {
      try {
        const raw = decrypt(out.encrypted_pan);
        out.pan_masked = raw.length >= 10 ? raw.slice(0, 5) + "****" + raw.slice(-1) : "****";
      } catch { out.pan_masked = "****"; }
      delete out.encrypted_pan;
    }
    if (out.encrypted_dob) { out.has_dob = true; delete out.encrypted_dob; }
    return out;
  });
}

/** Get the user's portfolio, auto-provisioning + self-repairing as needed. */
export async function get(user) {
  const { data, error } = await supabase.from("portfolio").select("*").eq("user_id", user.id).single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);

  if (!data) {
    const name = await displayNameFor(user).catch(() => user.email?.split("@")[0] || "Me");
    const member = { id: newMemberId(), name, relation: "Self", email: user.email || "" };
    const created = { id: user.id, user_id: user.id, members: [member], goals: [], alerts: [], updated_at: new Date().toISOString() };
    const { error: insErr } = await supabase.from("portfolio").upsert(created);
    if (insErr) console.error(`Auto-provision failed for ${user.email}:`, insErr.message);
    return created;
  }

  if (!data.members || data.members.length === 0 || !data.members.find((m) => m.relation === "Self")) {
    try {
      const name = await displayNameFor(user);
      const repaired = [...(data.members || []), { id: newMemberId(), name, relation: "Self", email: user.email || "" }];
      await supabase.from("portfolio").update({ members: repaired, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      data.members = repaired;
    } catch (e) { console.error(`Self-repair failed for ${user.email}:`, e.message); }
  }

  if (data.members) data.members = maskMembers(data.members);
  return data;
}

/** Upsert the portfolio, encrypting any new PAN/DOB the client submitted. */
export async function save(userId, body) {
  const { members, goals, alerts, liabilities } = body;

  // The client only ever sees masked PANs (get() strips encrypted_pan/encrypted_dob),
  // so members echoed back on save lack those fields. Carry them over from the
  // existing row unless the client submitted a replacement — otherwise every
  // portfolio save would silently wipe stored member PANs.
  const { data: existing } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const prevById = new Map((existing?.members || []).map((m) => [m.id, m]));

  const safeMembers = (members || []).map((m) => {
    const out = { ...m };
    const prev = prevById.get(out.id);
    if (out.pan && !out.pan.includes(":")) { out.encrypted_pan = encrypt(out.pan.toUpperCase().trim()); delete out.pan; }
    else if (!out.encrypted_pan && prev?.encrypted_pan) out.encrypted_pan = prev.encrypted_pan;
    if (out.dob && !out.dob.includes(":")) { out.encrypted_dob = encrypt(out.dob.trim()); delete out.dob; }
    else if (!out.encrypted_dob && prev?.encrypted_dob) out.encrypted_dob = prev.encrypted_dob;
    delete out.pan_masked; delete out.has_dob;
    return out;
  });
  const upsertData = { id: userId, user_id: userId, members: safeMembers, goals, alerts, updated_at: new Date().toISOString() };
  if (liabilities !== undefined) upsertData.liabilities = liabilities;
  const { error } = await supabase.from("portfolio").upsert(upsertData);
  if (error) throw new Error(error.message);
  return { ok: true };
}
