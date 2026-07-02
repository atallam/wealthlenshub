import { describe, it, expect } from "vitest";
import {
  fyRange, currentFY, monthsBetween, computeGains, summarizeRealized,
  LTCG_EXEMPTION,
} from "../lib/tax.js";

describe("fyRange", () => {
  it("maps FY string to Apr–Mar window", () => {
    expect(fyRange("2024-25")).toEqual({ start: "2024-04-01", end: "2025-03-31" });
  });
});

describe("currentFY", () => {
  it("returns a well-formed FY string", () => {
    expect(currentFY()).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("monthsBetween", () => {
  it("counts whole calendar months", () => {
    expect(monthsBetween("2024-01-15", "2025-01-15")).toBe(12);
    expect(monthsBetween("2024-01-01", "2024-07-01")).toBe(6);
  });
});

describe("computeGains (FIFO)", () => {
  it("classifies a >12-month sell as LTCG and matches oldest lot first", () => {
    const txns = [
      { txn_type: "BUY", units: 10, price: 100, txn_date: "2023-01-10" },
      { txn_type: "BUY", units: 10, price: 150, txn_date: "2024-06-10" },
      { txn_type: "SELL", units: 10, price: 200, txn_date: "2024-08-10" },
    ];
    const { realized } = computeGains(txns, "2024-04-01", "2025-03-31", 0);
    expect(realized).toHaveLength(1);
    expect(realized[0].is_ltcg).toBe(true);          // 2023-01 → 2024-08 ≥ 12 mo
    expect(realized[0].gain).toBe((200 - 100) * 10);  // oldest lot consumed first
  });

  it("classifies a <12-month sell as STCG", () => {
    const txns = [
      { txn_type: "BUY", units: 5, price: 100, txn_date: "2024-05-01" },
      { txn_type: "SELL", units: 5, price: 120, txn_date: "2024-09-01" },
    ];
    const { realized } = computeGains(txns, "2024-04-01", "2025-03-31", 0);
    expect(realized[0].is_ltcg).toBe(false);
    expect(realized[0].gain).toBe(100);
  });

  it("excludes sells outside the FY window from realized", () => {
    const txns = [
      { txn_type: "BUY", units: 5, price: 100, txn_date: "2022-01-01" },
      { txn_type: "SELL", units: 5, price: 120, txn_date: "2023-06-01" }, // prior FY
    ];
    const { realized } = computeGains(txns, "2024-04-01", "2025-03-31", 0);
    expect(realized).toHaveLength(0);
  });

  it("values open lots as unrealized when currentPrice is given", () => {
    const txns = [{ txn_type: "BUY", units: 10, price: 100, txn_date: "2020-01-01" }];
    const { unrealized } = computeGains(txns, "2024-04-01", "2025-03-31", 250);
    expect(unrealized).toHaveLength(1);
    expect(unrealized[0].gain).toBe((250 - 100) * 10);
    expect(unrealized[0].is_ltcg).toBe(true);
  });
});

describe("summarizeRealized", () => {
  it("applies the LTCG exemption and the 20%/12.5% rates", () => {
    const realized = [
      { gain: 200000, is_ltcg: true },
      { gain: 50000, is_ltcg: false },
    ];
    const s = summarizeRealized(realized);
    expect(s.ltcg).toBe(200000);
    expect(s.stcg).toBe(50000);
    expect(s.ltcg_taxable).toBe(200000 - LTCG_EXEMPTION);
    expect(s.stcg_tax).toBeCloseTo(50000 * 0.20);
    expect(s.ltcg_tax).toBeCloseTo((200000 - LTCG_EXEMPTION) * 0.125);
    expect(s.total_tax).toBeCloseTo(s.stcg_tax + s.ltcg_tax);
  });

  it("does not tax LTCG below the exemption", () => {
    const s = summarizeRealized([{ gain: 100000, is_ltcg: true }]);
    expect(s.ltcg_taxable).toBe(0);
    expect(s.ltcg_tax).toBe(0);
  });
});
