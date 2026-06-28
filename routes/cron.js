import { Router } from "express";
import { supabase } from "../lib/db.js";
import { fetchUsdInr, mfNav, stockPrice, yahooPrice } from "../lib/prices.js";

const router = Router();

function cronAuth(req, res, next) {
  const secret = req.headers["x-cron-secret"];
  if (!secret || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.post("/refresh-all-prices", cronAuth, async (req, res) => {
  const { data: rows } = await supabase.from("holdings").select("user_id");
  const userIds = [...new Set((rows || []).map(r => r.user_id))];
  console.log(`Cron refresh started: ${userIds.length} users`);
  let totalUpdated = 0;
  const results = [];
  for (const userId of userIds) {
    try {
      const { data: holdings } = await supabase.from("holdings").select("id, type, ticker, scheme_code, units, usd_inr_rate").eq("user_id", userId);
      if (!holdings?.length) continue;
      const { rate: usdInr } = await fetchUsdInr();
      let updated = 0;
      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i]; let patch = null;
        try {
          if (h.type === "MF" && h.scheme_code) { const nav = await mfNav(h.scheme_code); if (nav) patch = { current_nav: nav, current_value: (h.units||0)*nav, price_fetched_at: new Date().toISOString() }; }
          else if ((h.type === "IN_STOCK" || h.type === "IN_ETF") && h.ticker) { const q = await stockPrice(`${h.ticker.toUpperCase()}.NS`, "NSE"); const price = q?.price ?? await yahooPrice(`${h.ticker.toUpperCase()}.BO`); if (price) patch = { current_price: price, current_value: (h.units||0)*price, price_fetched_at: new Date().toISOString() }; }
          else if ((h.type === "US_STOCK" || h.type === "US_ETF" || h.type === "US_BOND") && h.ticker) { const q = await stockPrice(h.ticker.toUpperCase()); if (q?.price) patch = { current_price: q.price, current_value: (h.units||0)*q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() }; }
          else if (h.type === "CRYPTO" && h.ticker) { const sym = h.ticker.toUpperCase().includes("-") ? h.ticker.toUpperCase() : `${h.ticker.toUpperCase()}-USD`; const q = await stockPrice(sym); if (q?.price) patch = { current_price: q.price, current_value: (h.units||0)*q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() }; }
        } catch { /* skip */ }
        if (patch) { await supabase.from("holdings").update(patch).eq("id", h.id); updated++; }
        if (i < holdings.length - 1) await new Promise(r => setTimeout(r, 800));
      }
      // Auto-snapshot
      try {
        const { data: snapHoldings } = await supabase.from("holdings").select("member_id, type, units, purchase_price, current_price, purchase_value, current_value, currency").eq("user_id", userId);
        if (snapHoldings?.length) {
          const { rate: fx } = await fetchUsdInr();
          const toINR = h => { const v = h.current_value || (h.units * h.current_price) || 0; return h.currency === "USD" ? v * fx : v; };
          const invINR = h => { const v = h.purchase_value || (h.units * h.purchase_price) || 0; return h.currency === "USD" ? v * fx : v; };
          const totalCurrent = snapHoldings.reduce((s, h) => s + toINR(h), 0);
          const totalInvested = snapHoldings.reduce((s, h) => s + invINR(h), 0);
          const now = new Date();
          const snapshotMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
          await supabase.from("net_worth_snapshots").upsert({ user_id: userId, snapshot_month: snapshotMonth, total_invested: Math.round(totalInvested), total_current: Math.round(totalCurrent), currency: "INR", source: "cron_refresh" }, { onConflict: "user_id,snapshot_month,currency" });
        }
      } catch (snapErr) { console.error(`Snapshot failed for ${userId}:`, snapErr.message); }
      totalUpdated += updated;
      results.push({ userId, updated });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { results.push({ userId, error: e.message }); }
  }
  console.log(`Cron complete: ${totalUpdated} holdings updated across ${userIds.length} users`);
  res.json({ users: userIds.length, totalUpdated, results });
});

router.post("/check-cas-email", cronAuth, async (req, res) => {
  // Delegate to the gmail router's check-cas-email logic via internal import
  try {
    const { checkCasEmail } = await import("./gmail.js");
    await checkCasEmail(req, res);
  } catch (e) {
    res.json({ checked: 0, error: e.message });
  }
});

export default router;
