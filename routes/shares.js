import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { enrichHoldings } from "../lib/holdings-utils.js";

const router = Router();

async function lookupUserByEmail(email) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ filter: normalized, perPage: 1 });
  if (error || !data?.users?.length) return null;
  return data.users.find(u => u.email?.toLowerCase() === normalized) || null;
}

async function lookupUsersByEmails(emails) {
  const results = new Map();
  await Promise.all(emails.map(async (email) => {
    const user = await lookupUserByEmail(email);
    if (user) results.set(email, user);
  }));
  return results;
}

router.get("/", auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("portfolio_shares").select("id, shared_with, role, created_at").eq("owner_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    const userIds = (data || []).map(s => s.shared_with);
    const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
    const nameMap = {};
    for (const p of profiles || []) nameMap[p.id] = p.display_name;
    res.json({ shares: (data || []).map(s => ({ ...s, shared_with_name: nameMap[s.shared_with] || null, shared_with_email: null })) });
  } catch (e) { sendError(res, e); }
});

router.get("/received", auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("portfolio_shares").select("id, owner_id, role, created_at").eq("shared_with", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    const ownerIds = (data || []).map(s => s.owner_id);
    const { data: profiles } = ownerIds.length ? await supabase.from("profiles").select("id, display_name").in("id", ownerIds) : { data: [] };
    const nameMap = {};
    for (const p of profiles || []) nameMap[p.id] = p.display_name;
    res.json({ shared_with_me: (data || []).map(s => ({ ...s, owner_name: nameMap[s.owner_id] || "Unknown" })) });
  } catch (e) { sendError(res, e); }
});

router.post("/sync", auth, async (req, res) => {
  try {
    const { data: portfolio } = await supabase.from("portfolio").select("members").eq("user_id", req.user.id).single();
    const members = portfolio?.members || [];
    const memberEmails = members.filter(m => m.email && m.email.trim()).map(m => m.email.trim().toLowerCase());
    const { data: existingShares } = await supabase.from("portfolio_shares").select("shared_with").eq("owner_id", req.user.id);
    const alreadySharedWith = new Set((existingShares || []).map(s => s.shared_with));
    const usersByEmail = await lookupUsersByEmails(memberEmails);
    let synced = 0;
    for (const email of memberEmails) {
      if (email === req.user.email?.toLowerCase()) continue;
      const target = usersByEmail.get(email);
      if (!target || alreadySharedWith.has(target.id)) continue;
      const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: req.user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
      if (!error) { synced++; alreadySharedWith.add(target.id); }
    }
    res.json({ synced, checked: memberEmails.length });
  } catch (e) { console.error("Share sync error:", e.message); res.json({ synced: 0, error: e.message }); }
});

router.post("/cross-link", auth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    const normalEmail = email.trim().toLowerCase();
    if (normalEmail === req.user.email?.toLowerCase()) return res.json({ linked: 0 });
    const target = await lookupUserByEmail(normalEmail);
    if (!target) return res.json({ linked: 0, reason: "User not signed up yet" });
    const { data: myGranted } = await supabase.from("portfolio_shares").select("shared_with").eq("owner_id", req.user.id);
    const { data: myReceived } = await supabase.from("portfolio_shares").select("owner_id").eq("shared_with", req.user.id);
    const familyIds = new Set([...(myGranted || []).map(s => s.shared_with), ...(myReceived || []).map(s => s.owner_id)]);
    familyIds.delete(req.user.id); familyIds.delete(target.id);
    let linked = 0;
    for (const _familyUserId of familyIds) {
      const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: req.user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
      if (!error) linked++;
    }
    res.json({ linked, family_size: familyIds.size });
  } catch (e) { console.error("Cross-link error:", e.message); res.json({ linked: 0, error: e.message }); }
});

router.post("/", auth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    const target = await lookupUserByEmail(email);
    if (!target) return res.status(404).json({ error: "No account found with that email. They need to sign up first." });
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't share with yourself." });
    const { error } = await supabase.from("portfolio_shares").upsert({ owner_id: req.user.id, shared_with: target.id, role: "viewer", created_at: new Date().toISOString() }, { onConflict: "owner_id,shared_with" });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, shared_with: target.id, role: "viewer" });
  } catch (e) { sendError(res, e); }
});

router.put("/:shareId", auth, async (req, res) => {
  try {
    const { error } = await supabase.from("portfolio_shares").update({ role: "viewer" }).eq("id", req.params.shareId).eq("owner_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

router.delete("/:shareId", auth, async (req, res) => {
  try {
    const { error } = await supabase.from("portfolio_shares").delete().eq("id", req.params.shareId).or(`owner_id.eq.${req.user.id},shared_with.eq.${req.user.id}`);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

router.get("/shared-portfolio/:ownerId", auth, async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const { data: share } = await supabase.from("portfolio_shares").select("role").eq("owner_id", ownerId).eq("shared_with", req.user.id).single();
    if (!share) return res.status(403).json({ error: "No access to this portfolio" });
    const [portfolioResp, holdingsResp, profileResp] = await Promise.all([
      supabase.from("portfolio").select("*").eq("user_id", ownerId).single(),
      supabase.from("holdings").select("*, transactions(id,txn_type,units,price,txn_date,notes,created_at)").eq("user_id", ownerId).order("created_at", { ascending: true }),
      supabase.from("profiles").select("display_name, currency").eq("id", ownerId).single(),
    ]);
    res.json({ role: share.role, owner_name: profileResp.data?.display_name || "Unknown", owner_currency: profileResp.data?.currency || "INR", portfolio: portfolioResp.data || null, holdings: enrichHoldings(holdingsResp.data) });
  } catch (e) { sendError(res, e); }
});

export default router;
