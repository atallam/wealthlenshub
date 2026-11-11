import { createRequire } from "module";

// Lazy-load cheerio so the file doesn't hard-fail if not installed yet
let cheerio = null;
export async function getCheerio() {
  if (!cheerio) {
    const mod = await import("cheerio");
    cheerio = mod;
  }
  return cheerio;
}

// BSE codes map — ticker → BSE security code
const require = createRequire(import.meta.url);
export let BSE_CODES = {};
try {
  BSE_CODES = require("../../bse_codes.json");
} catch {
  console.warn("[concall/providers] bse_codes.json not found — BSE provider will use dynamic lookup only");
}

const FETCH_TIMEOUT_MS = 12_000;

export async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
