import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Routes must report server errors through sendError(), which hides internal messages in
// production. A literal `res.status(5xx).json({ error: e.message })` leaks DB/stack details.
const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");
const LEAK = /status\(\s*5\d\d\s*\)\s*\.json\(\s*\{\s*error\s*:\s*(?:e|err|error|ex)\b[^}]*\.message/;

describe("routes do not leak raw server error messages", () => {
  for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith(".js"))) {
    it(file, () => {
      const lines = fs.readFileSync(path.join(routesDir, file), "utf8").split(/\r?\n/);
      const hits = lines.map((l, i) => LEAK.test(l) ? `${file}:${i + 1}: ${l.trim().slice(0, 100)}` : null).filter(Boolean);
      expect(hits).toEqual([]);
    });
  }
});
