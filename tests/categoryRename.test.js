import { describe, it, expect, vi } from "vitest";

// Minimal chainable Supabase stub that records writes and returns scripted reads.
function makeDb({ current, dup = [], txMoved = [{ id: "t1" }, { id: "t2" }], txError = null }) {
  const calls = [];
  const builder = (table) => {
    const st = { table, op: "select", patch: null };
    const b = {
      select() { return b; }, eq() { return b; }, neq() { return b; }, or() { return b; }, limit() { return b; },
      update(p) { st.op = "update"; st.patch = p; return b; },
      maybeSingle: async () => ({ data: current, error: null }),
      then(res, rej) {
        calls.push({ table, op: st.op, patch: st.patch });
        let out = { data: [], error: null };
        if (table === "budget_categories" && st.op === "select") out = { data: dup, error: null };
        if (table === "budget_transactions" && st.op === "update") out = txError ? { data: null, error: txError } : { data: txMoved, error: null };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  return { supabase: { from: builder }, describeDbError: () => ({}), calls };
}

async function load(db) {
  vi.resetModules();
  vi.doMock("../lib/db.js", () => db);
  return await import("../services/budget.service.js");
}

describe("updateCategory rename", () => {
  it("re-labels existing transactions and reports the count", async () => {
    const db = makeDb({ current: { name: "Food" } });
    const { updateCategory } = await load(db);
    const r = await updateCategory("u1", "cat1", "Groceries");
    expect(r).toEqual({ ok: true, transactionsUpdated: 2 });
    expect(db.calls.find(c => c.table === "budget_transactions" && c.op === "update").patch).toEqual({ category: "Groceries" });
  });
  it("does not touch transactions when the name is unchanged", async () => {
    const db = makeDb({ current: { name: "Food" } });
    const { updateCategory } = await load(db);
    const r = await updateCategory("u1", "cat1", "Food", "kw");
    expect(r.transactionsUpdated).toBe(0);
    expect(db.calls.some(c => c.table === "budget_transactions")).toBe(false);
  });
  it("rejects a duplicate name with 409 and writes nothing", async () => {
    const db = makeDb({ current: { name: "Food" }, dup: [{ id: "other" }] });
    const { updateCategory } = await load(db);
    await expect(updateCategory("u1", "cat1", "Travel")).rejects.toMatchObject({ status: 409 });
    expect(db.calls.some(c => c.op === "update")).toBe(false);
  });
  it("rejects an empty name and a missing/system category", async () => {
    const { updateCategory } = await load(makeDb({ current: { name: "Food" } }));
    await expect(updateCategory("u1", "cat1", "   ")).rejects.toMatchObject({ status: 400 });
    const { updateCategory: u2 } = await load(makeDb({ current: null }));
    await expect(u2("u1", "sys", "X")).rejects.toMatchObject({ status: 404 });
  });
  it("rolls the category name back if the transaction update fails", async () => {
    const db = makeDb({ current: { name: "Food" }, txError: { message: "boom" } });
    const { updateCategory } = await load(db);
    await expect(updateCategory("u1", "cat1", "Groceries")).rejects.toThrow("boom");
    const catUpdates = db.calls.filter(c => c.table === "budget_categories" && c.op === "update").map(c => c.patch.name);
    expect(catUpdates).toEqual(["Groceries", "Food"]);
  });
});
