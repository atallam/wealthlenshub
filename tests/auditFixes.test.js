import { describe, it, expect, vi } from "vitest";

// Chainable Supabase stub. `tables[name]` is either rows or a fn(op, state) → {data,error}.
function makeDb(tables) {
  const calls = [];
  const from = (table) => {
    const st = { table, op: "select", payload: null, range: null, filters: [], single: false };
    const b = {};
    for (const m of ["select", "eq", "neq", "in", "or", "gte", "lte", "like", "limit", "order", "is"]) {
      b[m] = (...a) => { if (m === "eq" || m === "in") st.filters.push([m, ...a]); return b; };
    }
    b.range = (f, t) => { st.range = [f, t]; return b; };
    b.update = (p) => { st.op = "update"; st.payload = p; return b; };
    b.insert = (p) => { st.op = "insert"; st.payload = p; return b; };
    b.delete = () => { st.op = "delete"; return b; };
    b.single = () => { st.single = true; return b; };
    b.maybeSingle = () => { st.single = true; return b; };
    b.then = (res, rej) => {
      calls.push({ table, op: st.op, payload: st.payload, range: st.range, filters: st.filters });
      let out;
      const src = tables[table];
      if (typeof src === "function") out = src(st);
      else {
        let rows = src || [];
        if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
        out = { data: st.single ? (rows[0] ?? null) : rows, error: null };
      }
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  };
  return { supabase: { from }, describeDbError: () => ({}), calls };
}
async function load(db, mod) {
  vi.resetModules();
  vi.doMock("../lib/db.js", () => db);
  return await import(mod);
}

describe("fetchAll (PostgREST 1000-row cap)", () => {
  it("pages until a short page and returns every row", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const db = makeDb({ t: rows });
    const { fetchAll } = await load(db, "../lib/utils.js");
    const out = await fetchAll(() => db.supabase.from("t").select("*"));
    expect(out).toHaveLength(2500);
    expect(db.calls.map(c => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("throws the database error instead of returning partial data", async () => {
    const db = makeDb({ t: () => ({ data: null, error: { message: "boom" } }) });
    const { fetchAll } = await load(db, "../lib/utils.js");
    await expect(fetchAll(() => db.supabase.from("t").select("*"))).rejects.toThrow("boom");
  });
});

describe("AI advisor holdings tools", () => {
  const holdings = [
    { id: "h1", name: "Infosys", type: "IN_STOCK", ticker: "INFY", member_id: "m1", current_value: 5000, purchase_value: 4000 },
    { id: "h2", name: "Old FD", type: "FD", member_id: "m2", current_value: 900, purchase_value: 800, maturity_status: "closed" },
    { id: "h3", name: "Sold Co", type: "IN_STOCK", member_id: "m1", current_value: 100, purchase_value: 50, holding_status: "exited" },
    { id: "h4", name: "Nifty MF", type: "MF", member_id: "m2", current_value: 9000, purchase_value: 7000 },
  ];
  const tables = { holdings, portfolio: [{ members: [{ id: "m1", name: "Avi" }, { id: "m2", name: "Priya" }] }] };

  it("computes invested from purchase_value, names members, drops exited/closed, sorts by value", async () => {
    const { getHoldingsData } = await load(makeDb(tables), "../services/ai-tools.service.js");
    const out = await getHoldingsData("u1");
    expect(out.map(h => h.id)).toEqual(["h4", "h1"]);
    expect(out[0]).toMatchObject({ invested_value: 7000, member_name: "Priya" });
  });
  it("filters by asset type and member", async () => {
    const { getHoldingsData } = await load(makeDb(tables), "../services/ai-tools.service.js");
    expect((await getHoldingsData("u1", { member_id: "m1" })).map(h => h.id)).toEqual(["h1"]);
    expect((await getHoldingsData("u1", { asset_type: "MF" })).map(h => h.id)).toEqual(["h4"]);
  });
  it("summary rows carry the fields execTool sums", async () => {
    const { getPortfolioSummaryData } = await load(makeDb(tables), "../services/ai-tools.service.js");
    const rows = await getPortfolioSummaryData("u1");
    expect(rows.reduce((s, r) => s + r.current_value, 0)).toBe(14000);
    expect(rows.reduce((s, r) => s + r.invested_value, 0)).toBe(11000);
  });
  it("surfaces a database error instead of pretending there are no holdings", async () => {
    const db = makeDb({ holdings: () => ({ data: null, error: { message: "db down" } }) });
    const { getHoldingsData } = await load(db, "../services/ai-tools.service.js");
    await expect(getHoldingsData("u1")).rejects.toThrow("db down");
  });
});

describe("holdings.update ownership", () => {
  it("strips user_id / source / id from the client body", async () => {
    const db = makeDb({ holdings: (st) => st.op === "select" ? { data: { source: "manual" }, error: null } : { data: null, error: null } });
    const { update } = await load(db, "../services/holdings.service.js");
    await update("u1", "h1", { name: "Renamed", user_id: "someone-else", source: "cas", id: "other", import_method: "x", holding_status: "exited" });
    const patch = db.calls.find(c => c.op === "update").payload;
    expect(patch).toMatchObject({ name: "Renamed" });
    for (const k of ["user_id", "source", "id", "import_method", "holding_status"]) expect(patch).not.toHaveProperty(k);
  });
  it("still refuses to edit imported holdings", async () => {
    const db = makeDb({ holdings: () => ({ data: { source: "cas" }, error: null }) });
    const { update } = await load(db, "../services/holdings.service.js");
    await expect(update("u1", "h1", { name: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("transactions.importRows symbol matching", () => {
  it("does not book rows with an empty or too-short symbol onto a random holding", async () => {
    const db = makeDb({ holdings: [{ id: "h1", name: "Tata Elxsi", ticker: "TATAELXSI", scheme_code: "", type: "IN_STOCK" }], transactions: [] });
    const { importRows } = await load(db, "../services/transactions.service.js");
    const r = await importRows("u1", [{ _symbol: "", units: 1, price: 1 }, { _symbol: "ta", units: 1, price: 1 }, { _symbol: "TATAELXSI", units: 2, price: 5 }]);
    expect(r.imported_count).toBe(1);
    expect(r.unmatched_count).toBe(2);
  });
});
