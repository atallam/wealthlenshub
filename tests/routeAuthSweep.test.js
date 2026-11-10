import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Catches a route added without auth: every route on every router must be behind
// the `auth` middleware, either per-route or via router.use(auth) earlier in the stack.
// The service uses the Supabase service key (bypasses RLS), so a forgotten `auth`
// would expose data to anyone. Intentionally public routes are listed with a reason.
vi.mock("../lib/db.js", () => ({
  supabase: new Proxy({}, { get: () => () => ({}) }),
  describeDbError: () => ({}),
}));

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");

const PUBLIC = {
  "POST /webhook":    "Setu consent webhook - guarded by a shared secret (constant-time compare)",
  "GET /vapid-key":   "Web-push VAPID *public* key - public by design",
};

describe("every API route requires authentication", () => {
  const files = fs.readdirSync(routesDir).filter(f => f.endsWith(".js"));

  it("finds the route files", () => { expect(files.length).toBeGreaterThan(15); });

  it("has no unauthenticated routes beyond the documented public ones", async () => {
    const { auth } = await import("../lib/auth.js");
    const open = [];
    let routeCount = 0;

    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(routesDir, file)).href);
      const router = mod.default;
      if (!router?.stack) continue;
      let covered = false;
      for (const layer of router.stack) {
        if (!layer.route) { if (layer.handle === auth) covered = true; continue; }
        routeCount++;
        const guarded = covered || layer.route.stack.some(h => h.handle === auth);
        for (const method of Object.keys(layer.route.methods)) {
          const id = `${method.toUpperCase()} ${layer.route.path}`;
          if (!guarded && !PUBLIC[id]) open.push(`${file}: ${id}`);
        }
      }
    }
    expect(routeCount).toBeGreaterThan(80);
    expect(open).toEqual([]);
  });
});
