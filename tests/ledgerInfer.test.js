import { describe, it, expect } from "vitest";
import { netUnitsAsOf, detectSipDay, planInference, inferredKey } from "../lib/ledgerInfer.js";

const buy = (d, u, extra = {}) => ({ txn_type: "BUY", units: u, txn_date: d, source: "cas", source_type: "PURCHASE_SIP", ...extra });

describe("netUnitsAsOf / detectSipDay", () => {
  it("nets adds and subtracts up to the as-of date only", () => {
    const t = [buy("2026-01-05", 10), buy("2026-02-05", 10), { txn_type: "SELL", units: 5, txn_date: "2026-02-20" }, buy("2026-04-05", 10)];
    expect(netUnitsAsOf(t, "2026-03-31")).toBe(15);
    expect(netUnitsAsOf(t, null)).toBe(25);
  });
  it("finds a SIP day only with ≥3 buys on it", () => {
    expect(detectSipDay([buy("2026-01-05", 1), buy("2026-02-05", 1)])).toBeNull();
    expect(detectSipDay([buy("2026-01-05", 1), buy("2026-02-05", 1), buy("2026-03-05", 1), buy("2026-03-20", 1)])).toBe(5);
  });
});

describe("planInference", () => {
  const ledger = [buy("2026-01-05", 50), buy("2026-02-05", 50), buy("2026-03-05", 50)];

  it("does nothing without a baseline ledger", () => {
    expect(planInference({ statementUnits: 200, statementDate: "2026-04-30", txns: [] })).toBeNull();
    const onlyInferred = [buy("2026-03-05", 50, { source_type: "INFERRED" })];
    expect(planInference({ statementUnits: 200, statementDate: "2026-04-30", txns: onlyInferred })).toBeNull();
  });

  it("does nothing when the ledger already explains the statement (within tolerance)", () => {
    expect(planInference({ statementUnits: 150.02, statementDate: "2026-03-31", txns: ledger })).toBeNull();
  });

  it("infers a BUY for the gap, dated to the SIP day inside the window", () => {
    const p = planInference({ statementUnits: 200, statementDate: "2026-04-30", periodStart: "2026-04-01", txns: ledger, statementNav: 61 });
    expect(p).toMatchObject({ txn_type: "BUY", units: 50, txn_date: "2026-04-05", fallback_price: 61 });
  });

  it("falls back to the statement date when there is no SIP rhythm or the SIP day is already covered", () => {
    const noRhythm = [buy("2026-01-05", 50), buy("2026-02-17", 50)];
    expect(planInference({ statementUnits: 120, statementDate: "2026-04-30", txns: noRhythm }).txn_date).toBe("2026-04-30");
    // SIP day 5 already has a row this month → don't invent a second one on the 5th
    const covered = [...ledger, buy("2026-04-05", 50)];
    expect(planInference({ statementUnits: 210, statementDate: "2026-04-30", txns: covered }).txn_date).toBe("2026-04-30");
  });

  it("infers a SELL when units dropped", () => {
    const p = planInference({ statementUnits: 100, statementDate: "2026-04-30", txns: ledger });
    expect(p).toMatchObject({ txn_type: "SELL", units: 50, txn_date: "2026-04-30" });
  });

  it("ignores ledger rows dated after the statement", () => {
    const later = [...ledger, buy("2026-05-05", 50)];
    expect(planInference({ statementUnits: 150, statementDate: "2026-04-30", txns: later })).toBeNull();
  });

  it("produces a stable idempotency key per holding + statement date", () => {
    expect(inferredKey("h1", "2026-04-30")).toBe(inferredKey("h1", "2026-04-30"));
    expect(inferredKey("h1", "2026-04-30")).not.toBe(inferredKey("h1", "2026-05-31"));
    expect(inferredKey("h1", "2026-04-30")).toMatch(/^INFER\|/);
  });
});
