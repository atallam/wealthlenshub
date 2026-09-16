/**
 * lib/tax.js — Single source of truth for India LTCG/STCG capital-gains math.
 *
 * Used by BOTH routes/tax.js (the Tax tab) and routes/ai.js (the advisor's
 * get_tax_summary tool) so the two can never drift apart.
 *
 * Rules (post Budget-2024):
 *   Equity (IN_STOCK, IN_ETF, equity/hybrid MF):
 *     • STCG (< 12 months): 20%
 *     • LTCG (≥ 12 months): 12.5% on gains above the ₹1,25,000 per-FY exemption
 *   Debt MF (holdings.asset_class = DEBT):
 *     • units bought on/after 1-Apr-2023: always taxed at slab rate (no LTCG)
 *     • units bought before 1-Apr-2023: STCG (< 24 months) at slab,
 *       LTCG (≥ 24 months) at 12.5% without indexation
 *   • FIFO lot matching for SELL/REDEEM/SWP
 *
 * Every realized / unrealized row carries `rate_basis`:
 *   "equity_stcg" | "equity_ltcg" | "slab" | "debt_ltcg"
 */

export const LTCG_EXEMPTION = 125000;
export const STCG_RATE = 0.20;
export const LTCG_RATE = 0.125;
export const DEBT_SLAB_CUTOFF = "2023-04-01";   // Finance Act 2023: debt MF bought on/after → slab

/** Classify a lot given the holding's asset class. */
export function classifyLot(assetClass, buyDate, holdMonths) {
  const ac = String(assetClass || "EQUITY").toUpperCase();
  if (ac === "DEBT") {
    if (buyDate >= DEBT_SLAB_CUTOFF) return { is_ltcg: false, rate_basis: "slab" };
    return holdMonths >= 24 ? { is_ltcg: true, rate_basis: "debt_ltcg" } : { is_ltcg: false, rate_basis: "slab" };
  }
  // EQUITY, HYBRID (assumed equity-oriented), UNKNOWN → equity rules
  return holdMonths >= 12 ? { is_ltcg: true, rate_basis: "equity_ltcg" } : { is_ltcg: false, rate_basis: "equity_stcg" };
}

/** "2024-25" → { start:"2024-04-01", end:"2025-03-31" } */
export function fyRange(fyStr) {
  const startY = parseInt(String(fyStr).split("-")[0], 10);
  return { start: `${startY}-04-01`, end: `${startY + 1}-03-31` };
}

/** Current Indian FY string, e.g. "2026-27" (FY starts in April). */
export function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const startY = d.getMonth() >= 3 ? y : y - 1; // month is 0-indexed; April = 3
  return `${startY}-${String(startY + 1).slice(-2)}`;
}

/** Whole calendar months between two ISO date strings. */
export function monthsBetween(buyDate, sellDate) {
  const a = new Date(buyDate);
  const b = new Date(sellDate);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * FIFO lot matching over a transaction list.
 *
 * @param {Array}  transactions  rows with { txn_type, units, price, txn_date }
 * @param {string} fyStart       ISO date (inclusive)
 * @param {string} fyEnd         ISO date (inclusive)
 * @param {number} currentPrice  for valuing open lots (0 to skip unrealized)
 * @param {object} [opts]        { assetClass: "EQUITY"|"DEBT"|"HYBRID" }
 * @returns {{ realized: Array, unrealized: Array }}
 */
export function computeGains(transactions, fyStart, fyEnd, currentPrice = 0, opts = {}) {
  const assetClass = opts.assetClass || "EQUITY";
  const sorted = [...transactions].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  const lots = [];        // FIFO queue: { date, price, remaining }
  const realized = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const txn of sorted) {
    const units = Math.abs(+txn.units || 0);
    const price = +txn.price || 0;

    if (txn.txn_type === "BUY" || txn.txn_type === "SIP" || txn.txn_type === "RIGHTS") {
      lots.push({ date: txn.txn_date, price, remaining: units, approx: txn.source_type === "OPENING" });
    } else if (txn.txn_type === "BONUS") {
      lots.push({ date: txn.txn_date, price: 0, remaining: units, approx: false });
    } else if (txn.txn_type === "SELL" || txn.txn_type === "REDEEM" || txn.txn_type === "SWP") {
      let toSell = units;
      const sellDate = txn.txn_date;
      const inFY = sellDate >= fyStart && sellDate <= fyEnd;
      while (toSell > 1e-6 && lots.length > 0) {
        const lot = lots[0];
        const used = Math.min(lot.remaining, toSell);
        lot.remaining -= used;
        toSell -= used;
        if (inFY) {
          const holdMonths = monthsBetween(lot.date, sellDate);
          realized.push({
            buy_date: lot.date, sell_date: sellDate, units: used,
            buy_price: lot.price, sell_price: price,
            gain: (price - lot.price) * used,
            hold_months: holdMonths, approx_cost: !!lot.approx,
            ...classifyLot(assetClass, lot.date, holdMonths),
          });
        }
        if (lot.remaining < 1e-6) lots.shift();
      }
    }
  }

  const unrealized = [];
  if (currentPrice > 0) {
    for (const lot of lots) {
      if (lot.remaining < 1e-6) continue;
      const holdMonths = monthsBetween(lot.date, today);
      const cls = classifyLot(assetClass, lot.date, holdMonths);
      // When does this lot turn long-term? (null if it never will — slab-taxed debt)
      let ltcg_from = null;
      if (cls.rate_basis === "equity_stcg" || (cls.rate_basis === "slab" && lot.date < DEBT_SLAB_CUTOFF)) {
        const d = new Date(lot.date); d.setMonth(d.getMonth() + (assetClass === "DEBT" ? 24 : 12));
        ltcg_from = d.toISOString().slice(0, 10);
      }
      unrealized.push({
        buy_date: lot.date, units: lot.remaining, buy_price: lot.price,
        current_price: currentPrice, gain: (currentPrice - lot.price) * lot.remaining,
        hold_months: holdMonths, approx_cost: !!lot.approx, ltcg_from,
        ...cls,
      });
    }
  }

  return { realized, unrealized };
}

/**
 * Aggregate a list of realized-gain rows into STCG/LTCG totals and estimated tax.
 * @param {Array} realized  rows from computeGains().realized
 */
export function summarizeRealized(realized) {
  const basis = (d) => d.rate_basis || (d.is_ltcg ? "equity_ltcg" : "equity_stcg");
  const stcg = realized.filter(d => basis(d) === "equity_stcg").reduce((s, d) => s + d.gain, 0);
  const ltcg = realized.filter(d => basis(d) === "equity_ltcg").reduce((s, d) => s + d.gain, 0);
  const debtLtcg = realized.filter(d => basis(d) === "debt_ltcg").reduce((s, d) => s + d.gain, 0);
  const slab = realized.filter(d => basis(d) === "slab").reduce((s, d) => s + d.gain, 0);
  // The ₹1.25L exemption applies to equity LTCG (112A); debt LTCG (112) has none.
  const ltcgTaxable = Math.max(0, ltcg - LTCG_EXEMPTION);
  const stcgTax = Math.max(0, stcg) * STCG_RATE;
  const ltcgTax = ltcgTaxable * LTCG_RATE;
  const debtLtcgTax = Math.max(0, debtLtcg) * LTCG_RATE;
  return {
    stcg, ltcg,
    debt_ltcg: debtLtcg,
    slab_gain: slab,                 // taxed at the investor's slab — not estimated here
    ltcg_exemption: LTCG_EXEMPTION,
    ltcg_taxable: ltcgTaxable,
    stcg_tax: stcgTax,
    ltcg_tax: ltcgTax,
    debt_ltcg_tax: debtLtcgTax,
    total_tax: stcgTax + ltcgTax + debtLtcgTax,
    approx_lots: realized.filter(d => d.approx_cost).length,
  };
}
