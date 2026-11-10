import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * Cross-tenant (IDOR) tests. The server talks to Supabase with the service key, which
 * bypasses Row-Level Security, so every "does this row belong to the caller?" check lives in
 * code. These tests drive the REAL app (routers, services, auth, audit middleware) against an
 * in-memory database holding two users' data, and require that user B can neither READ nor
 * CHANGE user A's data through any id-addressed or list endpoint.
 *
 * For every case we check:
 *   - the owner can use the endpoint (so the case really exercises the route, not a 404)
 *   - another user gets no trace of the owner's data (marker string never appears)
 *   - another user's request changes nothing (whole-database snapshot is identical)
 *   - for id-addressed routes the answer for someone else's id is the same as for a
 *     non-existent id, so the API is not an oracle for "this id exists"
 */

const h = vi.hoisted(() => ({ db: null }));
vi.mock("../lib/db.js", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb.js");
  h.db = createFakeDb({
    users: {
      "token-alice-0000000000": { id: "alice", email: "alice@example.com" },
      "token-bob-000000000000": { id: "bob", email: "bob@example.com" },
    },
  });
  return { supabase: h.db.client, describeDbError: () => ({}) };
});

const { encrypt } = await import("../lib/crypto.js");

const M = "ALICEONLY"; // appears in every piece of Alice's data; must never reach Bob
const TOKENS = { alice: "token-alice-0000000000", bob: "token-bob-000000000000" };

function seed() {
  const alice = { user_id: "alice" };
  return {
    profiles: [{ id: "alice" }, { id: "bob" }],
    portfolio: [
      { user_id: "alice", members: [{ id: "m_a", name: `${M} Member` }, { id: "m_a2", name: "Alice Two" }], goals: [], alerts: [], liabilities: [] },
      { user_id: "bob",   members: [{ id: "m_b", name: "Bob" }],          goals: [], alerts: [], liabilities: [] },
    ],
    holdings: [
      { id: "h_alice1", ...alice, member_id: "m_a", name: `${M} Infosys`, ticker: "ALICETICK", type: "IN_STOCK", units: 15, purchase_price: 1000, current_price: 1500, currency: "INR", source: null, created_at: "2024-01-01T00:00:00Z" },
      { id: "h_bob1", user_id: "bob", member_id: "m_b", name: "Bob Holding", ticker: "BOBTICK", type: "IN_STOCK", units: 1, purchase_price: 10, current_price: 11, currency: "INR", source: null, created_at: "2024-01-01T00:00:00Z" },
    ],
    transactions: [{ id: "t_alice1", holding_id: "h_alice1", ...alice, txn_type: "BUY", units: 10, price: 1000, txn_date: "2024-01-01", notes: `${M} note`, source: null }],
    artifacts: [{ id: "art_alice1", ...alice, holding_id: "h_alice1", file_name: `${M}.pdf`, storage_path: `holdings/h_alice1/${M}.pdf`, file_type: "application/pdf", sha256: "abc", uploaded_at: "2024-01-02" }],
    budget_statements: [{ id: "s_alice1", ...alice, member_id: "m_a", bank: "hdfc", filename: `${M}.csv`, created_at: "2024-01-03" }],
    budget_transactions: [{ id: "bt_alice1", ...alice, statement_id: "s_alice1", date: "2024-01-03", description: encrypt(`${M} coffee`), raw_desc: encrypt(`${M} coffee`), amount: 250, type: "debit", category: "Food" }],
    budget_categories: [{ id: "c_alice1", ...alice, name: `${M}Cat`, keywords: [], icon: "x", color: "#fff", monthly_limit: 0, is_system: false }],
    budget_goals: [{ id: "g_alice1", ...alice, name: `${M} goal`, target: 1000, saved: 0, created_at: "2024-01-01" }],
    budget_transaction_splits: [],
    notifications: [{ id: "n_alice1", ...alice, title: `${M} alert`, read: false, created_at: "2024-01-01" }],
    net_worth_snapshots: [{ id: "snap_alice1", ...alice, month: "2024-01", total_value: 123456, created_at: "2024-01-31" }],
    concall_analyses: [{ id: "ca_alice1", holding_id: "h_alice1", ...alice, quarter: "Q1FY25", quarter_date: "2024-06-30", score: 7, signal: "BULLISH", summary: `${M} summary` }],
  };
}

// {tokens} are replaced with Alice's real ids for the attack, and made-up ids for the control.
const IDS = { "{h}": "h_alice1", "{t}": "t_alice1", "{a}": "art_alice1", "{bt}": "bt_alice1", "{c}": "c_alice1", "{g}": "g_alice1", "{n}": "n_alice1", "{snap}": "snap_alice1" };
const resolve = (s, useReal) => Object.entries(IDS).reduce((acc, [tok, real]) => acc.replaceAll(tok, useReal ? real : `nonexistent_${real}`), s);

// kind: "read" = response must not reveal Alice's data; "write" = must also change nothing.
// ownerOk:false = the owner path needs the network or an external service, so skip that control.
const CASES = [
  // holdings & transactions
  { name: "list holdings",                 m: "GET",    p: "/api/holdings", list: true },
  { name: "holding transactions",          m: "GET",    p: "/api/holdings/{h}/transactions" },
  { name: "transactions for a holding",    m: "GET",    p: "/api/transactions/{h}" },
  { name: "update holding",                m: "PUT",    p: "/api/holdings/{h}", body: { name: "HACKED", type: "IN_STOCK" }, write: true },
  { name: "delete holding",                m: "DELETE", p: "/api/holdings/{h}", write: true },
  { name: "add transaction to holding",    m: "POST",   p: "/api/transactions", body: { holding_id: "{h}", txn_type: "BUY", units: 1, price: 1, txn_date: "2024-02-01" }, write: true },
  { name: "delete transaction",            m: "DELETE", p: "/api/transactions/{t}", write: true },
  { name: "set cost basis",                m: "POST",   p: "/api/transactions/cost-basis", body: { holding_id: "{h}", avg_price: 10 }, write: true },
  // artifacts
  { name: "list artifacts",                m: "GET",    p: "/api/artifacts/{h}" },
  { name: "download artifact",             m: "GET",    p: "/api/artifacts/download/{a}" },
  { name: "delete artifact",               m: "DELETE", p: "/api/artifacts/{a}", write: true },
  // analytics & concall
  { name: "analytics for a holding",       m: "GET",    p: "/api/analytics/holdings/{h}" },
  { name: "concall latest",                m: "GET",    p: "/api/concall/{h}" },
  { name: "concall history",               m: "GET",    p: "/api/concall/{h}/history" },
  { name: "concall trend",                 m: "GET",    p: "/api/concall/{h}/trend" },
  { name: "concall provider debug",        m: "GET",    p: "/api/concall/{h}/debug", ownerOk: false },
  { name: "concall analyze",               m: "POST",   p: "/api/concall/{h}/analyze", write: true, ownerOk: false },
  { name: "concall analyze from text",     m: "POST",   p: "/api/concall/{h}/analyze-text", body: { text: "Management discussed margins and demand." }, write: true, ownerOk: false },
  // budget
  { name: "list statements",               m: "GET",    p: "/api/budget/statements", list: true },
  { name: "list categories",               m: "GET",    p: "/api/budget/categories", list: true },
  { name: "list goals",                    m: "GET",    p: "/api/budget/goals", list: true },
  { name: "transaction splits (read)",     m: "GET",    p: "/api/budget/transactions/{bt}/splits" },
  { name: "recategorise a transaction",    m: "PATCH",  p: "/api/budget/transactions/{bt}", body: { category: "HACKED" }, write: true },
  { name: "rename a category",             m: "PUT",    p: "/api/budget/categories/{c}", body: { name: "HACKED", keywords: [], icon: "x", color: "#000", monthly_limit: 0 }, write: true },
  { name: "delete a category",             m: "DELETE", p: "/api/budget/categories/{c}", write: true },
  { name: "update a goal",                 m: "PUT",    p: "/api/budget/goals/{g}", body: { name: "HACKED" }, write: true },
  { name: "delete a goal",                 m: "DELETE", p: "/api/budget/goals/{g}", write: true },
  { name: "split someone else's transaction", m: "PUT", p: "/api/budget/transactions/{bt}/splits", body: { splits: [{ member_id: "m_a", amount: 100 }, { member_id: "m_a2", amount: 150 }] }, write: true },
  // misc
  { name: "list notifications",            m: "GET",    p: "/api/notifications", list: true },
  { name: "mark notification read",        m: "POST",   p: "/api/notifications/{n}/read", write: true },
  { name: "list snapshots",                m: "GET",    p: "/api/snapshots", list: true },
  { name: "delete snapshot",               m: "DELETE", p: "/api/snapshots/{snap}", write: true },
];

let server, base, realFetch;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  // Block outbound calls (market data, filings, Anthropic) so tests are hermetic.
  globalThis.fetch = (url, ...rest) =>
    String(url).startsWith("http://127.0.0.1") ? realFetch(url, ...rest) : Promise.reject(new Error("network blocked in tests"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { app } = await import("../server.js");
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => { globalThis.fetch = realFetch; server?.close(); vi.restoreAllMocks(); });
beforeEach(() => h.db.reset(seed()));

async function call(as, c, useReal = true) {
  const res = await fetch(base + resolve(c.p, useReal), {
    method: c.m,
    headers: { authorization: `Bearer ${TOKENS[as]}`, "content-type": "application/json" },
    body: c.body ? JSON.stringify(JSON.parse(resolve(JSON.stringify(c.body), useReal))) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

const normalise = (t) => t.replace(/nonexistent_/g, "").replace(/\d{10,}/g, "<n>");

describe("a second user cannot see or change the first user's data", () => {
  for (const c of CASES) {
    describe(`${c.m} ${c.p}  (${c.name})`, () => {
      if (c.ownerOk !== false) {
        it("works for the owner (the case really exercises the route)", async () => {
          const out = await call("alice", c);
          expect(out.status, out.text.slice(0, 200)).toBeLessThan(400);
        });
      }

      it("shows another user nothing of the owner's data", async () => {
        const before = h.db.snapshot(["audit_logs"]);
        const out = await call("bob", c);
        expect(out.text, `${c.m} ${c.p} -> ${out.status}`).not.toContain(M);
        expect(out.text).not.toContain("ALICETICK");
        expect(out.text).not.toContain("alice@example.com");
        if (c.write) expect(h.db.snapshot(["audit_logs"])).toEqual(before);
      });

      if (!c.list) {
        it("answers the same as for an id that does not exist (no existence oracle)", async () => {
          const real = await call("bob", c, true);
          h.db.reset(seed());
          const fake = await call("bob", c, false);
          expect(real.status).toBe(fake.status);
          expect(normalise(real.text)).toBe(normalise(fake.text));
        });
      }
    });
  }
});

describe("harness sanity", () => {
  it("rejects a request with no token", async () => {
    const res = await fetch(`${base}/api/holdings`);
    expect(res.status).toBe(401);
  });
  it("lets each user see their own holdings only", async () => {
    const a = JSON.parse((await call("alice", { m: "GET", p: "/api/holdings" })).text);
    const b = JSON.parse((await call("bob", { m: "GET", p: "/api/holdings" })).text);
    expect(a.map((x) => x.id)).toEqual(["h_alice1"]);
    expect(b.map((x) => x.id)).toEqual(["h_bob1"]);
  });
});
