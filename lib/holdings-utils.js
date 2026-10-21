/**
 * lib/holdings-utils.js — pure holding transforms shared across routes/services.
 * (Previously defined inside routes/portfolio.js; moved here to decouple them
 * from the route layer.)
 */

import { buildLots } from "./lots.js";

/** Null out empty date strings so Postgres doesn't reject them. */
export function sanitizeDates(obj) {
  const dateFields = ["start_date", "maturity_date"];
  const result = { ...obj };
  for (const field of dateFields) {
    if (result[field] === "" || result[field] === undefined) result[field] = null;
  }
  return result;
}

// Asset types whose cost basis is derived from a trade ledger (and so can be unknown).
const LEDGER_COST_TYPES = new Set(["MF", "IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF", "US_BOND", "CRYPTO"]);

/**
 * Derive net units / average cost / invested value from a holding's transactions
 * using FIFO lots (lib/lots.js — the same engine the Tax tab uses), and tag each
 * holding with `cost_basis`: "exact" | "approx" | "unknown".
 */
export function enrichHoldings(holdings) {
  return (holdings || []).map((h) => {
    const txns = h.transactions || [];
    const ledgerType = LEDGER_COST_TYPES.has(h.type);
    const { openLots, netUnits, invested, avgCost, hasLedger, costBasis } = buildLots(txns);

    // No unit-moving ledger rows: fall back to whatever the holding row itself carries.
    if (!hasLedger) {
      if (!ledgerType) return h;
      const known = h.purchase_price != null || h.purchase_value != null;
      return { ...h, cost_basis: known ? "exact" : "unknown" };
    }

    // Ledger rows exist but none carries a price: units are known, cost is not.
    if (ledgerType && costBasis === "unknown") {
      return {
        ...h, net_units: netUnits, units: netUnits, avg_cost: null,
        purchase_price: null, purchase_nav: null, purchase_value: null,
        open_lot_count: openLots.length, cost_basis: "unknown",
      };
    }

    const sortedTxns = [...txns].filter((t) => t.txn_date).sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));
    return {
      ...h, net_units: netUnits, avg_cost: avgCost, units: netUnits,
      purchase_price: avgCost, purchase_nav: avgCost, purchase_value: invested,
      open_lot_count: openLots.length,
      cost_basis: ledgerType ? costBasis : undefined,
      start_date: h.start_date || sortedTxns[0]?.txn_date || null,
    };
  });
}
