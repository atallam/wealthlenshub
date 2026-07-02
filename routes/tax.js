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

const router = Router();

// ── helpers ────────────────────────────────────────────────────────────────

/** "2024-25" → { start:"2024-04-01", end:"2025-03-31" } */
function fyRange(fyStr) {
  const startY = parseInt(fyStr.split("-")[0], 10);
  return {
    start: `${startY}-04-01`,
    end:   `${startY + 1}-03-31`,
  };
}

/** Current Indian FY string, e.g. "2026-27" */
function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed; April = 3
  const startY = m >= 3 ? y : y - 1;
  return `${startY}-${String(startY + 1).slice(-2)}`;
}

/** Whole months between two ISO date strings */
function monthsBetween(buyDate, sellDate) {
  const a = new Date(buyDate);
  const b = new Date(sellDate);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * FIFO lot matching.
 *
 * Returns:
 *   realized  — gains from SELLs within [fyStart, fyEnd]
 *   unrealized — open lots valued at currentPrice
 */
function computeGains(transactions, fyStart, fyEnd, currentPrice) {
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.txn_date) - new Date(b.txn_date)
  );

  // Mutable FIFO queue: { date, units, price, remaining }
  const lots = [];
  const realized  = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const txn of sorted) {
    const units = Math.abs(+txn.units || 0);
    const price = +txn.price || 0;

    if (txn.txn_type === "BUY") {
      lots.push({ date: txn.txn_date, units, price, remaining: units });

    } else if (txn.txn_type === "SELL" || txn.txn_type === "REDEEM") {
      let toSell = units;
      const sellPrice = price;
      const sellDate  = txn.txn_date;
      const inFY = sellDate >= fyStart && sellDate <= fyEnd;

      // Consume oldest lots first (FIFO)
      while (toSell > 1e-6 && lots.length > 0) {
        const lot = lots[0];
        const used = Math.min(lot.remaining, toSell);
        lot.remaining -= used;
        toSell        -= used;

        if (inFY) {
          const holdMonths = monthsBetween(lot.date, sellDate);
          const isLtcg     = holdMonths >= 12;
          const gain        = (sellPrice - lot.price) * used;
          realized.push({
            buy_date:    lot.date,
            sell_date:   sellDate,
            units:       used,
            buy_price:   lot.price,
            sell_price:  sellPrice,
            gain,
            is_ltcg:     isLtcg,
            hold_months: holdMonths,
          });
        }

        if (lot.remaining < 1e-6) lots.shift();
      }
    }
  }

  // Open (unrealized) lots
  const unrealized = [];
  if (currentPrice > 0) {
    for (const lot of lots) {
      if (lot.remaining < 1e-6) continue;
      const holdMonths = monthsBetween(lot.date, today);
      const isLtcg     = holdMonths >= 12;
      const gain        = (currentPrice - lot.price) * lot.remaining;
      unrealized.push({
        buy_date:      lot.date,
        units:         lot.remaining,
        buy_price:     lot.price,
        current_price: currentPrice,
        gain,
        is_ltcg:       isLtcg,
        hold_months:   holdMonths,
      });
    }
  }

  return { realized, unrealized };
}

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

  // 5. Aggregate
  const stcg = realizedAll.filter(d => !d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcg = realizedAll.filter(d =>  d.is_ltcg).reduce((s, d) => s + d.gain, 0);

  const LTCG_EXEMPTION = 125000;
  const ltcgTaxable    = Math.max(0, ltcg - LTCG_EXEMPTION);
  const stcgTax        = Math.max(0, stcg) * 0.20;
  const ltcgTax        = ltcgTaxable * 0.125;

  const stcgUR = unrealizedAll.filter(d => !d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcgUR = unrealizedAll.filter(d =>  d.is_ltcg).reduce((s, d) => s + d.gain, 0);

  res.json({
    fy,
    realized: {
      stcg,
      ltcg,
      ltcg_exemption: LTCG_EXEMPTION,
      ltcg_taxable:   ltcgTaxable,
      stcg_tax:       stcgTax,
      ltcg_tax:       ltcgTax,
      total_tax:      stcgTax + ltcgTax,
      details:        realizedAll,
    },
    unrealized: {
      stcg: stcgUR,
      ltcg: ltcgUR,
      details: unrealizedAll,
    },
  });
});

export default router;
