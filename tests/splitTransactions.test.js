import { describe, it, expect, vi } from "vitest";

// Chainable Supabase stub: scripted reads per table, records every write.
function makeDb({ txn = { id: "t1", amount: 1000, category: "Groceries" }, members = [{ id: "a" }, { id: "b" }, { id: "c" }],
                  existing = [], insertError = null } = {}) {
  const calls = [];
  const from = (table) => {
    const st = { op: "select", payload: null, single: false };
    const b = {
      select() { return b; }, eq() { return b; },
      delete() { st.op = "delete"; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) {
        calls.push({ table, op: st.op, payload: st.payload });
        let out = { data: null, error: null };
        if (st.op === "select" && table === "budget_transactions") out = { data: txn, error: null };
        else if (st.op === "select" && table === "portfolio") out = { data: { members }, error: null };
        else if (st.op === "select" && table === "budget_transaction_splits") out = { data: existing, error: null };
        else if (st.op === "insert" && table === "budget_transaction_splits" && insertError && st.payload.length && !st.payload[0].id.startsWith("old")) out = { error: insertError };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  return { supabase: { from }, describeDbError: () => ({}), calls };
}
async function load(db) {
  vi.resetModules();
  vi.doMock("../lib/db.js", () => db);
  return await import("../services/budget.service.js");
}

describe("resolveTransactionAllocations", () => {
  const stmtMember = new Map([["s1", "a"], ["s2", null]]);
  it("attributes an unsplit transaction to its statement's member", async () => {
    const { resolveTransactionAllocations } = await load(makeDb());
    const out = resolveTransactionAllocations([{ id: "t1", statement_id: "s1", amount: 500, category: "Food" }], new Map(), stmtMember);
    expect(out).toEqual([{ id: "t1", statement_id: "s1", amount: 500, category: "Food", member_id: "a", is_split: false }]);
  });
  it("leaves transactions on unassigned statements with a null member", async () => {
    const { resolveTransactionAllocations } = await load(makeDb());
    expect(resolveTransactionAllocations([{ id: "t", statement_id: "s2", amount: 1 }], new Map(), stmtMember)[0].member_id).toBeNull();
  });
  it("replaces a split transaction with one allocation per share, keeping the parent's category and total", async () => {
    const { resolveTransactionAllocations } = await load(makeDb());
    const splits = new Map([["t1", [{ member_id: "a", amount: "600" }, { member_id: "b", amount: "400" }]]]);
    const out = resolveTransactionAllocations([{ id: "t1", statement_id: "s1", amount: 1000, category: "Food", txn_type: "DEBIT" }], splits, stmtMember);
    expect(out.map(o => [o.member_id, o.amount, o.category, o.is_split])).toEqual([["a", 600, "Food", true], ["b", 400, "Food", true]]);
    expect(out.reduce((s, o) => s + o.amount, 0)).toBe(1000);
  });
});

describe("setSplits", () => {
  it("saves shares that total the transaction amount", async () => {
    const db = makeDb(); const { setSplits } = await load(db);
    const r = await setSplits("u1", "t1", [{ member_id: "a", amount: 600 }, { member_id: "b", amount: 400 }]);
    expect(r.splits).toHaveLength(2);
    const ins = db.calls.find(c => c.op === "insert");
    expect(ins.payload.map(p => [p.member_id, p.amount, p.category])).toEqual([["a", 600, "Groceries"], ["b", 400, "Groceries"]]);
  });
  it("accepts shares that add up to the paisa (333.33 + 333.33 + 333.34)", async () => {
    const { setSplits } = await load(makeDb());
    await expect(setSplits("u1", "t1", [{ member_id: "a", amount: 333.33 }, { member_id: "b", amount: 333.33 }, { member_id: "c", amount: 333.34 }])).resolves.toMatchObject({ ok: true });
  });
  it("rejects shares that don't total the amount, without touching existing rows", async () => {
    const db = makeDb(); const { setSplits } = await load(db);
    await expect(setSplits("u1", "t1", [{ member_id: "a", amount: 600 }, { member_id: "b", amount: 300 }])).rejects.toMatchObject({ status: 400 });
    expect(db.calls.some(c => c.op === "delete" || c.op === "insert")).toBe(false);
  });
  it.each([
    ["one member only", [{ member_id: "a", amount: 1000 }]],
    ["duplicate member", [{ member_id: "a", amount: 500 }, { member_id: "a", amount: 500 }]],
    ["unknown member", [{ member_id: "zzz", amount: 500 }, { member_id: "a", amount: 500 }]],
    ["zero/negative share", [{ member_id: "a", amount: 1000 }, { member_id: "b", amount: 0 }]],
  ])("rejects %s", async (_n, shares) => {
    const db = makeDb(); const { setSplits } = await load(db);
    await expect(setSplits("u1", "t1", shares)).rejects.toMatchObject({ status: 400 });
    expect(db.calls.some(c => c.op === "delete")).toBe(false);
  });
  it("404s for a transaction that isn't the user's", async () => {
    const { setSplits } = await load(makeDb({ txn: null }));
    await expect(setSplits("u1", "nope", [])).rejects.toMatchObject({ status: 404 });
  });
  it("an empty array un-splits (delete only, no insert)", async () => {
    const db = makeDb(); const { setSplits } = await load(db);
    await expect(setSplits("u1", "t1", [])).resolves.toEqual({ ok: true, splits: [] });
    expect(db.calls.some(c => c.op === "delete")).toBe(true);
    expect(db.calls.some(c => c.op === "insert")).toBe(false);
  });
  it("restores the previous shares if the new insert fails", async () => {
    const db = makeDb({ existing: [{ id: "old1", member_id: "a", amount: 700, note: "" }, { id: "old2", member_id: "b", amount: 300, note: "" }], insertError: { message: "boom" } });
    const { setSplits } = await load(db);
    await expect(setSplits("u1", "t1", [{ member_id: "a", amount: 500 }, { member_id: "b", amount: 500 }])).rejects.toThrow("boom");
    const inserts = db.calls.filter(c => c.op === "insert");
    expect(inserts).toHaveLength(2);
    expect(inserts[1].payload.map(p => [p.id, p.amount])).toEqual([["old1", 700], ["old2", 300]]);
  });
});
