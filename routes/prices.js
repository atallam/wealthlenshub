import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { fetchUsdInr, fetchAllFxRates, fetchMfNav, getAmfiList, scoreMf, stockSearch, stockPrice, yahooPrice, timedFetch, TWELVE_KEY, twelveQuote, mfNav } from "../lib/prices.js";
import { takeSnapshot } from "../lib/snapshot.js";
import { refreshUserHoldings } from "../lib/refresh.js";

const router = Router();

router.get("/forex/usdinr", auth, async (req, res) => {
  const result = await fetchUsdInr();
  res.json({ ...result, fetched_at: new Date().toISOString() });
});

router.get("/forex/rates", auth, async (req, res) => {
  const rates = await fetchAllFxRates();
  res.json({ rates, base: "USD", fetched_at: new Date().toISOString() });
});

router.post("/mf/sip-navs", auth, async (req, res) => {
  const { scheme_code, months } = req.body;
  if (!scheme_code || !months?.length) return res.status(400).json({ error: "scheme_code and months required" });
  try {
    const response = await timedFetch(`https://api.mfapi.in/mf/${scheme_code}`, {}, 10000);
    if (!response.ok) throw new Error("MFAPI unavailable");
    const data = await response.json();
    const navHistory = data?.data || [];
    const meta = data?.meta || {};
    const navMap = {};
    for (const entry of navHistory) navMap[entry.date] = parseFloat(entry.nav);
    const results = months.map(({ year, month, sip_date }) => {
      const isFuture = new Date(year, month - 1, sip_date) > new Date();
      if (isFuture) { const latestNav = navHistory[0] ? parseFloat(navHistory[0].nav) : null; return { year, month, sip_date, txn_date: `${year}-${String(month).padStart(2,'0')}-${String(sip_date).padStart(2,'0')}`, nav: latestNav, nav_date: navHistory[0]?.date || null, is_future: true, is_estimated: true }; }
      const dateKey = (yr, mo, dy) => { const d = new Date(yr, mo - 1, dy); return { key: `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`, iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }; };
      let fwdResult = null, bwdResult = null;
      for (let offset = 0; offset <= 7; offset++) {
        if (!fwdResult) { const { key, iso } = dateKey(year, month, sip_date + offset); if (navMap[key]) fwdResult = { offset, key, iso }; }
        if (!bwdResult && offset > 0) { const { key, iso } = dateKey(year, month, sip_date - offset); if (navMap[key]) bwdResult = { offset, key, iso }; }
        if (fwdResult && bwdResult) break;
      }
      const best = fwdResult && bwdResult ? (fwdResult.offset <= bwdResult.offset ? fwdResult : bwdResult) : (fwdResult || bwdResult);
      if (best) return { year, month, sip_date, txn_date: best.iso, nav: navMap[best.key], nav_date: best.key, is_future: false, is_estimated: best.offset > 0 };
      return { year, month, sip_date, txn_date: null, nav: null, is_future: false, is_estimated: false };
    });
    res.json({ results, fund_house: meta.fund_house || "", scheme_name: meta.scheme_name || "" });
  } catch (e) { sendError(res, e); }
});

router.get("/mf/nav/:schemeCode", auth, async (req, res) => {
  const result = await fetchMfNav(req.params.schemeCode);
  if (!result) return res.json({ nav: null });
  res.json({ nav: result.nav, date: result.date || null, fund_house: result.meta?.fund_house || "", scheme_category: result.meta?.scheme_category || "", scheme_type: result.meta?.scheme_type || "", source: result.source });
});

router.get("/mf/search", auth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  const qLower = q.toLowerCase(), qWords = qLower.split(/\s+/).filter(Boolean);
  const all = await getAmfiList();
  let results = all.map(f => ({ ...f, score: scoreMf(f.name, qLower, qWords) })).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);
  if (results.length < 5) {
    try {
      const r = await timedFetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`, {}, 4000);
      if (r.ok) { const data = await r.json(); const existing = new Set(results.map(x => x.scheme_code)); for (const f of (data || [])) { const sc = String(f.schemeCode); if (!existing.has(sc)) { results.push({ scheme_code: sc, name: f.schemeName, score: scoreMf(f.schemeName, qLower, qWords) }); existing.add(sc); } } results.sort((a, b) => (b.score || 0) - (a.score || 0)); }
    } catch { /* fall through */ }
  }
  res.json(results.slice(0, 15).map(f => ({ scheme_code: f.scheme_code, name: f.name })));
});

router.get("/etf/search", auth, async (req, res) => {
  const q = req.query.q || "";
  if (q.length < 2) return res.json([]);
  try {
    const results = await stockSearch(q, "IN");
    const ETF_KW = /etf|bees|fund|gold|nifty|sensex|index|junior|midcap|smallcap|liquid|overnight|banking|silver|copper|nasdaq/i;
    res.json(results.filter(s => s.type === "ETF" || s.type === "Exchange Traded Fund" || ETF_KW.test(s.name)));
  } catch (e) { sendError(res, e); }
});

router.get("/stock/search", auth, async (req, res) => {
  const { q, market } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try { res.json(await stockSearch(q, market || "US")); } catch (e) { sendError(res, e); }
});

router.get("/stock/info", auth, async (req, res) => {
  const { ticker, market } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  const t = ticker.toUpperCase();
  if (TWELVE_KEY) {
    const q = await twelveQuote(market === "IN" ? `${t}:NSE` : t);
    if (q?.price) return res.json({ found: true, ...q, symbol: t });
    if (market === "IN") { const q2 = await twelveQuote(`${t}:BSE`); if (q2?.price) return res.json({ found: true, ...q2, symbol: t }); }
  }
  const { yahooChart } = await import("../lib/prices.js");
  for (const symbol of market === "IN" ? [`${t}.NS`, `${t}.BO`] : [t]) {
    const meta = await yahooChart(symbol);
    if (!meta) continue;
    const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
    if (!price) continue;
    return res.json({ found: true, name: meta.longName || meta.shortName || "", price, currency: meta.currency || (market === "IN" ? "INR" : "USD"), exchange: meta.exchangeName || "", symbol: meta.symbol || symbol });
  }
  res.json({ found: false });
});

router.post("/prices/refresh", auth, async (req, res) => {
  try {
    const r = await refreshUserHoldings(req.user.id, { concurrency: 8 });
    res.json(r);
    // Auto-snapshot (direct call — no self-HTTP round-trip)
    takeSnapshot(req.user.id, { source: "price_refresh" })
      .catch(e => console.error("Auto-snapshot failed:", e.message));
  } catch (e) { sendError(res, e); }
});

// Benchmark overlay
router.get("/prices/benchmark", auth, async (req, res) => {
  const { symbol, range } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const { yahooFetch } = await import("../lib/prices.js");
    const validRange = ["1mo","3mo","6mo","1y","2y","5y","max"].includes(range) ? range : "1y";
    const data = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=${validRange}`);
    const result = data?.chart?.result?.[0];
    if (!result) return res.json({ timestamps: [], closes: [] });
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    res.json({ timestamps, closes, currency: result.meta?.currency || "USD", symbol: result.meta?.symbol || symbol });
  } catch (e) { sendError(res, e); }
});

export default router;
