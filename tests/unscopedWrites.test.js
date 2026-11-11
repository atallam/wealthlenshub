import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The server uses the Supabase SERVICE key, which bypasses RLS: a write keyed only on `id` will
// happily touch another user's row. Every .update()/.delete() on a table must therefore also
// filter on the owner, unless it is listed below WITH A REASON. A new unscoped write fails here.

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["lib", "services", "routes"];

const ALLOWED = [
  { file: "services/artifacts.service.js", has: '.from("artifacts").delete()',
    why: "runs right after assertOwnsArtifact(); legacy artifact rows may have a NULL user_id" },
  { file: "services/account.service.js", has: '.from("artifacts").delete().in("holding_id"',
    why: "account deletion: legacy artifacts have no user_id and are reached through the user's own holding ids" },
  { file: "services/push.service.js", has: "push_subscriptions",
    why: "system cleanup of a dead push endpoint reported by the push service (410/404)" },
  { file: "services/setu.service.js", has: "updateConsentUnscoped",
    why: "Setu webhook: no authenticated user on that request; keyed on the unguessable consent_id" },
  { file: "services/setu.service.js", has: '.from("setu_consents").update(patch).eq("consent_id", consentId);',
    why: "same unscoped webhook update" },
];

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
}

function findUnscoped() {
  const bad = [];
  for (const f of DIRS.flatMap(files)) {
    const rel = f.replaceAll("\\", "/");
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    const re = /\.(update|delete)\(/g; let m;
    while ((m = re.exec(s))) {
      const start = Math.max(s.lastIndexOf(";", m.index), s.lastIndexOf("\n\n", m.index));
      let end = s.indexOf(";", m.index); if (end < 0) end = m.index + 400;
      const stmt = s.slice(start + 1, end + 1);
      if (!/\.from\(\s*["'`]/.test(stmt)) continue;       // only supabase table writes (skips Buffer.from etc.)
      if (/user_id|userId|owner/.test(stmt)) continue;      // scoped
      const allowed = ALLOWED.some((a) => a.file === rel && stmt.includes(a.has));
      if (!allowed) bad.push(`${rel}:${s.slice(0, m.index).split("\n").length}  ${stmt.trim().replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  return bad;
}

describe("service-key writes are owner-scoped", () => {
  it("has no .update()/.delete() on a table without an owner filter (beyond the documented exceptions)", () => {
    expect(findUnscoped()).toEqual([]);
  });

  it("only server-generated or ownership-checked ids are used with upsert onConflict:'id'", () => {
    const allowedFiles = new Set(["services/plaid.service.js", "services/setu.service.js", "services/snaptrade.service.js"]); // plaid: id is server-made; setu + snaptrade: idsTakenByOthers()
    const offenders = DIRS.flatMap(files).map((f) => f.replaceAll("\\", "/")).filter((rel) => {
      const s = fs.readFileSync(path.join(ROOT, rel), "utf8");
      return /onConflict:\s*"id"/.test(s) && !allowedFiles.has(rel);
    });
    expect(offenders).toEqual([]);
  });

  it("snaptrade.service guards its id-keyed upsert with idsTakenByOthers", () => {
    const s = fs.readFileSync(path.join(ROOT, "services/snaptrade.service.js"), "utf8");
    expect((s.match(/idsTakenByOthers\(/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(s.indexOf("idsTakenByOthers(")).toBeLessThan(s.indexOf('onConflict: "id"'));
  });

  it("setu.service guards its id-keyed upserts with idsTakenByOthers", () => {
    const s = fs.readFileSync(path.join(ROOT, "services/setu.service.js"), "utf8");
    expect((s.match(/idsTakenByOthers\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
