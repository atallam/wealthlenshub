/**
 * lib/lots.js — the single FIFO lot engine behind cost basis, average cost and
 * capital-gains math.
 *
 * Both lib/holdings-utils.js (Holdings tab: units, avg cost, invested) and
 * lib/tax.js (Tax tab / advisor: realized + unrealized gains) build on
 * buildLots(), so "invested" on Holdings and "unrealized cost" on Tax can never
 * disagree again.
 *
 * Ledger semantics
 *   adds  : BUY, SIP, RIGHTS (priced), BONUS (cost 0)
 *   subs  : SELL, REDEEM, SWP (consume the oldest lots first — FIFO)
 *   other : DIVIDEND etc. are ignored (no unit movement)
 *
 * Cost-basis confidence (per holding)
 *   exact   – every open lot comes from a real ledger row
 *   approx  – at least one open lot is an estimate (OPENING placeholder, INFERRED
 *             gap row, or a cost the user typed in via "Set cost basis")
 *   unknown – no priced ledger rows at all (e.g. a CAS demat stock)
 */

export const ADD_TYPES = new Set(["BUY", "SIP", "RIGHTS", "BONUS"]);
export const SUB_TYPES = new Set(["SELL", "REDEEM", "SWP"]);
export const APPROX_SOURCES = new Set(["OPENING", "INFERRED"]);

const EPS = 1e-6;

/** Is this ledger row an estimate rather than a real traded price? */
export function isApproxRow(txn) {
  return APPROX_SOURCES.has(String(txn?.source_type || "").toUpperCase());
}

/**
 * FIFO lot matching over a transaction list.
 *
 * @param {Array} transactions rows with { txn_type, units, price, txn_date, source_type? }
 * @returns {{
 *   openLots: Array<{date:string, price:number, remaining:number, approx:boolean, bonus:boolean}>,
 *   realized: Array<{buy_date:string, sell_date:string, units:number, buy_price:number, sell_price:number, approx:boolean}>,
 *   netUnits: number,      // units still held
 *   invested: number,      // Σ remaining × lot price (cost of what is still held)
 *   avgCost: number,       // invested / netUnits (0 when nothing held)
 *   shortfall: number,     // units sold that no lot could cover (incomplete ledger)
 *   hasLedger: boolean,    // any unit-moving rows at all
 *   costBasis: "exact"|"approx"|"unknown"
 * }}
 */
export function buildLots(transactions) {
  const rows = (transactions || []).filter((t) => t && t.txn_date && (ADD_TYPES.has(t.txn_type) || SUB_TYPES.has(t.txn_type)));
  // Chronological; on the same day, acquisitions are processed before disposals.
  const sorted = [...rows].sort((a, b) =>
    a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1
      : (ADD_TYPES.has(a.txn_type) ? 0 : 1) - (ADD_TYPES.has(b.txn_type) ? 0 : 1));

  const lots = [];
  const realized = [];
  let shortfall = 0;
  let sawPricedAdd = false;

  for (const txn of sorted) {
    const units = Math.abs(Number(txn.units) || 0);
    if (units < EPS) continue;
    const price = Number(txn.price) || 0;

    if (ADD_TYPES.has(txn.txn_type)) {
      const bonus = txn.txn_type === "BONUS";
      if (!bonus && price > 0) sawPricedAdd = true;
      lots.push({ date: txn.txn_date, price: bonus ? 0 : price, remaining: units, approx: isApproxRow(txn), bonus });
    } else {
      let toSell = units;
      while (toSell > EPS && lots.length > 0) {
        const lot = lots[0];
        const used = Math.min(lot.remaining, toSell);
        lot.remaining -= used;
        toSell -= used;
        realized.push({
          buy_date: lot.date, sell_date: txn.txn_date, units: used,
          buy_price: lot.price, sell_price: price, approx: lot.approx,
        });
        if (lot.remaining < EPS) lots.shift();
      }
      if (toSell > EPS) shortfall += toSell;
    }
  }

  const openLots = lots.filter((l) => l.remaining >= EPS);
  const netUnits = openLots.reduce((s, l) => s + l.remaining, 0);
  const invested = openLots.reduce((s, l) => s + l.remaining * l.price, 0);
  const hasLedger = sorted.length > 0;

  let costBasis;
  if (!hasLedger || !sawPricedAdd) costBasis = "unknown";
  else if (openLots.some((l) => l.approx)) costBasis = "approx";
  else costBasis = "exact";

  return {
    openLots, realized, netUnits, invested,
    avgCost: netUnits > EPS ? invested / netUnits : 0,
    shortfall, hasLedger, costBasis,
  };
}
