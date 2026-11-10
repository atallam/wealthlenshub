import { describe, it, expect, vi, beforeEach } from "vitest";

// A client-supplied id must never let one user overwrite another user's row via upsert.
const h = vi.hoisted(() => ({ db: null }));
vi.mock("../lib/db.js", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb.js");
  h.db = createFakeDb({ users: {} });
  return { supabase: h.db.client, describeDbError: () => ({}) };
});
const setu = await import("../services/setu.service.js");

const bobHolding = { id: "h_bob", user_id: "bob", name: "BOBS", units: 5 };
beforeEach(() => h.db.reset({ holdings: [bobHolding], setu_connections: [{ id: "setuconn_abcd1234", user_id: "bob", consent_id: "bobs" }] }));

describe("setu import cannot overwrite another user's holding", () => {
  it("re-ids a colliding row instead of overwriting it", async () => {
    const before = h.db.snapshot();
    const { error } = await setu.upsertHoldings("alice", [{ id: "h_bob", user_id: "alice", name: "ATTACK", units: 1 }]);
    expect(error).toBeFalsy();
    const rows = h.db.snapshot().holdings;
    expect(rows.find((r) => r.id === "h_bob")).toEqual(before.holdings[0]); // Bob untouched
    const mine = rows.filter((r) => r.user_id === "alice");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).not.toBe("h_bob");
  });

  it("still lets a user re-import (update) their own holding by id", async () => {
    h.db.reset({ holdings: [{ id: "h_a", user_id: "alice", name: "OLD", units: 1 }] });
    await setu.upsertHoldings("alice", [{ id: "h_a", user_id: "alice", name: "NEW", units: 2 }]);
    expect(h.db.snapshot().holdings).toEqual([expect.objectContaining({ id: "h_a", user_id: "alice", name: "NEW", units: 2 })]);
  });
});

describe("setu connection upsert", () => {
  it("does not overwrite another user's connection with the same derived id", async () => {
    await setu.upsertConnection({ id: "setuconn_abcd1234", user_id: "alice", consent_id: "alices" });
    const rows = h.db.snapshot().setu_connections;
    expect(rows.find((r) => r.user_id === "bob")).toMatchObject({ id: "setuconn_abcd1234", consent_id: "bobs" });
    expect(rows.find((r) => r.user_id === "alice").id).not.toBe("setuconn_abcd1234");
  });
});
