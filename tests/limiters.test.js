import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";

vi.mock("../lib/db.js", () => ({ supabase: { auth: { getUser: vi.fn() } } }));
const { uploadLimiter, analysisLimiter } = await import("../lib/auth.js");

// Stand-in for `auth`: identifies the caller from a header so we can verify per-user keys.
const asUser = (req, _res, next) => { const id = req.get("x-user"); if (id) req.user = { id }; next(); };

describe("per-user rate limiters", () => {
  let server;
  afterEach(() => server?.close());

  async function start(limiter) {
    const app = express();
    app.post("/x", asUser, limiter, (_req, res) => res.json({ ok: true }));
    await new Promise(r => { server = app.listen(0, r); });
    return (user) => fetch(`http://127.0.0.1:${server.address().port}/x`, { method: "POST", headers: { "x-user": user } });
  }

  it("uploadLimiter allows 60 per window per user, then 429s only that user", async () => {
    const hit = await start(uploadLimiter);
    for (let i = 0; i < 60; i++) expect((await hit("alice")).status).toBe(200);
    const blocked = await hit("alice");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/Too many uploads/);
    expect((await hit("bob")).status).toBe(200);
  });

  it("analysisLimiter allows 30 per window per user", async () => {
    const hit = await start(analysisLimiter);
    for (let i = 0; i < 30; i++) expect((await hit("carol")).status).toBe(200);
    const blocked = await hit("carol");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/Too many analysis/);
    expect((await hit("dave")).status).toBe(200);
  });
});
