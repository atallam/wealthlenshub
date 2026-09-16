/**
 * routes/analytics.js — ledger-derived performance analytics (Phase 3).
 *
 *   GET /api/analytics/xirr?member=all|<id>
 *       Per-holding XIRR + pooled money-weighted return per member and for the
 *       whole portfolio, computed from the transactions ledger.
 *
 *   GET /api/analytics/holdings/:id
 *       One holding: XIRR/stat block, open FIFO lots with LTCG/STCG status and
 *       the date each lot turns long-term, all-time realized lots.
 *
 * Holdings with no ledger rows fall back to a single estimated cashflow
 * (purchase_value on start_date) and are flagged basis:"estimated"; they are
 * excluded from pooled XIRR so one guess can't distort the family number.
 */
import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { assertOwnsHolding } from "../lib/guards.js";
import { ledgerStats, cashflowsFromLedger, xirr } from "../lib/xirr.js";
import { computeGains } from "../lib/tax.js";
import { USD_TYPES } from "../lib/constants.js";
import { fetchUsdInr, FX_FALLBACK } from "../lib/prices.js";

const router = Router();
const ACTIVE = "holding_status.is.null,holding_status.neq.exited";
const NOT_CLOSED = "maturity_status.is.null,maturity_status.neq.closed";
const LEDGER_TYPES = new Set(["IN_STOCK", "IN_ETF", "MF", "US_STOCK", "US_ETF", "CRYPTO"]);

async function loadHoldings(userId, member) {
  let q = supabase.from("holdings")
    .select("id, member_id, name, type, asset_class, units, current_price, current_nav, current_value, purchase_value, start_date, currency, source, depository, holding_status")
    .eq("user_id", userId).or(ACTIVE).or(NOT_CLOSED);
  if (member && member !== "all") q = q.eq("member_id", member);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).filter((h) => LEDGER_TYPES.has(h.type));
}

async function loadLedger(userId, holdingIds) {
  if (!holdingIds.length) return {};
  const { data, error } = await supabase.from("transactions")
    .select("holding_id, txn_type, units, price, amount, txn_date, source, source_type")
    .eq("user_id", userId).in("holding_id", holdingIds).order("txn_date", { ascending: true });
  if (error) throw new Error(error.message);
  const map = {};
  for (const t of data || []) (map[t.holding_id] ||= []).push(t);
  return map;
}

function valueInr(h, fx) {
  const isUSD = USD_TYPES.has(h.type) || (h.currency || "").toUpperCase() === "USD";
  const v = Number(h.current_value) || (Number(h.units) || 0) * (Number(h.current_price) || Number(h.current_nav) || 0);
  return isUSD ? v * fx : v;
}

/** Ledger in INR for pooled math (US holdings converted at today's rate — an approximation). */
function ledgerInr(txns, h, fx) {
  const isUSD = USD_TYPES.has(h.type) || (h.currency || "").toUpperCase() === "USD";
  if (!isUSD) return txns;
  return txns.map((t) => ({ ...t, price: (Number(t.price) || 0) * fx, amount: t.amount != null ? Number(t.amount) * fx : null }));
}

router.get("/xirr", auth, async (req, res) => {
  try {
    const member = req.query.member || "all";
    const holdings = await loadHoldings(req.user.id, member);
    const ledger = await loadLedger(req.user.id, holdings.map((h) => h.id));
    const { rate: fx } = await fetchUsdInr().catch(() => ({ rate: FX_FALLBACK }));
    const today = new Date().toISOString().slice(0, 10);

    const perHolding = [];
    const pooled = {};     // member_id → flows
    const allFlows = [];

    for (const h of holdings) {
      const txns = ledger[h.id] || [];
      const cv = valueInr(h, fx);
      let stats, basis;
      if (txns.length) {
        stats = ledgerStats(ledgerInr(txns, h, fx), cv, today);
        basis = txns.some((t) => t.source_type === "OPENING") ? "ledger_approx" : "ledger";
        const flows = cashflowsFromLedger(ledgerInr(txns, h, fx), cv, today);
        (pooled[h.member_id || "unassigned"] ||= []).push(...flows);
        allFlows.push(...flows);
      } else if (h.start_date && Number(h.purchase_value) > 0) {
        const est = [{ txn_type: "BUY", units: 1, price: Number(h.purchase_value) * (USD_TYPES.has(h.type) ? fx : 1), txn_date: h.start_date }];
        stats = ledgerStats(est, cv, today);
        basis = "estimated";
      } else {
        stats = { xirr: null, xirr_pct: null, invested: Number(h.purchase_value) || 0, withdrawn: 0, dividends: 0, current_value: cv, absolute_gain: null, absolute_return_pct: null, since: null, cashflows: 0 };
        basis = "none";
      }
      perHolding.push({
        holding_id: h.id, member_id: h.member_id, name: h.name, type: h.type, asset_class: h.asset_class || null,
        depository: h.depository || null, basis, ledger_rows: txns.length, ...stats,
      });
    }

    const members = Object.entries(pooled).map(([member_id, flows]) => {
      const r = xirr(flows);
      const invested = flows.filter((f) => f.kind === "BUY").reduce((s, f) => s - f.amount, 0);
      const value = flows.filter((f) => f.kind === "VALUE").reduce((s, f) => s + f.amount, 0);
      return { member_id, xirr: r, xirr_pct: r == null ? null : Math.round(r * 10000) / 100, invested, current_value: value, holdings: perHolding.filter((p) => (p.member_id || "unassigned") === member_id && p.basis.startsWith("ledger")).length };
    });
    const pr = xirr(allFlows);

    res.json({
      as_of: today,
      portfolio: {
        xirr: pr, xirr_pct: pr == null ? null : Math.round(pr * 10000) / 100,
        invested: allFlows.filter((f) => f.kind === "BUY").reduce((s, f) => s - f.amount, 0),
        current_value: allFlows.filter((f) => f.kind === "VALUE").reduce((s, f) => s + f.amount, 0),
        holdings_with_ledger: perHolding.filter((p) => p.basis.startsWith("ledger")).length,
        holdings_total: perHolding.length,
      },
      members,
      holdings: perHolding.sort((a, b) => (b.current_value || 0) - (a.current_value || 0)),
      notes: [
        "Pooled XIRR uses only holdings with a transaction ledger (CAS detailed statement or manual entries).",
        "Holdings flagged ledger_approx include an opening-balance lot whose cost is approximated — import a since-inception CAS for exact figures.",
      ],
    });
  } catch (e) { sendError(res, e); }
});

router.get("/holdings/:id", auth, async (req, res) => {
  try {
    await assertOwnsHolding(req.user.id, req.params.id);
    const { data: h, error } = await supabase.from("holdings")
      .select("id, member_id, name, type, asset_class, units, current_price, current_nav, current_value, purchase_value, start_date, currency, holding_status, depository, source")
      .eq("id", req.params.id).eq("user_id", req.user.id).single();
    if (error || !h) return res.status(404).json({ error: "Holding not found" });
    const ledger = await loadLedger(req.user.id, [h.id]);
    const txns = ledger[h.id] || [];
    const today = new Date().toISOString().slice(0, 10);
    const price = h.holding_status === "exited" ? 0 : Number(h.current_price) || Number(h.current_nav) || 0;
    const cv = h.holding_status === "exited" ? 0 : Number(h.current_value) || (Number(h.units) || 0) * price;

    const stats = txns.length ? ledgerStats(txns, cv, today) : null;
    // All-time lots: FY window wide open so every realized lot is returned.
    const { realized, unrealized } = computeGains(txns, "1900-01-01", "2999-12-31", price, { assetClass: h.asset_class });
    const openLots = unrealized.map((l) => ({ ...l, value: l.units * l.current_price, cost: l.units * l.buy_price }));
    const ltcgUnits = openLots.filter((l) => l.is_ltcg).reduce((s, l) => s + l.units, 0);
    const totalUnits = openLots.reduce((s, l) => s + l.units, 0);

    res.json({
      holding_id: h.id, name: h.name, type: h.type, asset_class: h.asset_class || "EQUITY", holding_status: h.holding_status || "active",
      basis: txns.length ? (txns.some((t) => t.source_type === "OPENING") ? "ledger_approx" : "ledger") : "none",
      ledger_rows: txns.length,
      ledger_sources: [...new Set(txns.map((t) => t.source || "manual"))],
      stats,
      lots: {
        open: openLots,
        realized,
        ltcg_units: ltcgUnits, total_units: totalUnits,
        ltcg_pct: totalUnits > 0 ? Math.round((ltcgUnits / totalUnits) * 1000) / 10 : null,
        unrealized_gain: openLots.reduce((s, l) => s + l.gain, 0),
        unrealized_ltcg: openLots.filter((l) => l.is_ltcg).reduce((s, l) => s + l.gain, 0),
        unrealized_stcg: openLots.filter((l) => !l.is_ltcg).reduce((s, l) => s + l.gain, 0),
        // Units that become long-term in the next 90 days — useful before a redemption.
        turning_ltcg_soon: openLots.filter((l) => l.ltcg_from && l.ltcg_from > today && l.ltcg_from <= addDays(today, 90)),
      },
    });
  } catch (e) { sendError(res, e, e.status || 500); }
});

function addDays(iso, n) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

export default router;
