import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/db.js", () => ({ supabase: { from: () => ({ insert: async () => ({}) }) } }));
const { sanitizeBody } = await import("../lib/auditLogger.js");

describe("audit log sanitizeBody", () => {
  it("redacts the credential fields this app actually receives", () => {
    const out = sanitizeBody({
      password: "p", pdfPassword: "p", casPassword: "p", userSecret: "s", user_secret: "s",
      access_token: "a", public_token: "p", refreshToken: "r", authorization: "Bearer x",
      apiKey: "k", client_secret: "c", pan: "ABCDE1234F", dob: "01-01-1990", key: "k",
      pan_number: "ABCDE1234F", encrypted_pan: "iv:tag:data", otp: "123456",
    });
    for (const [k, v] of Object.entries(out)) expect([k, v]).toEqual([k, "[REDACTED]"]);
  });

  it("redacts case-insensitively and inside nested objects and arrays", () => {
    const out = sanitizeBody({ user: { PASSWORD: "x", profile: { PAN: "x" } }, list: [{ Token: "x", ok: 1 }] });
    expect(out.user.PASSWORD).toBe("[REDACTED]");
    expect(out.user.profile.PAN).toBe("[REDACTED]");
    expect(out.list[0].Token).toBe("[REDACTED]");
    expect(out.list[0].ok).toBe(1);
  });

  it("keeps ordinary fields, including ones that merely contain 'pan' or 'key'", () => {
    const body = { name: "HDFC Bank", company: "Pantry Ltd", keyword: "sip", span: 3, category: "Food", amount: 250 };
    expect(sanitizeBody(body)).toEqual(body);
  });

  it("truncates long strings and caps long arrays", () => {
    const out = sanitizeBody({ text: "x".repeat(900), rows: Array.from({ length: 50 }, (_, i) => i) });
    expect(out.text.length).toBe(501);
    expect(out.text.endsWith("…")).toBe(true);
    expect(out.rows).toHaveLength(20);
  });

  it("replaces an oversized payload with a truncated preview", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i, note: "n".repeat(400) }));
    const out = sanitizeBody({ rows }, 2000);
    expect(out._truncated).toBe(true);
    expect(out._preview.length).toBeLessThanOrEqual(2000);
  });

  it("returns null for non-object bodies", () => {
    for (const v of [null, undefined, "text", 42]) expect(sanitizeBody(v)).toBeNull();
  });
});
