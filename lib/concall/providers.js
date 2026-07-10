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
 *   2. BSEFilingProvider    — BSE API keyword search (IN stocks, uses bse_codes.json + dynamic search fallback)
 *   3. TickertapeProvider   — Tickertape.in concall pages (IN stocks, cheerio)
 *   4. ScreenerProvider     — Screener.in HTML scrape (IN stocks, cheerio)
 *   5. MotleyFoolProvider   — Motley Fool free transcripts (US stocks, cheerio)
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
   * NSE's corporate announcements API requires a live session cookie from
   * nseindia.com — raw requests without cookies are rejected (403/empty JSON).
   * We warm up a session first, forward the cookies, then call the API.
   *
   * @param {string} ticker  NSE ticker symbol (e.g. "INFY")
   * @returns {Promise<{text:string, url:string, provider:string}|null>}
   */
  async find(ticker) {
    const symbol = ticker.toUpperCase().replace(/\.NS$/, "");

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Step 1: warm-up request to get NSE session cookies
    let cookieHeader = "";
    try {
      const warmup = await timedFetch("https://www.nseindia.com/", {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      // Node fetch exposes raw set-cookie as a comma-joined string via .get()
      // Split on "; " boundaries and extract just the name=value parts
      const rawCookies = warmup.headers.get("set-cookie") || "";
      cookieHeader = rawCookies
        .split(/,(?=[^ ].*?=)/)   // split multiple Set-Cookie values
        .map(c => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
    } catch {
      // warmup failed — try without cookies (will likely 403 but worth a shot)
    }

    const apiUrl = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}&issuer=&from_date=&to_date=`;
    const res = await timedFetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": UA,
        "Referer": "https://www.nseindia.com/",
        "Accept-Language": "en-US,en;q=0.9",
        ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
      },
    });
    if (!res.ok) return null;

    let data;
    try { data = await res.json(); } catch { return null; }
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
      headers: {
        "User-Agent": UA,
        ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
      },
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
  /**
   * Resolve NSE ticker → BSE security code.
   * First checks static map; if missing, calls BSE QuickSearch API.
   */
  async resolveBseCode(symbol) {
    if (BSE_CODES[symbol]) return BSE_CODES[symbol];

    // Dynamic fallback: BSE QuickSearch
    try {
      const searchRes = await timedFetch(
        `https://api.bseindia.com/BseIndiaAPI/api/ddlsector_companySearch/w?search=${encodeURIComponent(symbol)}&type=0&flag=0`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
            "Referer": "https://www.bseindia.com/",
          },
        }
      );
      if (!searchRes.ok) return null;
      const results = await searchRes.json();
      // Results is an array of { scrip_cd, long_name, nseid, ... }
      const match = Array.isArray(results)
        ? results.find(r => (r.nseid || "").toUpperCase() === symbol)
        : null;
      if (match?.scrip_cd) return String(match.scrip_cd);
    } catch {
      // dynamic search failed — continue with null
    }
    return null;
  }

  async find(ticker) {
    const symbol  = ticker.toUpperCase().replace(/\.BO$/, "").replace(/\.NS$/, "");
    const bseCode = await this.resolveBseCode(symbol);
    if (!bseCode) return null;   // ticker not found anywhere — skip

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

// ── 3. Tickertape Provider ────────────────────────────────────────────────────

class TickertapeProvider {
  /**
   * Resolve NSE ticker → Tickertape SID via their search API.
   *
   * API response shape (verified 2026-07):
   *   { success: true, data: { searchResults: [{ sid: "ACEL", stock: { info: { ticker: "ACE", name: "..." } } }] } }
   *
   * The SID is the identifier used in Tickertape URLs:
   *   tickertape.in/stocks/{SID}/concalls
   */
  async resolveSid(symbol) {
    try {
      const res = await timedFetch(
        `https://api.tickertape.in/stocks/search?text=${encodeURIComponent(symbol)}&count=10`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept":     "application/json",
            "Referer":    "https://www.tickertape.in/",
            "Origin":     "https://www.tickertape.in",
          },
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const results = data?.data?.searchResults;
      if (!Array.isArray(results) || !results.length) return null;
      // Prefer exact NSE ticker match; fall back to first result
      const match = results.find(r => (r.stock?.info?.ticker || "").toUpperCase() === symbol)
                 ?? results[0];
      return match?.sid ?? null;   // e.g. "ACEL" for ACE
    } catch {
      return null;
    }
  }

  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    // Step 1: Resolve SID — Tickertape URLs are /stocks/{SID}/concalls, not /stocks/{TICKER}/concalls
    const sid = await this.resolveSid(symbol);
    if (!sid) {
      console.warn(`[concall/tickertape] Could not resolve SID for ${symbol}`);
      return null;
    }

    const url = `https://www.tickertape.in/stocks/${sid}/concalls`;
    const res  = await timedFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":     "text/html,application/xhtml+xml",
        "Referer":    "https://www.tickertape.in/",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $    = load(html);

    // Tickertape lists concall PDF links on the page
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes(".pdf") || href.includes("concall") || href.includes("transcript")) {
        const full = href.startsWith("http") ? href : `https://www.tickertape.in${href}`;
        links.push(full);
      }
    });

    // Try PDFs first
    const pdfLink = links.find(l => l.endsWith(".pdf"));
    if (pdfLink) {
      const pdfRes = await timedFetch(pdfLink, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
      });
      if (pdfRes.ok) {
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        const text   = await extractPdf(buffer);
        if (text && text.length >= 500) {
          return { text, url: pdfLink, provider: "tickertape" };
        }
      }
    }

    // Fall back to inline page text
    const bodyText = $(".concall-content, .transcript, [class*='concall'], [class*='transcript'], main article").text().trim();
    if (bodyText.length > 2000) {
      return { text: bodyText, url, provider: "tickertape" };
    }

    return null;
  }
}

// ── 3. Screener.in Provider ───────────────────────────────────────────────────

class ScreenerProvider {
  /**
   * Screener uses two URL patterns for Indian equities:
   *   - screener.in/company/{TICKER}/concall/       (e.g. INFY, RELIANCE)
   *   - screener.in/company/{TICKER}-EQ/concall/    (e.g. ACE-EQ, BHEL-EQ)
   *
   * Try plain symbol first; if 404, retry with -EQ suffix.
   */
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    const candidates = [
      `https://www.screener.in/company/${encodeURIComponent(symbol)}/concall/`,
      `https://www.screener.in/company/${encodeURIComponent(symbol)}-EQ/concall/`,
    ];

    for (const url of candidates) {
      const res = await timedFetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
          "Accept":     "text/html",
        },
      });
      if (!res.ok) continue;   // try next candidate

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
        continue;   // page loaded but no usable content — try next candidate
      }

      const pdfRes = await timedFetch(pdfLink, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
      });
      if (!pdfRes.ok) continue;

      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const text   = await extractPdf(buffer);
      if (!text || text.length < 500) continue;

      return { text, url: pdfLink, provider: "screener" };
    }

    return null;
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

const IN_PROVIDERS = [new NSEFilingProvider(), new BSEFilingProvider(), new TickertapeProvider(), new ScreenerProvider()];
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
