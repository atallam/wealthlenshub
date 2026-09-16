import { describe, it, expect } from "vitest";
import { xirr, cashflowsFromLedger, ledgerStats } from "../lib/xirr.js";
import { computeGains, summarizeRealized, classifyLot } from "../lib/tax.js";

describe("xirr", () => {
  it("matches Excel on the canonical example", () => {
    // Excel docs: -10000 (2008-01-01), 2750 (2008-03-01), 4250 (2008-10-30), 3250 (2009-02-15), 2750 (2009-04-01) → 37.34%
    const r = xirr([
      { date: "2008-01-01", amount: -10000 }, { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 }, { date: "2009-02-15", amount: 3250 }, { date: "2009-04-01", amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.3734, 3);
  });

  it("single lump sum doubling in exactly 5 years ≈ 14.87%", () => {
    const r = xirr([{ date: "2020-01-01", amount: -1000 }, { date: "2025-01-01", amount: 2000 }]);
    expect(r).toBeCloseTo(Math.pow(2, 1 / 5) - 1, 3);
  });

  it("handles negative returns and SIP-style flows", () => {
    const flows = [];
    for (let m = 0; m < 12; m++) flows.push({ date: `2025-${String(m + 1).padStart(2, "0")}-05`, amount: -1000 });
    flows.push({ date: "2026-01-05", amount: 11000 });   // lost money
    const r = xirr(flows);
    expect(r).toBeLessThan(0);
    expect(r).toBeGreaterThan(-0.5);
  });

  it("returns null when undefined (all one sign, <2 flows, same day)", () => {
    expect(xirr([{ date: "2025-01-01", amount: -5 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: -5 }, { date: "2025-02-01", amount: -5 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: -5 }, { date: "2025-01-01", amount: 6 }])).toBeNull();
  });
});

describe("cashflowsFromLedger / ledgerStats", () => {
  const txns = [
    { txn_type: "BUY", units: 100, price: 10, amount: 1000, txn_date: "2024-01-01" },
    { txn_type: "BUY", units: 50, price: 12, txn_date: "2024-07-01" },            // amount derived = 600
    { txn_type: "DIVIDEND", units: 0, price: 0, amount: 30, txn_date: "2025-01-01" },
    { txn_type: "SELL", units: 20, price: 15, amount: 300, txn_date: "2025-06-01" },
    { txn_type: "BONUS", units: 10, price: 0, txn_date: "2025-06-02" },           // no cash
  ];
  it("maps signs, derives missing amounts, ignores non-cash rows and appends value", () => {
    const f = cashflowsFromLedger(txns, 2000, "2026-01-01");
    expect(f.map((x) => [x.kind, x.amount])).toEqual([["BUY", -1000], ["BUY", -600], ["DIVIDEND", 30], ["SELL", 300], ["VALUE", 2000]]);
  });
  it("stats add up", () => {
    const s = ledgerStats(txns, 2000, "2026-01-01");
    expect(s).toMatchObject({ invested: 1600, withdrawn: 300, dividends: 30, current_value: 2000, absolute_gain: 730, since: "2024-01-01" });
    expect(s.xirr).toBeGreaterThan(0.2);
  });
});

describe("tax rules by asset class", () => {
  it("equity: 12-month threshold", () => {
    expect(classifyLot("EQUITY", "2025-01-01", 11)).toEqual({ is_ltcg: false, rate_basis: "equity_stcg" });
    expect(classifyLot("EQUITY", "2025-01-01", 12)).toEqual({ is_ltcg: true, rate_basis: "equity_ltcg" });
    expect(classifyLot(null, "2025-01-01", 12).rate_basis).toBe("equity_ltcg");     // default
  });
  it("debt bought on/after 1-Apr-2023 is always slab; before → 24-month LTCG", () => {
    expect(classifyLot("DEBT", "2023-04-01", 40)).toEqual({ is_ltcg: false, rate_basis: "slab" });
    expect(classifyLot("DEBT", "2022-06-01", 23)).toEqual({ is_ltcg: false, rate_basis: "slab" });
    expect(classifyLot("DEBT", "2022-06-01", 24)).toEqual({ is_ltcg: true, rate_basis: "debt_ltcg" });
  });
  it("computeGains carries rate_basis, approx flag and ltcg_from through FIFO", () => {
    const txns = [
      { txn_type: "BUY", units: 100, price: 40, txn_date: "2023-06-01", source_type: "OPENING" },
      { txn_type: "BUY", units: 50, price: 50, txn_date: "2025-02-05" },
      { txn_type: "SELL", units: 120, price: 60, txn_date: "2025-03-05" },
    ];
    const { realized, unrealized } = computeGains(txns, "2024-04-01", "2025-03-31", 62, { assetClass: "EQUITY" });
    expect(realized).toHaveLength(2);
    expect(realized[0]).toMatchObject({ units: 100, buy_price: 40, rate_basis: "equity_ltcg", approx_cost: true });
    expect(realized[1]).toMatchObject({ units: 20, buy_price: 50, rate_basis: "equity_stcg", approx_cost: false });
    expect(unrealized).toHaveLength(1);
    expect(unrealized[0]).toMatchObject({ units: 30, buy_price: 50, is_ltcg: true, ltcg_from: null });   // Feb-2025 lot is long-term by now
    const s = summarizeRealized(realized);
    expect(s.ltcg).toBe(2000); expect(s.stcg).toBe(200); expect(s.approx_lots).toBe(1);
    expect(s.total_tax).toBeCloseTo(200 * 0.2, 6);   // LTCG under exemption
  });
  it("an open lot younger than 12 months reports the date it turns long-term", () => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); const buy = d.toISOString().slice(0, 10);
    const exp = new Date(buy); exp.setMonth(exp.getMonth() + 12);
    const { unrealized } = computeGains([{ txn_type: "BUY", units: 10, price: 100, txn_date: buy }], "1900-01-01", "2999-12-31", 110);
    expect(unrealized[0]).toMatchObject({ is_ltcg: false, rate_basis: "equity_stcg", ltcg_from: exp.toISOString().slice(0, 10) });
  });
  it("debt slab gains are reported separately and not taxed here", () => {
    const txns = [{ txn_type: "BUY", units: 10, price: 100, txn_date: "2024-01-01" }, { txn_type: "SELL", units: 10, price: 110, txn_date: "2026-01-01" }];
    const { realized } = computeGains(txns, "2025-04-01", "2026-03-31", 0, { assetClass: "DEBT" });
    const s = summarizeRealized(realized);
    expect(s.slab_gain).toBe(100); expect(s.total_tax).toBe(0);
  });
});
