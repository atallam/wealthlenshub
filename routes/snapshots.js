import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { fetchUsdInr, FX_FALLBACK } from "../lib/prices.js";

// Asset types denominated in USD — must match utils.js USD_TYPES
const USD_TYPES = new Set(["US_STOCK", "US_ETF", "US_BOND", "CRYPTO"]);

const router = Router();

router.post("/", auth, async (req, res) => {
  try {
    const { source = "manual", cas_statement_date = null } = req.body;
    let snapshotMonth;
    if (cas_statement_date) {
      snapshotMonth = cas_statement_date.slice(0, 7);
    } else {
      const now = new Date();
      snapshotMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
    const { data: holdings } = await supabase.from("holdings")
      .select("id, member_id, type, name, units, purchase_price, current_price, purchase_value, current_value, currency")
      .eq("user_id", req.user.id);
    if (!holdings?.length) return res.json({ snapshot: null, message: "No holdings to snapshot" });
    // Use the shared, cached FX fetcher — consistent with prices.js and the UI
    const { rate: usdInr } = await fetchUsdInr().catch(() => ({ rate: FX_FALLBACK }));
    const isUSD = (h) => USD_TYPES.has(h.type) || (h.currency || "").toUpperCase() === "USD";
    const toINR = (h) => { const val = h.current_value || (h.units * h.current_price) || 0; return isUSD(h) ? val * usdInr : val; };
    const invINR = (h) => { const val = h.purchase_value || (h.units * h.purchase_price) || 0; return isUSD(h) ? val * usdInr : val; };
    let totalInvested = 0, totalCurrent = 0;
    const memberBreakdown = {}, typeBreakdown = {};
    for (const h of holdings) {
      const cur = toINR(h), inv = invINR(h);
      totalInvested += inv; totalCurrent += cur;
      const mid = h.member_id || "unassigned";
      if (!memberBreakdown[mid]) memberBreakdown[mid] = { invested: 0, current: 0 };
      memberBreakdown[mid].invested += inv; memberBreakdown[mid].current += cur;
      const t = h.type || "OTHER";
      if (!typeBreakdown[t]) typeBreakdown[t] = { invested: 0, current: 0 };
      typeBreakdown[t].invested += inv; typeBreakdown[t].current += cur;
    }
    const { data: snap, error } = await supabase.from("net_worth_snapshots")
      .upsert({
        user_id: req.user.id, snapshot_month: snapshotMonth,
        total_invested: Math.round(totalInvested), total_current: Math.round(totalCurrent),
        currency: "INR", member_breakdown: memberBreakdown, type_breakdown: typeBreakdown,
        source, cas_statement_date: cas_statement_date || null,
      }, { onConflict: "user_id,snapshot_month,currency" })
      .select().single();
    if (error) throw error;
    res.json({ snapshot: snap });
  } catch (e) { console.error("Snapshot error:", e); sendError(res, e); }
});

router.get("/", auth, async (req, res) => {
  try {
    const { months = 24 } = req.query;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - parseInt(months));
    const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
    const { data, error } = await supabase.from("net_worth_snapshots")
      .select("*").eq("user_id", req.user.id).gte("snapshot_month", cutoffMonth)
      .order("snapshot_month", { ascending: true });
    if (error) throw error;
    res.json({ snapshots: data || [] });
  } catch (e) { console.error("Snapshots fetch error:", e); sendError(res, e); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const { error } = await supabase.from("net_worth_snapshots").delete().eq("id", req.params.id).eq("user_id", req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

export default router;
