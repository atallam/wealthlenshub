import { describe, it, expect, vi } from "vitest";
import { checkEnv, assertEnv } from "../lib/env.js";

const GOOD = { NODE_ENV: "production", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", BUDGET_ENCRYPT_KEY: "a".repeat(64) };

describe("checkEnv", () => {
  it("accepts a minimal valid production env", () => {
    expect(checkEnv(GOOD).errors).toEqual([]);
  });
  it("flags missing Supabase settings and a missing/short encryption key in production", () => {
    const { errors } = checkEnv({ NODE_ENV: "production" });
    expect(errors.join("\n")).toMatch(/SUPABASE_URL/);
    expect(errors.join("\n")).toMatch(/SUPABASE_SERVICE_KEY/);
    expect(errors.join("\n")).toMatch(/BUDGET_ENCRYPT_KEY/);
    expect(checkEnv({ ...GOOD, BUDGET_ENCRYPT_KEY: "abc" }).errors.join()).toMatch(/64 hex/);
  });
  it("does not require an encryption key outside production", () => {
    expect(checkEnv({ SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_KEY: "k" }).errors).toEqual([]);
  });
  it("rejects wildcard / malformed CORS origins and bad mode values", () => {
    expect(checkEnv({ ...GOOD, CORS_ORIGINS: "*" }).errors.join()).toMatch(/\*/);
    expect(checkEnv({ ...GOOD, CORS_ORIGINS: "not a url" }).errors.join()).toMatch(/invalid origin/);
    expect(checkEnv({ ...GOOD, CSP_MODE: "enforced" }).errors.join()).toMatch(/CSP_MODE/);
    expect(checkEnv({ ...GOOD, BODY_SCHEMA_MODE: "strict" }).errors.join()).toMatch(/BODY_SCHEMA_MODE/);
  });
  it("requires Plaid id and secret together", () => {
    expect(checkEnv({ ...GOOD, PLAID_CLIENT_ID: "x" }).errors.join()).toMatch(/PLAID/);
  });
  it("warns (does not fail) about Setu without a webhook secret, and about unenforced modes in prod", () => {
    const r = checkEnv({ ...GOOD, SETU_ENABLED: "true", SETU_CLIENT_ID: "a", SETU_CLIENT_SECRET: "b" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/SETU_WEBHOOK_SECRET/);
    expect(r.warnings.join()).toMatch(/CSP_MODE/);
    expect(r.warnings.join()).toMatch(/BODY_SCHEMA_MODE/);
    const ok = checkEnv({ ...GOOD, CSP_MODE: "enforce", BODY_SCHEMA_MODE: "enforce", ANTHROPIC_KEY: "k" });
    expect(ok.warnings).toEqual([]);
  });
});

describe("assertEnv", () => {
  it("throws one readable error listing every problem in production", () => {
    const log = { warn: vi.fn() };
    expect(() => assertEnv({ NODE_ENV: "production" }, log)).toThrow(/Invalid environment configuration[\s\S]*SUPABASE_URL[\s\S]*BUDGET_ENCRYPT_KEY/);
  });
  it("only warns in development", () => {
    const log = { warn: vi.fn() };
    expect(() => assertEnv({}, log)).not.toThrow();
    expect(log.warn).toHaveBeenCalled();
  });
});
