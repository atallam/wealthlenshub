import { describe, it, expect, vi, afterEach } from "vitest";

const KEY_A = "ab".repeat(32);
const KEY_B = "cd".repeat(32);
const saved = { NODE_ENV: process.env.NODE_ENV, KEY: process.env.BUDGET_ENCRYPT_KEY };

// lib/crypto.js reads its env at import time, so each case re-imports it fresh.
async function load(env) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return import("../lib/crypto.js");
}

afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.KEY === undefined) delete process.env.BUDGET_ENCRYPT_KEY; else process.env.BUDGET_ENCRYPT_KEY = saved.KEY;
  vi.restoreAllMocks();
});

describe("crypto: encrypt / decrypt", () => {
  it("round-trips text, including unicode", async () => {
    const { encrypt, decrypt } = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    for (const t of ["ABCDE1234F", "01-01-1990", "₹ 12,345.67 — UPI/नमस्ते"]) {
      expect(decrypt(encrypt(t))).toBe(t);
    }
  });

  it("returns an empty string for empty input and passes through un-encrypted legacy values", async () => {
    const { encrypt, decrypt } = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    expect(encrypt("")).toBe("");
    expect(encrypt(null)).toBe("");
    expect(decrypt("")).toBe("");
    expect(decrypt(null)).toBe("");
    expect(decrypt("plain legacy value")).toBe("plain legacy value");
  });

  it("produces iv:tag:data and never repeats a ciphertext for the same plaintext", async () => {
    const { encrypt } = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    const a = encrypt("same"), b = encrypt("same");
    expect(a.split(":")).toHaveLength(3);
    expect(a).not.toBe(b);
    expect(a).not.toContain("same");
  });

  it("refuses tampered ciphertext instead of returning garbage", async () => {
    const { encrypt, decrypt } = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    const [iv, tag, data] = encrypt("secret value").split(":");
    const flipped = (data[0] === "0" ? "1" : "0") + data.slice(1);
    expect(decrypt([iv, tag, flipped].join(":"))).toBe("[encrypted]");
    expect(decrypt([iv, "00".repeat(16), data].join(":"))).toBe("[encrypted]");
  });

  it("cannot be decrypted with a different key", async () => {
    const a = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    const token = a.encrypt("ABCDE1234F");
    const b = await load({ BUDGET_ENCRYPT_KEY: KEY_B });
    expect(b.decrypt(token)).toBe("[encrypted]");
  });
});

describe("crypto: key handling", () => {
  it("refuses to start in production without BUDGET_ENCRYPT_KEY", async () => {
    await expect(load({ NODE_ENV: "production", BUDGET_ENCRYPT_KEY: undefined }))
      .rejects.toThrow(/BUDGET_ENCRYPT_KEY is not set/);
  });

  it("falls back to an ephemeral key outside production", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { encrypt, decrypt } = await load({ NODE_ENV: "test", BUDGET_ENCRYPT_KEY: undefined });
    expect(decrypt(encrypt("dev"))).toBe("dev");
  });

  it("rejects a key that is not 32 bytes of hex", async () => {
    await expect(load({ BUDGET_ENCRYPT_KEY: "abcd" })).rejects.toThrow(/64-character hex/);
  });

  it("hashFile returns the SHA-256 hex digest", async () => {
    const { hashFile } = await load({ BUDGET_ENCRYPT_KEY: KEY_A });
    expect(hashFile(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
