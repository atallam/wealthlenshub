export const TWELVE_KEY = process.env.TWELVE_DATA_KEY || "";
export const FX_FALLBACK = 94.5;

// ── Generic fetch with timeout ────────────────────────────────────────────────
export async function timedFetch(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── Yahoo Finance helpers ─────────────────────────────────────────────────────
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function yahooFetch(path) {
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await timedFetch(`https://${host}${path}`, { headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data?.finance?.error?.code === "Too Many Requests") continue;
      return data;
    } catch { continue; }
  }
  return null;
}

export async function yahooChart(symbol) {
  const data = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  return data?.chart?.result?.[0]?.meta || null;
}

export async function yahooSearch(q, count = 25) {
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${count}&newsCount=0&enableFuzzyQuery=true`);
  return data?.quotes || [];
}

export async function yahooPrice(symbol) {
  const meta = await yahooChart(symbol);
  return meta?.regularMarketPrice ?? meta?.chartPreviousClose ?? null;
}

// ── Twelve Data helpers ───────────────────────────────────────────────────────
export async function twelveSearch(q, exchange = "") {
  if (!TWELVE_KEY) return null;
  try {
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=20${exchange ? "&exchange=" + exchange : ""}`;
    const r = await timedFetch(url, { headers: { "Authorization": `apikey ${TWELVE_KEY}` } });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status === "error") return null;
    return data.data || [];
  } catch { return null; }
}

export async function twelveQuote(symbol) {
  if (!TWELVE_KEY) return null;
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_KEY}`;
    const r = await timedFetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status === "error" || !data.close) return null;
    return {
      name:     data.name || symbol,
      price:    parseFloat(data.close),
      exchange: data.exchange || "",
      currency: data.currency || "",
    };
  } catch { return null; }
}

// ── Stock price: Twelve Data → Yahoo ─────────────────────────────────────────
export async function stockPrice(symbol, marketSuffix = "") {
  const tdSymbol = marketSuffix ? symbol.replace(/\.(NS|BO)$/, "") : symbol;
  if (TWELVE_KEY) {
    const q = await twelveQuote(tdSymbol + (marketSuffix ? `:${marketSuffix}` : ""));
    if (q?.price) return q;
  }
  const meta = await yahooChart(symbol);
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
  if (!price) return null;
  return { name: meta.longName || meta.shortName || "", price, exchange: meta.exchangeName || "", currency: meta.currency || "" };
}

// ── Stock search: Twelve Data → Yahoo ────────────────────────────────────────
export async function stockSearch(q, market = "US") {
  if (TWELVE_KEY) {
    const exchange = market === "IN" ? "NSE,BSE" : "";
    const results = await twelveSearch(q, exchange);
    if (results?.length) {
      return results
        .filter(s => market === "IN"
          ? ["NSE","BSE"].includes(s.exchange)
          : !["NSE","BSE"].includes(s.exchange) && s.country === "United States")
        .filter(s => ["Common Stock","ETF","Equity"].includes(s.instrument_type || s.type))
        .slice(0, 12)
        .map(s => ({
          ticker:   s.symbol,
          symbol:   s.symbol,
          name:     s.instrument_name || s.symbol,
          exchange: s.exchange || "",
          type:     s.instrument_type || s.type || "EQUITY",
        }));
    }
  }
  const quotes = await yahooSearch(q);
  const ETF_KW = /etf|bees|fund|gold|nifty|sensex|index|midcap|smallcap|liquid|overnight|banking|silver|copper|nasdaq/i;
  return quotes
    .filter(qt => {
      if (market === "IN") {
        const onIN = qt.symbol?.endsWith(".NS") || qt.symbol?.endsWith(".BO") || qt.exchange === "NSI" || qt.exchange === "BSE";
        return onIN && (qt.quoteType === "EQUITY" || qt.quoteType === "ETF" || ETF_KW.test(qt.longname || ""));
      }
      const notIN = !qt.symbol?.endsWith(".NS") && !qt.symbol?.endsWith(".BO") && qt.exchange !== "NSI" && qt.exchange !== "BSE";
      return notIN && (qt.quoteType === "EQUITY" || qt.quoteType === "ETF");
    })
    .slice(0, 12)
    .map(qt => ({
      ticker:   market === "IN" ? (qt.symbol?.replace(/\.(NS|BO)$/, "") || qt.symbol) : qt.symbol,
      symbol:   qt.symbol,
      name:     qt.longname || qt.shortname || qt.symbol,
      exchange: qt.exchange || "",
      type:     qt.quoteType || "EQUITY",
    }));
}

// ── MF NAV: AMFI → MFAPI fallback ────────────────────────────────────────────
export async function fetchMfNav(schemeCode) {
  try {
    const r = await timedFetch("https://www.amfiindia.com/spages/NAVAll.txt", {}, 8000);
    if (r.ok) {
      const text = await r.text();
      for (const line of text.split("\n")) {
        const parts = line.split(";");
        if (parts[0]?.trim() === String(schemeCode)) {
          const nav = parseFloat(parts[4]);
          if (!isNaN(nav)) return { nav, date: parts[5]?.trim() || null, meta: { fund_house: "" }, source: "amfi" };
        }
      }
    }
  } catch { /* fall through */ }
  try {
    const r = await timedFetch(`https://api.mfapi.in/mf/${schemeCode}`, {}, 5000);
    if (r.ok) {
      const data = await r.json();
      const nav = parseFloat(data?.data?.[0]?.nav);
      if (!isNaN(nav)) return { nav, date: data?.data?.[0]?.date || null, meta: data?.meta || {}, source: "mfapi" };
    }
  } catch { /* fall through */ }
  return null;
}

// ── AMFI master list ──────────────────────────────────────────────────────────
let amfiCache = null;
let amfiCacheTime = 0;

export async function getAmfiList() {
  if (amfiCache && Date.now() - amfiCacheTime < 6 * 3600_000) return amfiCache;
  try {
    const r = await timedFetch("https://www.amfiindia.com/spages/NAVAll.txt", {}, 10000);
    if (r.ok) {
      const text = await r.text();
      const schemes = [];
      for (const line of text.split("\n")) {
        const parts = line.split(";");
        if (parts.length >= 5 && /^\d+$/.test(parts[0]?.trim())) {
          schemes.push({ scheme_code: parts[0].trim(), isin1: parts[1]?.trim() || "", isin2: parts[2]?.trim() || "", name: parts[3]?.trim() || "" });
        }
      }
      if (schemes.length > 100) {
        amfiCache = schemes;
        amfiCacheTime = Date.now();
        console.log(`📋 AMFI list cached from amfiindia.com: ${amfiCache.length} schemes`);
        return amfiCache;
      }
    }
  } catch { /* fall through */ }
  try {
    const r = await timedFetch("https://api.mfapi.in/mf", {}, 10000);
    if (r.ok) {
      const data = await r.json();
      amfiCache = (data || []).map(f => ({ scheme_code: String(f.schemeCode), name: f.schemeName }));
      amfiCacheTime = Date.now();
      console.log(`📋 AMFI list cached from MFAPI: ${amfiCache.length} schemes`);
    }
  } catch { /* keep stale */ }
  return amfiCache || [];
}

export function scoreMf(name, qLower, qWords) {
  const n = name.toLowerCase();
  if (n.startsWith(qLower)) return 100;
  if (n.includes(qLower)) return 80;
  const hits = qWords.filter(w => n.includes(w)).length;
  if (hits === qWords.length) return 60;
  return hits > 0 ? Math.round(40 * hits / qWords.length) : 0;
}

// ── FX rates ──────────────────────────────────────────────────────────────────
export const FX_CACHE = { rates: {}, ts: 0 };
export const FX_FALLBACKS = { INR: 94.5, EUR: 0.88, GBP: 0.76, SGD: 1.30, AED: 3.67, AUD: 1.50, JPY: 150.0, CAD: 1.38, CHF: 0.85 };

export async function fetchAllFxRates() {
  if (Date.now() - FX_CACHE.ts < 600_000 && Object.keys(FX_CACHE.rates).length > 0) return FX_CACHE.rates;
  try {
    const r = await timedFetch("https://open.er-api.com/v6/latest/USD", {}, 5000);
    if (r.ok) {
      const data = await r.json();
      if (data?.rates) { FX_CACHE.rates = data.rates; FX_CACHE.ts = Date.now(); return data.rates; }
    }
  } catch { /* fall through */ }
  return FX_FALLBACKS;
}

export async function fetchUsdInr() {
  const rates = await fetchAllFxRates();
  const rate = rates?.INR;
  if (rate && rate > 50 && rate < 200) return { rate, source: FX_CACHE.ts > 0 ? "exchangerate-api" : "fallback" };
  try {
    const yRate = await yahooPrice("USDINR=X");
    if (yRate && yRate > 50 && yRate < 200) return { rate: yRate, source: "yahoo" };
  } catch { /* fall through */ }
  return { rate: FX_FALLBACK, source: "hardcoded" };
}

export async function mfNav(schemeCode) {
  const result = await fetchMfNav(schemeCode);
  return result?.nav ?? null;
}
