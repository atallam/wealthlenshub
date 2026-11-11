// Flags source files that have grown too large to review comfortably.
// Warn-only by default (GitHub shows ::warning annotations); pass --strict to fail the build.
import fs from "fs";
import path from "path";

const LIMIT = Number(process.env.MAX_FILE_LINES || 800);
const ROOTS = ["src", "lib", "routes", "services", "hooks"];
const EXT = new Set([".js", ".jsx"]);
const strict = process.argv.includes("--strict");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

const big = ROOTS.flatMap((r) => walk(r))
  .map((f) => ({ f, n: fs.readFileSync(f, "utf8").split("\n").length }))
  .filter((x) => x.n > LIMIT)
  .sort((a, b) => b.n - a.n);

for (const { f, n } of big) console.log(`::warning file=${f}::${f} has ${n} lines (limit ${LIMIT}) - consider splitting`);
console.log(big.length ? `${big.length} file(s) over ${LIMIT} lines` : `All files within ${LIMIT} lines`);
if (strict && big.length) process.exit(1);
