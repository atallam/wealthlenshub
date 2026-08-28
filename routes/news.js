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
        `/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=6&quotesCount=0&enableFuzzyQuery=false`
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

// ── RBI RSS feed ─────────────────────────────────────────────────────────────
async function rbiNews() {
  return cached("rbi", async () => {
    try {
      const r = await timedFetch("https://www.rbi.org.in/rss/RBINotificationRss.aspx", {}, 8000);
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRss(xml).slice(0, 10).map((item, i) => ({
        id:             `rbi-${i}-${item.publishedAt}`,
        title:          item.title,
        publisher:      "RBI",
        link:           item.link,
        publishedAt:    item.publishedAt,
        thumbnail:      null,
        relatedTickers: [],
        sourceTicker:   "RBI",
        category:       "MACRO",
      }));
    } catch { return []; }
  });
}

// ── GET /api/news?tickers=RELIANCE.NS,HDFCBANK.NS,AAPL ───────────────────────
router.get("/news", auth, async (req, res) => {
  try {
    const tickers = (req.query.tickers || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 8);

    // Fetch all in parallel
    const [rbi, ...tickerResults] = await Promise.all([
      rbiNews(),
      ...tickers.map(t => yahooNews(t)),
    ]);

    // Flatten + deduplicate by article id
    const seen = new Set();
    const all  = [];

    for (let i = 0; i < tickerResults.length; i++) {
      const ticker = tickers[i];
      const isIN   = ticker.endsWith(".NS") || ticker.endsWith(".BO");
      for (const a of tickerResults[i]) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          all.push({ ...a, category: isIN ? "IN" : "US" });
        }
      }
    }
    for (const a of rbi) {
      if (!seen.has(a.id)) { seen.add(a.id); all.push(a); }
    }

    all.sort((a, b) => b.publishedAt - a.publishedAt);
    res.json({ articles: all.slice(0, 50), fetchedAt: new Date().toISOString() });
  } catch (e) { sendError(res, e); }
});

export default router;
