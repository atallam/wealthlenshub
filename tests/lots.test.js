import { describe, it, expect } from "vitest";
import { buildLots } from "../lib/lots.js";
import { enrichHoldings } from "../lib/holdings-utils.js";
import { computeGains } from "../lib/tax.js";

const buy = (units, price, txn_date, extra = {}) => ({ txn_type: "BUY", units, price, txn_date, ...extra });
const sell = (units, price, txn_date) => ({ txn_type: "SELL", units, price, txn_date });

describe("buildLots (FIFO)", () => {
  it("consumes the oldest lot first and prices what is left", () => {
    const r = buildLots([buy(10, 100, "2023-01-01"), buy(10, 200, "2024-01-01"), sell(5, 300, "2024-06-01")]);
    expect(r.netUnits).toBe(15);
    expect(r.invested).toBe(5 * 100 + 10 * 200);
    expect(r.avgCost).toBeCloseTo(2500 / 15);
    expect(r.realized).toHaveLength(1);
    expect(r.realized[0]).toMatchObject({ buy_price: 100, units: 5 });
    expect(r.costBasis).toBe("exact");
  });

  it("counts SIP, BONUS (zero cost), RIGHTS, REDEEM and SWP — not just BUY/SELL", () => {
    const r = buildLots([
      { txn_type: "SIP", units: 10, price: 50, txn_date: "2024-01-01" },
      { txn_type: "BONUS", units: 10, price: 0, txn_date: "2024-02-01" },
      { txn_type: "RIGHTS", units: 5, price: 80, txn_date: "2024-03-01" },
      { txn_type: "REDEEM", units: 4, price: 90, txn_date: "2024-04-01" },
      { txn_type: "SWP", units: 1, price: 90, txn_date: "2024-05-01" },
    ]);
    expect(r.netUnits).toBe(20);                 // 25 in − 5 out
    expect(r.invested).toBe(5 * 50 + 0 + 5 * 80); // 5 SIP units left + 10 bonus@0 + 5 rights
  });

  it("processes same-day buys before sells", () => {
    const r = buildLots([sell(5, 120, "2024-01-01"), buy(10, 100, "2024-01-01")]);
    expect(r.netUnits).toBe(5);
    expect(r.shortfall).toBe(0);
  });

  it("reports a shortfall when sells exceed the ledger", () => {
    const r = buildLots([buy(5, 100, "2024-01-01"), sell(8, 120, "2024-02-01")]);
    expect(r.netUnits).toBe(0);
    expect(r.shortfall).toBeCloseTo(3);
  });

  it("flags cost basis: unknown with no ledger, approx with OPENING/INFERRED", () => {
    expect(buildLots([]).costBasis).toBe("unknown");
    expect(buildLots([buy(10, 100, "2024-01-01", { source_type: "OPENING" })]).costBasis).toBe("approx");
    expect(buildLots([buy(10, 100, "2024-01-01", { source_type: "INFERRED" })]).costBasis).toBe("approx");
  });

  it("an approx lot that has been fully sold no longer taints the holding", () => {
    const r = buildLots([buy(10, 100, "2023-01-01", { source_type: "OPENING" }), buy(5, 150, "2024-01-01"), sell(10, 200, "2024-06-01")]);
    expect(r.costBasis).toBe("exact");
  });
});

describe("enrichHoldings", () => {
  it("avg cost reflects remaining FIFO lots, not every buy ever made", () => {
    const [h] = enrichHoldings([{
      id: "h1", type: "IN_STOCK", transactions: [buy(10, 100, "2023-01-01"), sell(10, 150, "2023-06-01"), buy(10, 200, "2024-01-01")],
    }]);
    expect(h.net_units).toBe(10);
    expect(h.avg_cost).toBe(200);          // the old simple average over all buys gave 150
    expect(h.purchase_value).toBe(2000);
    expect(h.cost_basis).toBe("exact");
  });

  it("SIP-only mutual funds no longer collapse to zero units", () => {
    const [h] = enrichHoldings([{
      id: "h2", type: "MF", transactions: [
        { txn_type: "SIP", units: 3, price: 40, txn_date: "2024-01-05" },
        { txn_type: "SIP", units: 2, price: 50, txn_date: "2024-02-05" },
      ],
    }]);
    expect(h.units).toBe(5);
    expect(h.purchase_value).toBe(3 * 40 + 2 * 50);
  });

  it("demat stock with no ledger and no cost is flagged unknown", () => {
    const [h] = enrichHoldings([{ id: "h3", type: "IN_STOCK", units: 20, purchase_price: null, purchase_value: null, transactions: [] }]);
    expect(h.cost_basis).toBe("unknown");
    expect(h.purchase_price).toBeNull();
  });

  it("manually entered holdings with a price are exact; non-ledger types are untouched", () => {
    const [a] = enrichHoldings([{ id: "a", type: "IN_STOCK", units: 5, purchase_price: 90, transactions: [] }]);
    expect(a.cost_basis).toBe("exact");
    const fd = { id: "fd", type: "FD", principal: 1000, transactions: [] };
    expect(enrichHoldings([fd])[0]).toBe(fd);
  });

  it("a user-entered OPENING lot turns unknown into approx", () => {
    const [h] = enrichHoldings([{
      id: "h4", type: "IN_STOCK", units: 20, purchase_price: null,
      transactions: [buy(20, 1450, "2024-03-01", { source_type: "OPENING" })],
    }]);
    expect(h.cost_basis).toBe("approx");
    expect(h.avg_cost).toBe(1450);
    expect(h.purchase_value).toBe(29000);
  });
});

describe("Holdings and Tax tabs agree", () => {
  it("open-lot cost from computeGains equals enrichHoldings invested", () => {
    const txns = [buy(10, 100, "2022-01-01"), buy(10, 140, "2023-02-01"), sell(12, 180, "2024-05-01"), buy(4, 160, "2024-09-01")];
    const [h] = enrichHoldings([{ id: "x", type: "IN_STOCK", transactions: txns }]);
    const { unrealized } = computeGains(txns, "1900-01-01", "2999-12-31", 200);
    const taxCost = unrealized.reduce((s, u) => s + u.units * u.buy_price, 0);
    expect(h.purchase_value).toBeCloseTo(taxCost);
    expect(h.net_units).toBeCloseTo(unrealized.reduce((s, u) => s + u.units, 0));
  });
});
