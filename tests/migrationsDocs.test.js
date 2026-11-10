import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// migrations/README.md is the only record of apply-order (there is no migration tracker), so it
// must list every file, and only files that exist.
const DIR = path.resolve(__dirname, "..", "migrations");
const sqlFiles = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const readme = fs.readFileSync(path.join(DIR, "README.md"), "utf8");
const mentioned = new Set([...readme.matchAll(/`([A-Za-z0-9_]+\.sql)`/g)].map((m) => m[1]).filter((f) => !f.startsWith("NNNN")));   // NNNN_... is the naming placeholder

describe("migrations/README.md", () => {
  it("lists every .sql file in the folder", () => {
    expect(sqlFiles.filter((f) => !mentioned.has(f))).toEqual([]);
  });
  it("mentions only files that exist", () => {
    expect([...mentioned].filter((f) => !sqlFiles.includes(f))).toEqual([]);
  });
  it("numbered migrations are contiguous from 0009, and only 0010 and 0011 are shared", () => {
    const nums = sqlFiles.map((f) => f.match(/^(\d{4})_/)?.[1]).filter(Boolean).map(Number);
    const unique = [...new Set(nums)];
    expect(unique).toEqual(Array.from({ length: unique.length }, (_, i) => 9 + i));
    const dupes = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
    expect(dupes).toEqual([10, 11]);
  });
});
