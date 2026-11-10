import { describe, it, expect, vi, afterAll } from "vitest";

vi.mock("../lib/db.js", async () => {
  const { createFakeDb } = await import("./helpers/fakeDb.js");
  return { supabase: createFakeDb({ users: {} }).client, describeDbError: () => ({}) };
});

const { app } = await import("../server.js");
let server, base;
await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

describe("CSP header + /csp-report", () => {
  it("serves a CSP that reports to /csp-report", async () => {
    const res = await fetch(`${base}/health`);
    const csp = res.headers.get("content-security-policy-report-only") || res.headers.get("content-security-policy");
    expect(csp).toMatch(/report-uri \/csp-report/);
  });

  it("accepts a browser report, logs a short scrubbed line, and returns 204 without auth", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fetch(`${base}/csp-report`, {
      method: "POST", headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "violated-directive": "script-src", "blocked-uri": "https://evil.example/x.js?token=SECRET", "document-uri": "https://app.example/?code=SECRET" } }),
    });
    expect(res.status).toBe(204);
    const line = warn.mock.calls.map((c) => c.join(" ")).find((l) => l.startsWith("[csp]"));
    expect(line).toContain("script-src");
    expect(line).toContain("https://evil.example/x.js");
    expect(line).not.toContain("SECRET");
    warn.mockRestore();
  });

  it("rejects an oversized report", async () => {
    const res = await fetch(`${base}/csp-report`, {
      method: "POST", headers: { "content-type": "application/csp-report" }, body: "x".repeat(20_000),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
