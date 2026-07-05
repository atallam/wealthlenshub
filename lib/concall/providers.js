/**
 * lib/concall/providers.js — Transcript sourcing provider chain.
 *
 * Providers are tried in order. Each provider's find() method either:
 *   - Returns { text, url, provider } on success
 *   - Returns null if no transcript was found
 *   - Throws if the provider errors (caller catches and advances chain)
 *
 * Chain order:
 *   1. NSEFilingProvider    — NSE corporate announcements (IN stocks)
 *   2. BSEFilingProvider    — BSE API keyword search (IN stocks, uses bse_codes.json)
 *   3. ScreenerProvider     — Screener.in HTML scrape (IN stocks, cheerio)
 *   4. MotleyFoolProvider   — Motley Fool free transcripts (US stocks, cheerio)
 *
 * Install: npm install cheerio
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { extractPdf } from "./extractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-load cheerio so the file doesn't hard-fail if not installed yet
let cheerio = null;
async function getCheerio() {
  if (!cheerio) {
    const mod = await import("cheerio");
    cheerio = mod;
  }
  return cheerio;
}

// BSE codes map — ticker → BSE security code
const require = createRequire(import.meta.url);
let BSE_CODES = {};
try {
  BSE_CODES = require("../bse_codes.json");
} catch {
  console.warn("[concall/providers] bse_codes.json not found — BSE provider will skip");
}

const FETCH_TIMEOUT_MS = 12_000;

async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. NSE Filing Provider ────────────────────────────────────────────────────

class NSEFilingProvider {
  /**
   * @param {string} ticker  NSE ticker symbol (e.g. "INFY")
   * @returns {Promise<{text:string, url:string, provider:string}|null>}
   */
  async find(ticker) {
    const symbol = ticker.toUpperCase().replace(/\.NS$/, "");
    const apiUrl = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}&issuer=&from_date=&to_date=`;

    const res = await timedFetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Referer": "https://www.nseindia.com/",
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    // Find latest concall filing
    const concallEntry = data.find(item => {
      const desc = (item.desc || item.subject || "").toLowerCase();
      return desc.includes("concall") || desc.includes("earnings call") || desc.includes("investor call");
    });
    if (!concallEntry) return null;

    const pdfUrl = concallEntry.attchmntFile || concallEntry.attachmentFile;
    if (!pdfUrl) return null;

    const fullUrl = pdfUrl.startsWith("http") ? pdfUrl : `https://www.nseindia.com${pdfUrl}`;
    const pdfRes  = await timedFetch(fullUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
    });
    if (!pdfRes.ok) return null;

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const text   = await extractPdf(buffer);
    if (!text || text.length < 500) return null;

    return { text, url: fullUrl, provider: "nse" };
  }
}

// ── 2. BSE Filing Provider ────────────────────────────────────────────────────

class BSEFilingProvider {
  async find(ticker) {
    const symbol  = ticker.toUpperCase().replace(/\.BO$/, "");
    const bseCode = BSE_CODES[symbol];
    if (!bseCode) return null;   // not in our map — skip silently

    const searchUrl =
      `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=&strScrip=${bseCode}&strSearch=concall&strToDate=&strType=C&subcategory=-1`;

    const res = await timedFetch(searchUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Referer": "https://www.bseindia.com/",
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const items = data?.Table || [];
    if (!items.length) return null;

    // Take the most recent entry (already sorted descending by BSE)
    const entry  = items[0];
    const pdfUrl = entry.ATTACHMENTNAME
      ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${entry.ATTACHMENTNAME}`
      : null;

    if (!pdfUrl) return null;

    const pdfRes = await timedFetch(pdfUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
    });
    if (!pdfRes.ok) return null;

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const text   = await extractPdf(buffer);
    if (!text || text.length < 500) return null;

    return { text, url: pdfUrl, provider: "bse" };
  }
}

// ── 3. Screener.in Provider ───────────────────────────────────────────────────

class ScreenerProvider {
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    // Screener's transcript page pattern
    const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/concall/`;
    const res = await timedFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Accept":     "text/html",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $    = load(html);

    // Screener shows a list of concall links — grab the first (latest)
    const links = [];
    $("a[href*='concall'], a[href*='.pdf']").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes(".pdf") || href.includes("concall")) {
        links.push(href.startsWith("http") ? href : `https://www.screener.in${href}`);
      }
    });

    const pdfLink = links.find(l => l.endsWith(".pdf"));
    if (!pdfLink) {
      // Try extracting inline transcript text from page
      const bodyText = $(".concall-transcript, .transcript-content, article").text().trim();
      if (bodyText.length > 2000) return { text: bodyText, url, provider: "screener" };
      return null;
    }

    const pdfRes = await timedFetch(pdfLink, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
    });
    if (!pdfRes.ok) return null;

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const text   = await extractPdf(buffer);
    if (!text || text.length < 500) return null;

    return { text, url: pdfLink, provider: "screener" };
  }
}

// ── 4. Motley Fool Provider (US stocks) ───────────────────────────────────────

class MotleyFoolProvider {
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.[A-Z]+$/, "");

    // Motley Fool transcript index page
    const indexUrl = `https://www.fool.com/earnings-call-transcripts/?filter=${encodeURIComponent(symbol)}`;
    const res      = await timedFetch(indexUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Accept":     "text/html",
      },
    });
    if (!res.ok) return null;

    const html  = await res.text();
    const $     = load(html);

    // Find latest transcript link
    let transcriptUrl = null;
    $("a[href*='earnings-call-transcript']").each((_, el) => {
      if (!transcriptUrl) {
        const href = $(el).attr("href") || "";
        transcriptUrl = href.startsWith("http") ? href : `https://www.fool.com${href}`;
      }
    });
    if (!transcriptUrl) return null;

    const pageRes = await timedFetch(transcriptUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Accept":     "text/html",
      },
    });
    if (!pageRes.ok) return null;

    const pageHtml = await pageRes.text();
    const $p       = load(pageHtml);

    const text = $p("article .article-body, .transcript-container, .article-content").text().trim();
    if (!text || text.length < 500) return null;

    return { text, url: transcriptUrl, provider: "motleyfool" };
  }
}

// ── Exported provider chain ───────────────────────────────────────────────────

const IN_PROVIDERS = [new NSEFilingProvider(), new BSEFilingProvider(), new ScreenerProvider()];
const US_PROVIDERS = [new MotleyFoolProvider(), new ScreenerProvider()];

/**
 * Run the provider chain for a holding.
 * Returns the first successful result or null if all providers fail.
 *
 * @param {string} ticker     Holding ticker symbol
 * @param {string} assetType  One of the AT keys (IN_STOCK, US_STOCK, etc.)
 * @returns {Promise<{text:string, url:string, provider:string}|null>}
 */
export async function findTranscript(ticker, assetType) {
  if (!ticker) return null;

  const isUS = ["US_STOCK", "US_ETF"].includes(assetType);
  const chain = isUS ? US_PROVIDERS : IN_PROVIDERS;

  for (const provider of chain) {
    try {
      const result = await provider.find(ticker);
      if (result) return result;
    } catch (err) {
      console.warn(`[concall/providers] ${provider.constructor.name} failed for ${ticker}:`, err.message);
      // Continue to next provider
    }
  }

  return null;
}
