/**
 * lib/holdings-utils.js — pure holding transforms shared across routes/services.
 * (Previously defined inside routes/portfolio.js; moved here to decouple them
 * from the route layer.)
 */

/** Null out empty date strings so Postgres doesn't reject them. */
export function sanitizeDates(obj) {
  const dateFields = ["start_date", "maturity_date"];
  const result = { ...obj };
  for (const field of dateFields) {
    if (result[field] === "" || result[field] === undefined) result[field] = null;
  }
  return result;
}

/** Derive net units / average cost / purchase value from a holding's transactions. */
export function enrichHoldings(holdings) {
  return (holdings || []).map((h) => {
    const txns = h.transactions || [];
    if (txns.length === 0) return h;
    const buys = txns.filter((t) => t.txn_type === "BUY");
    const sells = txns.filter((t) => t.txn_type === "SELL");
    const buyUnits = buys.reduce((s, t) => s + Number(t.units || 0), 0);
    const sellUnits = sells.reduce((s, t) => s + Number(t.units || 0), 0);
    const netUnits = Math.max(0, buyUnits - sellUnits);
    const avgCost = buyUnits > 0
      ? buys.reduce((s, t) => s + Number(t.units || 0) * Number(t.price || 0), 0) / buyUnits
      : 0;
    const sortedTxns = [...txns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
    return {
      ...h, net_units: netUnits, avg_cost: avgCost, units: netUnits,
      purchase_price: avgCost, purchase_nav: avgCost, purchase_value: avgCost * netUnits,
      start_date: h.start_date || sortedTxns[0]?.txn_date || null,
    };
  });
}
