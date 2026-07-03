/**
 * services/shares.service.js — portfolio sharing (family cross-links + shared view).
 * All Supabase/auth-admin access for sharing lives here.
 */
import { supabase } from "../lib/db.js";
import { enrichHoldings } from "../lib/holdings-utils.js";

async function lookupUserByEmail(email) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ filter: normalized, perPage: 1 });
  if (error || !data?.users?.length) return null;
  return data.users.find((u) => u.email?.toLowerCase() === normalized) || null;
}

async function lookupUsersByEmails(emails) {
  const results = new Map();
  await Promise.all(emails.map(async (email) => {
    const user = await lookupUserByEmail(email);
    if (user) results.set(email, user);
  }));
  return results;
}

async function namesFor(ids) {
  const nameMap = {};
  if (!ids.length) return nameMap;
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  for (const p of data || []) nameMap[p.id] = p.display_name;
  return nameMap;
}

export async function listGranted(userId) {
  const { data, error } = await supabase.from("portfolio_shares").select("id, shared_with, role, created_at").eq("owner_id", userId);
  if (error) throw new Error(error.message);
  const names = await namesFor((data || []).map((s) => s.shared_with));
  return (data || []).map((s) => ({ ...s, shared_with_name: names[s.shared_with] || null, shared_with_email: null }));
}

export async function listReceived(userId) {
  const { data, error } = await supabase.from("portfolio_shares").select("id, owner_id, role, created_at").eq("shared_with", userId);
  if (error) throw new Error(error.message);
  const names = await namesFor((data || []).map((s) => s.owner_id));
  return (data || []).map((s) => ({ ...s, owner_name: names[s.owner_id] || "Unknown" }));
}

export async function syncFromMembers(user) {
  const { data: portfolio } = await supabase.from("portfolio").select("members").eq("user_id", user.id).single();
  const members = portfolio?.members || [];
  const memberEmails = members.filter((m) => m.email && m.email.trim()).map((m) => m.email.trim().toLowerCase());
  const { data: existingShares } = await supabase.from("portfolio_shares").select("shared_with").eq("owner_id", user.id);
  const alreadySharedWith = new Set((existingShares || []).map((s) => s.shared_with));
  const usersByEmail = await lookupUsersByEmails(memberEmails);
  let synced = 0;
  for (const email of memberEmails) {
    if (email === user.email?.toLowerCase()) continue;
    const target = usersByEmail.get(email);
    if (!target || alreadySharedWith.has(target.id)) continue;
    const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
    if (!error) { synced++; alreadySharedWith.add(target.id); }
  }
  return { synced, checked: memberEmails.length };
}

export async function crossLink(user, email) {
  const normalEmail = (email || "").trim().toLowerCase();
  if (normalEmail === user.email?.toLowerCase()) return { linked: 0 };
  const target = await lookupUserByEmail(normalEmail);
  if (!target) return { linked: 0, reason: "User not signed up yet" };
  const { data: myGranted } = await supabase.from("portfolio_shares").select("shared_with").eq("owner_id", user.id);
  const { data: myReceived } = await supabase.from("portfolio_shares").select("owner_id").eq("shared_with", user.id);
  const familyIds = new Set([...(myGranted || []).map((s) => s.shared_with), ...(myReceived || []).map((s) => s.owner_id)]);
  familyIds.delete(user.id); familyIds.delete(target.id);
  let linked = 0;
  for (const _ of familyIds) {
    const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
    if (!error) linked++;
  }
  return { linked, family_size: familyIds.size };
}

export async function share(user, email) {
  const target = await lookupUserByEmail(email);
  if (!target) { const e = new Error("No account found with that email. They need to sign up first."); e.status = 404; throw e; }
  if (target.id === user.id) { const e = new Error("You can't share with yourself."); e.status = 400; throw e; }
  const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
  if (error) throw new Error(error.message);
  return { ok: true, shared_with: target.id, role: "viewer" };
}

export async function updateRole(userId, shareId) {
  const { error } = await supabase.from("portfolio_shares").update({ role: "viewer" }).eq("id", shareId).eq("owner_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function remove(userId, shareId) {
  const { error } = await supabase.from("portfolio_shares").delete().eq("id", shareId).or(`owner_id.eq.${userId},shared_with.eq.${userId}`);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function sharedPortfolio(userId, ownerId) {
  const { data: shareRow } = await supabase.from("portfolio_shares").select("role").eq("owner_id", ownerId).eq("shared_with", userId).single();
  if (!shareRow) { const e = new Error("No access to this portfolio"); e.status = 403; throw e; }
  const [portfolioResp, holdingsResp, profileResp] = await Promise.all([
    supabase.from("portfolio").select("*").eq("user_id", ownerId).single(),
    supabase.from("holdings").select("*, transactions(id,txn_type,units,price,txn_date,notes,created_at)").eq("user_id", ownerId).order("created_at", { ascending: true }),
    supabase.from("profiles").select("display_name, currency").eq("id", ownerId).single(),
  ]);
  return {
    role: shareRow.role,
    owner_name: profileResp.data?.display_name || "Unknown",
    owner_currency: profileResp.data?.currency || "INR",
    portfolio: portfolioResp.data || null,
    holdings: enrichHoldings(holdingsResp.data),
  };
}
