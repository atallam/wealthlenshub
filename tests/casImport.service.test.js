import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal supabase-js stand-in ────────────────────────────────────────────
const calls = { rpc: [], inserts: [], selects: [] };
let existingRows = [];
let priorImports = [];
let rpcResult = { data: { inserted: 2, updated: 1, exited: 1, deleted: 0, legacy_retired: 0, skipped_older: 0 }, error: null };

function chain(table) {
  const q = {
    _table: table, _filters: [],
    select() { return q; }, eq(...a) { q._filters.push(["eq", ...a]); return q; },
    in(...a) { q._filters.push(["in", ...a]); return q; }, order() { return q; },
    limit() { return q; },
    insert(row) { calls.inserts.push({ table, row }); return Promise.resolve({ error: null }); },
    then(resolve) {
      calls.selects.push({ table, filters: q._filters });
      if (table === "holdings")    return resolve({ data: existingRows, error: null });
      if (table === "import_logs") return resolve({ data: priorImports, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return q;
}
vi.mock("../lib/db.js", () => ({
  supabase: {
    from: (t) => chain(t),
    rpc: (name, params) => { calls.rpc.push({ name, params }); return Promise.resolve(rpcResult); },
  },
}));

const { previewCasImport, applyCasImport } = await import("../services/casImport.service.js");

const U = "11111111-1111-1111-1111-111111111111";
const body = () => ({
  holdings: [
    { name: "INFOSYS", type: "IN_STOCK", ticker: "INE009A01021", isin: "INE009A01021", account_id: "IN300/1", units: 12, current_value: 18600, _holder_name: "AVINASH T" },
    { name: "HDFC BANK", type: "IN_STOCK", ticker: "INE040A01034", isin: "INE040A01034", account_id: "IN300/1", units: 4, current_value: 6400, _holder_name: "AVINASH T" },
    { name: "ICICI Bluechip", type: "MF", ticker: "INF109K01VQ1", isin: "INF109K01VQ1", account_id: "MF-FOLIOS", units: 100, current_value: 8000, _holder_name: "AVINASH T" },
  ],
  account_map: { "AVINASH T": "m1" },
  depository: "NSDL CAS (casparser v1.4.1)",
  cas_statement_date: "2026-09-30", cas_period_start: "2026-09-01", cas_period_end: "2026-09-30",
  statement_hash: "abc123",
});

beforeEach(() => {
  calls.rpc = []; calls.inserts = []; calls.selects = [];
  existingRows = [
    { id: "h1", member_id: "m1", depository: "NSDL", account_id: "IN300/1", isin: "INE009A01021", units: 10, current_value: 15000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "INFOSYS" },
    { id: "h2", member_id: "m1", depository: "NSDL", account_id: "IN300/1", isin: "INE467B01029", units: 5, current_value: 20000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "TCS" },
    { id: "h4", member_id: "m1", depository: "CAMS", account_id: "F1", isin: "INF109K01VQ1", units: 100, current_value: 8000, holding_status: "active", source_date: "2026-08-31", source: "cas", name: "ICICI Bluechip" },
  ];
  priorImports = [];
});

describe("previewCasImport", () => {
  it("normalises the depository label and writes nothing", async () => {
    const p = await previewCasImport(U, body());
    expect(p.depository).toBe("NSDL");
    expect(p.summary).toMatchObject({ new: 2, changed: 1, unchanged: 0, exited: 1, overlap: 1 });   // MF is new under NSDL (only tracked via CAMS so far)
    expect(p.exited[0].name).toBe("TCS");
    expect(p.overlaps[0]).toMatchObject({ isin: "INF109K01VQ1", type: "MF", with: [{ depository: "CAMS" }] });
    expect(p.already_imported).toBeNull();
    expect(calls.rpc).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });

  it("reports a prior import of the same statement hash", async () => {
    priorImports = [{ id: "x", created_at: "2026-09-10T10:00:00Z", summary: { inserted: 3 } }];
    const p = await previewCasImport(U, body());
    expect(p.already_imported.at).toBe("2026-09-10T10:00:00Z");
  });

  it("rejects an unknown depository up front", async () => {
    await expect(previewCasImport(U, { ...body(), depository: "SUMMARY" })).rejects.toThrow(/depository/);
  });
});

describe("applyCasImport", () => {
  it("sends one atomic RPC with the natural-key payload and honours skip decisions", async () => {
    const r = await applyCasImport(U, { ...body(), dup_actions: { "m1|INF109K01VQ1": "skip" }, import_method: "manual_upload" });
    expect(calls.rpc).toHaveLength(1);
    const { name, params } = calls.rpc[0];
    expect(name).toBe("apply_cas_snapshot");
    expect(params).toMatchObject({ p_user_id: U, p_depository: "NSDL", p_statement_date: "2026-09-30", p_import_method: "manual_upload", p_retire_legacy: true });
    expect(params.p_import_id).toMatch(/^imp_/);
    expect(params.p_groups).toHaveLength(1);
    const g = params.p_groups[0];
    expect(g.member_id).toBe("m1");
    expect(g.account_ids.sort()).toEqual(["IN300/1", "MF-FOLIOS"]);
    expect(g.rows.map((x) => x.isin)).toEqual(["INE009A01021", "INE040A01034"]);   // MF skipped
    expect(g.rows[0]).not.toHaveProperty("_holder_name");
    expect(g.rows[0]).toMatchObject({ account_id: "IN300/1", units: 12, current_value: 18600, ticker: "INE009A01021" });

    // audit row carries the hash for idempotency
    const log = calls.inserts.find((i) => i.table === "import_logs");
    expect(log.row).toMatchObject({ source: "CAS_PDF", status: "SUCCESS", statement_hash: "abc123", depository: "NSDL", rows_ok: 3 });

    expect(r).toMatchObject({ ok: true, inserted_count: 2, updated_count: 1, exited_count: 1, needs_price_refresh: true, _cas_statement_date: "2026-09-30" });
  });

  it("surfaces an RPC failure as 'no changes were made' and writes no audit row", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    await expect(applyCasImport(U, body())).rejects.toThrow(/no changes were made.*boom/);
    expect(calls.inserts).toHaveLength(0);
    rpcResult = { data: { inserted: 0, updated: 0, exited: 0, deleted: 0, legacy_retired: 0, skipped_older: 0 }, error: null };
  });

  it("never writes when no holding resolves to a member", async () => {
    const r = await applyCasImport(U, { ...body(), account_map: {}, member_id: "" });
    expect(calls.rpc).toHaveLength(0);
    expect(r.skipped_count).toBe(3);
  });
});
