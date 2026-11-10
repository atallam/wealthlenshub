import { describe, it, expect } from "vitest";
import { computeTrades } from "../src/features/strategy/rebalanceMath.js";

const norm = (alloc) => {
  const s = Object.values(alloc).reduce((a, v) => a + (+v || 0), 0);
  return Object.fromEntries(Object.entries(alloc).map(([k, v]) => [k, s > 0 ? ((+v || 0) / s) * 100 : 0]));
};
// The original inline formula, kept here as the reference for "no behaviour change".
const original = (types, curAlloc, normTarget, rTotal, totalWithCash) =>
  types.map((type) => {
    const cur = curAlloc[type] || 0, curPct = rTotal > 0 ? (cur / rTotal) * 100 : 0;
    const tgtPct = normTarget[type] || 0, tgtAmt = totalWithCash * (tgtPct / 100);
    return { type, cur, curPct, tgtPct, tgtAmt, delta: tgtAmt - cur };
  }).filter((r) => r.tgtPct > 0 || r.cur > 0);

const TYPES = ["IN_STOCK", "MF", "IN_BOND", "FD"];

describe("computeTrades", () => {
  it("matches the original formula when every held type has a target", () => {
    const targetAlloc = { IN_STOCK: 50, MF: 30, IN_BOND: 0, FD: 20 };
    const curAlloc = { IN_STOCK: 600000, MF: 300000, FD: 100000 };
    const rTotal = 1000000, cash = 50000;
    const args = { types: TYPES, curAlloc, normTarget: norm(targetAlloc), targetAlloc, rTotal, totalWithCash: rTotal + cash };
    const got = computeTrades(args), want = original(TYPES, curAlloc, args.normTarget, rTotal, rTotal + cash);
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => {
      for (const f of ["type", "cur", "curPct", "tgtPct", "tgtAmt", "delta"]) {
        typeof g[f] === "number" ? expect(g[f]).toBeCloseTo(want[i][f], 6) : expect(g[f]).toBe(want[i][f]);
      }
    });
  });

  it("holds a type with no target instead of recommending a full sale", () => {
    // Real case: IN_BOND (Rs 2.47L) is absent from every preset
    const targetAlloc = { IN_STOCK: 60, MF: 40 };
    const curAlloc = { IN_STOCK: 500000, MF: 253050, IN_BOND: 246950 };
    const total = 1000000;
    const trades = computeTrades({ types: TYPES, curAlloc, normTarget: norm(targetAlloc), targetAlloc, rTotal: total, totalWithCash: total });
    const bond = trades.find((t) => t.type === "IN_BOND");
    expect(bond.delta).toBeCloseTo(0, 6);
    expect(bond.tgtAmt).toBeCloseTo(246950, 6);
    // managed targets split the remaining (non-bond) value, so buys and sells balance
    const net = trades.reduce((s, t) => s + t.delta, 0);
    expect(net).toBeCloseTo(0, 6);
    expect(trades.find((t) => t.type === "IN_STOCK").tgtAmt).toBeCloseTo(753050 * 0.6, 6);
  });

  it("an explicit 0 target still means sell to zero", () => {
    const targetAlloc = { IN_STOCK: 100, IN_BOND: 0 };
    const curAlloc = { IN_STOCK: 500000, IN_BOND: 500000 };
    const bond = computeTrades({ types: TYPES, curAlloc, normTarget: norm(targetAlloc), targetAlloc, rTotal: 1e6, totalWithCash: 1e6 })
      .find((t) => t.type === "IN_BOND");
    expect(bond.delta).toBeCloseTo(-500000, 6);
  });
});
