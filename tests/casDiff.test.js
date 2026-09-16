import { describe, it, expect } from "vitest";
import { normalizeCasHolding, groupByMember, diffCas, buildApplyGroups } from "../lib/casDiff.js";

const row = (o) => ({ name: "X", type: "IN_STOCK", units: 1, current_value: 100, ...o });

describe("normalizeCasHolding", () => {
  it("derives isin from ticker/scheme_code and defaults account_id", () => {
    const h = normalizeCasHolding({ name: "TCS", ticker: "ine467b01029", units: "5", current_value: "20000" });
    expect(h.isin).toBe("INE467B01029");
    expect(h.account_id).toBe("UNKNOWN");
    expect(h.units).toBe(5);
    expect(h.current_value).toBe(20000);
  });
});

describe("groupByMember", () => {
  it("routes by account_map, then member_id, and never guesses", () => {
    const { groups, unmatched } = groupByMember([
      row({ isin: "A", account_id: "acc1", _holder_name: "TV RAO" }),
      row({ isin: "B", account_id: "acc2", _holder_name: "VIJAYA" }),
      row({ isin: "C", account_id: "acc3", _holder_name: "UNKNOWN PERSON" }),
      row({ isin: "",  account_id: "acc1", _holder_name: "TV RAO" }),
    ], { account_map: { "TV RAO": "m1", "VIJAYA": "m2" } });
    expect(groups.map((g) => g.member_id).sort()).toEqual(["m1", "m2"]);
    expect(groups.find((g) => g.member_id === "m1").account_ids).toEqual(["acc1"]);
    expect(unmatched.map((u) => u._reason).sort()).toEqual(["no_isin", "no_member"]);
  });

  it("single-holder statements fall back to member_id", () => {
    const { groups } = groupByMember([row({ isin: "A", account_id: "acc1" })], { member_id: "m9" });
    expect(groups[0].member_id).toBe("m9");
  });
});

describe("diffCas", () => {
  const existing = [
    { id: "h1", member_id: "m1", depository: "NSDL", account_id: "dp/1", isin: "INFY", units: 10, current_value: 15000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "INFOSYS" },
    { id: "h2", member_id: "m1", depository: "NSDL", account_id: "dp/1", isin: "TCS",  units: 5,  current_value: 20000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "TCS" },
    { id: "h3", member_id: "m1", depository: "CDSL", account_id: "cd/9", isin: "INFY", units: 3,  current_value: 4500,  holding_status: "active", source_date: "2026-08-31", source: "cas", name: "INFOSYS" },
    { id: "h4", member_id: "m1", depository: "CAMS", account_id: "F1",   isin: "MF1",  units: 100, current_value: 8000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "Bluechip" },
    { id: "h5", member_id: "m1", depository: "LEGACY", account_id: "",   isin: "OLD",  units: 1,  current_value: 1,     holding_status: "active", source_date: null, source: "cas", name: "Old" },
    { id: "h6", member_id: "m2", depository: "NSDL", account_id: "dp/2", isin: "INFY", units: 7,  current_value: 10000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "INFOSYS" },
  ];

  it("classifies new / changed / unchanged and finds exits only within the statement's accounts", () => {
    const { groups } = groupByMember([
      row({ isin: "INFY", account_id: "dp/1", units: 12, current_value: 18600 }),   // changed
      row({ isin: "HDFC", account_id: "dp/1", units: 4,  current_value: 6400 }),    // new
    ], { member_id: "m1" });
    const d = diffCas(groups, existing, { depository: "NSDL", statementDate: "2026-09-30" });
    expect(d.summary).toMatchObject({ new: 1, changed: 1, unchanged: 0, exited: 1, older: 0 });
    expect(d.rows.find((r) => r.isin === "INFY")).toMatchObject({ status: "changed", delta: { units: 2, value: 3600 }, existing_id: "h1" });
    expect(d.exited.map((e) => e.id)).toEqual(["h2"]);                 // TCS gone from dp/1
    expect(d.rows.find((r) => r.isin === "HDFC").overlap).toBeNull();
  });

  it("CDSL import never touches NSDL rows and vice versa (the original bug)", () => {
    const { groups } = groupByMember([row({ isin: "RELIANCE", account_id: "cd/9", units: 8, current_value: 23200 })], { member_id: "m1" });
    const d = diffCas(groups, existing, { depository: "CDSL", statementDate: "2026-09-30" });
    expect(d.exited.map((e) => e.id)).toEqual(["h3"]);   // only the CDSL row in cd/9
    expect(d.exited.some((e) => e.id === "h1" || e.id === "h2")).toBe(false);
  });

  it("unchanged rows are detected with a small value tolerance", () => {
    const { groups } = groupByMember([row({ isin: "INFY", account_id: "dp/1", units: 10, current_value: 15000.2 })], { member_id: "m1" });
    const d = diffCas(groups, existing, { depository: "NSDL", statementDate: "2026-09-30" });
    expect(d.rows[0].status).toBe("unchanged");
  });

  it("an older statement is flagged, not applied, and produces no exits", () => {
    const { groups } = groupByMember([row({ isin: "INFY", account_id: "dp/1", units: 7, current_value: 9800 })], { member_id: "m1" });
    const d = diffCas(groups, existing, { depository: "NSDL", statementDate: "2026-07-31" });
    expect(d.rows[0].status).toBe("older");
    expect(d.exited).toEqual([]);
  });

  it("flags the same member+ISIN active under another depository, but not LEGACY or other members", () => {
    const { groups } = groupByMember([row({ isin: "INFY", account_id: "cd/9", units: 3, current_value: 4500 })], { member_id: "m1" });
    const d = diffCas(groups, existing, { depository: "CDSL" });
    const r = d.rows[0];
    expect(r.overlap).toEqual([{ id: "h1", depository: "NSDL", account_id: "dp/1", units: 10 }]);   // not h6 (m2), not LEGACY
    expect(d.summary.overlap).toBe(1);
  });

  it("reports legacy rows for the members in this statement", () => {
    const { groups } = groupByMember([row({ isin: "INFY", account_id: "dp/1" })], { member_id: "m1" });
    expect(diffCas(groups, existing, { depository: "NSDL" }).legacy).toEqual([{ member_id: "m1", count: 1 }]);
    const { groups: g2 } = groupByMember([row({ isin: "INFY", account_id: "dp/2" })], { member_id: "m2" });
    expect(diffCas(g2, existing, { depository: "NSDL" }).legacy).toEqual([]);
  });

  it("a soft-exited row that reappears is 'reentered'", () => {
    const ex = [{ ...existing[1], holding_status: "exited" }];
    const { groups } = groupByMember([row({ isin: "TCS", account_id: "dp/1" })], { member_id: "m1" });
    expect(diffCas(groups, ex, { depository: "NSDL" }).rows[0].status).toBe("reentered");
  });
});

describe("buildApplyGroups", () => {
  it("drops rows the user chose to skip and strips UI-only fields", () => {
    const { groups } = groupByMember([
      row({ isin: "MF1", account_id: "MF-FOLIOS", _holder_name: "A", _pan: "P" }),
      row({ isin: "INFY", account_id: "MF-FOLIOS", _holder_name: "A" }),
    ], { member_id: "m1" });
    const out = buildApplyGroups(groups, { "m1|MF1": "skip" });
    expect(out).toHaveLength(1);
    expect(out[0].rows.map((r) => r.isin)).toEqual(["INFY"]);
    expect(out[0].rows[0]).not.toHaveProperty("_holder_name");
    expect(out[0].account_ids).toEqual(["MF-FOLIOS"]);
  });
});
