import { describe, it, expect, vi } from "vitest";

// holdings.create() takes a client-controlled body. It must not let a manual entry
// claim another owner or pose as an imported (CAS / broker) holding.
function makeDb() {
  const inserts = [];
  const chain = (table) => {
    const b = {
      delete() { return b; }, eq() { return b; }, like() { return b; },
      insert(p) { inserts.push({ table, p }); return Promise.resolve({ error: null }); },
      then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
    };
    return b;
  };
  return { supabase: { from: chain }, describeDbError: () => ({}), inserts };
}

async function load(db) {
  vi.resetModules();
  vi.doMock("../lib/db.js", () => db);
  return import("../services/holdings.service.js");
}

describe("holdings.create provenance", () => {
  it("strips ownership and provenance columns from the client body", async () => {
    const db = makeDb();
    const { create } = await load(db);
    await create("real-user", {
      id: "h_abc", name: "Infosys", type: "IN_STOCK", units: 10, purchase_price: 1500,
      user_id: "attacker", source: "cas", source_date: "2020-01-01", import_method: "cas_pdf",
      holding_status: "closed", created_at: "2001-01-01", depository: "NSDL", account_id: "ACC1",
    });
    const row = db.inserts.find(i => i.table === "holdings").p;
    expect(row.user_id).toBe("real-user");
    for (const k of ["source", "source_date", "import_method", "holding_status", "created_at", "depository", "account_id"]) {
      expect(row, k).not.toHaveProperty(k);
    }
    expect(row).toMatchObject({ id: "h_abc", name: "Infosys", type: "IN_STOCK", units: 10, purchase_price: 1500 });
  });
});
