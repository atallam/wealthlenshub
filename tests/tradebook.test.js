import { describe, it, expect } from "vitest";
import { parseTradebook, aggregateFills, orderKey, planTradebookImport, parseTradeDate, cleanSymbol } from "../lib/tradebook.js";

const ZERODHA = `Client ID,AB1234
Tradebook for Equity,
,
symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
INFY,INE009A01021,2024-01-15,NSE,EQ,EQ,buy,false,6,1500.00,T1,O1,2024-01-15T09:20:00
INFY,INE009A01021,2024-01-15,NSE,EQ,EQ,buy,false,4,1510.00,T2,O1,2024-01-15T09:20:01
INFY,INE009A01021,2024-06-10,NSE,EQ,EQ,sell,false,3,1700.00,T3,O2,2024-06-10T10:00:00
NIFTY24JUNFUT,,2024-06-11,NFO,FO,,buy,false,50,22000,T4,O3,2024-06-11T10:00:00
`;

const GROWW = `Name,Avinash
Order history for stocks,
Stock name,Symbol,ISIN,Type,Quantity,Value,Exchange,Exchange Order Id,Executed date and time,Order status
Tata Motors,TATAMOTORS,INE155A01022,BUY,10,9500.00,NSE,E1,02-03-2024 10:15 AM,Executed
Tata Motors,TATAMOTORS,INE155A01022,BUY,5,4700.00,NSE,E2,05-03-2024 11:00 AM,Rejected
`;

const ICICI = `Stock Symbol,Action,Quantity,Transaction Price,Transaction Date
RELIANCE,Buy,2,"2,450.50",12-Feb-2023
`;

describe("parseTradeDate / cleanSymbol", () => {
  it("reads Indian date formats day-first", () => {
    expect(parseTradeDate("2024-01-15T09:20:00")).toBe("2024-01-15");
    expect(parseTradeDate("02-03-2024 10:15 AM")).toBe("2024-03-02");
    expect(parseTradeDate("12/02/2023")).toBe("2023-02-12");
    expect(parseTradeDate("12-Feb-2023")).toBe("2023-02-12");
    expect(parseTradeDate("31-02-2024")).toBeNull();
    expect(parseTradeDate("")).toBeNull();
  });
  it("strips exchange noise from symbols", () => {
    expect(cleanSymbol("TCS-EQ")).toBe("TCS");
    expect(cleanSymbol("nse:tcs")).toBe("TCS");
    expect(cleanSymbol("TCS.NS")).toBe("TCS");
  });
});

describe("parseTradebook", () => {
  it("parses a Zerodha tradebook past preamble rows and ignores F&O", () => {
    const r = parseTradebook(ZERODHA);
    expect(r.broker).toBe("Zerodha");
    expect(r.fills).toHaveLength(3);
    expect(r.skipped).toBe(1);
    expect(r.fills[0]).toMatchObject({ symbol: "INFY", isin: "INE009A01021", side: "BUY", qty: 6, price: 1500 });
  });

  it("derives price from Value and skips non-executed Groww orders", () => {
    const r = parseTradebook(GROWW);
    expect(r.broker).toBe("Groww");
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ symbol: "TATAMOTORS", qty: 10, price: 950, date: "2024-03-02" });
  });

  it("handles a generic layout with thousands separators", () => {
    const r = parseTradebook(ICICI);
    expect(r.fills[0]).toMatchObject({ symbol: "RELIANCE", side: "BUY", qty: 2, price: 2450.5, date: "2023-02-12" });
  });

  it("explains itself when no trade table is found", () => {
    const r = parseTradebook("foo,bar\n1,2");
    expect(r.fills).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/trade table/i);
  });
});

describe("aggregateFills / orderKey", () => {
  it("merges fills of one order into a weighted-average price", () => {
    const orders = aggregateFills(parseTradebook(ZERODHA).fills);
    const buy = orders.find((o) => o.side === "BUY");
    expect(orders).toHaveLength(2);
    expect(buy.qty).toBe(10);
    expect(buy.price).toBeCloseTo((6 * 1500 + 4 * 1510) / 10);
    expect(buy.fills).toBe(2);
  });
  it("keys are stable across re-parses", () => {
    const a = aggregateFills(parseTradebook(ZERODHA).fills).map(orderKey);
    const b = aggregateFills(parseTradebook(ZERODHA).fills).map(orderKey);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

const holding = (over = {}) => ({ id: "h1", name: "Infosys", type: "IN_STOCK", ticker: "INFY", isin: "INE009A01021", units: 7, member_id: "m1", ...over });

describe("planTradebookImport", () => {
  const orders = () => aggregateFills(parseTradebook(ZERODHA).fills);

  it("inserts new orders and fully reconciles to the CAS units", () => {
    const plan = planTradebookImport({ orders: orders(), holdings: [holding()], existingTxns: [] });
    expect(plan.inserts).toHaveLength(2);
    expect(plan.symbols[0]).toMatchObject({ status: "ready", reconcile: "explained", ledger_units: 7, cost_basis: "exact" });
  });

  it("is idempotent: importing the same file again inserts nothing", () => {
    const first = planTradebookImport({ orders: orders(), holdings: [holding()], existingTxns: [] });
    const existing = first.inserts.map((t, i) => ({ id: "t" + i, holding_id: "h1", txn_type: t.txn_type, units: t.units, price: t.price, txn_date: t.txn_date, external_key: t.external_key }));
    const second = planTradebookImport({ orders: orders(), holdings: [holding()], existingTxns: existing });
    expect(second.inserts).toHaveLength(0);
    expect(second.totals.duplicate_orders).toBe(2);
  });

  it("doesn't re-book trades already keyed in by hand (same day, side and units)", () => {
    const manual = [{ id: "m", holding_id: "h1", txn_type: "BUY", units: 10, price: 1505, txn_date: "2024-01-15", external_key: null }];
    const plan = planTradebookImport({ orders: orders(), holdings: [holding()], existingTxns: manual });
    expect(plan.inserts).toHaveLength(1);                  // only the SELL is new
    expect(plan.inserts[0].txn_type).toBe("SELL");
  });

  it("retires a typed-in cost estimate once real trades over-explain the position", () => {
    const opening = { id: "op", holding_id: "h1", txn_type: "BUY", units: 7, price: 1400, txn_date: "2023-01-01", source_type: "OPENING", external_key: "OPENING|h1" };
    const plan = planTradebookImport({ orders: orders(), holdings: [holding()], existingTxns: [opening] });
    expect(plan.deletes).toEqual(["op"]);
    expect(plan.symbols[0]).toMatchObject({ reconcile: "explained", replaces_estimates: true });
  });

  it("keeps the estimate when the tradebook only covers part of the history", () => {
    const opening = { id: "op", holding_id: "h1", txn_type: "BUY", units: 5, price: 1400, txn_date: "2023-01-01", source_type: "OPENING", external_key: "OPENING|h1" };
    const buyOnly = aggregateFills(parseTradebook(ZERODHA).fills.filter((f) => f.side === "BUY"));   // +10 buys, 15 > 7 held
    const plan = planTradebookImport({ orders: buyOnly, holdings: [holding({ units: 15 })], existingTxns: [opening] });
    expect(plan.deletes).toEqual([]);
    expect(plan.symbols[0].reconcile).toBe("explained");
  });

  it("reports a gap when the tradebook doesn't cover every held unit", () => {
    const plan = planTradebookImport({ orders: orders(), holdings: [holding({ units: 20 })], existingTxns: [] });
    expect(plan.symbols[0]).toMatchObject({ reconcile: "gap", gap_units: 13 });
  });

  it("flags sells that have no earlier buys as incomplete", () => {
    const sellOnly = aggregateFills(parseTradebook(ZERODHA).fills.filter((f) => f.side === "SELL"));
    const plan = planTradebookImport({ orders: sellOnly, holdings: [holding({ units: 20 })], existingTxns: [] });
    expect(plan.symbols[0].reconcile).toBe("incomplete");
  });

  it("matches by cleaned symbol when the file has no ISIN, and never fuzzy-matches names", () => {
    const noIsin = aggregateFills(parseTradebook(ICICI).fills);
    const ok = planTradebookImport({ orders: noIsin, holdings: [holding({ ticker: "RELIANCE.NS", isin: "INE002A01018", units: 2 })], existingTxns: [] });
    expect(ok.symbols[0].status).toBe("ready");
    const no = planTradebookImport({ orders: noIsin, holdings: [holding({ ticker: "RELIANCEPOWER", units: 2 })], existingTxns: [] });
    expect(no.symbols[0].status).toBe("unmatched");
  });

  it("asks for a member when two family members hold the same stock", () => {
    const hs = [holding({ id: "a", member_id: "m1" }), holding({ id: "b", member_id: "m2" })];
    const amb = planTradebookImport({ orders: orders(), holdings: hs, existingTxns: [] });
    expect(amb.symbols[0].status).toBe("ambiguous");
    expect(amb.inserts).toHaveLength(0);
    const picked = planTradebookImport({ orders: orders(), holdings: hs, existingTxns: [], memberId: "m2" });
    expect(picked.symbols[0].holding.id).toBe("b");
    expect(picked.inserts.every((t) => t.holding_id === "b")).toBe(true);
  });
});
