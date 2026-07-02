import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router = Router();

function sanitizeDates(obj) {
  const dateFields = ["start_date", "maturity_date"];
  const result = { ...obj };
  for (const field of dateFields) {
    if (result[field] === "" || result[field] === undefined) result[field] = null;
  }
  return result;
}

function enrichHoldings(holdings) {
  return (holdings || []).map(h => {
    const txns = h.transactions || [];
    if (txns.length === 0) return h;
    const buys  = txns.filter(t => t.txn_type === "BUY");
    const sells = txns.filter(t => t.txn_type === "SELL");
    const buyUnits  = buys.reduce((s, t) => s + Number(t.units || 0), 0);
    const sellUnits = sells.reduce((s, t) => s + Number(t.units || 0), 0);
    const netUnits  = Math.max(0, buyUnits - sellUnits);
    const avgCost   = buyUnits > 0
      ? buys.reduce((s, t) => s + Number(t.units || 0) * Number(t.price || 0), 0) / buyUnits : 0;
    const sortedTxns = [...txns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
    return { ...h, net_units: netUnits, avg_cost: avgCost, units: netUnits, purchase_price: avgCost, purchase_nav: avgCost, purchase_value: avgCost * netUnits, start_date: h.start_date || sortedTxns[0]?.txn_date || null };
  });
}

router.get("/", auth, async (req, res) => {
  const { data, error } = await supabase.from("portfolio").select("*").eq("user_id", req.user.id).single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  const getDisplayName = async () => {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", req.user.id).single();
    return profile?.display_name || req.user.email?.split("@")[0] || "Me";
  };
  if (!data) {
    try {
      const displayName = await getDisplayName();
      const defaultMember = { id: "m_" + Date.now().toString(36), name: displayName, relation: "Self", email: req.user.email || "" };
      const newPortfolio = { id: req.user.id, user_id: req.user.id, members: [defaultMember], goals: [], alerts: [], updated_at: new Date().toISOString() };
      const { error: insertErr } = await supabase.from("portfolio").upsert(newPortfolio);
      if (insertErr) console.error(`Auto-provision failed for ${req.user.email}:`, insertErr.message);
      return res.json(newPortfolio);
    } catch (e) {
      const displayName = req.user.email?.split("@")[0] || "Me";
      return res.json({ id: req.user.id, user_id: req.user.id, members: [{ id: "m_" + Date.now().toString(36), name: displayName, relation: "Self", email: req.user.email || "" }], goals: [], alerts: [] });
    }
  }
  if (data && (!data.members || data.members.length === 0 || !data.members.find(m => m.relation === "Self"))) {
    try {
      const displayName = await getDisplayName();
      const selfMember = { id: "m_" + Date.now().toString(36), name: displayName, relation: "Self", email: req.user.email || "" };
      const repairedMembers = [...(data.members || []), selfMember];
      await supabase.from("portfolio").update({ members: repairedMembers, updated_at: new Date().toISOString() }).eq("user_id", req.user.id);
      data.members = repairedMembers;
    } catch (e) { console.error(`Self-repair failed for ${req.user.email}:`, e.message); }
  }
  if (data?.members) {
    data.members = data.members.map(m => {
      const out = { ...m };
      if (out.encrypted_pan) {
        try { const raw = decrypt(out.encrypted_pan); out.pan_masked = raw.length >= 10 ? raw.slice(0,5) + "****" + raw.slice(-1) : "****"; } catch { out.pan_masked = "****"; }
        delete out.encrypted_pan;
      }
      if (out.encrypted_dob) { out.has_dob = true; delete out.encrypted_dob; }
      return out;
    });
  }
  res.json(data);
});

router.post("/", auth, async (req, res) => {
  const { members, goals, alerts, liabilities } = req.body;
  const safeMembers = (members || []).map(m => {
    const out = { ...m };
    if (out.pan && !out.pan.includes(":")) { out.encrypted_pan = encrypt(out.pan.toUpperCase().trim()); delete out.pan; }
    if (out.dob && !out.dob.includes(":")) { out.encrypted_dob = encrypt(out.dob.trim()); delete out.dob; }
    delete out.pan_masked; delete out.has_dob;
    return out;
  });
  const upsertData = { id: req.user.id, user_id: req.user.id, members: safeMembers, goals, alerts, updated_at: new Date().toISOString() };
  if (liabilities !== undefined) upsertData.liabilities = liabilities;
  const { error } = await supabase.from("portfolio").upsert(upsertData);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export { sanitizeDates, enrichHoldings };
export default router;
