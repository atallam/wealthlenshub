/**
 * lib/tax.js — Single source of truth for India LTCG/STCG capital-gains math.
 *
 * Used by BOTH routes/tax.js (the Tax tab) and routes/ai.js (the advisor's
 * get_tax_summary tool) so the two can never drift apart.
 *
 * Rules (post Budget-2024, equity: IN_STOCK, IN_ETF, MF):
 *   • STCG (< 12 months): 20%
 *   • LTCG (≥ 12 months): 12.5% on gains above the ₹1,25,000 per-FY exemption
 *   • FIFO lot matching for SELL/REDEEM
 */

export const LTCG_EXEMPTION = 125000;
export const STCG_RATE = 0.20;
export const LTCG_RATE = 0.125;

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
 * @returns {{ realized: Array, unrealized: Array }}
 */
export function computeGains(transactions, fyStart, fyEnd, currentPrice = 0) {
  const sorted = [...transactions].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  const lots = [];        // FIFO queue: { date, price, remaining }
  const realized = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const txn of sorted) {
    const units = Math.abs(+txn.units || 0);
    const price = +txn.price || 0;

    if (txn.txn_type === "BUY") {
      lots.push({ date: txn.txn_date, price, remaining: units });
    } else if (txn.txn_type === "SELL" || txn.txn_type === "REDEEM") {
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
            is_ltcg: holdMonths >= 12, hold_months: holdMonths,
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
      unrealized.push({
        buy_date: lot.date, units: lot.remaining, buy_price: lot.price,
        current_price: currentPrice, gain: (currentPrice - lot.price) * lot.remaining,
        is_ltcg: holdMonths >= 12, hold_months: holdMonths,
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
  const stcg = realized.filter(d => !d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcg = realized.filter(d => d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcgTaxable = Math.max(0, ltcg - LTCG_EXEMPTION);
  const stcgTax = Math.max(0, stcg) * STCG_RATE;
  const ltcgTax = ltcgTaxable * LTCG_RATE;
  return {
    stcg, ltcg,
    ltcg_exemption: LTCG_EXEMPTION,
    ltcg_taxable: ltcgTaxable,
    stcg_tax: stcgTax,
    ltcg_tax: ltcgTax,
    total_tax: stcgTax + ltcgTax,
  };
}
