/**
 * routes/tax.js — LTCG / STCG tax computation (India, post Budget-2024)
 *
 * Rules applied:
 *  • Equity assets (IN_STOCK, IN_ETF, MF)
 *  • STCG  : holding < 12 months → 20 %  (new rate from Jul 2024)
 *  • LTCG  : holding ≥ 12 months → 12.5 % on gains > ₹ 1,25,000 exemption per FY
 *  • FIFO lot matching for SELLs
 *
 * Endpoint:  GET /api/tax/gains?fy=2025-26
 */

import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { fyRange, currentFY, computeGains, summarizeRealized } from "../lib/tax.js";

const router = Router();

// ── route ──────────────────────────────────────────────────────────────────

/**
 * GET /api/tax/gains?fy=2025-26
 *
 * Query params:
 *   fy       — Indian FY string, default current FY
 *   member   — member_id filter ("all" or specific id)
 */
router.get("/gains", auth, async (req, res) => {
  const fy     = req.query.fy     || currentFY();
  const member = req.query.member || "all";
  const { start: fyStart, end: fyEnd } = fyRange(fy);

  // 1. Fetch taxable holdings
  let hq = supabase
    .from("holdings")
    .select("id, name, symbol, type, current_price, current_nav, member_id")
    .eq("user_id", req.user.id)
    .in("type", ["IN_STOCK", "IN_ETF", "MF"]);

  if (member !== "all") hq = hq.eq("member_id", member);

  const { data: holdings, error: hErr } = await hq;
  if (hErr) return res.status(500).json({ error: hErr.message });

  if (!holdings || holdings.length === 0) {
    return res.json({
      fy,
      realized:   { stcg: 0, ltcg: 0, ltcg_exemption: 125000, ltcg_taxable: 0, stcg_tax: 0, ltcg_tax: 0, total_tax: 0, details: [] },
      unrealized: { stcg: 0, ltcg: 0, details: [] },
    });
  }

  // 2. Fetch all transactions for those holdings
  const holdingIds = holdings.map(h => h.id);
  const { data: transactions, error: tErr } = await supabase
    .from("transactions")
    .select("id, holding_id, txn_type, units, price, txn_date")
    .in("holding_id", holdingIds)
    .order("txn_date", { ascending: true });

  if (tErr) return res.status(500).json({ error: tErr.message });

  // 3. Group transactions by holding
  const txnMap = {};
  for (const t of (transactions || [])) {
    (txnMap[t.holding_id] ||= []).push(t);
  }

  // 4. FIFO per holding
  const realizedAll  = [];
  const unrealizedAll = [];

  for (const h of holdings) {
    const txns = txnMap[h.id] || [];
    if (txns.length === 0) continue;

    const currentPrice = +(h.current_price || h.current_nav || 0);
    const { realized, unrealized } = computeGains(txns, fyStart, fyEnd, currentPrice);

    const meta = { holding_id: h.id, name: h.name, symbol: h.symbol, type: h.type, member_id: h.member_id };
    for (const r of realized)   realizedAll.push({ ...meta, ...r });
    for (const u of unrealized) unrealizedAll.push({ ...meta, ...u });
  }

  // 5. Aggregate (shared math in lib/tax.js)
  const summary = summarizeRealized(realizedAll);
  const stcgUR = unrealizedAll.filter(d => !d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcgUR = unrealizedAll.filter(d =>  d.is_ltcg).reduce((s, d) => s + d.gain, 0);

  res.json({
    fy,
    realized: { ...summary, details: realizedAll },
    unrealized: { stcg: stcgUR, ltcg: ltcgUR, details: unrealizedAll },
  });
});

export default router;
