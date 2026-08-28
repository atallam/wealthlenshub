/**
 * routes/news.js — Financial news feed
 *
 * Sources:
 *  Ticker-specific : Yahoo Finance per holding (IN_STOCK .NS / US stocks)
 *  Indian market   : ET Markets RSS, Livemint Markets RSS
 *  Macro / policy  : RBI notifications RSS, SEBI RSS, ET Economy RSS
 *
 * GET /api/news?tickers=RELIANCE.NS,HDFCBANK.NS,AAPL
 */

import { Router }          from "express";
import { auth, sendError } from "../lib/auth.js";
import { yahooFetch, timedFetch } from "../lib/prices.js";

const router = Router();

// ── In-process news cache (15 min TTL) ───────────────────────────────────────
const _cache = {};
const NEWS_TTL = 15 * 60_000;

async function cached(key, fn) {
  if (_cache[key] && Date.now() - _cache[key].ts < NEWS_TTL) return _cache[key].data;
  const data = await fn();
  _cache[key] = { data, ts: Date.now() };
  return data;
}

// ── Yahoo Finance news for a single ticker ────────────────────────────────────
async function yahooNews(ticker) {
  return cached(`yn:${ticker}`, async () => {
    try {
      const data = await yahooFetch(
        `/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=8&quotesCount=0&enableFuzzyQuery=false`
      );
      return (data?.news || []).map(n => ({
        id:             n.uuid,
        title:          n.title || "",
        publisher:      n.publisher || "",
        link:           n.link || "",
        publishedAt:    (n.providerPublishTime || 0) * 1000,
        thumbnail:      n.thumbnail?.resolutions?.[0]?.url || null,
        relatedTickers: n.relatedTickers || [],
        sourceTicker:   ticker,
      }));
    } catch { return []; }
  });
}

// ── Simple RSS 2.0 parser — no extra dep, handles CDATA and plain text ────────
function parseRss(xml) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`
      );
      const x = r.exec(block);
      return x ? (x[1] || x[2] || "").trim() : "";
    };
    const title   = get("title");
    const link    = get("link") || get("guid");
    const pubDate = get("pubDate");
    if (title && link) {
      items.push({ title, link, publishedAt: pubDate ? new Date(pubDate).getTime() : Date.now() });
    }
  }
  return items;
}

// ── Generic RSS fetcher ───────────────────────────────────────────────────────
async function rssItems(url, count = 10) {
  try {
    const r = await timedFetch(url, {}, 8000);
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRss(xml).slice(0, count);
  } catch { return []; }
}

// ── RBI notifications RSS ─────────────────────────────────────────────────────
async function rbiNews() {
  return cached("rbi", async () => {
    const items = await rssItems("https://www.rbi.org.in/rss/RBINotificationRss.aspx", 8);
    return items.map((item, i) => ({
      id:           `rbi-${i}-${item.publishedAt}`,
      title:        item.title,
      publisher:    "RBI",
      link:         item.link,
      publishedAt:  item.publishedAt,
      thumbnail:    null,
      sourceTicker: "RBI",
      category:     "MACRO",
    }));
  });
}

// ── SEBI RSS ──────────────────────────────────────────────────────────────────
async function sebiNews() {
  return cached("sebi", async () => {
    const items = await rssItems("https://www.sebi.gov.in/sebiweb/rss/sebirss.aspx", 8);
    return items.map((item, i) => ({
      id:           `sebi-${i}-${item.publishedAt}`,
      title:        item.title,
      publisher:    "SEBI",
      link:         item.link,
      publishedAt:  item.publishedAt,
      thumbnail:    null,
      sourceTicker: "SEBI",
      category:     "MACRO",
    }));
  });
}

// ── Economic Times — Economy macro RSS ───────────────────────────────────────
async function etEconomyNews() {
  return cached("et-economy", async () => {
    const items = await rssItems(
      "https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms", 8
    );
    return items.map((item, i) => ({
      id:           `et-eco-${i}-${item.publishedAt}`,
      title:        item.title,
      publisher:    "ET Economy",
      link:         item.link,
      publishedAt:  item.publishedAt,
      thumbnail:    null,
      sourceTicker: "ET_ECONOMY",
      category:     "MACRO",
    }));
  });
}

// ── Economic Times Markets — Indian market RSS ────────────────────────────────
async function etMarketsNews() {
  return cached("et-markets", async () => {
    const items = await rssItems(
      "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", 12
    );
    return items.map((item, i) => ({
      id:           `et-mkt-${i}-${item.publishedAt}`,
      title:        item.title,
      publisher:    "ET Markets",
      link:         item.link,
      publishedAt:  item.publishedAt,
      thumbnail:    null,
      sourceTicker: "ET_MARKETS",
      category:     "IN",
    }));
  });
}

// ── Livemint — Indian market RSS ──────────────────────────────────────────────
async function livemintNews() {
  return cached("livemint", async () => {
    const items = await rssItems("https://www.livemint.com/rss/markets", 10);
    return items.map((item, i) => ({
      id:           `lm-${i}-${item.publishedAt}`,
      title:        item.title,
      publisher:    "Livemint",
      link:         item.link,
      publishedAt:  item.publishedAt,
      thumbnail:    null,
      sourceTicker: "LIVEMINT",
      category:     "IN",
    }));
  });
}

// ── Non-ticker source names (for UI to know these aren't portfolio holdings) ──
export const RSS_SOURCES = new Set(["RBI","SEBI","ET_ECONOMY","ET_MARKETS","LIVEMINT"]);

// ── GET /api/news?tickers=RELIANCE.NS,HDFCBANK.NS,AAPL ───────────────────────
router.get("/news", auth, async (req, res) => {
  try {
    const tickers = (req.query.tickers || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 12);          // allow up to 12 portfolio tickers

    // Fire all sources in parallel
    const [rbi, sebi, etEco, etMkt, livemint, ...tickerResults] = await Promise.all([
      rbiNews(),
      sebiNews(),
      etEconomyNews(),
      etMarketsNews(),
      livemintNews(),
      ...tickers.map(t => yahooNews(t)),
    ]);

    const seen = new Set();
    const all  = [];

    // Per-ticker Yahoo news first (most specific — win dedup)
    for (let i = 0; i < tickerResults.length; i++) {
      const ticker = tickers[i];
      const isIN   = ticker.endsWith(".NS") || ticker.endsWith(".BO");
      for (const a of tickerResults[i]) {
        if (a.id && !seen.has(a.id)) {
          seen.add(a.id);
          all.push({ ...a, category: isIN ? "IN" : "US" });
        }
      }
    }

    // Indian market broad RSS
    for (const a of [...etMkt, ...livemint]) {
      if (!seen.has(a.id)) { seen.add(a.id); all.push(a); }
    }

    // Macro policy RSS
    for (const a of [...rbi, ...sebi, ...etEco]) {
      if (!seen.has(a.id)) { seen.add(a.id); all.push(a); }
    }

    all.sort((a, b) => b.publishedAt - a.publishedAt);

    res.json({
      articles:  all.slice(0, 60),
      fetchedAt: new Date().toISOString(),
      rssSources: [...RSS_SOURCES],   // tell the client which sourceTickers are RSS feeds
    });
  } catch (e) { sendError(res, e); }
});

export default router;
