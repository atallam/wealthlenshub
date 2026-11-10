import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import multer from "multer";
import { allowExtensions } from "../lib/uploads.js";

vi.mock("../lib/db.js", () => ({ supabase: { auth: { getUser: vi.fn() } } }));

describe("allowExtensions", () => {
  const run = (name) => { const cb = vi.fn(); allowExtensions(["pdf", "csv"])({}, { originalname: name }, cb); return cb.mock.calls[0]; };

  it("accepts listed extensions case-insensitively", () => {
    expect(run("CAS.PDF")).toEqual([null, true]);
    expect(run("trades.v2.csv")).toEqual([null, true]);
  });

  it("rejects other types with a 400", () => {
    for (const name of ["payload.exe", "script.js", "archive.zip", "noextension", ".pdf.exe", ""]) {
      const [err] = run(name);
      expect(err, name).toBeInstanceOf(Error);
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/Unsupported file type\. Allowed: \.pdf, \.csv/);
    }
  });
});

describe("allowExtensions through multer + an Express error handler", () => {
  let server;
  afterEach(() => server?.close());

  async function start() {
    const app = express();
    const upload = multer({ storage: multer.memoryStorage(), fileFilter: allowExtensions(["pdf"]) });
    app.post("/up", upload.single("file"), (req, res) => res.json({ ok: true, bytes: req.file.size }));
    // Express only treats a 4-argument function as an error handler, so `next` must stay.
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    await new Promise(r => { server = app.listen(0, r); });
    return `http://127.0.0.1:${server.address().port}/up`;
  }
  const form = (name) => { const f = new FormData(); f.append("file", new Blob(["hello"]), name); return f; };

  it("lets an allowed file through", async () => {
    const res = await fetch(await start(), { method: "POST", body: form("cas.pdf") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bytes: 5 });
  });

  it("answers a disallowed file with 400 JSON before the handler runs", async () => {
    const res = await fetch(await start(), { method: "POST", body: form("virus.exe") });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unsupported file type/);
  });
});
