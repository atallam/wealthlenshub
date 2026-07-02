import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client so guards can be tested without a real DB / env vars.
// We build a tiny chainable query stub whose terminal .single() resolves to a
// value we control per-test.
let singleResult;
const from = vi.fn(() => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(singleResult),
  };
  return chain;
});

vi.mock("../lib/db.js", () => ({ supabase: { from } }));

const { assertOwnsHolding, assertOwnsArtifact } = await import("../lib/guards.js");

beforeEach(() => {
  singleResult = { data: null, error: null };
  from.mockClear();
});

describe("assertOwnsHolding", () => {
  it("returns the row when the holding belongs to the user", async () => {
    singleResult = { data: { id: "h_1" }, error: null };
    await expect(assertOwnsHolding("u_1", "h_1")).resolves.toEqual({ id: "h_1" });
  });

  it("throws 400 when no holding id is supplied", async () => {
    await expect(assertOwnsHolding("u_1", "")).rejects.toMatchObject({ status: 400 });
  });

  it("throws 404 when the holding is not owned / not found", async () => {
    singleResult = { data: null, error: { message: "no rows" } };
    await expect(assertOwnsHolding("u_1", "h_x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("assertOwnsArtifact", () => {
  it("throws 400 when no artifact id is supplied", async () => {
    await expect(assertOwnsArtifact("u_1", "")).rejects.toMatchObject({ status: 400 });
  });

  it("throws 404 when the artifact does not exist", async () => {
    singleResult = { data: null, error: { message: "no rows" } };
    await expect(assertOwnsArtifact("u_1", "art_x")).rejects.toMatchObject({ status: 404 });
  });
});
