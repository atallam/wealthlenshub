import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getUser = vi.fn();
const savedEnv = process.env.NODE_ENV;

function mkRes() {
  const r = { statusCode: 200, body: null, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function load(nodeEnv = "test") {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  vi.doMock("../lib/db.js", () => ({ supabase: { auth: { getUser } } }));
  return import("../lib/auth.js");
}

beforeEach(() => { getUser.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { process.env.NODE_ENV = savedEnv; vi.restoreAllMocks(); });

describe("auth middleware", () => {
  async function run(headers) {
    const { auth } = await load();
    const req = { headers }, res = mkRes(), next = vi.fn();
    await auth(req, res, next);
    return { req, res, next };
  }

  it("rejects a missing Authorization header", async () => {
    const { res, next } = await run({});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("No token");
    expect(next).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    const { res, next } = await run({ authorization: "Basic dXNlcjpwYXNz" });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an implausibly short token without calling Supabase", async () => {
    const { res, next } = await run({ authorization: "Bearer abc" });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid token");
    expect(next).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a token Supabase does not recognise", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const { res, next } = await run({ authorization: "Bearer " + "x".repeat(40) });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase throws", async () => {
    getUser.mockRejectedValue(new Error("network down"));
    const { res, next } = await run({ authorization: "Bearer " + "x".repeat(40) });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Authentication failed");
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the verified user and continues on a valid token", async () => {
    const token = "t".repeat(40);
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } }, error: null });
    const { req, res, next } = await run({ authorization: `Bearer ${token}` });
    expect(getUser).toHaveBeenCalledWith(token);
    expect(req.user).toEqual({ id: "u1", email: "a@b.c" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});

describe("sendError", () => {
  it("shows the real message outside production", async () => {
    const { sendError } = await load("test");
    const res = mkRes();
    sendError(res, new Error("relation x does not exist"));
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("relation x does not exist");
  });

  it("hides internal 5xx messages in production", async () => {
    const { sendError } = await load("production");
    const res = mkRes();
    sendError(res, new Error("connection string postgres://user:pw@host"));
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(JSON.stringify(res.body)).not.toContain("postgres");
  });

  it("still returns client-error (4xx) messages in production", async () => {
    const { sendError } = await load("production");
    const res = mkRes();
    sendError(res, new Error("category required"), 400);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("category required");
  });

  it("surfaces schema-drift errors in production with a code", async () => {
    const { sendError } = await load("production");
    const res = mkRes();
    sendError(res, Object.assign(new Error("run migration 0033"), { code: "SCHEMA_DRIFT" }));
    expect(res.body).toEqual({ error: "run migration 0033", code: "SCHEMA_DRIFT" });
  });
});
