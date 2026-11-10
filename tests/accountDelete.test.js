import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({ db: null }));
vi.mock("../lib/db.js", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb.js");
  h.db = createFakeDb({
    users: {
      "token-alice-0000000000": { id: "alice", email: "Alice@Example.com" },
      "token-bob-000000000000": { id: "bob", email: "bob@example.com" },
    },
  });
  return { supabase: h.db.client, describeDbError: (e) => ({ isSchemaDrift: /does not exist/.test(e?.message || ""), friendly: e?.message }) };
});

const { app } = await import("../server.js");
const { USER_TABLES } = await import("../services/account.service.js");

let server, base;
await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const ALICE = { Authorization: "Bearer token-alice-0000000000", "content-type": "application/json" };
const del = (headers, body) => fetch(`${base}/api/account`, { method: "DELETE", headers, body: JSON.stringify(body ?? {}) });

function seed() {
  const rows = {};
  for (const [table, col] of USER_TABLES) {
    rows[table] = [
      { id: `${table}_a`, [col]: "alice", marker: "A" },
      { id: `${table}_b`, [col]: "bob", marker: "B" },
    ];
  }
  // Alice has an uploaded file; Bob has one too. Alice also has a legacy artifact with no user_id.
  rows.artifacts = [
    { id: "art_a", user_id: "alice", holding_id: "holdings_a", storage_path: "alice/doc.pdf" },
    { id: "art_legacy", user_id: null, holding_id: "holdings_a", storage_path: "legacy/alice-old.pdf" },
    { id: "art_b", user_id: "bob", holding_id: "holdings_b", storage_path: "bob/doc.pdf" },
  ];
  return rows;
}
const bobOnly = (snap) => Object.fromEntries(Object.entries(snap).map(([t, rs]) => [t, rs.filter((r) => r.marker === "B" || r.user_id === "bob" || r.id === "art_b")]));

beforeEach(() => h.db.reset(seed()));

describe("DELETE /api/account", () => {
  it("requires authentication", async () => {
    expect((await fetch(`${base}/api/account`, { method: "DELETE" })).status).toBe(401);
  });

  it("refuses without the right confirmation email, and deletes nothing", async () => {
    const before = h.db.snapshot(["audit_logs"]);
    for (const body of [{}, { confirm_email: "wrong@example.com" }, { confirm_email: "bob@example.com" }]) {
      const res = await del(ALICE, body);
      expect(res.status).toBe(400);
    }
    expect(h.db.snapshot(["audit_logs"])).toEqual(before);
    expect(h.db.deletedAuthUsers).toEqual([]);
  });

  it("erases every one of the caller's rows, files and the login - and nobody else's", async () => {
    const before = h.db.snapshot();
    const res = await del(ALICE, { confirm_email: "  alice@example.COM " });   // case/space tolerant
    expect(res.status).toBe(200);
    const after = h.db.snapshot();

    for (const [table, col] of USER_TABLES) {
      expect(after[table].filter((r) => r[col] === "alice"), `${table} still has Alice rows`).toEqual([]);
    }
    expect(after.artifacts.find((r) => r.id === "art_legacy")).toBeUndefined();   // legacy, linked via holding
    expect(bobOnly(after)).toEqual(bobOnly(before));                              // Bob untouched
    expect(after.holdings.some((r) => r.user_id === "bob")).toBe(true);

    expect(h.db.storage.removed.sort()).toEqual(["artifacts/alice/doc.pdf", "artifacts/legacy/alice-old.pdf"]);
    expect(h.db.deletedAuthUsers).toEqual(["alice"]);
  });

  it("is repeatable: a second attempt after success just fails auth (login is gone)", async () => {
    await del(ALICE, { confirm_email: "alice@example.com" });
    expect((await del(ALICE, { confirm_email: "alice@example.com" })).status).toBe(401);
  });

  it("keeps the login and reports failure when a table cannot be cleared", async () => {
    const orig = h.db.client.from;
    h.db.client.from = (t) => t === "budget_goals"
      ? { delete: () => ({ eq: async () => ({ error: { message: "boom" } }) }) }
      : orig(t);
    try {
      const res = await del(ALICE, { confirm_email: "alice@example.com" });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/try again/i);
      expect(body.failed).toEqual(["budget_goals"]);
      expect(h.db.deletedAuthUsers).toEqual([]);        // can retry
    } finally { h.db.client.from = orig; }
  });
});
