import { describe, it, expect, vi, afterEach } from "vitest";
import {
  bodyGuard, profileUpdateSchema, assetTypeSchema, categorySchema, goalSchema,
  categoryLimitSchema, recategoriseSchema,
} from "../lib/validate.js";

function run(schema, body) {
  const req = { body }; let status = null, json = null, nexted = false;
  const res = { status(c) { status = c; return res; }, json(j) { json = j; return res; } };
  bodyGuard(schema, "thing")(req, res, () => { nexted = true; });
  return { req, status, json, nexted };
}

afterEach(() => { delete process.env.BODY_SCHEMA_MODE; vi.restoreAllMocks(); });

describe("bodyGuard", () => {
  it("strips unknown keys (user_id, id, created_at) from a valid body", () => {
    const r = run(assetTypeSchema, { label: "Gold", user_id: "victim", id: "x", created_at: "2001" });
    expect(r.nexted).toBe(true);
    expect(r.req.body).toEqual({ label: "Gold" });
  });

  it("log mode (default): an invalid body is warned about and allowed through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = run(goalSchema, { name: "Car", target: "lots" });
    expect(r.nexted).toBe(true);
    expect(r.status).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("enforce mode: an invalid body is rejected with 400 and a readable message", () => {
    process.env.BODY_SCHEMA_MODE = "enforce";
    const r = run(goalSchema, { name: "Car", target: -5 });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/target/);
  });
});

describe("schemas accept what the UI sends", () => {
  it("category with string numbers and booleans", () => {
    expect(categorySchema.safeParse({ name: "Food", keywords: "swiggy,zomato", monthly_limit: "5000", is_essential: true }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "Food", keywords: ["swiggy"], monthly_limit: null }).success).toBe(true);
  });
  it("goal with optional fields missing / null", () => {
    expect(goalSchema.safeParse({ name: "Trip", target: 100000, saved: null, due_date: null }).success).toBe(true);
  });
  it("profile with only a settings patch, and an explicit-null PAN (clears it)", () => {
    expect(profileUpdateSchema.safeParse({ settings: { ppf_rate: 7.1 } }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ pan: null }).success).toBe(true);
  });
  it("category limit may be zero", () => {
    expect(categoryLimitSchema.safeParse({ category_id: "c", member_id: "m", monthly_limit: 0 }).success).toBe(true);
  });
});

describe("schemas reject abuse", () => {
  it("oversized settings, oversized id list, non-array ids", () => {
    expect(profileUpdateSchema.safeParse({ settings: { blob: "x".repeat(20000) } }).success).toBe(false);
    expect(recategoriseSchema.safeParse({ ids: Array(501).fill("a"), category: "Food" }).success).toBe(false);
    expect(recategoriseSchema.safeParse({ ids: "a", category: "Food" }).success).toBe(false);
  });
  it("unknown price_source", () => {
    expect(assetTypeSchema.safeParse({ label: "X", price_source: "EVIL" }).success).toBe(false);
  });
});

describe("profile asset types cannot be re-homed by the body", () => {
  async function load(inserts, updates) {
    const chain = (table) => {
      const b = {
        insert(p) { inserts.push({ table, p }); return Promise.resolve({ error: null }); },
        update(p) { updates.push({ table, p }); return b; },
        eq() { return b; },
        then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
      };
      return b;
    };
    vi.resetModules();
    vi.doMock("../lib/db.js", () => ({ supabase: { from: chain }, describeDbError: () => ({}) }));
    return import("../services/profile.service.js");
  }
  it("create keeps the caller's user_id and server id", async () => {
    const inserts = [], updates = [];
    const svc = await load(inserts, updates);
    const out = await svc.createAssetType("real-user", { label: "Gold", user_id: "victim", id: "stolen" });
    const row = inserts[0].p;
    expect(row.user_id).toBe("real-user");
    expect(row.id).not.toBe("stolen");
    expect(row.id).toBe(out.id);
    expect(row.label).toBe("Gold");
  });
  it("update cannot change user_id or id", async () => {
    const inserts = [], updates = [];
    const svc = await load(inserts, updates);
    await svc.updateAssetType("real-user", "at_1", { label: "New", user_id: "victim", id: "other" });
    expect(updates[0].p).toEqual({ label: "New" });
  });
});
