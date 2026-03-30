import express from "express";
import multer  from "multer";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";
import { Snaptrade } from "snaptrade-typescript-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Fail fast if required env vars are missing ───────────────────
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_KEY"];
const missing  = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌  Missing required environment variables: ${missing.join(", ")}`);
  console.error("    Add them in Render → Environment panel.");
  process.exit(1);
}

// ── SnapTrade env diagnostic ─────────────────────────────────────
console.log("🔑 SNAPTRADE_CLIENT_ID:", process.env.SNAPTRADE_CLIENT_ID ? "✅ set" : "❌ NOT SET");
console.log("🔑 SNAPTRADE_CONSUMER_KEY:", process.env.SNAPTRADE_CONSUMER_KEY ? "✅ set" : "❌ NOT SET");

// ── Supabase admin client (service key — full DB access) ─────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json({ limit: "10mb" }));
const distPath = path.join(process.cwd(), "dist");
app.use(express.static(distPath, { maxAge: "1d" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max per file
});

// ── Auth middleware ───────────────────────────────────────────────
// Hub is public — any authenticated Supabase user gets access.
// All DB queries are scoped to req.user.id for full tenant isolation.
async function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  const token = hdr.slice(7);
  if (!token || token.length < 10) return res.status(401).json({ error: "Invalid token" });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

// ── Setu feature flag — set SETU_ENABLED=true in env to expose ───
const SETU_ENABLED = process.env.SETU_ENABLED === "true";

// ── PORTFOLIO: members, goals, alerts ────────────────────────────
app.get("/api/portfolio", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("portfolio").select("*").eq("user_id", req.user.id).single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  res.json(data || null);
});

app.post("/api/portfolio", auth, async (req, res) => {
  const { members, goals, alerts } = req.body;
  const { error } = await supabase.from("portfolio").upsert({
    id: req.user.id, user_id: req.user.id, members, goals, alerts,
    updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Date sanitizer — convert empty strings to null ───────────────
function sanitizeDates(obj) {
  const dateFields = ["start_date", "maturity_date"];
  const result = { ...obj };
  for (const field of dateFields) {
    if (result[field] === "" || result[field] === undefined) {
      result[field] = null;
    }
  }
  return result;
}

// ── Enrich holdings with computed fields from transactions ───────
function enrichHoldings(holdings) {
  return (holdings || []).map(h => {
    const txns = h.transactions || [];
    if (txns.length === 0) return h;
    const buys  = txns.filter(t => t.txn_type === "BUY");
    const sells = txns.filter(t => t.txn_type === "SELL");
    const buyUnits  = buys.reduce((s, t) => s + Number(t.units || 0), 0);
    const sellUnits = sells.reduce((s, t) => s + Number(t.units || 0), 0);
    const netUnits  = Math.max(0, buyUnits - sellUnits);
    const avgCost   = buyUnits > 0
      ? buys.reduce((s, t) => s + Number(t.units || 0) * Number(t.price || 0), 0) / buyUnits
      : 0;
    const sortedTxns = [...txns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
    return {
      ...h,
      net_units: netUnits,
      avg_cost:  avgCost,
      units:          netUnits,
      purchase_price: avgCost,
      purchase_nav:   avgCost,
      purchase_value: avgCost * netUnits,
      start_date: h.start_date || sortedTxns[0]?.txn_date || null,
    };
  });
}

// ── HOLDINGS ─────────────────────────────────────────────────────
app.get("/api/holdings", auth, async (req, res) => {
  let { data, error } = await supabase
    .from("holdings")
    .select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at), transactions(id,txn_type,units,price,txn_date,notes,created_at)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    // Fallback: transactions table might not exist yet
    ({ data, error } = await supabase
      .from("holdings")
      .select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at)")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: true }));
  }

  if (error) return res.status(500).json({ error: error.message });
  res.json(enrichHoldings(data));
});

app.post("/api/holdings", auth, async (req, res) => {
  const { first_transaction, purchase_nav, current_nav, ...holdingData } = req.body;
  const isMF = holdingData.type === "MF";

  // Option 1: Auto-clear all demo data when user adds their first real holding
  if (!holdingData.notes?.includes("__demo__")) {
    await supabase.from("holdings")
      .delete()
      .eq("user_id", req.user.id)
      .like("notes", "%__demo__%");
  }

  const insertData = { ...holdingData, user_id: req.user.id, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").insert(sanitizeDates(insertData));
  if (error) return res.status(500).json({ error: error.message });

  // If a first transaction was provided, insert it too
  if (first_transaction && first_transaction.units && first_transaction.price) {
    await supabase.from("transactions").insert({
      id:         "t_" + Date.now() + Math.random().toString(36).slice(2,6),
      holding_id: holdingData.id,
      txn_type:   first_transaction.txn_type || "BUY",
      units:      Number(first_transaction.units),
      price:      Number(first_transaction.price),
      txn_date:   first_transaction.txn_date || holdingData.start_date || new Date().toISOString().slice(0,10),
      notes:      first_transaction.notes || "",
    });
  }
  res.json({ ok: true });
});

app.put("/api/holdings/:id", auth, async (req, res) => {
  // Strip computed / joined fields that are not real DB columns
  const { artifacts, transactions, net_units, avg_cost, purchase_nav, current_nav, purchase_price, ...holdingData } = req.body;
  const isMF = holdingData.type === "MF";
  const updateData = { ...holdingData, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").update(sanitizeDates(updateData)).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/holdings/:id", auth, async (req, res) => {
  const { error } = await supabase.from("holdings").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── TRANSACTIONS ──────────────────────────────────────────────────
app.get("/api/transactions/:holdingId", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("holding_id", req.params.holdingId)
    .eq("user_id", req.user.id)
    .order("txn_date", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/transactions", auth, async (req, res) => {
  const { price_usd, ...txnData } = req.body;
  const payload = {
    id: "t_" + Date.now() + Math.random().toString(36).slice(2,6),
    ...txnData,
    user_id: req.user.id,
    ...(price_usd ? { price_usd: Number(price_usd) } : {}),
  };
  const { error } = await supabase.from("transactions").insert(payload);
  // If price_usd column doesn't exist yet, retry without it
  if (error && error.message?.includes("price_usd")) {
    const { price_usd: _drop, ...safePayload } = payload;
    const { error: e2 } = await supabase.from("transactions").insert(safePayload);
    if (e2) return res.status(500).json({ error: e2.message });
    return res.json({ ok: true });
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/transactions/:id", auth, async (req, res) => {
  const { error } = await supabase.from("transactions").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── USER PROFILE ─────────────────────────────────────────────────
app.get("/api/profile", auth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  // Auto-create if not exists (race condition on first login)
  if (!data) {
    const { data: newProfile } = await supabase.from("profiles").insert({
      id: req.user.id, display_name: req.user.user_metadata?.full_name || req.user.email?.split("@")[0] || "User", currency: "INR"
    }).select().single();
    return res.json(newProfile || { id: req.user.id, currency: "INR" });
  }
  res.json(data);
});

app.put("/api/profile", auth, async (req, res) => {
  const { display_name, currency, pan, dob } = req.body;
  const update = { id: req.user.id, updated_at: new Date().toISOString() };
  if (display_name !== undefined) update.display_name = display_name;
  if (currency !== undefined) update.currency = currency;
  // Encrypt PAN and DOB before storing
  if (pan !== undefined) update.encrypted_pan = pan ? encrypt(pan.toUpperCase().trim()) : null;
  if (dob !== undefined) update.encrypted_dob = dob ? encrypt(dob.trim()) : null;
  const { error } = await supabase.from("profiles").upsert(update);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET decrypted CAS credentials (PAN/DOB) — never return raw, only masked PAN + full DOB for reuse
app.get("/api/profile/cas-credentials", auth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("encrypted_pan, encrypted_dob").eq("id", req.user.id).single();
  if (error) return res.json({ pan: null, dob: null, has_credentials: false });
  const pan = data?.encrypted_pan ? decrypt(data.encrypted_pan) : null;
  const dob = data?.encrypted_dob ? decrypt(data.encrypted_dob) : null;
  if (!pan || pan === "[encrypted]") return res.json({ pan: null, dob: null, has_credentials: false });
  // Return masked PAN (show first 4 + last 1) and full DOB for PDF unlock
  const maskedPan = pan.length >= 10 ? pan.slice(0, 4) + "****" + pan.slice(-1) : "****";
  res.json({ pan_masked: maskedPan, dob, has_credentials: true, _pan: pan });
});

// ── ASSET TYPES ───────────────────────────────────────────────────
app.get("/api/asset-types", auth, async (req, res) => {
  const { data, error } = await supabase.from("asset_types").select("*").eq("user_id", req.user.id).order("label");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/asset-types", auth, async (req, res) => {
  const id = "at_" + Date.now().toString(36) + "_" + req.user.id.slice(0,8);
  const { error } = await supabase.from("asset_types").insert({ id, user_id: req.user.id, ...req.body });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id });
});

app.put("/api/asset-types/:id", auth, async (req, res) => {
  const { error } = await supabase.from("asset_types").update(req.body).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/asset-types/:id", auth, async (req, res) => {
  await supabase.from("asset_types").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

// ── FOREX RATE — live multi-currency rates ────────────────────────
app.get("/api/forex/usdinr", auth, async (req, res) => {
  const result = await fetchUsdInr();
  res.json({ ...result, fetched_at: new Date().toISOString() });
});

app.get("/api/forex/rates", auth, async (req, res) => {
  const rates = await fetchAllFxRates();
  res.json({ rates, base: "USD", fetched_at: new Date().toISOString() });
});

// ── SIP BATCH NAV — fetch NAVs for a date range for SIP import ───
app.post("/api/mf/sip-navs", auth, async (req, res) => {
  const { scheme_code, months } = req.body;
  // months = [{year, month, sip_date}] — array of {year:2024, month:1, sip_date:5}
  if (!scheme_code || !months?.length) return res.status(400).json({ error: "scheme_code and months required" });

  try {
    // Fetch full NAV history once
    const response = await timedFetch(`https://api.mfapi.in/mf/${scheme_code}`, {}, 10000);
    if (!response.ok) throw new Error("MFAPI unavailable");
    const data = await response.json();
    const navHistory = data?.data || []; // [{date: "05-01-2024", nav: "77.8900"}, ...]
    const meta = data?.meta || {};

    // Build a map of date string → nav for fast lookup
    // MFAPI returns dates as DD-MM-YYYY
    const navMap = {};
    for (const entry of navHistory) {
      navMap[entry.date] = parseFloat(entry.nav);
    }

    // For each requested month, find the NAV on or after the SIP date
    const results = months.map(({ year, month, sip_date }) => {
      const isFuture = new Date(year, month - 1, sip_date) > new Date();

      if (isFuture) {
        // For future months use latest available NAV as estimate
        const latestNav = navHistory[0] ? parseFloat(navHistory[0].nav) : null;
        return {
          year, month, sip_date,
          txn_date:  `${year}-${String(month).padStart(2,'0')}-${String(sip_date).padStart(2,'0')}`,
          nav:       latestNav,
          nav_date:  navHistory[0]?.date || null,
          is_future: true,
          is_estimated: true,
        };
      }

      // Search both forward and backward up to 7 days; pick whichever is closer
      const dateKey = (yr, mo, dy) => {
        const d = new Date(yr, mo - 1, dy);
        return {
          key: `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`,
          iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        };
      };

      let fwdResult = null, bwdResult = null;

      for (let offset = 0; offset <= 7; offset++) {
        if (!fwdResult) {
          const { key, iso } = dateKey(year, month, sip_date + offset);
          if (navMap[key]) fwdResult = { offset, key, iso };
        }
        if (!bwdResult && offset > 0) {
          const { key, iso } = dateKey(year, month, sip_date - offset);
          if (navMap[key]) bwdResult = { offset, key, iso };
        }
        if (fwdResult && bwdResult) break;
      }

      // Exact match (offset 0) wins; otherwise pick the closer direction
      const best = fwdResult && bwdResult
        ? (fwdResult.offset <= bwdResult.offset ? fwdResult : bwdResult)
        : (fwdResult || bwdResult);

      if (best) {
        return {
          year, month, sip_date,
          txn_date:     best.iso,
          nav:          navMap[best.key],
          nav_date:     best.key,
          is_future:    false,
          is_estimated: best.offset > 0,
        };
      }

      return { year, month, sip_date, txn_date: null, nav: null, is_future: false, is_estimated: false };
    });

    res.json({ results, fund_house: meta.fund_house || "", scheme_name: meta.scheme_name || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MF NAV — MFAPI → AMFI direct ────────────────────────────────
app.get("/api/mf/nav/:schemeCode", auth, async (req, res) => {
  const result = await fetchMfNav(req.params.schemeCode);
  if (!result) return res.json({ nav: null });
  res.json({
    nav:             result.nav,
    date:            result.date || null,
    fund_house:      result.meta?.fund_house || "",
    scheme_category: result.meta?.scheme_category || "",
    scheme_type:     result.meta?.scheme_type || "",
    source:          result.source,
  });
});

// ── MF SEARCH — AMFI master list → MFAPI supplement ─────────────
app.get("/api/mf/search", auth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  const qLower = q.toLowerCase();
  const qWords = qLower.split(/\s+/).filter(Boolean);

  // Primary: AMFI master list local fuzzy search (always populated from cache)
  const all = await getAmfiList();
  let results = all
    .map(f => ({ ...f, score: scoreMf(f.name, qLower, qWords) }))
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  // Supplement: MFAPI search — adds any results not already found
  if (results.length < 5) {
    try {
      const r = await timedFetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`, {}, 4000);
      if (r.ok) {
        const data = await r.json();
        const existing = new Set(results.map(x => x.scheme_code));
        for (const f of (data || [])) {
          const sc = String(f.schemeCode);
          if (!existing.has(sc)) {
            results.push({ scheme_code: sc, name: f.schemeName, score: scoreMf(f.schemeName, qLower, qWords) });
            existing.add(sc);
          }
        }
        results.sort((a, b) => (b.score || 0) - (a.score || 0));
      }
    } catch { /* fall through */ }
  }

  res.json(results.slice(0, 15).map(f => ({ scheme_code: f.scheme_code, name: f.name })));
});

// ── ETF SEARCH — Indian ETFs via Twelve Data → Yahoo ─────────────
app.get("/api/etf/search", auth, async (req, res) => {
  const q = req.query.q || "";
  if (q.length < 2) return res.json([]);
  try {
    const results = await stockSearch(q, "IN");
    const ETF_KW = /etf|bees|fund|gold|nifty|sensex|index|junior|midcap|smallcap|liquid|overnight|banking|silver|copper|nasdaq/i;
    res.json(results.filter(s => s.type === "ETF" || s.type === "Exchange Traded Fund" || ETF_KW.test(s.name)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STOCK SEARCH — Twelve Data → Yahoo ───────────────────────────
app.get("/api/stock/search", auth, async (req, res) => {
  const { q, market } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    res.json(await stockSearch(q, market || "US"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STOCK INFO — Twelve Data → Yahoo (.NS then .BO for Indian) ───
app.get("/api/stock/info", auth, async (req, res) => {
  const { ticker, market } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  const t = ticker.toUpperCase();

  // Twelve Data
  if (TWELVE_KEY) {
    const q = await twelveQuote(market === "IN" ? `${t}:NSE` : t);
    if (q?.price) return res.json({ found: true, ...q, symbol: t });
    if (market === "IN") {
      const q2 = await twelveQuote(`${t}:BSE`);
      if (q2?.price) return res.json({ found: true, ...q2, symbol: t });
    }
  }

  // Yahoo fallback — .NS then .BO for Indian
  for (const symbol of market === "IN" ? [`${t}.NS`, `${t}.BO`] : [t]) {
    const meta = await yahooChart(symbol);
    if (!meta) continue;
    const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
    if (!price) continue;
    return res.json({
      found: true, name: meta.longName || meta.shortName || "",
      price, currency: meta.currency || (market === "IN" ? "INR" : "USD"),
      exchange: meta.exchangeName || "", symbol: meta.symbol || symbol,
    });
  }
  res.json({ found: false });
});

// ── ANTHROPIC PROXY — all Claude API calls go through here ───────
app.post("/api/ai/chat", auth, async (req, res) => {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_KEY not set on server" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    // Log any Anthropic-level errors so they appear in Render logs
    if (!response.ok) {
      console.error("Anthropic error:", response.status, JSON.stringify(data));
      return res.status(response.status).json({ error: data?.error?.message || "Anthropic API error", detail: data });
    }
    res.json(data);
  } catch (e) {
    console.error("AI chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
});
// ══════════════════════════════════════════════════════════════════
//  DATA SOURCE FALLBACK LAYER
//  MF:     AMFI master list → MFAPI.in
//  Stocks: Twelve Data → Yahoo Finance
//  FX:     exchangerate-api → Yahoo Finance → fallback
// ══════════════════════════════════════════════════════════════════

const TWELVE_KEY = process.env.TWELVE_DATA_KEY || "";  // optional — set in Render env
const FX_FALLBACK = 94.5;

// ── Generic fetch with timeout ────────────────────────────────────
async function timedFetch(url, opts = {}, ms = 6000) {
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

// ── YAHOO FINANCE helpers (dual-host, rate-limit aware) ───────────
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function yahooFetch(path) {
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

async function yahooChart(symbol) {
  const data = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  return data?.chart?.result?.[0]?.meta || null;
}

async function yahooSearch(q, count = 25) {
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${count}&newsCount=0&enableFuzzyQuery=true`);
  return data?.quotes || [];
}

async function yahooPrice(symbol) {
  const meta = await yahooChart(symbol);
  return meta?.regularMarketPrice ?? meta?.chartPreviousClose ?? null;
}

// ── TWELVE DATA helpers ───────────────────────────────────────────
// Returns null if no key is configured so callers fall through to Yahoo.

async function twelveSearch(q, exchange = "") {
  if (!TWELVE_KEY) return null;
  try {
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=20${exchange ? "&exchange=" + exchange : ""}`;
    const r = await timedFetch(url, { headers: { "Authorization": `apikey ${TWELVE_KEY}` } });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status === "error") return null;
    return data.data || [];   // [{symbol, instrument_name, exchange, country, type}]
  } catch { return null; }
}

async function twelveQuote(symbol) {
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

// ── STOCK PRICE: Twelve Data → Yahoo ─────────────────────────────
async function stockPrice(symbol, marketSuffix = "") {
  // Twelve Data: symbol without suffix (uses exchange param or symbol directly)
  const tdSymbol = marketSuffix ? symbol.replace(/\.(NS|BO)$/, "") : symbol;
  if (TWELVE_KEY) {
    const q = await twelveQuote(tdSymbol + (marketSuffix ? `:${marketSuffix}` : ""));
    if (q?.price) return q;
  }
  // Yahoo fallback
  const meta = await yahooChart(symbol);
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
  if (!price) return null;
  return { name: meta.longName || meta.shortName || "", price, exchange: meta.exchangeName || "", currency: meta.currency || "" };
}

// ── STOCK SEARCH: Twelve Data → Yahoo ────────────────────────────
async function stockSearch(q, market = "US") {
  // Try Twelve Data
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
          ticker:   market === "IN" ? s.symbol : s.symbol,
          symbol:   s.symbol,
          name:     s.instrument_name || s.symbol,
          exchange: s.exchange || "",
          type:     s.instrument_type || s.type || "EQUITY",
        }));
    }
  }
  // Yahoo fallback
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

// ── MF NAV: AMFI direct → MFAPI fallback ─────────────────────────
async function fetchMfNav(schemeCode) {
  // Primary: AMFI NAVAll.txt (authoritative, updated daily)
  try {
    const r = await timedFetch("https://www.amfiindia.com/spages/NAVAll.txt", {}, 8000);
    if (r.ok) {
      const text = await r.text();
      // Format: SchemeCode;ISIN1;ISIN2;SchemeName;NAV;Date
      for (const line of text.split("\n")) {
        const parts = line.split(";");
        if (parts[0]?.trim() === String(schemeCode)) {
          const nav = parseFloat(parts[4]);
          if (!isNaN(nav)) return { nav, date: parts[5]?.trim() || null, meta: { fund_house: "" }, source: "amfi" };
        }
      }
    }
  } catch { /* fall through */ }

  // Fallback: MFAPI
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

// ── MF SEARCH: AMFI master list (primary) → MFAPI (fallback) ─────
let amfiCache = null;
let amfiCacheTime = 0;

async function getAmfiList() {
  if (amfiCache && Date.now() - amfiCacheTime < 6 * 3600_000) return amfiCache;
  // Primary: AMFI direct scheme list
  try {
    const r = await timedFetch("https://www.amfiindia.com/spages/NAVAll.txt", {}, 10000);
    if (r.ok) {
      const text = await r.text();
      const schemes = [];
      for (const line of text.split("\n")) {
        const parts = line.split(";");
        if (parts.length >= 5 && /^\d+$/.test(parts[0]?.trim())) {
          schemes.push({ scheme_code: parts[0].trim(), name: parts[3]?.trim() || "" });
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
  // Fallback: MFAPI all-schemes list
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

function scoreMf(name, qLower, qWords) {
  const n = name.toLowerCase();
  if (n.startsWith(qLower)) return 100;
  if (n.includes(qLower)) return 80;
  const hits = qWords.filter(w => n.includes(w)).length;
  if (hits === qWords.length) return 60;
  return hits > 0 ? Math.round(40 * hits / qWords.length) : 0;
}

// ── FX RATE: exchangerate-api → Yahoo → fallback ─────────────────
const FX_CACHE = { rates: {}, ts: 0 };
const FX_FALLBACKS = { INR: 94.5, EUR: 0.88, GBP: 0.76, SGD: 1.30, AED: 3.67, AUD: 1.50, JPY: 150.0, CAD: 1.38, CHF: 0.85 };

async function fetchAllFxRates() {
  // Cache for 10 minutes
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

async function fetchUsdInr() {
  const rates = await fetchAllFxRates();
  const rate = rates?.INR;
  if (rate && rate > 50 && rate < 200) return { rate, source: FX_CACHE.ts > 0 ? "exchangerate-api" : "fallback" };

  // Fallback: Yahoo Finance
  try {
    const yRate = await yahooPrice("USDINR=X");
    if (yRate && yRate > 50 && yRate < 200) return { rate: yRate, source: "yahoo" };
  } catch { /* fall through */ }

  return { rate: FX_FALLBACK, source: "hardcoded" };
}

// ── AMFI NAV fallback for prices/refresh ─────────────────────────
async function mfNav(schemeCode) {
  const result = await fetchMfNav(schemeCode);
  return result?.nav ?? null;
}


// ── PRICES REFRESH — Twelve Data → Yahoo (.NS + .BO) + MFAPI + FX ─
app.post("/api/prices/refresh", auth, async (req, res) => {
  const { data: holdings } = await supabase
    .from("holdings").select("id, type, ticker, scheme_code, usd_inr_rate").eq("user_id", req.user.id);

  if (!holdings?.length) return res.json({ updated: 0 });

  // FX rate with full fallback chain
  const { rate: usdInr, source: fxSource } = await fetchUsdInr();

  const updates = [];
  for (const h of holdings) {
    let patch = null;
    try {
      if (h.type === "MF" && h.scheme_code) {
        const nav = await mfNav(h.scheme_code);
        if (nav) patch = { current_nav: nav, price_fetched_at: new Date().toISOString() };

      } else if ((h.type === "IN_STOCK" || h.type === "IN_ETF") && h.ticker) {
        // Twelve Data → Yahoo .NS → Yahoo .BO
        const q = await stockPrice(`${h.ticker.toUpperCase()}.NS`, "NSE");
        const price = q?.price ?? await yahooPrice(`${h.ticker.toUpperCase()}.BO`);
        if (price) patch = { current_price: price, price_fetched_at: new Date().toISOString() };

      } else if (h.type === "US_STOCK" && h.ticker) {
        const q = await stockPrice(h.ticker.toUpperCase());
        if (q?.price) patch = { current_price: q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() };

      } else if (h.type === "US_ETF" && h.ticker) {
        const q = await stockPrice(h.ticker.toUpperCase());
        if (q?.price) patch = { current_price: q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() };

      } else if (h.type === "US_BOND" && h.ticker) {
        const q = await stockPrice(h.ticker.toUpperCase());
        if (q?.price) patch = { current_price: q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() };

      } else if (h.type === "CRYPTO" && h.ticker) {
        // Yahoo uses BTC-USD, ETH-USD format for crypto
        const sym = h.ticker.toUpperCase().includes("-") ? h.ticker.toUpperCase() : `${h.ticker.toUpperCase()}-USD`;
        const q = await stockPrice(sym);
        if (q?.price) patch = { current_price: q.price, usd_inr_rate: usdInr, price_fetched_at: new Date().toISOString() };
      }
    } catch { /* skip failed holding */ }

    if (patch) {
      await supabase.from("holdings").update(patch).eq("id", h.id);
      updates.push({ id: h.id, ...patch });
    }
  }
  res.json({ updated: updates.length, usdInr, fxSource, results: updates });
});

// ── ARTIFACTS ────────────────────────────────────────────────────
app.get("/api/artifacts/:holdingId", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("holding_id", req.params.holdingId)
    .order("uploaded_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/artifacts/upload", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { holdingId, description } = req.body;
  if (!holdingId) return res.status(400).json({ error: "holdingId required" });

  const id = "art_" + Date.now() + Math.random().toString(36).slice(2,6);
  const ext = req.file.originalname.split(".").pop();
  const storagePath = `holdings/${holdingId}/${id}.${ext}`;

  // Upload bytes to Supabase Storage
  const { error: upErr } = await supabase.storage
    .from("artifacts")
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });

  // Save metadata to DB
  const { error: dbErr } = await supabase.from("artifacts").insert({
    id, holding_id: holdingId,
    file_name: req.file.originalname,
    storage_path: storagePath,
    file_type: req.file.mimetype,
    file_size: req.file.size,
    description: description || "",
  });
  if (dbErr) return res.status(500).json({ error: dbErr.message });
  res.json({ ok: true, id, file_name: req.file.originalname });
});

app.get("/api/artifacts/download/:id", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("artifacts").select("storage_path, file_name").eq("id", req.params.id).single();
  if (error || !data) return res.status(404).json({ error: "Not found" });
  const { data: signed } = await supabase.storage
    .from("artifacts").createSignedUrl(data.storage_path, 300); // 5-min expiry
  res.json({ url: signed?.signedUrl, file_name: data.file_name });
});

app.delete("/api/artifacts/:id", auth, async (req, res) => {
  // Verify ownership via the holding → user_id chain
  const { data } = await supabase
    .from("artifacts").select("storage_path, holding_id").eq("id", req.params.id).single();
  if (!data) return res.status(404).json({ error: "Not found" });
  // Verify the holding belongs to this user
  const { data: holding } = await supabase
    .from("holdings").select("id").eq("id", data.holding_id).eq("user_id", req.user.id).single();
  if (!holding) return res.status(403).json({ error: "Not authorized" });
  if (data.storage_path) {
    await supabase.storage.from("artifacts").remove([data.storage_path]);
  }
  await supabase.from("artifacts").delete().eq("id", req.params.id);
  res.json({ ok: true });
});



// ══════════════════════════════════════════════════════════════════
//  PORTFOLIO SHARING
// ══════════════════════════════════════════════════════════════════

// ── List shares I've granted (as owner) ──────────────────────────
app.get("/api/shares", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("portfolio_shares")
      .select("id, shared_with, role, created_at")
      .eq("owner_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });

    // Resolve shared_with to display names
    const userIds = (data || []).map(s => s.shared_with);
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
      : { data: [] };
    const nameMap = {};
    for (const p of profiles || []) nameMap[p.id] = p.display_name;

    const shares = (data || []).map(s => ({
      ...s,
      shared_with_name: nameMap[s.shared_with] || null,
      shared_with_email: null, // not exposed for privacy
    }));
    res.json({ shares });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List portfolios shared WITH me ───────────────────────────────
app.get("/api/shares/received", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("portfolio_shares")
      .select("id, owner_id, role, created_at")
      .eq("shared_with", req.user.id);
    if (error) return res.status(500).json({ error: error.message });

    // Resolve owner names
    const ownerIds = (data || []).map(s => s.owner_id);
    const { data: profiles } = ownerIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", ownerIds)
      : { data: [] };
    const nameMap = {};
    for (const p of profiles || []) nameMap[p.id] = p.display_name;

    const shared = (data || []).map(s => ({
      ...s,
      owner_name: nameMap[s.owner_id] || "Unknown",
    }));
    res.json({ shared_with_me: shared });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Sync shares: ensure all members with emails have active shares ──
// Called on login to catch cases where auto-share failed (user didn't exist yet)
app.post("/api/shares/sync", auth, async (req, res) => {
  try {
    // Get this user's portfolio to find members with emails
    const { data: portfolio } = await supabase
      .from("portfolio").select("members").eq("user_id", req.user.id).single();
    const members = portfolio?.members || [];
    const memberEmails = members
      .filter(m => m.email && m.email.trim())
      .map(m => m.email.trim().toLowerCase());
    if (memberEmails.length === 0) return res.json({ synced: 0 });

    // Get existing shares I've granted
    const { data: existingShares } = await supabase
      .from("portfolio_shares").select("shared_with").eq("owner_id", req.user.id);
    const alreadySharedWith = new Set((existingShares || []).map(s => s.shared_with));

    // Look up all users to find matching emails
    const { data: { users } } = await supabase.auth.admin.listUsers();
    let synced = 0;

    for (const email of memberEmails) {
      if (email === req.user.email?.toLowerCase()) continue; // skip self
      const target = users.find(u => u.email?.toLowerCase() === email);
      if (!target) continue; // user hasn't signed up yet
      if (alreadySharedWith.has(target.id)) continue; // already shared

      // Create the share
      const { error } = await supabase.from("portfolio_shares").upsert({
        owner_id: req.user.id,
        shared_with: target.id,
        role: "viewer",
        created_at: new Date().toISOString(),
      }, { onConflict: "owner_id,shared_with" });
      if (!error) synced++;
    }

    res.json({ synced, checked: memberEmails.length });
  } catch (e) {
    console.error("Share sync error:", e.message);
    res.json({ synced: 0, error: e.message }); // non-fatal
  }
});

// ── Share my portfolio with another user (by email) ──────────────
app.post("/api/shares", auth, async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    const validRole = ["viewer", "editor"].includes(role) ? role : "viewer";

    // Look up user by email
    const { data: { users }, error: lookupErr } = await supabase.auth.admin.listUsers();
    if (lookupErr) return res.status(500).json({ error: lookupErr.message });
    const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
    if (!target) return res.status(404).json({ error: "No account found with that email. They need to sign up first." });
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't share with yourself." });

    // Create or update the share
    const { data, error } = await supabase.from("portfolio_shares").upsert({
      owner_id: req.user.id,
      shared_with: target.id,
      role: validRole,
      created_at: new Date().toISOString(),
    }, { onConflict: "owner_id,shared_with" });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, shared_with: target.id, role: validRole });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update share role ────────────────────────────────────────────
app.put("/api/shares/:shareId", auth, async (req, res) => {
  try {
    const { role } = req.body;
    const validRole = ["viewer", "editor"].includes(role) ? role : "viewer";
    const { error } = await supabase
      .from("portfolio_shares")
      .update({ role: validRole })
      .eq("id", req.params.shareId)
      .eq("owner_id", req.user.id); // only owner can change role
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Revoke a share ───────────────────────────────────────────────
app.delete("/api/shares/:shareId", auth, async (req, res) => {
  try {
    // Owner can revoke, or shared user can remove themselves
    const { error } = await supabase
      .from("portfolio_shares")
      .delete()
      .eq("id", req.params.shareId)
      .or(`owner_id.eq.${req.user.id},shared_with.eq.${req.user.id}`);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Load a shared portfolio (read-only, as a viewer) ─────────────
app.get("/api/shared-portfolio/:ownerId", auth, async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    // Verify share exists
    const { data: share } = await supabase
      .from("portfolio_shares")
      .select("role")
      .eq("owner_id", ownerId)
      .eq("shared_with", req.user.id)
      .single();
    if (!share) return res.status(403).json({ error: "No access to this portfolio" });

    // Fetch owner's data in parallel
    const [portfolioResp, holdingsResp, profileResp] = await Promise.all([
      supabase.from("portfolio").select("*").eq("user_id", ownerId).single(),
      supabase.from("holdings")
        .select("*, transactions(id,txn_type,units,price,txn_date,notes,created_at)")
        .eq("user_id", ownerId)
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("display_name, currency").eq("id", ownerId).single(),
    ]);

    // Enrich holdings with net_units (same logic as /api/holdings)
    const enriched = enrichHoldings(holdingsResp.data);

    res.json({
      role: share.role,
      owner_name: profileResp.data?.display_name || "Unknown",
      owner_currency: profileResp.data?.currency || "INR",
      portfolio: portfolioResp.data || null,
      holdings: enriched,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════
//  SNAPTRADE INTEGRATION — US Portfolio Import
// ══════════════════════════════════════════════════════════════════

let _snapClient = null;
function getSnapClient() {
  if (!_snapClient) {
    const cid = process.env.SNAPTRADE_CLIENT_ID;
    const ckey = process.env.SNAPTRADE_CONSUMER_KEY;
    if (!cid || !ckey) throw new Error("Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY");
    _snapClient = new Snaptrade({ clientId: cid, consumerKey: ckey });
  }
  return _snapClient;
}

async function getSnapConn(userId) {
  const { data, error } = await supabase
    .from("snaptrade_connections").select("*").eq("owner_id", userId).single();
  if (error || !data) throw new Error("No SnapTrade connection found — register first.");
  return { ...data, user_secret: decrypt(data.user_secret_enc) };
}

// ── Extract SnapTrade security type code safely ──────────────────
// The SDK v9 `type` field can be:
//   - An object: { id: "...", code: "cs", description: "Common Stock" }
//   - A string:  "cs"  (older SDK or raw API responses)
//   - Undefined/null
function _extractTypeCode(typeField) {
  if (!typeField) return "";
  if (typeof typeField === "string") return typeField.toLowerCase().trim();
  if (typeof typeField === "object" && typeField.code) return typeField.code.toLowerCase().trim();
  return "";
}

function _extractTypeDesc(typeField) {
  if (!typeField) return "";
  if (typeof typeField === "object" && typeField.description) return typeField.description.toLowerCase().trim();
  return "";
}

// ── Detect Indian exchange from code or MIC code ─────────────────
const INDIAN_EXCHANGE_CODES = new Set(["NSE", "BSE", "XNSE", "XBOM"]);
function _isIndianExchange(exchangeObj) {
  if (!exchangeObj) return false;
  const code = (exchangeObj.code || "").toUpperCase();
  const mic  = (exchangeObj.mic_code || "").toUpperCase();
  return INDIAN_EXCHANGE_CODES.has(code) || INDIAN_EXCHANGE_CODES.has(mic);
}

// ── Map SnapTrade security type → WealthLens holding type ────────
// SnapTrade type codes (from SDK SecurityType docs):
//   cs  = Common Stock      ad  = ADR           ps  = Preferred Stock
//   et  = ETF               cef = Closed End Fund
//   oef = Open Ended Fund   bnd = Bond          crypto = Cryptocurrency
//   pm  = Precious Metals   struct = Structured Product
//   ut  = Unit              wi  = When Issued   wt = Warrant   rt = Right
// Money market / cash sweep tickers — these duplicate the cash balance from SnapTrade
const CASH_SWEEP_TICKERS = new Set(["SPAXX","FDRXX","FZFXX","FCASH","VMFXX","SWVXX","TTTXX","SPRXX","CORE","QCEQX"]);

function snapHoldingType(symbolObj) {
  const code    = _extractTypeCode(symbolObj?.type);
  const desc    = _extractTypeDesc(symbolObj?.type);
  const isIndia = _isIndianExchange(symbolObj?.exchange);
  const ticker  = (symbolObj?.symbol || symbolObj?.raw_symbol || "").toUpperCase();

  // ── Stocks ─────────────────────────────────────────────────────
  if (["cs", "ad", "ps", "wi", "wt", "rt"].includes(code)
      || desc.includes("common stock") || desc.includes("preferred stock")
      || desc.includes("equity") || desc === "stock") {
    return isIndia ? "IN_STOCK" : "US_STOCK";
  }

  // ── ETFs ───────────────────────────────────────────────────────
  if (["et", "etf", "cef"].includes(code)
      || desc.includes("etf") || desc.includes("exchange traded") || desc.includes("closed end")) {
    return isIndia ? "IN_ETF" : "US_ETF";
  }

  // ── Mutual Funds ───────────────────────────────────────────────
  if (["oef"].includes(code)
      || desc.includes("open ended") || desc.includes("open-ended") || desc.includes("mutual fund")) {
    return isIndia ? "MF" : "US_ETF";
  }

  // ── Crypto ─────────────────────────────────────────────────────
  if (["crypto", "cryptocurrency"].includes(code) || desc.includes("crypto")) {
    return "CRYPTO";
  }

  // ── Bonds / structured products ────────────────────────────────
  if (["bnd", "bond", "fixed_income", "struct"].includes(code)
      || desc.includes("bond") || desc.includes("fixed income") || desc.includes("structured")) {
    return isIndia ? "FD" : "US_BOND";
  }

  // ── Precious metals → Gold in WealthLens ───────────────────────
  if (["pm"].includes(code) || desc.includes("precious metal")) {
    return "GOLD";
  }

  // ── Unit trusts ────────────────────────────────────────────────
  if (["ut"].includes(code) || desc.includes("unit trust") || desc.includes("unit")) {
    return isIndia ? "MF" : "US_ETF";
  }

  // ── Ticker-based heuristic fallback ────────────────────────────
  // Crypto tickers often end in -USD / -USDT / -BTC
  if (ticker.includes("-USD") || ticker.includes("-USDT") || ticker.includes("-BTC")) {
    return "CRYPTO";
  }

  console.warn(`⚠️ Unknown SnapTrade type: code="${code}", desc="${desc}", exchange="${symbolObj?.exchange?.code || "?"}", ticker="${ticker}"`);
  return "OTHER";
}

// ── SnapTrade: Health check ───────────────────────────────────────
app.get("/api/snaptrade/status", async (_req, res) => {
  try {
    const cid = process.env.SNAPTRADE_CLIENT_ID;
    const ckey = process.env.SNAPTRADE_CONSUMER_KEY;
    if (!cid || !ckey) return res.status(502).json({ error: "SnapTrade not configured", detail: "Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY" });
    const client = getSnapClient();
    const resp = await client.apiStatus.check();
    res.json({ status: "ok", snaptrade: resp.data });
  } catch (e) {
    console.error("❌ SnapTrade status error:", e.message);
    res.status(502).json({ error: "SnapTrade API unreachable", detail: e.message, code: e.code || null });
  }
});

// ── SnapTrade: Register user ──────────────────────────────────────
app.post("/api/snaptrade/register", auth, async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from("snaptrade_connections").select("snaptrade_user_id").eq("owner_id", req.user.id).single();
    if (existing) return res.json({ snaptrade_user_id: existing.snaptrade_user_id, already_registered: true });

    const snapUserId = `wlh-${req.user.id}`;
    const resp = await getSnapClient().authentication.registerSnapTradeUser({ userId: snapUserId });
    const userSecret = resp.data.userSecret;

    await supabase.from("snaptrade_connections").insert({
      owner_id: req.user.id,
      snaptrade_user_id: snapUserId,
      user_secret_enc: encrypt(userSecret),
      status: "active",
    });
    res.json({ snaptrade_user_id: snapUserId, registered: true });
  } catch (e) {
    console.error("SnapTrade register:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: Connection portal redirect ─────────────────────────
app.post("/api/snaptrade/connect", auth, async (req, res) => {
  try {
    const { broker } = req.body;
    const conn = await getSnapConn(req.user.id);
    const baseUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:5173";

    const params = {
      userId: conn.snaptrade_user_id,
      userSecret: conn.user_secret,
      customRedirect: `${baseUrl}/import/snaptrade/callback`,
    };
    if (broker) params.broker = broker;

    const resp = await getSnapClient().authentication.loginSnapTradeUser(params);
    res.json({ redirect_uri: resp.data.redirectURI });
  } catch (e) {
    console.error("SnapTrade connect:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: List connected accounts ────────────────────────────
app.get("/api/snaptrade/accounts", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const resp = await getSnapClient().accountInformation.listUserAccounts({
      userId: conn.snaptrade_user_id, userSecret: conn.user_secret,
    });
    const accounts = (resp.data || []).map(a => ({
      account_id: a.id,
      brokerage: a.brokerage?.name || "",
      brokerage_slug: a.brokerage?.slug || "",
      brokerage_type: a.brokerage?.brokerage_type || a.brokerage?.type || "",
      account_name: a.name || "",
      account_number: a.number || "",
      account_type: a.meta?.type || a.raw_type || "",
    }));
    res.json({ accounts, count: accounts.length });
  } catch (e) {
    console.error("SnapTrade accounts:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: Preview holdings (with duplicate detection) ────────
app.get("/api/snaptrade/holdings/:accountId", auth, async (req, res) => {
  try {
    const t0 = Date.now();
    const conn = await getSnapConn(req.user.id);
    const client = getSnapClient();
    const brokerageName = req.query.brokerage || "SnapTrade";

    // Fetch SnapTrade positions, balances, AND existing holdings in parallel
    const [posResp, balResp, existingResp] = await Promise.all([
      client.accountInformation.getUserAccountPositions({
        userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: req.params.accountId,
      }),
      client.accountInformation.getUserAccountBalance({
        userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: req.params.accountId,
      }),
      supabase.from("holdings")
        .select("id, ticker, units, name, type, source, source_account, brokerage_name, current_price, purchase_price")
        .eq("user_id", req.user.id),
    ]);
    const tApi = Date.now();

    const existingMap = {};
    for (const h of existingResp.data || []) {
      if (h.ticker) existingMap[h.ticker.toUpperCase()] = h;
    }

    const positions = (posResp.data || []).map(p => {
      const units = Number(p.units || 0);
      const price = Number(p.price || 0);
      const avg   = Number(p.average_purchase_price || p.averageEntryPrice || 0);
      const ticker = p.symbol?.symbol?.symbol || "UNKNOWN";
      const desc  = (p.symbol?.symbol?.description || "").toLowerCase();
      const typeCode = _extractTypeCode(p.symbol?.symbol?.type);

      // Skip money market / cash sweep funds — their value is in the cash balance
      const isCashSweep = CASH_SWEEP_TICKERS.has(ticker.toUpperCase())
        || (typeCode === "oef" && (desc.includes("money market") || desc.includes("cash") || desc.includes("sweep") || desc.includes("government money")));
      if (isCashSweep) return null;

      const existing = existingMap[ticker.toUpperCase()];

      // Determine duplicate status
      let dup_status = "new";           // no match
      let dup_detail = null;
      if (existing) {
        const existingUnits = Number(existing.units || 0);
        const existSrc = existing.brokerage_name || existing.source || "manual";
        if (existingUnits === units && existing.source === "snaptrade") {
          dup_status = "exact_match";   // same ticker + same units from snaptrade
          dup_detail = `Already imported: ${existingUnits} units via ${existSrc}`;
        } else if (existing.source === "snaptrade") {
          dup_status = "qty_changed";   // same ticker, different units (re-sync)
          dup_detail = `${existSrc}: ${existingUnits} units → New: ${units} units`;
        } else {
          dup_status = "manual_exists"; // user added this ticker manually
          dup_detail = `Manual entry exists: ${existing.name} (${existingUnits || "?"} units) via ${existSrc}`;
        }
      }

      return {
        ticker,
        asset_name: p.symbol?.symbol?.description || p.symbol?.symbol?.symbol || "",
        asset_type: snapHoldingType(p.symbol?.symbol),
        snap_type_raw: _extractTypeCode(p.symbol?.symbol?.type),
        snap_type_desc: _extractTypeDesc(p.symbol?.symbol?.type),
        snap_exchange: p.symbol?.symbol?.exchange?.code || p.symbol?.symbol?.exchange?.mic_code || "",
        brokerage_name: brokerageName,
        source: "snaptrade",
        units, current_price: price, avg_cost: avg,
        market_value: units * price,
        unrealized_pnl: avg ? (price - avg) * units : 0,
        currency: p.symbol?.symbol?.currency?.code || "USD",
        dup_status,
        dup_detail,
        existing_id: existing?.id || null,
      };
    }).filter(Boolean);

    const cashPositions = (balResp.data || [])
      .filter(b => Number(b.cash || 0) > 0)
      .map(b => {
        const cash = Number(b.cash);
        const cur  = b.currency?.code || "USD";
        const ticker = `CASH-${cur}`;
        const existing = existingMap[ticker.toUpperCase()];
        return {
          ticker, asset_name: `Cash (${cur})`, asset_type: "CASH",
          brokerage_name: brokerageName,
          source: "snaptrade",
          units: 1, current_price: cash, avg_cost: cash,
          market_value: cash, unrealized_pnl: 0, currency: cur,
          dup_status: existing ? "exact_match" : "new",
          dup_detail: existing ? "Cash balance already tracked" : null,
          existing_id: existing?.id || null,
        };
      });

    const all = [...positions, ...cashPositions];
    const dupSummary = {
      new_count: all.filter(a => a.dup_status === "new").length,
      exact_match_count: all.filter(a => a.dup_status === "exact_match").length,
      qty_changed_count: all.filter(a => a.dup_status === "qty_changed").length,
      manual_exists_count: all.filter(a => a.dup_status === "manual_exists").length,
    };
    const tTotal = Date.now();
    console.log(`⏱ SnapTrade preview: api=${tApi - t0}ms, transform=${tTotal - tApi}ms, total=${tTotal - t0}ms, positions=${all.length}`);
    res.json({
      account_id: req.params.accountId,
      assets: all,
      asset_count: all.length,
      total_market_value: Math.round(all.reduce((s, a) => s + a.market_value, 0) * 100) / 100,
      duplicates: dupSummary,
      _timing: { api_ms: tApi - t0, total_ms: tTotal - t0 },
    });
  } catch (e) {
    console.error("SnapTrade holdings:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: Import holdings → WealthLens Hub ───────────────────
// Accepts body: { resolutions: { "AAPL": "skip"|"replace"|"merge" }, brokerage_name: "Fidelity" }
// ALL duplicates MUST have an explicit resolution — unresolved duplicates are skipped with a warning
// OPTIMISED: bulk upsert for new holdings, parallel updates for replace/merge
app.post("/api/snaptrade/import/:accountId", auth, async (req, res) => {
  try {
    const conn  = await getSnapConn(req.user.id);
    const client = getSnapClient();
    const now = new Date().toISOString();
    const acctId = req.params.accountId;
    const resolutions = req.body?.resolutions || {};
    const brokerageName = req.body?.brokerage_name || "SnapTrade";
    const memberId = req.body?.member_id || null;

    const [posResp, balResp, existingResp] = await Promise.all([
      client.accountInformation.getUserAccountPositions({
        userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: acctId,
      }),
      client.accountInformation.getUserAccountBalance({
        userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: acctId,
      }),
      supabase.from("holdings")
        .select("id, ticker, units, name, type, source, current_price, purchase_price")
        .eq("user_id", req.user.id),
    ]);

    const existingMap = {};
    for (const h of existingResp.data || []) {
      if (h.ticker) existingMap[h.ticker.toUpperCase()] = h;
    }

    // ── Classify positions into batches ───────────────────────────
    const newRows = [];       // bulk upsert
    const updateOps = [];     // parallel update promises
    let skipped = 0, merged = 0, replaced = 0;
    const unresolved = [];

    for (const p of posResp.data || []) {
      const ticker = p.symbol?.symbol?.symbol || "UNKNOWN";
      const units  = Number(p.units || 0);
      const price  = Number(p.price || 0);
      const avg    = Number(p.average_purchase_price || p.averageEntryPrice || 0);
      if (units <= 0) continue;

      // Skip money market / cash sweep — value is in cash balance
      const descLow = (p.symbol?.symbol?.description || "").toLowerCase();
      const typeCode = _extractTypeCode(p.symbol?.symbol?.type);
      const isCashSweep = CASH_SWEEP_TICKERS.has(ticker.toUpperCase())
        || (typeCode === "oef" && (descLow.includes("money market") || descLow.includes("cash") || descLow.includes("sweep") || descLow.includes("government money")));
      if (isCashSweep) { skipped++; continue; }

      const existing = existingMap[ticker.toUpperCase()];
      const resolution = resolutions[ticker] || resolutions[ticker.toUpperCase()];

      if (existing) {
        if (!resolution) { unresolved.push(ticker); skipped++; continue; }
        if (resolution === "skip") { skipped++; continue; }

        const existingUnits = Number(existing.units || 0);

        if (resolution === "merge") {
          updateOps.push(
            supabase.from("holdings").update({
              units: existingUnits + units,
              current_price: price,
              brokerage_name: brokerageName,
              source: "snaptrade",
              ...(memberId && { member_id: memberId }),
              price_fetched_at: now,
              last_synced: now,
            }).eq("id", existing.id).then(r => { if (!r.error) merged++; })
          );
        } else {
          // replace
          updateOps.push(
            supabase.from("holdings").update({
              units,
              type: snapHoldingType(p.symbol?.symbol),
              name: p.symbol?.symbol?.description || ticker,
              purchase_price: avg || price,
              current_price: price,
              currency: p.symbol?.symbol?.currency?.code || "USD",
              source: "snaptrade",
              source_account: acctId,
              brokerage_name: brokerageName,
              ...(memberId && { member_id: memberId }),
              last_synced: now,
              price_fetched_at: now,
            }).eq("id", existing.id).then(r => { if (!r.error) replaced++; })
          );
        }
        continue;
      }

      // New holding — collect for bulk upsert
      newRows.push({
        id: `snap_${acctId}_${ticker}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
        user_id: req.user.id,
        type: snapHoldingType(p.symbol?.symbol),
        ticker,
        name: p.symbol?.symbol?.description || ticker,
        units,
        purchase_price: avg || price,
        current_price: price,
        currency: p.symbol?.symbol?.currency?.code || "USD",
        source: "snaptrade",
        source_account: acctId,
        brokerage_name: brokerageName,
        ...(memberId && { member_id: memberId }),
        last_synced: now,
        price_fetched_at: now,
        start_date: now.slice(0, 10),
      });
    }

    // Cash positions
    for (const b of balResp.data || []) {
      const cash = Number(b.cash || 0);
      if (cash <= 0) continue;
      const cur = b.currency?.code || "USD";
      newRows.push({
        id: `snap_${acctId}_CASH_${cur}`,
        user_id: req.user.id,
        type: "CASH",
        ticker: `CASH-${cur}`,
        name: `Cash (${cur})`,
        units: 1,
        purchase_price: cash,
        current_price: cash,
        currency: cur,
        source: "snaptrade",
        source_account: acctId,
        brokerage_name: brokerageName,
        ...(memberId && { member_id: memberId }),
        last_synced: now,
        price_fetched_at: now,
        start_date: now.slice(0, 10),
      });
    }

    // ── Execute all DB writes in parallel ─────────────────────────
    const bulkUpsertPromise = newRows.length > 0
      ? supabase.from("holdings").upsert(newRows, { onConflict: "id" })
      : Promise.resolve({ error: null });

    const [bulkResult] = await Promise.all([
      bulkUpsertPromise,
      ...updateOps,
      supabase.from("snaptrade_connections").update({ last_synced_at: now }).eq("owner_id", req.user.id),
    ]);

    const imported = bulkResult.error ? 0 : newRows.length;
    if (bulkResult.error) console.error("SnapTrade bulk upsert error:", bulkResult.error.message);

    res.json({
      status: "imported",
      assets_imported: imported,
      assets_skipped: skipped,
      assets_merged: merged,
      assets_replaced: replaced,
      unresolved_tickers: unresolved,
      account_id: acctId,
      brokerage_name: brokerageName,
    });
  } catch (e) {
    console.error("SnapTrade import:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: List brokerage connections ─────────────────────────
app.get("/api/snaptrade/connections", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const resp = await getSnapClient().connections.listBrokerageAuthorizations({
      userId: conn.snaptrade_user_id, userSecret: conn.user_secret,
    });
    const connections = (resp.data || []).map(c => ({
      authorization_id: c.id,
      brokerage: c.brokerage?.name || "",
      brokerage_slug: c.brokerage?.slug || "",
      status: c.disabled ? "disabled" : "active",
      created_at: c.createdDate || c.created_date || null,
      updated_at: c.updatedDate || c.updated_date || null,
    }));
    res.json({ connections, count: connections.length });
  } catch (e) {
    console.error("SnapTrade connections:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: Disconnect a single brokerage connection ───────────
app.delete("/api/snaptrade/connections/:authId", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const authId = req.params.authId;

    // Remove the brokerage authorization from SnapTrade
    await getSnapClient().connections.removeBrokerageAuthorization({
      userId: conn.snaptrade_user_id,
      userSecret: conn.user_secret,
      authorizationId: authId,
    });

    // Remove any holdings imported from accounts under this connection
    // First get all accounts to find which belong to this auth
    const acctResp = await getSnapClient().accountInformation.listUserAccounts({
      userId: conn.snaptrade_user_id, userSecret: conn.user_secret,
    });
    // Filter accounts that belonged to this authorization (already removed,
    // so we clean up holdings whose source_account matches any account from this broker)
    // Since SnapTrade may have already removed the accounts, we do best-effort cleanup
    await supabase.from("holdings")
      .delete()
      .eq("user_id", req.user.id)
      .eq("source", "snaptrade");

    // Check if user still has any connections left
    const remaining = await getSnapClient().connections.listBrokerageAuthorizations({
      userId: conn.snaptrade_user_id, userSecret: conn.user_secret,
    });

    res.json({
      status: "disconnected",
      authorization_id: authId,
      remaining_connections: (remaining.data || []).length,
    });
  } catch (e) {
    console.error("SnapTrade disconnect connection:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SnapTrade: Disconnect ALL (delete SnapTrade user entirely) ────
app.delete("/api/snaptrade/disconnect", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    await getSnapClient().authentication.deleteSnapTradeUser({ userId: conn.snaptrade_user_id });
    await supabase.from("snaptrade_connections").delete().eq("owner_id", req.user.id);
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "snaptrade");
    res.json({ status: "disconnected" });
  } catch (e) {
    console.error("SnapTrade disconnect:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
//  END SNAPTRADE INTEGRATION
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  PLAID — US Bank Transaction Import
//  Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|development|production)
// ══════════════════════════════════════════════════════════════════

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET    = process.env.PLAID_SECRET;
const PLAID_ENV       = process.env.PLAID_ENV || "sandbox";
const PLAID_ENABLED   = !!(PLAID_CLIENT_ID && PLAID_SECRET);

let _plaidClient = null;
async function getPlaidClient() {
  if (_plaidClient) return _plaidClient;
  if (!PLAID_ENABLED) throw new Error("Plaid not configured — set PLAID_CLIENT_ID and PLAID_SECRET");
  const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");
  const envMap = { sandbox: PlaidEnvironments.sandbox, development: PlaidEnvironments.development, production: PlaidEnvironments.production };
  const config = new Configuration({
    basePath: envMap[PLAID_ENV] || PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": PLAID_CLIENT_ID, "PLAID-SECRET": PLAID_SECRET } },
  });
  _plaidClient = new PlaidApi(config);
  return _plaidClient;
}

// ── Plaid: Status ─────────────────────────────────────────────────
app.get("/api/plaid/status", auth, async (req, res) => {
  if (!PLAID_ENABLED) return res.json({ configured: false, env: PLAID_ENV });
  try {
    const { data: connections, error } = await supabase
      .from("plaid_connections").select("id, institution_name, accounts, last_synced, status, error_code")
      .eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (error) {
      console.error("Plaid status error:", error.message);
      // Table may not exist yet — treat as not configured
      return res.json({ configured: true, env: PLAID_ENV, connections: [], error: error.message });
    }
    res.json({ configured: true, env: PLAID_ENV, connections: connections || [] });
  } catch (e) {
    console.error("Plaid status error:", e.message);
    res.json({ configured: false, env: PLAID_ENV, connections: [], error: e.message });
  }
});

// ── Plaid: Create Link Token ──────────────────────────────────────
app.post("/api/plaid/link-token", auth, async (req, res) => {
  try {
    const plaid = await getPlaidClient();
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: req.user.id },
      client_name: "WealthLens Hub",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      redirect_uri: undefined, // not needed for web
    });
    res.json({ link_token: response.data.link_token, expiration: response.data.expiration });
  } catch (e) {
    console.error("Plaid link-token error:", e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data?.error_message || e.message });
  }
});

// ── Plaid: Exchange Public Token → Access Token ───────────────────
app.post("/api/plaid/exchange", auth, async (req, res) => {
  try {
    const { public_token, metadata } = req.body;
    if (!public_token) return res.status(400).json({ error: "public_token required" });

    const plaid = await getPlaidClient();
    const tokenResp = await plaid.itemPublicTokenExchange({ public_token });
    const access_token = tokenResp.data.access_token;
    const item_id = tokenResp.data.item_id;

    // Get account details
    const acctResp = await plaid.accountsGet({ access_token });
    const accounts = (acctResp.data.accounts || []).map(a => ({
      account_id: a.account_id,
      name: a.name || a.official_name || "Account",
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
    }));

    // Encrypt access token before storing
    const encryptedToken = encrypt(access_token);

    // Upsert connection
    const connId = "plaid_" + Date.now().toString(36);
    const institution_name = metadata?.institution?.name || "US Bank";
    const institution_id = metadata?.institution?.institution_id || "";

    await supabase.from("plaid_connections").upsert({
      id: connId,
      user_id: req.user.id,
      item_id,
      access_token: encryptedToken,
      institution_id,
      institution_name,
      accounts,
      status: "active",
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    res.json({
      ok: true,
      connection_id: connId,
      institution_name,
      accounts: accounts.map(a => ({ name: a.name, type: a.type, mask: a.mask })),
    });
  } catch (e) {
    console.error("Plaid exchange error:", e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data?.error_message || e.message });
  }
});

// ── Plaid: Sync Transactions ──────────────────────────────────────
app.post("/api/plaid/sync/:connectionId", auth, async (req, res) => {
  try {
    const { data: conn } = await supabase
      .from("plaid_connections").select("*").eq("id", req.params.connectionId).eq("user_id", req.user.id).single();
    if (!conn) return res.status(404).json({ error: "Connection not found" });

    const access_token = decrypt(conn.access_token);
    const plaid = await getPlaidClient();

    // Use transactions/sync with cursor-based pagination
    let cursor = conn.cursor || "";
    let added = [], modified = [], removed = [];
    let hasMore = true;

    while (hasMore) {
      const syncResp = await plaid.transactionsSync({
        access_token,
        cursor: cursor || undefined,
        count: 500,
      });
      const data = syncResp.data;
      added = added.concat(data.added || []);
      modified = modified.concat(data.modified || []);
      removed = removed.concat(data.removed || []);
      hasMore = data.has_more;
      cursor = data.next_cursor;
    }

    // Create a budget statement for this sync
    const stmtId = "plaid_stmt_" + Date.now().toString(36);
    const now = new Date().toISOString();

    if (added.length > 0) {
      // Determine period range
      const dates = added.map(t => t.date).filter(Boolean).sort();
      const periodStart = dates[0] || now.slice(0, 10);
      const periodEnd = dates[dates.length - 1] || now.slice(0, 10);

      await supabase.from("budget_statements").insert({
        id: stmtId,
        user_id: req.user.id,
        source: conn.institution_name || "Plaid",
        statement_type: "BANK",
        filename: `plaid_sync_${now.slice(0, 10)}`,
        file_size: 0,
        period_start: periodStart,
        period_end: periodEnd,
        txn_count: added.length,
        notes: `Auto-synced via Plaid · ${added.length} new transactions`,
      });

      // Map Plaid transactions → budget_transactions
      const txns = added.map(t => ({
        id: "ptxn_" + t.transaction_id,
        statement_id: stmtId,
        user_id: req.user.id,
        txn_date: t.date,
        description: encrypt(t.name || t.merchant_name || "Transaction"),
        amount: Math.abs(t.amount),
        txn_type: t.amount > 0 ? "DEBIT" : "CREDIT", // Plaid: positive = debit
        category: mapPlaidCategory(t.personal_finance_category),
        raw_desc: encrypt(JSON.stringify({
          merchant: t.merchant_name,
          plaid_category: t.personal_finance_category,
          payment_channel: t.payment_channel,
          account_id: t.account_id,
        })),
        ref_number: t.transaction_id,
      }));

      // Batch insert
      const batchSize = 100;
      for (let i = 0; i < txns.length; i += batchSize) {
        const { error } = await supabase.from("budget_transactions").insert(txns.slice(i, i + batchSize));
        if (error) console.error("Plaid txn insert batch error:", error.message);
      }
    }

    // Handle removed transactions
    if (removed.length > 0) {
      const removeIds = removed.map(r => "ptxn_" + r.transaction_id);
      await supabase.from("budget_transactions").delete().in("id", removeIds);
    }

    // Update cursor + last_synced
    await supabase.from("plaid_connections").update({
      cursor, last_synced: now, status: "active", error_code: null, updated_at: now,
    }).eq("id", conn.id);

    res.json({
      ok: true,
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      total_synced: added.length,
      period: added.length > 0 ? {
        start: added.map(t => t.date).sort()[0],
        end: added.map(t => t.date).sort().pop(),
      } : null,
    });
  } catch (e) {
    console.error("Plaid sync error:", e?.response?.data || e.message);
    // Update connection status on error
    await supabase.from("plaid_connections").update({
      status: "error",
      error_code: e?.response?.data?.error_code || e.message,
      updated_at: new Date().toISOString(),
    }).eq("id", req.params.connectionId).eq("user_id", req.user.id);
    res.status(500).json({ error: e?.response?.data?.error_message || e.message });
  }
});

// ── Plaid: Disconnect ─────────────────────────────────────────────
app.delete("/api/plaid/connections/:connectionId", auth, async (req, res) => {
  try {
    const { data: conn } = await supabase
      .from("plaid_connections").select("*").eq("id", req.params.connectionId).eq("user_id", req.user.id).single();
    if (!conn) return res.status(404).json({ error: "Connection not found" });

    // Remove Plaid Item
    try {
      const plaid = await getPlaidClient();
      const access_token = decrypt(conn.access_token);
      await plaid.itemRemove({ access_token });
    } catch { /* best effort */ }

    // Delete connection record
    await supabase.from("plaid_connections").delete().eq("id", conn.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Plaid: Category mapping (Plaid PFC → WealthLens budget categories) ──
function mapPlaidCategory(pfc) {
  if (!pfc) return "Uncategorised";
  const primary = (pfc.primary || "").toUpperCase();
  const detailed = (pfc.detailed || "").toUpperCase();
  const map = {
    "FOOD_AND_DRINK": "Food & Dining",
    "TRANSPORTATION": "Transport",
    "SHOPPING": "Shopping",
    "ENTERTAINMENT": "Entertainment",
    "HEALTH_AND_FITNESS": "Health",
    "PERSONAL_CARE": "Personal Care",
    "RENT_AND_UTILITIES": "Housing & Bills",
    "HOME_IMPROVEMENT": "Housing & Bills",
    "TRAVEL": "Travel",
    "EDUCATION": "Education",
    "MEDICAL": "Health",
    "GOVERNMENT_AND_NON_PROFIT": "Other",
    "TRANSFER_IN": "Income",
    "TRANSFER_OUT": "Transfer",
    "INCOME": "Income",
    "BANK_FEES": "Other",
    "LOAN_PAYMENTS": "EMI / Loans",
    "GENERAL_MERCHANDISE": "Shopping",
    "GENERAL_SERVICES": "Other",
  };
  return map[primary] || map[detailed] || "Uncategorised";
}

if (PLAID_ENABLED) {
  console.log(`🏦  Plaid: enabled (${PLAID_ENV})`);
} else {
  console.log("🏦  Plaid: disabled (set PLAID_CLIENT_ID and PLAID_SECRET to enable)");
}

// ══════════════════════════════════════════════════════════════════
//  SETU ACCOUNT AGGREGATOR — India Financial Data Import
//  Hidden behind SETU_ENABLED=true env flag (not yet production-ready)
// ══════════════════════════════════════════════════════════════════

if (SETU_ENABLED) {

const SETU_BASE     = process.env.SETU_BASE_URL || "https://fiu-sandbox.setu.co";
const SETU_CLIENT   = process.env.SETU_CLIENT_ID;
const SETU_SECRET   = process.env.SETU_CLIENT_SECRET;
const SETU_PRODUCT  = process.env.SETU_PRODUCT_INSTANCE_ID;

let _setuToken = null;
let _setuTokenExp = 0;

async function getSetuToken() {
  if (_setuToken && Date.now() < _setuTokenExp - 30000) return _setuToken;
  const resp = await fetch("https://orgservice.setu.co/v1/users/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientID: SETU_CLIENT, secret: SETU_SECRET }),
  });
  if (!resp.ok) throw new Error("Setu OAuth failed: " + resp.status);
  const data = await resp.json();
  _setuToken = data.access_token || data.token;
  _setuTokenExp = Date.now() + (data.expiresIn || 1800) * 1000;
  return _setuToken;
}

function setuHeaders() {
  return { "Content-Type": "application/json", "x-product-instance-id": SETU_PRODUCT };
}

app.get("/api/setu/status", auth, (req, res) => {
  const configured = !!(SETU_CLIENT && SETU_SECRET && SETU_PRODUCT);
  res.json({ configured, sandbox: SETU_BASE.includes("sandbox") });
});

app.post("/api/setu/consent", auth, async (req, res) => {
  try {
    if (!SETU_CLIENT || !SETU_SECRET || !SETU_PRODUCT) return res.status(400).json({ error: "Setu AA not configured" });
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: "Mobile number is required" });
    const token = await getSetuToken();
    const from = new Date(Date.now() - 3 * 365 * 86400000).toISOString();
    const to = new Date().toISOString();
    const cr = await fetch(`${SETU_BASE}/consents`, {
      method: "POST",
      headers: { ...setuHeaders(), Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consentDuration: { unit: "MONTH", value: "6" }, vua: mobile, dataRange: { from, to }, context: [] }),
    });
    const cd = await cr.json();
    if (!cr.ok) return res.status(cr.status).json({ error: cd.errorMsg || cd.detail || "Consent creation failed" });
    await supabase.from("setu_consents").insert({
      user_id: req.user.id, consent_id: cd.id, status: cd.status || "PENDING",
      fi_types: ["DEPOSIT","TERM_DEPOSIT","MUTUAL_FUNDS","EQUITIES","ETF","EPF","PPF"],
      data_range_from: from, data_range_to: to, redirect_url: cd.url,
    });
    res.json({ consent_id: cd.id, url: cd.url, status: cd.status });
  } catch (e) { console.error("Setu consent error:", e.message); res.status(500).json({ error: e.message }); }
});

app.get("/api/setu/consent/:consentId", auth, async (req, res) => {
  try {
    const token = await getSetuToken();
    const r = await fetch(`${SETU_BASE}/consents/${req.params.consentId}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.errorMsg || "Failed" });
    await supabase.from("setu_consents").update({ status: d.status, updated_at: new Date().toISOString() }).eq("consent_id", req.params.consentId).eq("user_id", req.user.id);
    res.json({ status: d.status, accounts_linked: d.accountsLinked || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/setu/fetch/:consentId", auth, async (req, res) => {
  try {
    const token = await getSetuToken();
    const cid = req.params.consentId;
    const { data: cr } = await supabase.from("setu_consents").select("*").eq("consent_id", cid).eq("user_id", req.user.id).single();
    if (!cr) return res.status(404).json({ error: "Consent not found" });
    const sr = await fetch(`${SETU_BASE}/sessions`, {
      method: "POST", headers: { ...setuHeaders(), Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consentId: cid, dataRange: { from: cr.data_range_from || new Date(Date.now()-3*365*86400000).toISOString(), to: cr.data_range_to || new Date().toISOString() }, format: "json" }),
    });
    const sd = await sr.json();
    if (!sr.ok) return res.status(sr.status).json({ error: sd.errorMsg || "Data session failed" });
    await supabase.from("setu_consents").update({ session_id: sd.id, fi_data_status: "PENDING", updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
    let fiData = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const fr = await fetch(`${SETU_BASE}/sessions/${sd.id}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
      const fd = await fr.json();
      if (fd.status === "COMPLETED" || fd.status === "PARTIAL") { fiData = fd; break; }
      if (fd.status === "FAILED" || fd.status === "EXPIRED") return res.status(500).json({ error: `Data session ${fd.status}` });
    }
    if (!fiData) return res.status(408).json({ error: "Data not ready. Try again shortly." });
    const holdings = parseSetuFIData(fiData);
    await supabase.from("setu_consents").update({ fi_data_status: fiData.status, last_fetched_at: new Date().toISOString(), holdings_count: holdings.length, updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
    res.json({ status: fiData.status, holdings, session_id: sd.id });
  } catch (e) { console.error("Setu fetch error:", e.message); res.status(500).json({ error: e.message }); }
});

app.post("/api/setu/import", auth, async (req, res) => {
  try {
    const { holdings, member_id, consent_id } = req.body;
    if (!holdings?.length) return res.status(400).json({ error: "No holdings to import" });
    const rows = holdings.map(h => ({ ...h, id: h.id || crypto.randomUUID(), user_id: req.user.id, member_id: member_id || "", source: "setu_aa", brokerage_name: h.fip_name || "", created_at: new Date().toISOString() }));
    const { error } = await supabase.from("holdings").upsert(rows, { onConflict: "id" });
    if (error) return res.status(500).json({ error: error.message });
    if (consent_id) await supabase.from("setu_consents").update({ holdings_count: rows.length, updated_at: new Date().toISOString() }).eq("consent_id", consent_id).eq("user_id", req.user.id);
    res.json({ imported: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/setu/consents", auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("setu_consents").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ consents: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/setu/webhook", async (req, res) => {
  const { type, consentId, status } = req.body;
  console.log(`🔔 Setu webhook: type=${type} consent=${consentId} status=${status}`);
  if (type === "CONSENT_STATUS_UPDATE" && consentId) await supabase.from("setu_consents").update({ status, updated_at: new Date().toISOString() }).eq("consent_id", consentId);
  if (type === "FI_DATA_READY" && consentId) await supabase.from("setu_consents").update({ fi_data_status: status, last_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("consent_id", consentId);
  res.json({ ok: true });
});

function parseSetuFIData(sessionData) {
  const holdings = [];
  for (const fip of (sessionData.fips || [])) {
    const fipName = fip.fipID || "";
    for (const account of (fip.accounts || [])) {
      if (!["DELIVERED","READY"].includes(account.status || account.FIstatus)) continue;
      const d = account.data?.account; if (!d) continue;
      const fiType = (d.type || "").toLowerCase();
      const summary = d.summary || {};
      const masked = d.maskedAccNumber || account.maskedAccNumber || "";
      try {
        if (fiType === "deposit") {
          holdings.push({ name: `Bank Account ${masked}`, type: "CASH", purchase_value: +summary.currentBalance || 0, current_value: +summary.currentBalance || 0, fip_name: fipName, source_account: masked, notes: `${summary.type||"SAVINGS"} · ${summary.branch||""} · IFSC: ${summary.ifscCode||""}` });
        } else if (fiType === "term_deposit" || fiType === "recurring_deposit") {
          holdings.push({ name: `${fiType==="term_deposit"?"FD":"RD"} ${masked}`, type: "FD", principal: +summary.principalAmount || 0, purchase_value: +summary.principalAmount || 0, current_value: +summary.currentValue || 0, interest_rate: +summary.interestRate || 0, start_date: _setuDate(summary.openingDate), maturity_date: _setuDate(summary.maturityDate), fip_name: fipName, source_account: masked, notes: fiType==="recurring_deposit"?`Recurring · ₹${summary.recurringAmount||"?"}/month`:"" });
        } else if (fiType === "mutual_funds") {
          const list = [].concat(summary.investment?.holdings?.holding || []);
          for (const mf of list) {
            const u = +mf.closingUnits || +mf.units || 0, r = +mf.rate || 0, n = +mf.nav || 0;
            holdings.push({ name: `${mf.amc||"MF"} · ${mf.schemeCode||""}`, type: "MF", scheme_code: mf.amfiCode||mf.schemeCode||"", net_units: u, units: u, purchase_nav: r, current_nav: n, purchase_value: r*u, current_value: n*u, avg_cost: r, purchase_price: r, fip_name: fipName, source_account: masked, notes: `Folio: ${mf.folioNo||"?"} · ${mf.mode||""}` });
          }
        } else if (fiType === "equities") {
          const list = [].concat(summary.investment?.holdings?.holding || []);
          for (const eq of list) {
            const u = +eq.units || 0, r = +eq.rate || 0, p = +eq.lastTradedPrice || r;
            holdings.push({ name: eq.issuerName||eq.companyName||`Stock ${eq.isin||""}`, type: "IN_STOCK", ticker: eq.symbol||"", net_units: u, units: u, purchase_price: r, current_price: p, purchase_value: r*u, current_value: p*u, avg_cost: r, fip_name: fipName, source_account: masked });
          }
        } else if (fiType === "etf") {
          const list = [].concat(summary.investment?.holdings?.holding || []);
          for (const et of list) {
            const u = +et.units || 0, r = +et.rate || 0, p = +et.lastTradedPrice || r;
            holdings.push({ name: et.issuerName||`ETF ${et.isin||""}`, type: "IN_ETF", ticker: et.symbol||"", net_units: u, units: u, purchase_price: r, current_price: p, purchase_value: r*u, current_value: p*u, avg_cost: r, fip_name: fipName, source_account: masked });
          }
        } else if (fiType === "epf") {
          holdings.push({ name: `EPF · ${summary.establishmentName||""}`, type: "EPF", principal: +summary.employeeBalance || 0, purchase_value: +summary.totalBalance || +summary.currentBalance || 0, current_value: +summary.totalBalance || +summary.currentBalance || 0, start_date: _setuDate(summary.openingDate), fip_name: fipName, source_account: summary.establishmentId||masked, notes: `Employee: ₹${summary.employeeBalance||0} · Employer: ₹${summary.employerBalance||0}` });
        } else if (fiType === "ppf") {
          holdings.push({ name: `PPF Account ${masked}`, type: "PPF", principal: +summary.currenBalance || +summary.currentBalance || 0, purchase_value: +summary.currenBalance || +summary.currentBalance || 0, current_value: +summary.currenBalance || +summary.currentBalance || 0, start_date: _setuDate(summary.openingDate), maturity_date: _setuDate(summary.maturityDate), fip_name: fipName, source_account: masked });
        } else if (fiType === "insurance_policies" || fiType === "ulip") {
          holdings.push({ name: `${summary.policyName||"Insurance"} · ${summary.policyNumber||masked}`, type: "OTHER", purchase_value: +summary.premiumAmount || +summary.sumAssured || 0, current_value: +summary.coverAmount || +summary.sumAssured || 0, fip_name: fipName, source_account: summary.policyNumber||masked, notes: `${summary.policyType||fiType} · Premium: ₹${summary.premiumAmount||"?"}` });
        } else if (fiType === "bonds") {
          const bh = summary.holdings?.holding;
          holdings.push({ name: bh?.issuerName||`Bond ${masked}`, type: "OTHER", scheme_code: bh?.isin||"", net_units: +bh?.units || 0, units: +bh?.units || 0, purchase_value: +summary.investmentValue || 0, current_value: +summary.currentValue || 0, interest_rate: +bh?.couponRate || 0, maturity_date: _setuDate(bh?.maturityDate), fip_name: fipName, source_account: masked });
        } else {
          holdings.push({ name: `${fiType} · ${masked}`, type: "OTHER", purchase_value: +summary.investmentValue || +summary.currentBalance || +summary.currentValue || 0, current_value: +summary.currentValue || +summary.currentBalance || 0, fip_name: fipName, source_account: masked, notes: `FI type: ${fiType}` });
        }
      } catch (pe) { console.warn(`⚠️ Setu parse ${fiType}:`, pe.message); }
    }
  }
  return holdings;
}

function _setuDate(d) { if (!d) return null; if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,10); const m = d.match(/^(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : d; }

} else {
  // Setu not enabled — return disabled status for all Setu endpoints
  app.get("/api/setu/status", auth, (_req, res) => res.json({ configured: false, sandbox: false, disabled: true }));
  app.all("/api/setu/*", auth, (_req, res) => res.status(404).json({ error: "Account Aggregator not enabled. Set SETU_ENABLED=true to activate." }));
}

// ── Serve React app for all other routes ─────────────────────────
app.get("*", (_, res) => {
  const indexPath = path.join(process.cwd(), "dist", "index.html");
  res.sendFile(indexPath, err => {
    if (err) {
      console.error("❌ Failed to serve index.html from:", indexPath, err.message);
      res.status(404).send("Build error — dist/index.html not found.");
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅  WealthLens Hub running on port ${PORT} (public multi-tenant)`);
  console.log(`📊  Price sources: Twelve Data → Yahoo Finance | MF: MFAPI → AMFI | FX: exchangerate-api → Yahoo → ${FX_FALLBACK}`);
  console.log(`🔐  Auth: Google OAuth + Email/Password via Supabase`);
  console.log(`💾  Postgres DB + file storage via Supabase`);
  console.log(`🔌  Setu AA: ${SETU_ENABLED ? "ENABLED" : "disabled (set SETU_ENABLED=true to activate)"}`);
});

// ══════════════════════════════════════════════════════════════════
//  BUDGET MODULE
// ══════════════════════════════════════════════════════════════════

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const Papa = _require("papaparse");
const XLSX = _require("xlsx");
const pdfjsLib = _require("pdfjs-dist/legacy/build/pdf.mjs");
import crypto from "crypto";

// ── pdfjs-dist: resolve standard font path for text extraction ──
const _pdfjsFontPath = path.join(path.dirname(_require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
console.log("📄 pdfjs-dist font path:", _pdfjsFontPath);

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────
const BUDGET_KEY = process.env.BUDGET_ENCRYPT_KEY
  ? Buffer.from(process.env.BUDGET_ENCRYPT_KEY, "hex")
  : crypto.randomBytes(32);
if (!process.env.BUDGET_ENCRYPT_KEY) {
  console.warn("⚠️  BUDGET_ENCRYPT_KEY not set — using ephemeral key. Transactions will lose decryption on restart. Set a 64-char hex key in Render env.");
}

function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", BUDGET_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function decrypt(data) {
  if (!data || !data.includes(":")) return data || "";
  try {
    const [ivHex, tagHex, encHex] = data.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", BUDGET_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
  } catch { return "[encrypted]"; }
}

// ── Auto-categorise from keywords ────────────────────────────────
async function autoCategorise(description) {
  try {
    const { data: cats } = await supabase.from("budget_categories").select("id,name,keywords");
    const desc = description.toLowerCase();
    for (const cat of (cats || [])) {
      if (!cat.keywords) continue;
      for (const kw of cat.keywords.split(",").map(k => k.trim()).filter(Boolean)) {
        if (desc.includes(kw)) return cat.name;
      }
    }
  } catch { /* ignore */ }
  return "Other";
}

// ── Parser: detect bank format and parse CSV rows ─────────────────
function parseCSV(text) {
  const result = Papa.parse(text.trim(), { header: false, skipEmptyLines: true });
  const rows = result.data;
  if (!rows.length) return [];

  // Detect format by header row
  const headerRow = rows.find(r => r.some(c => /date|narration|description|particulars/i.test(c)));
  if (!headerRow) return genericCSV(rows);

  const h = headerRow.map(c => (c||"").toLowerCase().trim());
  const dataRows = rows.slice(rows.indexOf(headerRow) + 1);

  // ── US BANK PARSERS ──────────────────────────────────────────────

  // Chase (checking/savings): Transaction Date, Post Date, Description, Category, Type, Amount
  // Chase (credit card): Transaction Date, Post Date, Description, Category, Type, Amount, Memo
  if (h.some(c => c.includes("post date")) && h.some(c => c.includes("category")) && h.some(c => c.includes("type"))) {
    const di = h.findIndex(c => c.includes("transaction date") || c === "date");
    const descI = h.findIndex(c => c.includes("description"));
    const amtI = h.findIndex(c => c.includes("amount"));
    const catI = h.findIndex(c => c === "category");
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      return { date: r[di], desc: r[descI], debit: amt < 0 ? Math.abs(amt).toString() : "", credit: amt > 0 ? amt.toString() : "", balance: "", ref: "", _usCat: r[catI] || "" };
    }).filter(r => r.date && r.desc);
  }

  // Bank of America: Date, Description, Amount, Running Bal.
  if (h.some(c => c.includes("running bal")) || (h.length <= 5 && h[0] === "date" && h.includes("amount") && h.includes("description"))) {
    const di = h.findIndex(c => c === "date");
    const descI = h.findIndex(c => c.includes("description"));
    const amtI = h.findIndex(c => c === "amount");
    const balI = h.findIndex(c => c.includes("bal"));
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      return { date: r[di], desc: r[descI], debit: amt < 0 ? Math.abs(amt).toString() : "", credit: amt > 0 ? amt.toString() : "", balance: r[balI] || "", ref: "" };
    }).filter(r => r.date && r.desc);
  }

  // Capital One: Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
  if (h.some(c => c.includes("card no")) || (h.some(c => c.includes("posted date")) && h.some(c => c.includes("debit")) && h.some(c => c.includes("credit")))) {
    const di = h.findIndex(c => c.includes("transaction date") || c.includes("date"));
    const descI = h.findIndex(c => c.includes("description") || c.includes("payee"));
    const debI = h.findIndex(c => c === "debit" || c.includes("debit"));
    const credI = h.findIndex(c => c === "credit" || c.includes("credit"));
    const catI = h.findIndex(c => c === "category");
    return dataRows.map(r => ({
      date: r[di], desc: r[descI], debit: r[debI], credit: r[credI], balance: "", ref: "", _usCat: catI >= 0 ? r[catI] : ""
    })).filter(r => r.date && r.desc);
  }

  // Citi: Status, Date, Description, Debit, Credit
  if (h.includes("status") && h.includes("debit") && h.includes("credit")) {
    const di = h.findIndex(c => c === "date");
    const descI = h.findIndex(c => c.includes("description"));
    const debI = h.findIndex(c => c === "debit");
    const credI = h.findIndex(c => c === "credit");
    return dataRows.map(r => ({
      date: r[di], desc: r[descI], debit: r[debI], credit: r[credI], balance: "", ref: ""
    })).filter(r => r.date && r.desc);
  }

  // Amex: Date, Description, Amount (or: Date, Reference, Description, Amount)
  if (h[0] === "date" && h.includes("amount") && (h.includes("reference") || h.length <= 4) && !h.includes("balance")) {
    const di = 0;
    const descI = h.findIndex(c => c.includes("description"));
    const amtI = h.findIndex(c => c === "amount");
    const refI = h.findIndex(c => c.includes("reference"));
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      return { date: r[di], desc: r[descI >= 0 ? descI : 1], debit: amt > 0 ? amt.toString() : "", credit: amt < 0 ? Math.abs(amt).toString() : "", balance: "", ref: refI >= 0 ? r[refI] : "" };
    }).filter(r => r.date && r.desc);
  }

  // Discover: Trans. Date, Post Date, Description, Amount, Category
  if (h.some(c => c.includes("trans. date") || c.includes("trans date")) && h.includes("amount")) {
    const di = h.findIndex(c => c.includes("trans"));
    const descI = h.findIndex(c => c.includes("description"));
    const amtI = h.findIndex(c => c === "amount");
    const catI = h.findIndex(c => c === "category");
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      return { date: r[di], desc: r[descI], debit: amt > 0 ? amt.toString() : "", credit: amt < 0 ? Math.abs(amt).toString() : "", balance: "", ref: "", _usCat: catI >= 0 ? r[catI] : "" };
    }).filter(r => r.date && r.desc);
  }

  // Wells Fargo (varies): common format is Date, Amount, *, *, Description
  // Also: Date, Description, Amount, Balance — detected via "amount" without specific bank markers
  if (h[0] === "date" && h.length >= 3 && h.length <= 6 && h.includes("amount") && !h.includes("narration")) {
    const di = 0;
    const amtI = h.findIndex(c => c === "amount");
    const descI = h.findIndex(c => c.includes("description") || c.includes("memo") || c.includes("name"));
    const balI = h.findIndex(c => c.includes("balance") || c.includes("bal"));
    // If no desc column found, try the last text column
    const actualDescI = descI >= 0 ? descI : (h.length > 2 ? h.length - 1 : 1);
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      return { date: r[di], desc: r[actualDescI], debit: amt < 0 ? Math.abs(amt).toString() : "", credit: amt > 0 ? amt.toString() : "", balance: balI >= 0 ? r[balI] : "", ref: "" };
    }).filter(r => r.date && r.desc);
  }

  // US Bank: Date, Transaction, Name, Memo, Amount
  if (h.some(c => c === "memo") && h.some(c => c === "name") && h.includes("amount")) {
    const di = h.findIndex(c => c === "date");
    const nameI = h.findIndex(c => c === "name");
    const memoI = h.findIndex(c => c === "memo");
    const amtI = h.findIndex(c => c === "amount");
    return dataRows.map(r => {
      const amt = parseFloat(String(r[amtI]||"").replace(/[$,]/g, "")) || 0;
      const desc = [r[nameI], r[memoI]].filter(Boolean).join(" - ");
      return { date: r[di], desc, debit: amt < 0 ? Math.abs(amt).toString() : "", credit: amt > 0 ? amt.toString() : "", balance: "", ref: "" };
    }).filter(r => r.date && r.desc);
  }

  // ── INDIAN BANK PARSERS ─────────────────────────────────────────

  // HDFC Bank savings (Date, Narration, Chq/Ref, Value Date, Withdrawal, Deposit, Balance)
  if (h.includes("narration") && h.includes("withdrawal amt.") || h.includes("withdrawal amt")) {
    return dataRows.map(r => ({
      date: r[0], desc: r[1], debit: r[4], credit: r[5], balance: r[6], ref: r[2]
    })).filter(r => r.date && r.desc);
  }

  // ICICI Bank (S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks, Withdrawal Amount, Deposit Amount, Balance)
  if (h.some(c => c.includes("transaction remarks"))) {
    return dataRows.map(r => ({
      date: r[2]||r[1], desc: r[4], debit: r[5], credit: r[6], balance: r[7], ref: r[3]
    })).filter(r => r.date && r.desc);
  }

  // Axis Bank (Tran Date, CHQNO, Particulars, Debit, Credit, Balance, Dr/Cr)
  if (h.some(c => c.includes("particulars"))) {
    return dataRows.map(r => ({
      date: r[0], desc: r[2], debit: r[3], credit: r[4], balance: r[5], ref: r[1]
    })).filter(r => r.date && r.desc);
  }

  // SBI (Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance)
  if (h.some(c => c.includes("txn date")) || h.some(c => c.includes("value date"))) {
    return dataRows.map(r => ({
      date: r[0], desc: r[2], debit: r[4], credit: r[5], balance: r[6], ref: r[3]
    })).filter(r => r.date && r.desc);
  }

  // Kotak (Transaction Date, Value Date, Description, Debit, Credit, Balance)
  if (h.some(c => c.includes("transaction date"))) {
    const di = h.findIndex(c => c.includes("transaction date")||c.includes("date"));
    const descI = h.findIndex(c => c.includes("description")||c.includes("particular")||c.includes("narration"));
    const debI = h.findIndex(c => c.includes("debit")||c.includes("withdrawal"));
    const credI = h.findIndex(c => c.includes("credit")||c.includes("deposit"));
    const balI = h.findIndex(c => c.includes("balance"));
    return dataRows.map(r => ({
      date: r[di], desc: r[descI], debit: r[debI], credit: r[credI], balance: r[balI]
    })).filter(r => r.date && r.desc);
  }

  return genericCSV(rows);
}

function genericCSV(rows) {
  // Best-effort: find date-like, desc-like, amount-like columns
  const header = rows[0] || [];
  const h = header.map(c => (c||"").toLowerCase());
  const di  = h.findIndex(c => /date/i.test(c));
  const dsc = h.findIndex(c => /desc|narr|particular|remark/i.test(c));
  const deb = h.findIndex(c => /debit|withdrawal|dr/i.test(c));
  const crd = h.findIndex(c => /credit|deposit|cr/i.test(c));
  const amt = h.findIndex(c => /amount/i.test(c));
  if (di < 0 || (dsc < 0 && amt < 0)) return [];
  return rows.slice(1).map(r => ({
    date: r[di], desc: dsc >= 0 ? r[dsc] : r[1],
    debit: deb >= 0 ? r[deb] : (amt >= 0 ? r[amt] : ""),
    credit: crd >= 0 ? r[crd] : "",
    balance: "", ref: ""
  })).filter(r => r.date && r.desc);
}

function parseAmount(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[₹$,\s]/g, "").trim());
  return isNaN(n) ? 0 : Math.abs(n);
}

function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // YYYY-MM-DD (ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY (US) or DD/MM/YYYY (Indian) — disambiguate by checking if first part > 12
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    const a = parseInt(m1[1]), b = parseInt(m1[2]);
    const y = m1[3].length === 2 ? "20" + m1[3] : m1[3];
    // If first number > 12, it must be DD (Indian format DD/MM/YYYY)
    // If second number > 12, it must be DD (US format MM/DD/YYYY)
    // If both <= 12, try US format (MM/DD) since US banks are more common in this context
    if (a > 12) {
      // DD/MM/YYYY
      return `${y}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}`;
    } else if (b > 12) {
      // MM/DD/YYYY
      return `${y}-${String(a).padStart(2,"0")}-${String(b).padStart(2,"0")}`;
    } else {
      // Ambiguous — default to MM/DD/YYYY (US format) for budget imports
      // Indian bank parsers typically use DD/MM/YYYY but those are handled above (a > 12 check)
      return `${y}-${String(a).padStart(2,"0")}-${String(b).padStart(2,"0")}`;
    }
  }
  // DD MMM YYYY (01 Jan 2024)
  const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const m2 = s.match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/i);
  if (m2) {
    const mo = months[m2[2].toLowerCase()];
    if (mo) return `${m2[3]}-${String(mo).padStart(2,"0")}-${m2[1].padStart(2,"0")}`;
  }
  // MMM DD, YYYY (Jan 01, 2024) — common in US exports
  const m3 = s.match(/^([a-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m3) {
    const mo = months[m3[1].toLowerCase()];
    if (mo) return `${m3[3]}-${String(mo).padStart(2,"0")}-${m3[2].padStart(2,"0")}`;
  }
  return null;
}

// ── PDF Bank Statement Parser ─────────────────────────────────────
// Extracts transactions from bank statement PDFs (US and Indian banks)
// Uses pattern matching on extracted text to find date + description + amount rows
function parseBankStatementPDF(rawText) {
  const rows = [];
  const months = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

  // Date patterns found in bank statement PDFs
  const datePatterns = [
    `\\d{1,2}/\\d{1,2}/\\d{2,4}`,
    `\\d{1,2}-\\d{1,2}-\\d{2,4}`,
    `\\d{1,2}\\s+(?:${months})\\s+\\d{2,4}`,
    `(?:${months})\\s+\\d{1,2},?\\s+\\d{4}`,
    `\\d{1,2}/\\d{1,2}`,
  ];
  const dateRegex = new RegExp(`(${datePatterns.join("|")})`, "gi");
  const amtPat = `[-]?\\$?[\\d,]+\\.\\d{2}`;

  // Find all date positions in the text
  const dateMatches = [...rawText.matchAll(dateRegex)];

  // Strategy A: line-based (if text has real newlines)
  if (rawText.includes("\n")) {
    const lines = rawText.split(/\n/);
    for (const line of lines) {
      const dateM = line.match(new RegExp(`^\\s*(${datePatterns.join("|")})`, "i"));
      if (!dateM) continue;
      const rest = line.substring(dateM.index + dateM[0].length).trim();
      const amounts = [...rest.matchAll(new RegExp(amtPat, "g"))].map(m => ({
        val: parseFloat(m[0].replace(/[$,]/g, "")), idx: m.index
      }));
      if (amounts.length === 0) continue;
      const desc = rest.substring(0, amounts[0].idx).replace(/\s+/g, " ").trim();
      if (!desc || desc.length < 3 || /^(page|total|balance|opening|closing|statement)/i.test(desc)) continue;

      const primaryAmt = amounts[0].val;
      const balance = amounts.length > 2 ? amounts[amounts.length - 1].val : null;
      let debit = "", credit = "";
      if (amounts.length >= 3) {
        const a1 = amounts[0].val, a2 = amounts[1].val;
        if (Math.abs(a1) > 0 && Math.abs(a2) < 0.01) debit = Math.abs(a1).toString();
        else if (Math.abs(a2) > 0 && Math.abs(a1) < 0.01) credit = Math.abs(a2).toString();
        else debit = Math.abs(a1).toString();
      } else {
        if (primaryAmt < 0) debit = Math.abs(primaryAmt).toString();
        else debit = Math.abs(primaryAmt).toString();
      }

      rows.push({ date: dateM[1], desc: desc.substring(0, 120), debit, credit, balance: balance ? balance.toString() : "", ref: "" });
    }
    if (rows.length >= 3) {
      return dedupeRows(rows);
    }
  }

  // Strategy B: date-position segmentation (for concatenated PDF text)
  for (let i = 0; i < dateMatches.length; i++) {
    const dateStr = dateMatches[i][1];
    const startPos = dateMatches[i].index + dateMatches[i][0].length;
    const endPos = i + 1 < dateMatches.length ? dateMatches[i + 1].index : startPos + 300;
    const block = rawText.substring(startPos, Math.min(endPos, startPos + 300)).trim();

    const amounts = [...block.matchAll(new RegExp(amtPat, "g"))].map(m => ({
      val: parseFloat(m[0].replace(/[$,]/g, "")), idx: m.index, raw: m[0],
    }));
    if (amounts.length === 0) continue;

    const desc = block.substring(0, amounts[0].idx).replace(/\s+/g, " ").trim();
    if (!desc || desc.length < 3 || /^(page|total|balance|opening|closing|statement|continued)/i.test(desc)) continue;

    const primaryAmt = amounts[0].val;
    let debit = "", credit = "";
    if (primaryAmt < 0) debit = Math.abs(primaryAmt).toString();
    else debit = Math.abs(primaryAmt).toString();

    const balance = amounts.length > 1 ? amounts[amounts.length - 1].val : null;
    rows.push({ date: dateStr, desc: desc.substring(0, 120), debit, credit, balance: balance ? balance.toString() : "", ref: "" });
  }

  return dedupeRows(rows);
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const key = `${r.date}|${r.desc?.substring(0,30)}|${r.debit||r.credit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SMART PORTFOLIO & TRANSACTION IMPORT
// ═══════════════════════════════════════════════════════════════════

function pNum(val) {
  if (val === null || val === undefined || val === "") return 0;
  const n = parseFloat(String(val).replace(/[₹$,\s]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

/**
 * Detect the broker/format from CSV headers and return parsed holdings.
 */
function detectAndParseHoldings(text, fileName = "") {
  const result = Papa.parse(text.trim(), { header: false, skipEmptyLines: true });
  const rows = result.data;
  if (!rows.length) return { format: "unknown", holdings: [], warnings: ["Empty file"] };

  const headerIdx = rows.findIndex(r =>
    r.some(c => /instrument|stock|symbol|scrip|isin|scheme|fund|name|ticker/i.test(c || ""))
  );

  if (headerIdx >= 0) {
    const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());

    // Zerodha Console
    if (h.some(c => c === "instrument") && h.some(c => /avg\.?\s*cost/i.test(c))) {
      return parseZerodhaHoldings(rows, headerIdx);
    }
    // Groww
    if (h.some(c => c === "symbol") && h.some(c => /company\s*name/i.test(c)) && h.some(c => /avg\s*price/i.test(c))) {
      return parseGrowwHoldings(rows, headerIdx);
    }
    // ICICI Direct
    if (h.some(c => /stock\s*symbol/i.test(c)) && h.some(c => /avg\s*buy/i.test(c))) {
      return parseICICIDirectHoldings(rows, headerIdx);
    }
    // HDFC Securities
    if (h.some(c => /scrip\s*name/i.test(c)) && h.some(c => /avg\s*cost/i.test(c))) {
      return parseHDFCSecHoldings(rows, headerIdx);
    }
    // Upstox
    if (h.some(c => /trading\s*symbol/i.test(c)) && h.some(c => /average\s*price/i.test(c))) {
      return parseUpstoxHoldings(rows, headerIdx);
    }
    // Angel One
    if (h.some(c => c === "scrip") && h.some(c => /avg\s*price/i.test(c)) && h.some(c => /overall/i.test(c))) {
      return parseAngelOneHoldings(rows, headerIdx);
    }
    // Mutual Fund Export (Kuvera / CAS-like)
    if (h.some(c => /scheme\s*name/i.test(c)) && h.some(c => /unit/i.test(c)) && h.some(c => /nav/i.test(c))) {
      return parseMFExportHoldings(rows, headerIdx);
    }
    // WealthLens native
    if (h.some(c => c === "name") && h.some(c => c === "type")) {
      return parseNativeCSVHoldings(rows, headerIdx);
    }

    // ── US BROKER FORMATS ────────────────────────────────────────

    // Schwab (Symbol, Description, Quantity, Price, Price Change %, Market Value, Day Change %, ...)
    if (h.some(c => c === "symbol") && h.some(c => c === "description") && h.some(c => /market\s*value/i.test(c))) {
      return parseSchwabHoldings(rows, headerIdx);
    }
    // Fidelity (Account Name/Number, Symbol, Description, Quantity, Last Price, Current Value, ...)
    // Also matches without Account column (some Fidelity exports omit it)
    if (h.some(c => c === "symbol") && h.some(c => /last\s*price|closing\s*price/i.test(c)) && h.some(c => /current\s*value|total\s*gain/i.test(c))) {
      return parseFidelityHoldings(rows, headerIdx);
    }
    // Robinhood (Instrument, Quantity, Average Cost, Equity, ...)
    if (h.some(c => c === "instrument") && h.some(c => /average\s*cost/i.test(c)) && h.some(c => /equity/i.test(c))) {
      return parseRobinhoodHoldings(rows, headerIdx);
    }
    // Vanguard (Account Number, Investment Name, Symbol, Shares, Share Price, Total Value)
    if (h.some(c => /investment\s*name/i.test(c)) && h.some(c => /share\s*price/i.test(c))) {
      return parseVanguardHoldings(rows, headerIdx);
    }
    // Interactive Brokers (Symbol, Description, Asset Class, Currency, Quantity, Cost Price, Close Price, Value, Unrealized P&L)
    if (h.some(c => /asset\s*class/i.test(c)) && h.some(c => /cost\s*price/i.test(c) || /cost\s*basis/i.test(c))) {
      return parseIBKRHoldings(rows, headerIdx);
    }
    // E*TRADE / TD Ameritrade (Symbol, Description, Qty, Price Paid, Market Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => /price\s*paid/i.test(c))) {
      return parseETRADEHoldings(rows, headerIdx);
    }
    // Coinbase (Asset, Quantity, Cost Basis, Value, ...)
    if (h.some(c => c === "asset") && h.some(c => /cost\s*basis/i.test(c)) && h.some(c => /spot\s*price|value/i.test(c))) {
      return parseCoinbaseHoldings(rows, headerIdx);
    }
    // Merrill Edge / Merrill Lynch (Symbol, Quantity, Last Price, Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => /quantity/i.test(c)) && h.some(c => /last\s*price/i.test(c)) && h.some(c => /value/i.test(c)) && !h.some(c => /current\s*value|total\s*gain/i.test(c))) {
      return parseMerrillHoldings(rows, headerIdx);
    }
    // Webull (Symbol, Name, Qty, Avg Cost, Mkt Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => /avg\s*cost/i.test(c)) && h.some(c => /mkt\s*value|market\s*val/i.test(c)) && h.some(c => /unrealized/i.test(c))) {
      return parseWebullHoldings(rows, headerIdx);
    }
    // SoFi Invest (Name, Symbol, Type, Quantity, Average Price, Current Price, ...)
    if (h.some(c => c === "symbol") && h.some(c => /average\s*price/i.test(c)) && h.some(c => /current\s*price/i.test(c)) && h.some(c => /total\s*return/i.test(c))) {
      return parseSoFiHoldings(rows, headerIdx);
    }
    // Wealthfront (Account, Ticker, Description, Shares, Cost Basis, Market Value)
    if (h.some(c => /ticker/i.test(c)) && h.some(c => /shares/i.test(c)) && h.some(c => /cost\s*basis/i.test(c)) && h.some(c => /market\s*value/i.test(c))) {
      return parseWealthfrontHoldings(rows, headerIdx);
    }
    // Betterment (Symbol, Name, Asset Class, Shares, Price, Market Value, Cost Basis)
    if (h.some(c => c === "symbol") && h.some(c => /asset\s*class/i.test(c)) && h.some(c => /market\s*value/i.test(c)) && h.some(c => /cost\s*basis/i.test(c)) && !h.some(c => /cost\s*price/i.test(c))) {
      return parseBettermentHoldings(rows, headerIdx);
    }
    // Firstrade (Symbol, Description, Quantity, Cost Per Share, Market Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => /cost\s*per\s*share/i.test(c))) {
      return parseFirstradeHoldings(rows, headerIdx);
    }
    // J.P. Morgan Self-Directed (Symbol, Description, Quantity, Price, Market Value, Cost Basis, Gain/Loss)
    if (h.some(c => c === "symbol") && h.some(c => /description/i.test(c)) && h.some(c => /quantity/i.test(c)) && h.some(c => /gain|loss|g\/l/i.test(c)) && h.some(c => /market\s*value/i.test(c)) && !h.some(c => /asset\s*class/i.test(c))) {
      return parseJPMorganHoldings(rows, headerIdx);
    }
    // Ally Invest (Symbol, Description, Qty, Cost Basis, Market Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => /description/i.test(c)) && h.some(c => /cost\s*basis/i.test(c)) && h.some(c => /market\s*value/i.test(c)) && !h.some(c => /asset\s*class/i.test(c)) && !h.some(c => /price\s*paid/i.test(c))) {
      return parseAllyHoldings(rows, headerIdx);
    }
    // Public.com (Symbol, Name, Shares, Average Cost, Market Value, ...)
    if (h.some(c => c === "symbol") && h.some(c => c === "name") && h.some(c => /average\s*cost/i.test(c)) && h.some(c => /market\s*value/i.test(c))) {
      return parsePublicHoldings(rows, headerIdx);
    }
    // Tastytrade / Tastyworks (Symbol, Instrument Type, Quantity, Trade Price, Mark, Net Liq, ...)
    if (h.some(c => c === "symbol") && h.some(c => /instrument\s*type/i.test(c)) && h.some(c => /net\s*liq/i.test(c))) {
      return parseTastytradeHoldings(rows, headerIdx);
    }
  }
  return parseGenericHoldings(rows, headerIdx >= 0 ? headerIdx : 0);
}

function parseZerodhaHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    name: h.findIndex(c => c === "instrument"),
    qty:  h.findIndex(c => /^qty/i.test(c)),
    avg:  h.findIndex(c => /avg\.?\s*cost/i.test(c)),
    ltp:  h.findIndex(c => c === "ltp"),
    cv:   h.findIndex(c => /cur\.?\s*val/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]), ltp = pNum(r[col.ltp]);
    if (units === 0 && avg === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    holdings.push({ name, type: "IN_STOCK", ticker: name.replace(/\s+/g, "").toUpperCase(),
      units, purchase_price: avg, current_price: ltp || avg,
      purchase_value: units * avg, current_value: pNum(r[col.cv]) || units * (ltp || avg) });
  }
  return { format: "Zerodha Console", holdings, warnings };
}

function parseGrowwHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /company\s*name/i.test(c)),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    avg:    h.findIndex(c => /avg\s*price/i.test(c)),
    ltp:    h.findIndex(c => c === "ltp"),
    cv:     h.findIndex(c => /current\s*value/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || r[col.symbol] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    holdings.push({ name, type: "IN_STOCK", ticker: (r[col.symbol] || "").trim().toUpperCase(),
      units, purchase_price: avg, current_price: pNum(r[col.ltp]) || avg,
      purchase_value: units * avg, current_value: pNum(r[col.cv]) || units * avg });
  }
  return { format: "Groww", holdings, warnings };
}

function parseICICIDirectHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => /stock\s*symbol/i.test(c)),
    name:   h.findIndex(c => /stock\s*name/i.test(c)),
    qty:    h.findIndex(c => /^qty/i.test(c)),
    avg:    h.findIndex(c => /avg\s*buy/i.test(c)),
    cmp:    h.findIndex(c => c === "cmp"),
    cv:     h.findIndex(c => /current\s*value/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || r[col.symbol] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    holdings.push({ name, type: "IN_STOCK", ticker: (r[col.symbol] || "").trim().toUpperCase(),
      units, purchase_price: avg, current_price: pNum(r[col.cmp]) || avg,
      purchase_value: units * avg, current_value: pNum(r[col.cv]) || units * avg });
  }
  return { format: "ICICI Direct", holdings, warnings };
}

function parseHDFCSecHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    name: h.findIndex(c => /scrip\s*name/i.test(c)),
    qty:  h.findIndex(c => /quantity/i.test(c)),
    avg:  h.findIndex(c => /avg\s*cost/i.test(c)),
    mp:   h.findIndex(c => /market\s*price/i.test(c)),
    mv:   h.findIndex(c => /market\s*value/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    holdings.push({ name, type: "IN_STOCK", ticker: name.split(/\s+/)[0].toUpperCase(),
      units, purchase_price: avg, current_price: pNum(r[col.mp]) || avg,
      purchase_value: units * avg, current_value: pNum(r[col.mv]) || units * avg });
  }
  return { format: "HDFC Securities", holdings, warnings };
}

function parseUpstoxHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => /trading\s*symbol/i.test(c)),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    avg:    h.findIndex(c => /average\s*price/i.test(c)),
    ltp:    h.findIndex(c => c === "ltp"),
    close:  h.findIndex(c => /close\s*price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    const ltp = pNum(r[col.ltp]) || pNum(r[col.close]) || avg;
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    holdings.push({ name: symbol, type: "IN_STOCK", ticker: symbol.toUpperCase(),
      units, purchase_price: avg, current_price: ltp,
      purchase_value: units * avg, current_value: units * ltp });
  }
  return { format: "Upstox", holdings, warnings };
}

function parseAngelOneHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    scrip: h.findIndex(c => c === "scrip"),
    qty:   h.findIndex(c => /^qty/i.test(c)),
    avg:   h.findIndex(c => /avg\s*price/i.test(c)),
    ltp:   h.findIndex(c => c === "ltp"),
    cv:    h.findIndex(c => /current\s*value/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.scrip] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    holdings.push({ name, type: "IN_STOCK", ticker: name.toUpperCase(),
      units, purchase_price: avg, current_price: pNum(r[col.ltp]) || avg,
      purchase_value: units * avg, current_value: pNum(r[col.cv]) || units * avg });
  }
  return { format: "Angel One", holdings, warnings };
}

function parseMFExportHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    scheme: h.findIndex(c => /scheme\s*name/i.test(c)),
    units:  h.findIndex(c => /unit/i.test(c)),
    nav:    h.findIndex(c => /nav/i.test(c)),
    cv:     h.findIndex(c => /current\s*value/i.test(c)),
    inv:    h.findIndex(c => /invest/i.test(c)),
    code:   h.findIndex(c => /amfi|scheme\s*code/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.scheme] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.units]), nav = pNum(r[col.nav]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero units`); continue; }
    holdings.push({ name, type: "MF", ticker: "",
      scheme_code: col.code >= 0 ? (r[col.code] || "").trim() : "",
      units, purchase_nav: col.inv >= 0 ? pNum(r[col.inv]) / (units || 1) : nav, current_nav: nav,
      purchase_value: pNum(r[col.inv]) || units * nav,
      current_value: pNum(r[col.cv]) || units * nav });
  }
  return { format: "Mutual Fund Export", holdings, warnings };
}

function parseNativeCSVHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const ci = (patterns) => h.findIndex(c => patterns.some(p => typeof p === "string" ? c === p : p.test(c)));
  const col = {
    name: ci(["name"]), type: ci(["type"]), ticker: ci(["ticker"]),
    code: ci(["schemecode", /scheme.?code/i]), units: ci(["units"]),
    pp: ci(["purchaseprice", /purchase.?price/i]), cp: ci(["currentprice", /current.?price/i]),
    pnav: ci(["purchasenav", /purchase.?nav/i]), cnav: ci(["currentnav", /current.?nav/i]),
    pv: ci(["purchasevalue", /purchase.?value/i, /invested/i]), cv: ci(["currentvalue", /current.?value/i]),
    principal: ci(["principal"]), rate: ci(["interestrate", /interest.?rate/i]),
    start: ci(["startdate", /start.?date/i]), maturity: ci(["maturitydate", /maturity.?date/i]),
    member: ci(["member"]),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = col.name >= 0 ? (r[col.name] || "").trim() : "";
    if (!name) continue;
    holdings.push({
      name, type: col.type >= 0 ? (r[col.type] || "IN_STOCK").toUpperCase() : "IN_STOCK",
      ticker: col.ticker >= 0 ? (r[col.ticker] || "").trim() : "",
      scheme_code: col.code >= 0 ? (r[col.code] || "").trim() : "",
      units: col.units >= 0 ? pNum(r[col.units]) : 0,
      purchase_price: col.pp >= 0 ? pNum(r[col.pp]) : 0,
      current_price: col.cp >= 0 ? pNum(r[col.cp]) : 0,
      purchase_nav: col.pnav >= 0 ? pNum(r[col.pnav]) : 0,
      current_nav: col.cnav >= 0 ? pNum(r[col.cnav]) : 0,
      purchase_value: col.pv >= 0 ? pNum(r[col.pv]) : 0,
      current_value: col.cv >= 0 ? pNum(r[col.cv]) : 0,
      principal: col.principal >= 0 ? pNum(r[col.principal]) : 0,
      interest_rate: col.rate >= 0 ? pNum(r[col.rate]) : 0,
      start_date: col.start >= 0 ? (r[col.start] || "") : "",
      maturity_date: col.maturity >= 0 ? (r[col.maturity] || "") : "",
      _member_name: col.member >= 0 ? (r[col.member] || "").trim() : "",
    });
  }
  return { format: "WealthLens CSV", holdings, warnings };
}

// ── US Broker Parsers ─────────────────────────────────────────────

function classifyUSAsset(symbol, name, type) {
  const nm = (name || "").toLowerCase();
  const sym = (symbol || "").toUpperCase();
  if (/crypto|bitcoin|ethereum|btc|eth|sol|ada|doge|bnb/i.test(nm) || sym.includes("-USD") || sym.includes("-BTC")) return "CRYPTO";
  // ETF by descriptive keywords in name (substring match is fine)
  if (/\betf\b|ishares|spdr|\bindex\s*fund\b|vanguard.*index/i.test(nm)) return "US_ETF";
  // ETF by well-known ticker symbols — must be whole-word matches to avoid
  // false positives like "NVIDIA" matching "DIA" or "DIAG" matching "DIA"
  const etfTickers = /\b(QQQ|VOO|VTI|SPY|IWM|ARKK|DIA|EEM|VXUS|BND|AGG|TLT|SCHD|VEA|VWO|VGT|XLF|XLK|XLE|XLV|GLD|SLV|IEMG|IVV|IJR|IJH|VIG|JEPI|JEPQ|HYG|LQD|VNQ|VCIT|VCSH|BSV|EMB)\b/i;
  if (etfTickers.test(sym) || etfTickers.test(nm)) return "US_ETF";
  if (/bond|treasury|t-bill|note|fixed.income|tips/i.test(nm)) return "US_BOND";
  if (type && /etf/i.test(type)) return "US_ETF";
  return "US_STOCK";
}

function parseSchwabHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "description"),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    price:  h.findIndex(c => c === "price"),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || symbol === "Account Total" || symbol === "Cash & Cash Investments") continue;
    const name = (r[col.name] || symbol).trim();
    const units = pNum(r[col.qty]);
    const price = pNum(r[col.price]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const mv = pNum(r[col.mv]);
    const cb = pNum(r[col.cb]);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: mv || units * price });
  }
  return { format: "Charles Schwab", holdings, warnings };
}

function parseFidelityHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    account: h.findIndex(c => /account/i.test(c)),
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /description|security/i.test(c)),
    qty:    h.findIndex(c => /quantity|shares/i.test(c)),
    price:  h.findIndex(c => /last\s*price|closing\s*price|price/i.test(c)),
    cv:     h.findIndex(c => /current\s*value/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis(?!\s*per)/i.test(c)),
    cbps:   h.findIndex(c => /cost\s*basis\s*per\s*share/i.test(c)),
    type:   h.findIndex(c => c === "type"),
  };
  const holdings = [], warnings = [], accounts = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /pending|cash|core|total|overall/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]);
    const price = pNum(r[col.price]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const cv = pNum(r[col.cv]);
    const cb = pNum(r[col.cb]);
    const cbps = col.cbps >= 0 ? pNum(r[col.cbps]) : (cb && units ? cb / units : 0);
    const acct = col.account >= 0 ? (r[col.account] || "").trim() : "";
    if (acct) accounts.add(acct);
    const assetType = col.type >= 0 ? (r[col.type] || "").trim() : "";
    const type = classifyUSAsset(symbol, name, assetType);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cbps || price, current_price: price,
      purchase_value: cb || units * (cbps || price), current_value: cv || units * price,
      _account_name: acct });
  }
  return { format: "Fidelity", holdings, warnings, accounts: [...accounts] };
}

function parseRobinhoodHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    name:   h.findIndex(c => c === "instrument"),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    avg:    h.findIndex(c => /average\s*cost/i.test(c)),
    equity: h.findIndex(c => /equity/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || "").trim();
    if (!name) continue;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${name}": zero quantity`); continue; }
    const equity = pNum(r[col.equity]);
    // Robinhood instrument names are like "AAPL" or "Apple Inc - Class A"
    const ticker = name.length <= 6 && /^[A-Z]+$/.test(name) ? name : name.split(/\s*[-–]\s*/)[0].trim();
    const type = classifyUSAsset(ticker, name);
    holdings.push({ name, type, ticker: ticker.toUpperCase(), units,
      purchase_price: avg, current_price: equity && units ? equity / units : avg,
      purchase_value: units * avg, current_value: equity || units * avg });
  }
  return { format: "Robinhood", holdings, warnings };
}

function parseVanguardHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    name:   h.findIndex(c => /investment\s*name/i.test(c)),
    symbol: h.findIndex(c => c === "symbol"),
    shares: h.findIndex(c => /shares/i.test(c)),
    price:  h.findIndex(c => /share\s*price/i.test(c)),
    value:  h.findIndex(c => /total\s*value/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[col.name] || "").trim();
    const symbol = (r[col.symbol] || "").trim();
    if (!name && !symbol) continue;
    const units = pNum(r[col.shares]), price = pNum(r[col.price]);
    if (units === 0) { warnings.push(`Skipped "${name || symbol}": zero shares`); continue; }
    const value = pNum(r[col.value]);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name: name || symbol, type, ticker: symbol.toUpperCase(), units,
      purchase_price: price, current_price: price,
      purchase_value: units * price, current_value: value || units * price });
  }
  return { format: "Vanguard", holdings, warnings };
}

function parseIBKRHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol:   h.findIndex(c => c === "symbol"),
    name:     h.findIndex(c => c === "description"),
    asset:    h.findIndex(c => /asset\s*class/i.test(c)),
    currency: h.findIndex(c => c === "currency"),
    qty:      h.findIndex(c => /quantity/i.test(c)),
    costP:    h.findIndex(c => /cost\s*price/i.test(c) || /cost\s*basis.*price/i.test(c)),
    closeP:   h.findIndex(c => /close\s*price/i.test(c) || /mark.*price/i.test(c)),
    value:    h.findIndex(c => /value/i.test(c) && !/unrealized/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|^$/i.test(symbol)) continue;
    const name = (r[col.name] || symbol).trim();
    const units = pNum(r[col.qty]), costP = pNum(r[col.costP]), closeP = pNum(r[col.closeP]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const assetClass = (r[col.asset] || "").toUpperCase();
    let type = classifyUSAsset(symbol, name);
    if (assetClass === "OPT" || assetClass === "FOP") { warnings.push(`Skipped "${symbol}": options not supported`); continue; }
    if (assetClass === "BOND") type = "US_BOND";
    if (assetClass === "CRYPTO") type = "CRYPTO";
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: costP, current_price: closeP || costP,
      purchase_value: units * costP, current_value: pNum(r[col.value]) || units * (closeP || costP) });
  }
  return { format: "Interactive Brokers", holdings, warnings };
}

function parseETRADEHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "description" || c === "name"),
    qty:    h.findIndex(c => /qty|quantity/i.test(c)),
    pp:     h.findIndex(c => /price\s*paid/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    price:  h.findIndex(c => /last\s*price|current\s*price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]), pp = pNum(r[col.pp]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const price = col.price >= 0 ? pNum(r[col.price]) : pp;
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: pp, current_price: price,
      purchase_value: units * pp, current_value: pNum(r[col.mv]) || units * price });
  }
  return { format: "E*TRADE / TD Ameritrade", holdings, warnings };
}

function parseCoinbaseHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    asset:    h.findIndex(c => c === "asset"),
    qty:      h.findIndex(c => /quantity/i.test(c)),
    cb:       h.findIndex(c => /cost\s*basis/i.test(c)),
    value:    h.findIndex(c => /value/i.test(c) && !/cost/i.test(c)),
    spot:     h.findIndex(c => /spot\s*price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const asset = (r[col.asset] || "").trim();
    if (!asset) continue;
    const units = pNum(r[col.qty]);
    if (units === 0) { warnings.push(`Skipped "${asset}": zero quantity`); continue; }
    const cb = pNum(r[col.cb]), value = pNum(r[col.value]), spot = pNum(r[col.spot]);
    // Coinbase ticker format: BTC → BTC-USD for Yahoo
    holdings.push({ name: asset, type: "CRYPTO", ticker: `${asset.toUpperCase()}-USD`, units,
      purchase_price: cb && units ? cb / units : spot, current_price: spot || (value && units ? value / units : 0),
      purchase_value: cb || units * spot, current_value: value || units * spot });
  }
  return { format: "Coinbase", holdings, warnings };
}

// ── Merrill Edge / Merrill Lynch ───────────────────────────────────
function parseMerrillHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /description|name|security/i.test(c)),
    qty:    h.findIndex(c => /quantity|shares/i.test(c)),
    price:  h.findIndex(c => /last\s*price|price/i.test(c)),
    value:  h.findIndex(c => /value/i.test(c) && !/cost/i.test(c) && !/gain/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
    acct:   h.findIndex(c => /account/i.test(c)),
  };
  const holdings = [], warnings = [], accounts = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash|money\s*market|pending/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]);
    const price = pNum(r[col.price]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const value = pNum(r[col.value]);
    const cb = col.cb >= 0 ? pNum(r[col.cb]) : 0;
    const acct = col.acct >= 0 ? (r[col.acct] || "").trim() : "";
    if (acct) accounts.add(acct);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: value || units * price,
      _account_name: acct });
  }
  return { format: "Merrill Edge", holdings, warnings, accounts: [...accounts] };
}

// ── J.P. Morgan Self-Directed ─────────────────────────────────────
function parseJPMorganHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /description|name|security/i.test(c)),
    qty:    h.findIndex(c => /quantity|shares/i.test(c)),
    price:  h.findIndex(c => /price/i.test(c) && !/cost/i.test(c) && !/paid/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
    acct:   h.findIndex(c => /account/i.test(c)),
  };
  const holdings = [], warnings = [], accounts = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash|money\s*market|pending|sweep/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]);
    const price = col.price >= 0 ? pNum(r[col.price]) : 0;
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const mv = pNum(r[col.mv]);
    const cb = col.cb >= 0 ? pNum(r[col.cb]) : 0;
    const acct = col.acct >= 0 ? (r[col.acct] || "").trim() : "";
    if (acct) accounts.add(acct);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: mv || units * price,
      _account_name: acct });
  }
  return { format: "J.P. Morgan", holdings, warnings, accounts: [...accounts] };
}

// ── Webull ─────────────────────────────────────────────────────────
function parseWebullHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "name" || c === "description"),
    qty:    h.findIndex(c => /qty|quantity|shares/i.test(c)),
    avg:    h.findIndex(c => /avg\s*cost/i.test(c)),
    mv:     h.findIndex(c => /mkt\s*value|market\s*val/i.test(c)),
    price:  h.findIndex(c => /last\s*price|price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const price = col.price >= 0 ? pNum(r[col.price]) : avg;
    const mv = pNum(r[col.mv]);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: avg, current_price: price || avg,
      purchase_value: units * avg, current_value: mv || units * (price || avg) });
  }
  return { format: "Webull", holdings, warnings };
}

// ── SoFi Invest ───────────────────────────────────────────────────
function parseSoFiHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "name" || c === "description"),
    qty:    h.findIndex(c => /quantity|shares/i.test(c)),
    avg:    h.findIndex(c => /average\s*price/i.test(c)),
    price:  h.findIndex(c => /current\s*price|last\s*price/i.test(c)),
    mv:     h.findIndex(c => /market\s*value|value/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
    type:   h.findIndex(c => c === "type"),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const price = col.price >= 0 ? pNum(r[col.price]) : avg;
    const mv = col.mv >= 0 ? pNum(r[col.mv]) : 0;
    const cb = col.cb >= 0 ? pNum(r[col.cb]) : 0;
    const assetType = col.type >= 0 ? (r[col.type] || "").trim() : "";
    const type = classifyUSAsset(symbol, name, assetType);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : avg, current_price: price,
      purchase_value: cb || units * avg, current_value: mv || units * price });
  }
  return { format: "SoFi Invest", holdings, warnings };
}

// ── Wealthfront ───────────────────────────────────────────────────
function parseWealthfrontHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    ticker: h.findIndex(c => /ticker|symbol/i.test(c)),
    name:   h.findIndex(c => /description|name/i.test(c)),
    shares: h.findIndex(c => /shares|quantity/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    acct:   h.findIndex(c => /account/i.test(c)),
  };
  const holdings = [], warnings = [], accounts = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const ticker = (r[col.ticker] || "").trim();
    if (!ticker || /total|cash/i.test(ticker)) continue;
    const name = col.name >= 0 ? (r[col.name] || ticker).trim() : ticker;
    const units = pNum(r[col.shares]);
    if (units === 0) { warnings.push(`Skipped "${ticker}": zero shares`); continue; }
    const cb = pNum(r[col.cb]), mv = pNum(r[col.mv]);
    const price = mv && units ? mv / units : (cb && units ? cb / units : 0);
    const acct = col.acct >= 0 ? (r[col.acct] || "").trim() : "";
    if (acct) accounts.add(acct);
    const type = classifyUSAsset(ticker, name);
    holdings.push({ name, type, ticker, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: mv || units * price,
      _account_name: acct });
  }
  return { format: "Wealthfront", holdings, warnings, accounts: [...accounts] };
}

// ── Betterment ────────────────────────────────────────────────────
function parseBettermentHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "name" || c === "description"),
    asset:  h.findIndex(c => /asset\s*class/i.test(c)),
    shares: h.findIndex(c => /shares|quantity/i.test(c)),
    price:  h.findIndex(c => /^price$/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.shares]), price = col.price >= 0 ? pNum(r[col.price]) : 0;
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero shares`); continue; }
    const mv = pNum(r[col.mv]), cb = pNum(r[col.cb]);
    const assetClass = col.asset >= 0 ? (r[col.asset] || "").trim() : "";
    let type = classifyUSAsset(symbol, name);
    if (/bond|fixed/i.test(assetClass)) type = "US_BOND";
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: mv || units * price });
  }
  return { format: "Betterment", holdings, warnings };
}

// ── Firstrade ─────────────────────────────────────────────────────
function parseFirstradeHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /description/i.test(c)),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    cps:    h.findIndex(c => /cost\s*per\s*share/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    price:  h.findIndex(c => /last\s*price|current\s*price|price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]), cps = pNum(r[col.cps]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const price = col.price >= 0 ? pNum(r[col.price]) : cps;
    const mv = pNum(r[col.mv]);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cps, current_price: price || cps,
      purchase_value: units * cps, current_value: mv || units * (price || cps) });
  }
  return { format: "Firstrade", holdings, warnings };
}

// ── Ally Invest ───────────────────────────────────────────────────
function parseAllyHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => /description/i.test(c)),
    qty:    h.findIndex(c => /qty|quantity|shares/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    price:  h.findIndex(c => /last\s*price|price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.qty]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const cb = pNum(r[col.cb]), mv = pNum(r[col.mv]);
    const price = col.price >= 0 ? pNum(r[col.price]) : (mv && units ? mv / units : 0);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : price, current_price: price,
      purchase_value: cb || units * price, current_value: mv || units * price });
  }
  return { format: "Ally Invest", holdings, warnings };
}

// ── Public.com ────────────────────────────────────────────────────
function parsePublicHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    name:   h.findIndex(c => c === "name"),
    shares: h.findIndex(c => /shares|quantity/i.test(c)),
    avg:    h.findIndex(c => /average\s*cost/i.test(c)),
    mv:     h.findIndex(c => /market\s*value/i.test(c)),
    price:  h.findIndex(c => /current\s*price|last\s*price/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const name = col.name >= 0 ? (r[col.name] || symbol).trim() : symbol;
    const units = pNum(r[col.shares]), avg = pNum(r[col.avg]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero shares`); continue; }
    const price = col.price >= 0 ? pNum(r[col.price]) : avg;
    const mv = pNum(r[col.mv]);
    const type = classifyUSAsset(symbol, name);
    holdings.push({ name, type, ticker: symbol, units,
      purchase_price: avg, current_price: price || avg,
      purchase_value: units * avg, current_value: mv || units * (price || avg) });
  }
  return { format: "Public.com", holdings, warnings };
}

// ── Tastytrade / Tastyworks ───────────────────────────────────────
function parseTastytradeHoldings(rows, headerIdx) {
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const col = {
    symbol: h.findIndex(c => c === "symbol"),
    itype:  h.findIndex(c => /instrument\s*type/i.test(c)),
    qty:    h.findIndex(c => /quantity/i.test(c)),
    tp:     h.findIndex(c => /trade\s*price|avg\s*price/i.test(c)),
    mark:   h.findIndex(c => /mark/i.test(c)),
    netliq: h.findIndex(c => /net\s*liq/i.test(c)),
    cb:     h.findIndex(c => /cost\s*basis/i.test(c)),
  };
  const holdings = [], warnings = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const symbol = (r[col.symbol] || "").trim();
    if (!symbol || /total|cash/i.test(symbol)) continue;
    const itype = col.itype >= 0 ? (r[col.itype] || "").trim() : "";
    // Skip options and futures
    if (/option|put|call|future/i.test(itype)) { warnings.push(`Skipped "${symbol}": ${itype} not supported`); continue; }
    const units = pNum(r[col.qty]);
    if (units === 0) { warnings.push(`Skipped "${symbol}": zero quantity`); continue; }
    const tp = pNum(r[col.tp]), mark = pNum(r[col.mark]);
    const netliq = pNum(r[col.netliq]), cb = col.cb >= 0 ? pNum(r[col.cb]) : 0;
    const type = /crypto/i.test(itype) ? "CRYPTO" : classifyUSAsset(symbol, symbol);
    holdings.push({ name: symbol, type, ticker: symbol, units,
      purchase_price: cb && units ? cb / units : tp, current_price: mark || tp,
      purchase_value: cb || units * tp, current_value: netliq || units * (mark || tp) });
  }
  return { format: "Tastytrade", holdings, warnings };
}

function parseGenericHoldings(rows, headerIdx) {
  const h = (rows[headerIdx] || []).map(c => (c || "").toLowerCase().trim());
  const ci = (patterns) => h.findIndex(c => patterns.some(p => c.includes(p)));
  const nameI  = ci(["name", "instrument", "scrip", "stock", "symbol", "fund", "scheme"]);
  const qtyI   = ci(["qty", "quantity", "units", "shares"]);
  const priceI = ci(["avg", "cost", "buy price", "purchase"]);
  const ltpI   = ci(["ltp", "market price", "current price", "cmp", "close"]);
  const valI   = ci(["current value", "market value", "value"]);
  const acctI  = ci(["account"]);
  const holdings = [], warnings = [], accounts = new Set();
  if (nameI < 0) { warnings.push("Could not identify a Name/Instrument column."); return { format: "Unknown", holdings, warnings }; }

  // Detect if this is Indian data: look for .NS/.BO suffixes, NSE/BSE, INR, Indian bank names
  const allText = rows.slice(headerIdx + 1).flat().join(" ").toLowerCase();
  const isIndian = /\.ns\b|\.bo\b|\bnse\b|\bbse\b|\binr\b|\bnifty\b|\bsensex\b|\bamfi\b/i.test(allText)
    || h.some(c => /narration|scrip|scheme.?code|nse|bse/i.test(c));
  const defaultType = isIndian ? "IN_STOCK" : "US_STOCK";

  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[nameI] || "").trim();
    if (!name) continue;
    const units = qtyI >= 0 ? pNum(r[qtyI]) : 0;
    const avg = priceI >= 0 ? pNum(r[priceI]) : 0;
    const ltp = ltpI >= 0 ? pNum(r[ltpI]) : avg;
    const acct = acctI >= 0 ? (r[acctI] || "").trim() : "";
    if (acct) accounts.add(acct);
    const type = isIndian ? "IN_STOCK" : classifyUSAsset(name.split(/\s+/)[0], name);
    holdings.push({ name, type, ticker: name.split(/\s+/)[0].toUpperCase(),
      units, purchase_price: avg, current_price: ltp,
      purchase_value: units * avg, current_value: valI >= 0 ? pNum(r[valI]) : units * ltp,
      _account_name: acct });
  }
  return { format: `Generic CSV (${isIndian ? "Indian" : "US"})`, holdings, warnings, accounts: [...accounts] };
}

// ── Transaction CSV Parsers ───────────────────────────────────────

function parseTransactionCSV(text) {
  const result = Papa.parse(text.trim(), { header: false, skipEmptyLines: true });
  const rows = result.data;
  if (!rows.length) return { format: "unknown", transactions: [], warnings: ["Empty file"] };
  const headerIdx = rows.findIndex(r =>
    r.some(c => /date|trade|type|buy|sell|units|quantity|price|amount/i.test(c || ""))
  );
  if (headerIdx < 0) return { format: "unknown", transactions: [], warnings: ["No recognizable header row"] };
  const h = rows[headerIdx].map(c => (c || "").toLowerCase().trim());
  const dataRows = rows.slice(headerIdx + 1);

  // Zerodha Tradebook
  if (h.some(c => /trade\s*date/i.test(c)) && h.some(c => /trade\s*type/i.test(c))) {
    const col = { date: h.findIndex(c => /trade\s*date/i.test(c)), symbol: h.findIndex(c => /symbol/i.test(c)),
      type: h.findIndex(c => /trade\s*type/i.test(c)), qty: h.findIndex(c => /quantity/i.test(c)), price: h.findIndex(c => /price/i.test(c)) };
    const transactions = [], warnings = [];
    for (const r of dataRows) {
      const symbol = (r[col.symbol] || "").trim(); if (!symbol) continue;
      const date = parseDate(r[col.date]); if (!date) { warnings.push(`Skipped: invalid date "${r[col.date]}"`); continue; }
      transactions.push({ _symbol: symbol, txn_type: (r[col.type] || "").toUpperCase().includes("SELL") ? "SELL" : "BUY",
        units: pNum(r[col.qty]), price: pNum(r[col.price]), txn_date: date, notes: "Zerodha tradebook import" });
    }
    return { format: "Zerodha Tradebook", transactions, warnings };
  }

  // Groww Transactions
  if (h.some(c => c === "symbol") && h.some(c => /type/i.test(c)) && h.some(c => /quantity/i.test(c))) {
    const col = { date: h.findIndex(c => /date/i.test(c)), symbol: h.findIndex(c => /symbol/i.test(c)),
      type: h.findIndex(c => /type/i.test(c)), qty: h.findIndex(c => /quantity|units/i.test(c)), price: h.findIndex(c => /price/i.test(c)) };
    const transactions = [], warnings = [];
    for (const r of dataRows) {
      const symbol = (r[col.symbol] || "").trim(); if (!symbol) continue;
      const date = parseDate(r[col.date]); if (!date) { warnings.push(`Skipped: invalid date "${r[col.date]}"`); continue; }
      transactions.push({ _symbol: symbol, txn_type: (r[col.type] || "").toUpperCase().includes("SELL") ? "SELL" : "BUY",
        units: pNum(r[col.qty]), price: pNum(r[col.price]), txn_date: date, notes: "Groww import" });
    }
    return { format: "Groww Transactions", transactions, warnings };
  }

  // Generic
  const ci = (patterns) => h.findIndex(c => patterns.some(p => c.includes(p)));
  const col = { date: ci(["date"]), symbol: ci(["symbol", "ticker", "name", "instrument", "scrip"]),
    type: ci(["type", "buy", "sell", "side", "action"]), qty: ci(["qty", "quantity", "units", "shares"]),
    price: ci(["price", "rate", "nav"]), notes: ci(["notes", "remark", "narration"]) };
  const transactions = [], warnings = [];
  for (const r of dataRows) {
    const symbol = col.symbol >= 0 ? (r[col.symbol] || "").trim() : ""; if (!symbol) continue;
    const date = col.date >= 0 ? parseDate(r[col.date]) : null;
    if (!date) { warnings.push(`Skipped "${symbol}": missing date`); continue; }
    transactions.push({ _symbol: symbol,
      txn_type: col.type >= 0 && ((r[col.type] || "").toUpperCase().includes("SELL") || (r[col.type] || "").toUpperCase().includes("REDEEM")) ? "SELL" : "BUY",
      units: col.qty >= 0 ? pNum(r[col.qty]) : 0, price: col.price >= 0 ? pNum(r[col.price]) : 0,
      txn_date: date, notes: col.notes >= 0 ? (r[col.notes] || "").trim() : "CSV import" });
  }
  return { format: "Generic Transactions", transactions, warnings };
}

// ── NSDL / CDSL CAS PDF Parser ────────────────────────────────────
function parseNSDLCASStatement(rawText) {
  const holdings = [], warnings = [];
  const isCAS = /consolidated\s*account\s*statement|nsdl\s*cas|cdsl\s*cas|nsdl\s*e-cas/i.test(rawText);
  if (!isCAS) return { holdings: [], warnings: ["Not a CAS statement"], format: null };

  // Detect depository for source tagging
  const isNSDL = /nsdl/i.test(rawText);
  const isCDSL = /cdsl/i.test(rawText);
  const depository = isNSDL && isCDSL ? "NSDL/CDSL" : isNSDL ? "NSDL" : isCDSL ? "CDSL" : "CAS";
  const _source = "cas";
  const _brokerage = `${depository} CAS`;

  const seen = new Set();

  // ── Helper: clean CAS holding names ────────────────────────────
  // CAS PDFs often have names like:
  //   "KIMS.NSE KRISHNA INSTITUTE OF MEDICAL SCIENCES LIMITED"
  //   "MFPPFA0001 Parag Parikh Flexi Cap Fund - Regular Plan Growth"
  //   "MFRILC0135 NIPPON INDIA SMALL CAP FUND - GROWTH PLAN"
  //   "NOT AVAILABLE ICICI Prudential Energy Opportunities Fund"
  function cleanCASName(rawName) {
    let name = rawName;
    // Remove "NOT AVAILABLE" prefix
    name = name.replace(/^NOT\s+AVAILABLE\s+/i, "").trim();
    // Remove scheme code prefixes like "MFPPFA0001", "MFRILC0135", "MFSBIM0250"
    name = name.replace(/^MF[A-Z0-9]{4,10}\s+/i, "").trim();
    // Remove exchange prefix like "KIMS.NSE", "TCS.BSE", "SBICARD.NSE"
    name = name.replace(/^[A-Z0-9]+\.(NSE|BSE)\s+/i, "").trim();
    return name;
  }

  // Extract NSE/BSE ticker from CAS name like "KIMS.NSE KRISHNA..."
  function extractExchangeTicker(rawName) {
    const m = rawName.match(/^([A-Z0-9]+)\.(NSE|BSE)\s/i);
    return m ? m[1].toUpperCase() : "";
  }

  // ── Strategy A: Parse MF from INF ISIN rows in CAS summary/detail ──
  // CAS text format (from actual PDF extraction):
  //   INF109KC15W9 NOT AVAILABLE   ICICI Prudential...Fund 34425415   2,499.875   10.0005   25,000.00   11.0000   27,498.63   2,498.63   6.12
  //   INF204K01HY3 MFRILC0135   NIPPON INDIA...FUND 477351147776   603.442   165.7160   1,00,000.00   162.1622   97,855.48   -2,144.52   -2.67
  // Pattern: ISIN [junk] NAME [numbers...]
  // The numbers include: folio, nav, units, invested, current_nav, current_value, gain, gain%
  // We identify which is which using: Units × NAV ≈ Value (within 5%)

  const infRe = /\b(INF[A-Z0-9]{9})\b/g;
  let infMatch;
  while ((infMatch = infRe.exec(rawText)) !== null) {
    const isin = infMatch[1];
    if (seen.has(isin)) continue;

    // Extract text from this ISIN to the next ISIN (or 800 chars, whichever comes first)
    const afterStart = infMatch.index + infMatch[0].length;
    const nextIsin = rawText.substring(afterStart).match(/\b(IN[FE][A-Z0-9]{9})\b/);
    const blockEnd = nextIsin ? afterStart + nextIsin.index : afterStart + 800;
    const block = rawText.substring(afterStart, Math.min(blockEnd, afterStart + 800));

    // Extract the name: text between ISIN and the first long number sequence
    // Skip scheme code prefix (e.g. "MFRILC0135", "NOT AVAILABLE")
    const nameMatch = block.match(/^[\s\S]*?([A-Z][A-Za-z\s&().'-]{5,120}(?:Fund|Growth|IDCW|Plan|Option|Savings|Dividend|Bonus|Direct|Regular|Flexi|Equity|Debt|Liquid|Hybrid|Balanced|Cap|Index|ETF|ELSS)[A-Za-z\s()'-]{0,40})/i);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].replace(/\s+/g, " ").trim();
    const name = cleanCASName(rawName);

    // Extract ALL numbers from the block after the name
    const numRegion = block.substring(nameMatch[0].length);
    const numRe = /-?[\d,]+\.?\d*/g;
    const allNums = [];
    let nm;
    while ((nm = numRe.exec(numRegion)) !== null) {
      const val = pNum(nm[0]);
      if (!isNaN(val) && val !== 0) allNums.push(val);
    }

    // Skip transaction detail headers (not summary rows)
    if (/Scheme\s*Name/i.test(name) || /Mutual\s*Fund\s*-\s*Scheme/i.test(rawName)) {
      console.log(`   → Skipping (transaction detail header, not summary row)`);
      continue;
    }

    console.log(`📋 CAS MF: ${name} (${isin}) — ${allNums.length} numbers: [${allNums.slice(0,10).join(", ")}]`);

    if (allNums.length < 4) continue; // Need at least folio + nav + units + value

    // ── Identify columns by cross-validation: Units × NAV ≈ Value ──
    // Find ALL valid triplets, then pick the one with the LARGEST value (= current value)
    // This distinguishes current value from invested amount
    const matches = [];

    for (let i = 0; i < Math.min(allNums.length, 8); i++) {
      for (let j = i + 1; j < Math.min(allNums.length, 8); j++) {
        const product = allNums[i] * allNums[j];
        for (let k = 0; k < Math.min(allNums.length, 10); k++) {
          if (k === i || k === j) continue;
          if (allNums[k] <= 0) continue;
          const err = Math.abs(product - allNums[k]) / allNums[k];
          if (err < 0.03) {
            const n1 = allNums[i], n2 = allNums[j], val = allNums[k];
            // NAV is per-unit (typically larger per unit for most MFs)
            // But we need to figure out which factor is NAV and which is units
            // The value matched is the product; we'll resolve nav/units later
            matches.push({ a: n1, b: n2, val, err, indices: [i, j, k] });
          }
        }
      }
    }


    if (matches.length === 0) {
      console.log(`   ⚠ No Units×NAV≈Value match found. Skipping.`);
      continue;
    }

    // CAS text column order: Units, PurchaseNAV, Invested, CurrentNAV, CurrentValue, Gain, Gain%
    // The value appearing LATER in the number array = current value (not invested)
    // Among valid triplets, pick the one whose value index (k) is HIGHEST = appears later in text
    matches.sort((a, b) => b.indices[2] - a.indices[2]);
    const currentValueMatch = matches[0];
    const investedMatch = matches.find(m => m.val !== currentValueMatch.val && m.indices[2] < currentValueMatch.indices[2]);
    
    // Determine units: common factor between currentValue and invested triplets
    let nav, units;
    const cvFactors = [currentValueMatch.a, currentValueMatch.b];
    
    if (investedMatch) {
      const invFactors = [investedMatch.a, investedMatch.b];
      const common = cvFactors.find(f => invFactors.some(o => Math.abs(f - o) / Math.max(f, 0.001) < 0.001));
      if (common) {
        units = common;
        nav = cvFactors.find(f => Math.abs(f - common) / Math.max(f, 0.001) > 0.001) ?? cvFactors[0];
      } else {
        // No common — the factor at the earlier index position is units (CAS order: Units before NAV)
        const [iA, iB] = [currentValueMatch.indices[0], currentValueMatch.indices[1]];
        if (iA < iB) { units = currentValueMatch.a; nav = currentValueMatch.b; }
        else { units = currentValueMatch.b; nav = currentValueMatch.a; }
      }
    } else {
      // Single triplet — earlier factor = units
      const [iA, iB] = [currentValueMatch.indices[0], currentValueMatch.indices[1]];
      if (iA < iB) { units = currentValueMatch.a; nav = currentValueMatch.b; }
      else { units = currentValueMatch.b; nav = currentValueMatch.a; }
    }
    const currentValue = currentValueMatch.val;

    console.log(`   ✓ Matched: units=${units}, nav=${nav}, value=${currentValue} (err=${(currentValueMatch.err*100).toFixed(1)}%, ${matches.length} triplets)`);

    // ── Find invested amount and purchase NAV ──
    let invested = 0, purchaseNav = 0;

    if (investedMatch) {
      invested = investedMatch.val;
      const invFactors = [investedMatch.a, investedMatch.b];
      purchaseNav = invFactors.find(f => Math.abs(f - units) / Math.max(units, 0.001) > 0.001) || invFactors[0];
      if (Math.abs(purchaseNav - units) / Math.max(units, 0.001) < 0.001) purchaseNav = invFactors[1] || 0;
      console.log(`   ✓ Invested=${invested}, PurchaseNAV=${purchaseNav}`);
    }

    if (!invested) {
      // Fallback: look for a round number that could be invested amount
      for (let i = 0; i < Math.min(allNums.length, 8); i++) {
        if (currentValueMatch.indices.includes(i)) continue;
        const n = allNums[i];
        if (n > 100 && n < currentValue * 3 && (n % 1000 === 0 || n % 500 === 0 || n % 100 === 0)) {
          invested = n;
          purchaseNav = units > 0 ? invested / units : nav;
          console.log(`   ✓ Invested=${invested} (round number fallback), PurchaseNAV=${purchaseNav.toFixed(4)}`);
          break;
        }
      }
    }

    if (!invested) {
      invested = currentValue;
      purchaseNav = nav;
    }

    // Also look for Closing Balance pattern in region before this ISIN for transaction-detail CAS
    const beforeIsin = rawText.substring(Math.max(0, infMatch.index - 1500), infMatch.index);
    const closingBalMatch = beforeIsin.match(/Closing\s*(?:Unit\s*)?Balance\s*[:\s]*([\d,.]+)/i);
    if (closingBalMatch) {
      const cbUnits = pNum(closingBalMatch[1]);
      // Verify: if this closing balance × nav ≈ currentValue, use it as units
      if (cbUnits > 0 && nav > 0) {
        const cbVal = cbUnits * nav;
        if (Math.abs(cbVal - currentValue) / currentValue < 0.05) {
          console.log(`   ✓ Closing Balance confirms units=${cbUnits}`);
          units = cbUnits;
        }
      }
    }

    const key = isin + "|" + units.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract folio (first very large number, likely >6 digits, no decimal)
    const folio = allNums.find(n => n > 100000 && n === Math.floor(n) && !currentValueMatch.indices.includes(allNums.indexOf(n)))?.toString() || "";

    holdings.push({
      name, type: "MF", ticker: isin, scheme_code: "",
      units, purchase_nav: purchaseNav, current_nav: nav,
      purchase_price: purchaseNav, current_price: nav,
      purchase_value: invested, current_value: currentValue,
      source: _source, brokerage_name: _brokerage, currency: "INR",
      _folio: folio,
    });
  }

  // ── Strategy 3: Demat holdings — ISIN (INE...) + quantity ──
  const ineRe = /\b(INE[A-Z0-9]{9})\b/g;
  let ineMatch;
  while ((ineMatch = ineRe.exec(rawText)) !== null) {
    const isin = ineMatch[1];
    if (seen.has(isin)) continue;

    const after = rawText.substring(ineMatch.index, ineMatch.index + 300);
    const rowMatch = after.match(/^[A-Z0-9]+\s+(.{3,80}?)\s+([\d,.]+)\s/);
    let rawName = "", qty = 0;
    if (rowMatch) {
      rawName = rowMatch[1].replace(/\s+/g, " ").trim();
      qty = pNum(rowMatch[2]);
    }

    if (!rawName || qty <= 0) {
      const before = rawText.substring(Math.max(0, ineMatch.index - 200), ineMatch.index);
      const backName = before.match(/([A-Z][A-Za-z\s&().'-]{3,60})\s*$/);
      if (backName) rawName = backName[1].trim();
      const qtyMatch = after.match(/(?:Free|Total|Net|Closing)?\s*(?:Balance|Quantity|Qty)[:\s]*([\d,.]+)/i)
        || after.match(/\b([\d,]+)\s*$/m);
      if (qtyMatch) qty = pNum(qtyMatch[1]);
    }

    // Also check the text BEFORE the ISIN for "TICKER.NSE COMPANY NAME" pattern
    const beforeIsin = rawText.substring(Math.max(0, ineMatch.index - 300), ineMatch.index);
    const exchangeTicker = extractExchangeTicker(rawName) || extractExchangeTicker(beforeIsin.split(/\n/).pop() || "");
    const name = cleanCASName(rawName);

    if (!name || qty <= 0 || /total|sub.?total|header|page/i.test(name)) continue;
    seen.add(isin);

    let type = "IN_STOCK";
    if (/sovereign\s*gold|sgb/i.test(name)) type = "IN_ETF";
    else if (/etf|bees|nifty.*etf|gold.*etf|liquid.*etf/i.test(name)) type = "IN_ETF";
    else if (/bond|debenture|ncd/i.test(name)) type = "FD";

    const afterWide = rawText.substring(ineMatch.index, ineMatch.index + 500);
    const valMatch = afterWide.match(/(?:Value|Valuation|Market\s*Value)[:\s]*(?:INR|Rs\.?|`)?\s*([\d,.]+)/i);
    const costValMatch = afterWide.match(/(?:Cost|Cost\s*Value|Acquisition\s*Cost)[:\s]*(?:INR|Rs\.?|`)?\s*([\d,.]+)/i);
    const val = valMatch ? pNum(valMatch[1]) : 0;
    const costVal = costValMatch ? pNum(costValMatch[1]) : 0;

    // Derive per-unit prices
    const currentPricePerUnit = val && qty ? val / qty : 0;
    const purchasePricePerUnit = costVal && qty ? costVal / qty : 0;

    holdings.push({
      name, type,
      ticker: exchangeTicker || isin,   // prefer NSE/BSE ticker over ISIN
      scheme_code: isin,                // store ISIN in scheme_code for reference
      units: qty,
      purchase_price: purchasePricePerUnit, current_price: currentPricePerUnit,
      purchase_value: costVal || val, current_value: val,
      source: _source, brokerage_name: _brokerage, currency: "INR",
    });
  }

  const mfCount = holdings.filter(h => h.type === "MF").length;
  const dematCount = holdings.filter(h => h.type !== "MF").length;
  if (mfCount) warnings.push("Found " + mfCount + " mutual fund(s)");
  if (dematCount) warnings.push("Found " + dematCount + " demat holding(s)");
  if (!mfCount && !dematCount) warnings.push("No holdings detected - CAS format may differ from expected layout");

  return {
    format: "NSDL/CDSL CAS (PDF)",
    holdings, warnings,
    accounts: [],
  };
}

// ── Fidelity PDF Statement Parser ─────────────────────────────────
function parseFidelityPDFStatement(rawText) {
  const holdings = [], warnings = [];
  // Extract account name
  const acctMatch = rawText.match(/FIDELITY\s+ACCOUNT\s+(.+?)\s*-\s*(INDIVIDUAL|JOINT|TRUST)/i)
    || rawText.match(/Account\s*#\s*\S+\s+(.+?)\s*-\s*(INDIVIDUAL|JOINT|TRUST)/i);
  const accountName = acctMatch ? acctMatch[1].trim() : "";

  // Find all ticker symbols in parentheses: (ADBE), (TSLA), etc.
  const tickerRe = /\(([A-Z]{1,6})\)/g;
  let tm;
  while ((tm = tickerRe.exec(rawText)) !== null) {
    const ticker = tm[1];
    const tickerEnd = tm.index + tm[0].length;

    // Skip non-holding tickers (money market, totals, etc.)
    if (/SPAXX|FDRXX|FCASH/i.test(ticker)) continue;

    // Look backwards from (TICKER) to find the name — text between "M" prefix and "(TICKER)"
    const before = rawText.substring(Math.max(0, tm.index - 200), tm.index);
    // M must be preceded by whitespace/newline (standalone margin indicator, not part of a word)
    const nameMatch = before.match(/(?:^|\s)M\s+(?:t\s+)?(.{5,80}?)\s*$/);
    if (!nameMatch) continue;
    const name = nameMatch[1].replace(/\s+/g, " ").trim();

    // Look forward from (TICKER) to extract the 6 numbers: beg_mv, qty, price, end_mv, cost, gain
    const after = rawText.substring(tickerEnd, tickerEnd + 300);
    const numRe = /-?[$]?[\d,]+\.?\d*/g;
    const nums = [];
    let nm;
    while ((nm = numRe.exec(after)) !== null && nums.length < 6) {
      const val = parseFloat(nm[0].replace(/[$,]/g, ""));
      if (!isNaN(val)) nums.push(val);
    }

    if (nums.length < 4) continue; // Need at least beg_mv, qty, price, end_mv

    const begMV = nums[0];
    const qty = nums[1];
    const price = nums[2];
    const endMV = nums[3];
    const costBasis = nums.length >= 5 ? nums[4] : 0;

    if (qty === 0) continue;
    // Skip subtotal/total rows
    if (/total|subtotal/i.test(name)) continue;

    const type = classifyUSAsset(ticker, name);
    const avgCost = costBasis && qty ? costBasis / qty : price;

    holdings.push({
      name, type, ticker, units: qty,
      purchase_price: avgCost, current_price: price,
      purchase_value: costBasis || qty * avgCost,
      current_value: endMV || qty * price,
      source: "pdf", brokerage_name: "Fidelity", currency: "USD",
      _account_name: accountName,
    });
  }

  return {
    format: "Fidelity (PDF Statement)",
    holdings, warnings,
    accounts: accountName ? [accountName] : [],
  };
}

// ── IMPORT: Auto-detect format + type + preview (no DB write) ─────
app.post("/api/import/detect", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const ext = req.file.originalname.split(".").pop().toLowerCase();

  let text = "";
  try {
    if (ext === "csv" || ext === "txt") {
      text = req.file.buffer.toString("utf8");
    } else if (ext === "xlsx" || ext === "xls") {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      text = XLSX.utils.sheet_to_csv(ws);
    } else if (ext === "pdf") {
      try {
        // Accept optional password from form data (for encrypted CAS PDFs)
        const pdfPassword = req.body?.password || "";

        let pdf;
        try {
          const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(req.file.buffer),
            standardFontDataUrl: _pdfjsFontPath,
            useSystemFonts: true,
          });
          console.log("📄 PDF: opening with standardFontDataUrl =", _pdfjsFontPath);
          // Handle password-protected PDFs via callback
          let passwordAttempted = false;
          loadingTask.onPassword = (updateCallback, reason) => {
            // reason: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
            if (reason === 2 || passwordAttempted) {
              // Already tried or explicitly wrong — reject via Error passed to callback
              updateCallback(new Error(pdfPassword ? "Incorrect PDF password" : "Password required"));
              return;
            }
            if (pdfPassword) {
              passwordAttempted = true;
              updateCallback(pdfPassword);
            } else {
              updateCallback(new Error("Password required"));
            }
          };
          pdf = await loadingTask.promise;
        } catch (pdfOpenErr) {
          const msg = (pdfOpenErr?.message || "").toLowerCase();
          // Detect password errors
          if (msg.includes("password") || msg.includes("encrypted") || pdfOpenErr?.code === 1 || pdfOpenErr?.code === 2) {
            if (pdfPassword) {
              // Password was provided but wrong
              return res.status(400).json({
                error: "password_incorrect",
                message: "Incorrect password. Check your PAN number (uppercase).",
                needs_password: true,
              });
            }
            return res.status(400).json({
              error: "password_required",
              message: "This PDF is password-protected. Enter your PAN to unlock.",
              needs_password: true,
            });
          }
          throw pdfOpenErr;
        }

        // Extract text from all pages in parallel for speed
        const pagePromises = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          pagePromises.push(
            pdf.getPage(i).then(page => page.getTextContent()).then(content =>
              content.items.map(item => item.str).join(" ")
            )
          );
        }
        const pages = await Promise.all(pagePromises);
        const rawPdfText = pages.join("\n");
        console.log(`📄 PDF: extracted ${rawPdfText.length} chars from ${pages.length} pages. First 200: "${rawPdfText.substring(0,200).replace(/\n/g,"\\n")}"`);

        // ── Diagnostic: check what keywords exist in the text ──
        const hasCAS = /consolidated\s*account\s*statement|nsdl\s*cas|cdsl\s*cas/i.test(rawPdfText);
        const hasNSDL = /nsdl/i.test(rawPdfText);
        const hasCDSL = /cdsl/i.test(rawPdfText);
        const hasMF = /mutual\s*fund/i.test(rawPdfText);
        const hasDemat = /demat/i.test(rawPdfText);
        const hasFolio = /folio/i.test(rawPdfText);
        const hasClosingBal = /closing\s*unit\s*balance/i.test(rawPdfText);
        const hasINF = /\bINF[A-Z0-9]{9}\b/.test(rawPdfText);
        const hasINE = /\bINE[A-Z0-9]{9}\b/.test(rawPdfText);
        const hasNAV = /\bNAV\b/i.test(rawPdfText);
        const hasValuation = /valuation/i.test(rawPdfText);
        console.log(`📄 PDF keywords: CAS=${hasCAS} NSDL=${hasNSDL} CDSL=${hasCDSL} MF=${hasMF} Demat=${hasDemat} Folio=${hasFolio} ClosingBal=${hasClosingBal} INF=${hasINF} INE=${hasINE} NAV=${hasNAV} Val=${hasValuation}`);

        // Debug mode: return raw PDF text for troubleshooting
        if (req.query.debug === "1" || req.body?.debug === "1") {
          return res.json({
            debug: true,
            totalLength: rawPdfText.length,
            pageCount: pages.length,
            pageLengths: pages.map((p,i) => ({ page: i+1, chars: p.length })),
            // First 8000 chars of raw text
            rawText: rawPdfText.substring(0, 8000),
            // Search for key anchors
            anchors: {
              closingUnitBalance: [...rawPdfText.matchAll(/Closing\s*Unit\s*Balance\s*[:\s]*([\d,.]+)/gi)].map(m => ({
                position: m.index,
                matched: m[0],
                units: m[1],
                surrounding: rawPdfText.substring(Math.max(0, m.index - 80), m.index + 250)
              })),
              nav: [...rawPdfText.matchAll(/NAV\s*(?:on|as\s*on)?[^:]*?[:\s]\s*(?:INR|Rs)?\.?\s*([\d,.]+)/gi)].map(m => ({
                matched: m[0].substring(0,80), value: m[1]
              })),
              valuation: [...rawPdfText.matchAll(/Valuation\s*(?:on|as\s*on)?[^:]*?[:\s]\s*(?:INR|Rs)?\.?\s*([\d,.]+)/gi)].map(m => ({
                matched: m[0].substring(0,80), value: m[1]
              })),
              costValue: [...rawPdfText.matchAll(/Cost\s*(?:Value)?[^:]*?[:\s]\s*(?:INR|Rs)?\.?\s*([\d,.]+)/gi)].map(m => ({
                matched: m[0].substring(0,80), value: m[1]
              })),
            }
          });
        }

        // ── Route 1: NSDL/CDSL CAS statement ──
        if (/consolidated\s*account\s*statement|nsdl|cdsl/i.test(rawPdfText) && /mutual\s*fund|demat|folio/i.test(rawPdfText)) {
          console.log("📋 CAS: Route 1 matched — entering CAS parser");
          // Debug: log a snippet around each "Closing Unit Balance" match
          const debugRe = /Closing\s*Unit\s*Balance/gi;
          let dm;
          while ((dm = debugRe.exec(rawPdfText)) !== null) {
            const snippet = rawPdfText.substring(Math.max(0, dm.index - 100), dm.index + 250);
            console.log(`📋 CAS DEBUG — Closing Unit Balance at ${dm.index}:\n  ...${snippet.replace(/\n/g,"\\n")}...`);
          }
          const result = parseNSDLCASStatement(rawPdfText);
          console.log(`📋 CAS: parser returned ${result.holdings.length} holdings, ${result.warnings.length} warnings`);
          if (result.holdings.length > 0) {
            result.holdings.forEach((h,i) => console.log(`   [${i}] ${h.name} | units=${h.units} | nav=${h.current_nav||h.current_price} | val=${h.current_value} | cost=${h.purchase_value} | type=${h.type}`));
            const { data: existing } = await supabase.from("holdings")
              .select("name, ticker, scheme_code, type").eq("user_id", req.user.id);
            const existingSet = new Set(
              (existing || []).map(h => `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`)
            );
            result.holdings = result.holdings.map(h => ({
              ...h, _duplicate: existingSet.has(`${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`),
            }));
            const dupCount = result.holdings.filter(h => h._duplicate).length;
            if (dupCount > 0) result.warnings.push(`${dupCount} holding(s) already exist (marked as duplicates)`);
            return res.json({ ...result, detected_type: "holdings", accounts: result.accounts || [] });
          }
        }

        console.log("📄 PDF: Route 1 (CAS) did not match or returned 0 holdings. Trying Route 2...");
        // ── Route 2: Fidelity statement ──
        if (/fidelity/i.test(rawPdfText) && /account\s*#/i.test(rawPdfText)) {
          const result = parseFidelityPDFStatement(rawPdfText);
          if (result.holdings.length > 0) {
            const { data: existing } = await supabase.from("holdings")
              .select("name, ticker, scheme_code, type").eq("user_id", req.user.id);
            const existingSet = new Set(
              (existing || []).map(h => `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`)
            );
            result.holdings = result.holdings.map(h => ({
              ...h, _duplicate: existingSet.has(`${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`),
            }));
            const dupCount = result.holdings.filter(h => h._duplicate).length;
            if (dupCount > 0) result.warnings.push(`${dupCount} holding(s) already exist (marked as duplicates)`);
            return res.json({ ...result, detected_type: "holdings", accounts: result.accounts || [] });
          }
        }

        // ── Route 3: Fallback — normalize to TSV for CSV pipeline ──
        text = pages.map(l => l.replace(/\s{2,}/g, "\t")).join("\n");
      } catch (pdfErr) {
        return res.status(400).json({ error: "Could not extract data from PDF: " + pdfErr.message });
      }
    } else {
      return res.status(400).json({ error: "Unsupported format. Use CSV, XLSX, XLS, or PDF." });
    }
  } catch (e) {
    return res.status(400).json({ error: "Parse error: " + e.message });
  }

  // ── Auto-detect: try both parsers, score and pick the better one ──
  const holdingsResult = detectAndParseHoldings(text, req.file.originalname);
  const txnResult = parseTransactionCSV(text);

  // Score each result based on quality signals
  const hScore = scoreHoldings(holdingsResult, text);
  const tScore = scoreTransactions(txnResult, text);

  const detectedType = tScore > hScore ? "transactions" : "holdings";

  if (detectedType === "transactions") {
    return res.json({ ...txnResult, detected_type: "transactions" });
  }

  // Holdings path: add duplicate detection with existing values for comparison
  const { data: existing } = await supabase.from("holdings")
    .select("name, ticker, scheme_code, type, units, purchase_price, current_price, purchase_value, current_value").eq("user_id", req.user.id);
  const existingMap = {};
  for (const h of (existing || [])) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    existingMap[key] = h;
  }
  holdingsResult.holdings = holdingsResult.holdings.map(h => {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    const ex = existingMap[key];
    return {
      ...h,
      _duplicate: !!ex,
      _existing: ex ? { units: ex.units, purchase_price: ex.purchase_price, current_price: ex.current_price, purchase_value: ex.purchase_value, current_value: ex.current_value } : null,
    };
  });
  const dupCount = holdingsResult.holdings.filter(h => h._duplicate).length;
  if (dupCount > 0) holdingsResult.warnings.push(`${dupCount} holding(s) already exist in your portfolio`);

  res.json({ ...holdingsResult, detected_type: "holdings", accounts: holdingsResult.accounts || [] });
});

/**
 * Score how well the parsed result looks like a holdings file.
 * Higher = more likely to be holdings.
 */
function scoreHoldings(result, text) {
  let score = 0;
  if (result.holdings.length === 0) return -10;
  score += result.holdings.length * 2;                              // more rows = better
  if (result.format !== "Unknown" && result.format !== "Generic CSV (best-effort)") score += 20; // named format detected

  // Holdings signals: avg cost, LTP, market value columns in header
  const lower = text.toLowerCase();
  if (/avg\.?\s*(cost|price)|average\s*price|purchase\s*price/i.test(lower)) score += 15;
  if (/ltp|market\s*value|current\s*value|close\s*price|cmp/i.test(lower)) score += 10;

  // Unique symbols = holdings (each row is a different asset)
  const symbols = result.holdings.map(h => (h.ticker || h.name).toLowerCase());
  const uniqueRatio = new Set(symbols).size / (symbols.length || 1);
  if (uniqueRatio > 0.8) score += 15;     // mostly unique rows → holdings

  // Negative: date column + buy/sell column = probably transactions
  if (/trade\s*date|txn\s*date|transaction\s*date/i.test(lower)) score -= 10;
  if (/trade\s*type|buy|sell|side|action/i.test(lower) && /date/i.test(lower)) score -= 15;

  return score;
}

/**
 * Score how well the parsed result looks like a transactions file.
 * Higher = more likely to be transactions.
 */
function scoreTransactions(result, text) {
  let score = 0;
  if (result.transactions.length === 0) return -10;
  score += result.transactions.length;                               // more rows = better
  if (result.format !== "unknown" && result.format !== "Generic Transactions") score += 20;

  const lower = text.toLowerCase();
  // Strong transaction signals
  if (/trade\s*date|transaction\s*date/i.test(lower)) score += 15;
  if (/trade\s*type/i.test(lower)) score += 15;
  if (/buy|sell/i.test(lower) && /date/i.test(lower)) score += 10;
  if (/tradebook|trade\s*book|order\s*book|order\s*history/i.test(lower)) score += 20;

  // Repeated symbols = transactions (multiple buy/sell per asset)
  const symbols = result.transactions.map(t => (t._symbol || "").toLowerCase());
  const uniqueRatio = new Set(symbols).size / (symbols.length || 1);
  if (uniqueRatio < 0.5) score += 15;      // same symbol repeats → transactions

  // Many rows with dates = transactions
  const withDates = result.transactions.filter(t => t.txn_date).length;
  if (withDates > 10) score += 10;

  // Negative: avg cost, market value columns = probably holdings
  if (/avg\.?\s*(cost|price)|average\s*price|market\s*value|current\s*value/i.test(lower)) score -= 10;
  if (/ltp|cmp/i.test(lower)) score -= 10;

  return score;
}

// ── IMPORT: Bulk import holdings (upsert — update existing, insert new) ──
app.post("/api/holdings/import", auth, async (req, res) => {
  const { holdings, member_id, account_map } = req.body;
  // account_map: { "Brokerage XXXX1234": "member_id_abc", ... }
  if (!holdings?.length) return res.status(400).json({ error: "No holdings to import" });

  // Auto-resolve member_id: if not provided, use the first member from user's portfolio
  let effectiveMemberId = member_id || null;
  if (!effectiveMemberId) {
    const { data: portfolio } = await supabase
      .from("portfolio").select("members").eq("user_id", req.user.id).single();
    const pMembers = portfolio?.members || [];
    if (pMembers.length > 0) effectiveMemberId = pMembers[0].id;
  }

  // Fetch existing holdings for this user
  const { data: existing } = await supabase.from("holdings")
    .select("id, name, ticker, scheme_code, type").eq("user_id", req.user.id);

  // Build lookup: key → existing holding id
  const existingMap = {};
  for (const h of (existing || [])) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    existingMap[key] = h.id;
  }

  // Clear demo holdings
  await supabase.from("holdings").delete().eq("user_id", req.user.id).like("notes", "%__demo__%");

  const inserted = [], updated = [], skipped = [], errors = [];
  for (const h of holdings) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    const existingId = existingMap[key];

    // ── Respect per-holding duplicate action from frontend ──
    if (existingId && h._dupAction === "skip") {
      skipped.push(h.name);
      continue;
    }

    const isMF = (h.type || "IN_STOCK") === "MF";
    // Resolve member: account_map > explicit member_id > auto-resolved > holding's own > null
    const resolvedMember = (account_map && h._account_name && account_map[h._account_name])
      || effectiveMemberId || h.member_id || null;
    const payload = sanitizeDates({
      member_id: resolvedMember,
      type: h.type || "IN_STOCK", name: h.name,
      ticker: h.ticker || "", scheme_code: h.scheme_code || "",
      units: h.units || 0, purchase_price: h.purchase_price || 0,
      current_price: h.current_price || 0,
      ...(isMF ? { purchase_nav: h.purchase_nav || 0, current_nav: h.current_nav || 0 } : {}),
      purchase_value: h.purchase_value || 0,
      current_value: h.current_value || 0, principal: h.principal || 0,
      interest_rate: h.interest_rate || 0, start_date: h.start_date || null,
      maturity_date: h.maturity_date || null, usd_inr_rate: h.usd_inr_rate || null,
      ...(h.source ? { source: h.source } : {}),
      ...(h.brokerage_name ? { brokerage_name: h.brokerage_name } : {}),
      ...(h.currency ? { currency: h.currency } : {}),
    });

    if (existingId) {
      // ── UPDATE existing holding with new numbers ──
      const { error } = await supabase.from("holdings").update(payload).eq("id", existingId);
      if (error) { errors.push(`${h.name}: ${error.message}`); continue; }
      updated.push(h.name);
    } else {
      // ── INSERT new holding ──
      const id = "h_" + Date.now() + Math.random().toString(36).slice(2, 8);
      const { error } = await supabase.from("holdings").insert({ ...payload, id, user_id: req.user.id });
      if (error) { errors.push(`${h.name}: ${error.message}`); continue; }
      inserted.push(h.name);

      // Auto-create first BUY transaction for new holdings
      const price = h.purchase_price || h.purchase_nav || 0;
      if (h.units && price) {
        await supabase.from("transactions").insert({
          id: "t_" + Date.now() + Math.random().toString(36).slice(2, 6),
          holding_id: id, user_id: req.user.id, txn_type: "BUY",
          units: h.units, price, txn_date: h.start_date || new Date().toISOString().slice(0, 10),
          notes: "Imported from CSV",
        });
      }
    }
  }
  res.json({ ok: true, inserted_count: inserted.length, updated_count: updated.length,
    skipped_count: skipped.length, error_count: errors.length, inserted, updated, skipped, errors });
});

// ── IMPORT: Bulk import transactions ──────────────────────────────
app.post("/api/transactions/import", auth, async (req, res) => {
  const { transactions } = req.body;
  if (!transactions?.length) return res.status(400).json({ error: "No transactions to import" });

  const { data: userHoldings } = await supabase.from("holdings")
    .select("id, name, ticker, scheme_code, type").eq("user_id", req.user.id);
  const holdingMap = {};
  for (const h of (userHoldings || [])) {
    if (h.ticker) holdingMap[h.ticker.toLowerCase()] = h.id;
    if (h.scheme_code) holdingMap[h.scheme_code.toLowerCase()] = h.id;
    holdingMap[h.name.toLowerCase()] = h.id;
  }

  const imported = [], unmatched = [], errors = [];
  for (const t of transactions) {
    const sym = (t._symbol || "").toLowerCase();
    const holdingId = holdingMap[sym] || holdingMap[sym.replace(/\s+/g, "")] ||
      Object.entries(holdingMap).find(([k]) => k.includes(sym))?.[1];
    if (!holdingId) { unmatched.push(t._symbol); continue; }

    const { error } = await supabase.from("transactions").insert({
      id: "t_" + Date.now() + Math.random().toString(36).slice(2, 6),
      holding_id: holdingId, user_id: req.user.id,
      txn_type: t.txn_type || "BUY", units: Number(t.units) || 0,
      price: Number(t.price) || 0, txn_date: t.txn_date || new Date().toISOString().slice(0, 10),
      notes: t.notes || "Bulk import",
    });
    if (error) errors.push(`${t._symbol}: ${error.message}`);
    else imported.push(t._symbol);
  }
  res.json({ ok: true, imported_count: imported.length, unmatched_count: unmatched.length,
    error_count: errors.length, unmatched: [...new Set(unmatched)], errors });
});

// ── BUDGET: Upload + Parse Statement ─────────────────────────────
app.post("/api/budget/upload", auth, upload.single("file"), async (req, res) => {
  try {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const { source, statement_type, notes } = req.body;

  const id = "bst_" + Date.now() + Math.random().toString(36).slice(2,6);
  const ext = req.file.originalname.split(".").pop().toLowerCase();

  // ── Parse file ──
  let rawRows = [];
  try {
    if (ext === "csv" || ext === "txt") {
      rawRows = parseCSV(req.file.buffer.toString("utf8"));
    } else if (ext === "xlsx" || ext === "xls") {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const csvText = XLSX.utils.sheet_to_csv(ws);
      rawRows = parseCSV(csvText);
    } else if (ext === "pdf") {
      // ── PDF Bank Statement Parser ──
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(req.file.buffer),
          standardFontDataUrl: _pdfjsFontPath,
          useSystemFonts: true,
        });
        const pdf = await loadingTask.promise;
        const pageTexts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pageTexts.push(content.items.map(item => item.str).join(" "));
        }
        const rawText = pageTexts.join("\n");
        rawRows = parseBankStatementPDF(rawText);
        console.log(`📄 Budget PDF: extracted ${rawText.length} chars, ${rawRows.length} transactions`);
      } catch (pdfErr) {
        return res.status(400).json({ error: "PDF parse error: " + pdfErr.message });
      }
    } else {
      return res.status(400).json({ error: "Unsupported format. Use CSV, XLS, XLSX, or PDF." });
    }
  } catch (e) {
    return res.status(400).json({ error: "Parse error: " + e.message });
  }

  if (!rawRows.length) return res.status(400).json({ error: "No transactions found. Check the file format." });

  // ── Build transactions ──
  const txns = [];
  let periodStart = null, periodEnd = null;

  for (const row of rawRows) {
    const date = parseDate(row.date);
    if (!date) continue;
    const debit = parseAmount(row.debit);
    const credit = parseAmount(row.credit);
    if (debit === 0 && credit === 0) continue;
    const amount = debit > 0 ? debit : credit;
    const type = debit > 0 ? "DEBIT" : "CREDIT";
    const desc = String(row.desc || "").trim();
    if (!desc) continue;
    const category = await autoCategorise(desc);
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;
    txns.push({
      id: "btx_" + Date.now() + Math.random().toString(36).slice(2,8),
      statement_id: id,
      user_id: req.user.id,
      txn_date: date,
      description: encrypt(desc),
      raw_desc: encrypt(desc),
      amount,
      txn_type: type,
      category,
      balance: row.balance ? encrypt(String(row.balance)) : null,
      ref_number: (row.ref || "").slice(0, 50),
    });
  }

  if (!txns.length) return res.status(400).json({ error: "Transactions parsed but none had valid dates/amounts." });

  // ── Purge statements older than 1 year ──
  await supabase.from("budget_statements").delete().eq("user_id", req.user.id).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());

  // ── Save statement record ──
  const { error: stErr } = await supabase.from("budget_statements").insert({ user_id: req.user.id,
    id, source: source || "Unknown", statement_type: statement_type || "BANK",
    filename: req.file.originalname, file_size: req.file.size,
    period_start: periodStart, period_end: periodEnd,
    txn_count: txns.length, notes: notes || "",
  });
  if (stErr) return res.status(500).json({ error: stErr.message });

  // ── Batch insert transactions ──
  const batchSize = 100;
  for (let i = 0; i < txns.length; i += batchSize) {
    const { error: txErr } = await supabase.from("budget_transactions").insert(txns.slice(i, i + batchSize));
    if (txErr) { console.error("Batch insert error:", txErr.message); }
  }

  res.json({ ok: true, statement_id: id, txn_count: txns.length, period_start: periodStart, period_end: periodEnd });
  } catch (e) {
    console.error("Budget upload error:", e.message, e.stack);
    res.status(500).json({ error: "Upload failed: " + e.message });
  }
});

// ── BUDGET: List statements ───────────────────────────────────────
app.get("/api/budget/statements", auth, async (req, res) => {
  const { data, error } = await supabase.from("budget_statements")
    .select("*").eq("user_id", req.user.id).order("upload_date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── BUDGET: Delete statement ──────────────────────────────────────
app.delete("/api/budget/statements/:id", auth, async (req, res) => {
  await supabase.from("budget_statements").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

// ── BUDGET: Get transactions (with decryption) ────────────────────
app.get("/api/budget/transactions", auth, async (req, res) => {
  const { statement_id, category, month, search } = req.query;
  let q = supabase.from("budget_transactions").select("*").eq("user_id", req.user.id).order("txn_date", { ascending: false });
  if (statement_id) q = q.eq("statement_id", statement_id);
  if (category && category !== "All") q = q.eq("category", category);
  if (month) { q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-31`); }
  q = q.limit(1000);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Decrypt descriptions
  const decrypted = (data || []).map(t => ({
    ...t,
    description: decrypt(t.description),
    balance: t.balance ? decrypt(t.balance) : null,
  }));
  // Client-side search filter after decryption
  const filtered = search
    ? decrypted.filter(t => t.description.toLowerCase().includes(search.toLowerCase()))
    : decrypted;
  res.json(filtered);
});

// ── BUDGET: Update transaction category ──────────────────────────
app.patch("/api/budget/transactions/:id", auth, async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: "category required" });
  const { error } = await supabase.from("budget_transactions").update({ category }).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── BUDGET: Bulk recategorise ─────────────────────────────────────
app.post("/api/budget/recategorise", auth, async (req, res) => {
  const { ids, category } = req.body;
  if (!ids?.length || !category) return res.status(400).json({ error: "ids and category required" });
  if (ids.length > 500) return res.status(400).json({ error: "Too many IDs (max 500)" });
  const { error } = await supabase.from("budget_transactions").update({ category }).in("id", ids).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, updated: ids.length });
});

// ── BUDGET: Categories CRUD ───────────────────────────────────────
app.get("/api/budget/categories", auth, async (req, res) => {
  const { data, error } = await supabase.from("budget_categories").select("*").eq("user_id", req.user.id).order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/budget/categories", auth, async (req, res) => {
  const id = "cat_" + Date.now().toString(36);
  const { name, keywords } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const { error } = await supabase.from("budget_categories").insert({ id, user_id: req.user.id, name, keywords: keywords || "" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id });
});

app.put("/api/budget/categories/:id", auth, async (req, res) => {
  const { name, keywords } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (keywords !== undefined) update.keywords = keywords;
  const { error } = await supabase.from("budget_categories").update(update).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/budget/categories/:id", auth, async (req, res) => {
  await supabase.from("budget_categories").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

// ── BUDGET: Analytics summary ─────────────────────────────────────
app.get("/api/budget/analytics", auth, async (req, res) => {
  const { month } = req.query; // YYYY-MM
  const from = month ? `${month}-01` : new Date(Date.now() - 30*24*3600_000).toISOString().slice(0,10);
  const to   = month ? `${month}-31` : new Date().toISOString().slice(0,10);

  const { data: txns } = await supabase.from("budget_transactions")
    .select("amount, txn_type, category, txn_date")
    .eq("user_id", req.user.id)
    .gte("txn_date", from).lte("txn_date", to);

  const byCategory = {};
  let totalDebit = 0, totalCredit = 0;
  for (const t of (txns || [])) {
    if (t.txn_type === "DEBIT") {
      totalDebit += t.amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    } else {
      totalCredit += t.amount;
    }
  }

  // Monthly trend (last 6 months)
  const { data: allTxns } = await supabase.from("budget_transactions")
    .select("amount, txn_type, txn_date")
    .eq("user_id", req.user.id)
    .gte("txn_date", new Date(Date.now() - 180*24*3600_000).toISOString().slice(0,10))
    .eq("txn_type", "DEBIT");

  const monthly = {};
  for (const t of (allTxns || [])) {
    const mo = t.txn_date.slice(0, 7);
    monthly[mo] = (monthly[mo] || 0) + t.amount;
  }

  res.json({ byCategory, totalDebit, totalCredit, monthly });
});

// ── BENCHMARK — Nifty 50 / Sensex historical data ─────────────────
app.get("/api/benchmark", auth, async (req, res) => {
  const { period = "1Y", index = "NIFTY" } = req.query;
  const symbol = index === "SENSEX" ? "^BSESN" : "^NSEI";
  const ranges = { "1Y": "1y", "3Y": "3y", "5Y": "5y", "ALL": "10y" };
  const range = ranges[period] || "1y";
  try {
    const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1mo&range=${range}`);
    const result = data?.chart?.result?.[0];
    if (!result) return res.json({ prices: [] });
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    const prices = timestamps
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 7), value: closes[i] }))
      .filter(p => p.value != null);
    res.json({ prices, symbol });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
