/**
 * routes/mf.js — Mutual Fund portfolio overlap analysis
 *
 * POST /api/mf/overlap
 *   Body: { schemeCodes: string[] }   // 2–10 scheme codes from user's MF holdings
 *   Returns: { funds[], overlapMatrix[], topSharedStocks[] }
 *
 * Data source:
 *   Primary  — api.mfapi.in /mf/{code}/portfolio (when available)
 *   Fallback — AMFI monthly portfolio disclosure CSV (portal.amfiindia.com)
 *   Cache    — In-memory, 7-day TTL (portfolios change monthly)
 */

import { Router } from "express";
import { auth } from "../lib/auth.js";
import { timedFetch } from "../lib/prices.js";

const router = Router();
router.use(auth);

// ── In-memory cache: schemeCode → { name, holdings, fetchedAt } ────────────
const portfolioCache = new Map();
const CACHE_TTL_MS  = 7 * 24 * 3600 * 1000; // 7 days

// ── Fetch from mfapi.in (NAV meta gives fund name) ──────────────────────────
async function getFundMeta(code) {
  try {
    const r = await timedFetch(`https://api.mfapi.in/mf/${code}`, {}, 6000);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.meta?.scheme_name || null;
  } catch { return null; }
}

// ── Fetch portfolio from AMFI monthly disclosure ─────────────────────────────
// AMFI publishes CSV at: https://portal.amfiindia.com/DownloadSchemeData_Po.aspx
// The file is tab-delimited with a specific structure. We parse stocks section.
async function fetchFromAmfi(schemeCode) {
  try {
    // AMFI portfolio URL with scheme code
    const url = `https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0&tp=1&sc=${schemeCode}&pdt=1`;
    const r = await timedFetch(url, { headers: { "User-Agent": "WealthLensHub/1.0" } }, 12000);
    if (!r.ok) return [];
    const text = await r.text();

    // Parse: lines after header contain ISIN | Stock Name | % to NAV
    const lines = text.split(/\r?\n/);
    const holdings = [];
    let inData = false;
    for (const line of lines) {
      const parts = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      if (parts.length < 3) continue;
      const isin = (parts[0] || "").trim();
      if (!inData && /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) inData = true;
      if (!inData) continue;
      const name = (parts[1] || parts[2] || "").trim().replace(/^"|"$/g, "");
      const pct  = parseFloat((parts[parts.length - 2] || parts[parts.length - 1] || "0").replace(/[^0-9.]/g, ""));
      if (isin && name && pct > 0) holdings.push({ isin, name, pct });
    }
    return holdings.slice(0, 80); // cap at top 80 holdings
  } catch { return []; }
}

// ── Main portfolio resolver ─────────────────────────────────────────────────
async function resolvePortfolio(schemeCode) {
  const cached = portfolioCache.get(schemeCode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const name     = await getFundMeta(schemeCode);
  const holdings = await fetchFromAmfi(schemeCode);
  const entry    = { name: name || `Fund ${schemeCode}`, holdings, fetchedAt: Date.now() };
  portfolioCache.set(schemeCode, entry);
  return entry;
}

// ── Overlap computation ─────────────────────────────────────────────────────
function computePairOverlap(holdingsA, holdingsB) {
  if (!holdingsA.length || !holdingsB.length) return { count: 0, weightedPct: 0, jaccard: 0 };

  const mapA = new Map(holdingsA.map(h => [h.isin || h.name, h.pct]));
  const mapB = new Map(holdingsB.map(h => [h.isin || h.name, h.pct]));

  let overlap = 0, unionSum = 0;
  const shared = [];
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys) {
    const pA = mapA.get(key) || 0;
    const pB = mapB.get(key) || 0;
    const minV = Math.min(pA, pB);
    const maxV = Math.max(pA, pB);
    unionSum += maxV;
    if (pA > 0 && pB > 0) {
      overlap += minV;
      shared.push({ key, pA, pB, minV });
    }
  }

  shared.sort((a, b) => b.minV - a.minV);
  return {
    count:       shared.length,
    weightedPct: Math.round(overlap * 10) / 10,   // sum of min weights
    jaccard:     unionSum > 0 ? Math.round((overlap / unionSum) * 1000) / 10 : 0,
    topShared:   shared.slice(0, 15),
  };
}

// ── POST /api/mf/overlap ───────────────────────────────────────────────────
router.post("/overlap", async (req, res) => {
  const { schemeCodes } = req.body;
  if (!Array.isArray(schemeCodes) || schemeCodes.length < 2 || schemeCodes.length > 10) {
    return res.status(400).json({ error: "Provide 2–10 scheme codes." });
  }
  const codes = [...new Set(schemeCodes.map(String))];

  // Fetch all portfolios in parallel
  const resolved = await Promise.all(codes.map(async c => ({ code: c, ...(await resolvePortfolio(c)) })));

  // Build pairwise overlap matrix
  const matrix = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const pair = computePairOverlap(resolved[i].holdings, resolved[j].holdings);
      matrix.push({
        fundA: { code: resolved[i].code, name: resolved[i].name },
        fundB: { code: resolved[j].code, name: resolved[j].name },
        ...pair,
      });
    }
  }
  matrix.sort((a, b) => b.weightedPct - a.weightedPct);

  // Aggregate top shared stocks across all pairs
  const stockScore = new Map();
  for (const pair of matrix) {
    for (const s of pair.topShared || []) {
      const prev = stockScore.get(s.key) || { key: s.key, totalOverlap: 0, funds: 0 };
      stockScore.set(s.key, { ...prev, totalOverlap: prev.totalOverlap + s.minV, funds: prev.funds + 1 });
    }
  }
  const topSharedStocks = [...stockScore.values()]
    .sort((a, b) => b.totalOverlap - a.totalOverlap)
    .slice(0, 20);

  res.json({
    funds: resolved.map(r => ({
      code: r.code,
      name: r.name,
      holdingCount: r.holdings.length,
      dataAvailable: r.holdings.length > 0,
    })),
    matrix,
    topSharedStocks,
    cachedAt: new Date().toISOString(),
  });
});

export default router;
