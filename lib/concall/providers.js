/**
 * lib/concall/providers.js — Transcript sourcing provider chain.
 *
 * Providers are tried in order. Each provider's find() method either:
 *   - Returns { text, url, provider } on success
 *   - Returns null if no transcript was found
 *   - Throws if the provider errors (caller catches and advances chain)
 *
 * Chain order (IN stocks):
 *   1. NSEFilingProvider    — NSE corporate announcements (blocked by Cloudflare in practice)
 *   2. BSEFilingProvider    — BSE API multi-term search (most reliable for IN stocks)
 *   3. ScreenerProvider     — Screener.in HTML scrape (works when not behind login)
 *   4. TickertapeProvider   — Tickertape internal API attempt (experimental)
 *
 * Chain order (US stocks):
 *   1. MotleyFoolProvider   — Motley Fool free transcripts
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
  console.warn("[concall/providers] bse_codes.json not found — BSE provider will use dynamic lookup only");
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
   * NSE's corporate announcements API requires a live session cookie.
   * In practice this is often blocked by Cloudflare from server IPs,
   * but we still attempt it — a 403 just moves us to the next provider.
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
      const rawCookies = warmup.headers.get("set-cookie") || "";
      cookieHeader = rawCookies
        .split(/,(?=[^ ].*?=)/)
        .map(c => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
    } catch (e) {
      console.warn(`[concall/nse] Warm-up failed for ${symbol}:`, e.message);
    }

    const apiUrl = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}&issuer=&from_date=&to_date=`;
    let res;
    try {
      res = await timedFetch(apiUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": UA,
          "Referer": "https://www.nseindia.com/",
          "Accept-Language": "en-US,en;q=0.9",
          ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
        },
      });
    } catch (e) {
      console.warn(`[concall/nse] API request failed for ${symbol}:`, e.message);
      return null;
    }

    if (!res.ok) {
      console.warn(`[concall/nse] API HTTP ${res.status} for ${symbol} (likely Cloudflare block)`);
      return null;
    }

    let data;
    try { data = await res.json(); } catch {
      console.warn(`[concall/nse] Non-JSON response for ${symbol}`);
      return null;
    }
    if (!Array.isArray(data)) {
      console.warn(`[concall/nse] Unexpected response shape for ${symbol}:`, typeof data);
      return null;
    }

    console.log(`[concall/nse] ${symbol}: ${data.length} announcements`);

    const concallEntry = data.find(item => {
      const desc = (item.desc || item.subject || "").toLowerCase();
      return (
        desc.includes("concall") ||
        desc.includes("earnings call") ||
        desc.includes("investor call") ||
        desc.includes("analyst meet") ||
        desc.includes("conference call")
      );
    });

    if (!concallEntry) {
      console.warn(`[concall/nse] No concall filing in ${data.length} announcements for ${symbol}`);
      return null;
    }

    const pdfUrl = concallEntry.attchmntFile || concallEntry.attachmentFile;
    if (!pdfUrl) {
      console.warn(`[concall/nse] Filing found but no attachment for ${symbol}: "${concallEntry.desc || concallEntry.subject}"`);
      return null;
    }

    const fullUrl = pdfUrl.startsWith("http") ? pdfUrl : `https://www.nseindia.com${pdfUrl}`;
    const pdfRes  = await timedFetch(fullUrl, {
      headers: { "User-Agent": UA, ...(cookieHeader ? { "Cookie": cookieHeader } : {}) },
    });
    if (!pdfRes.ok) {
      console.warn(`[concall/nse] PDF fetch failed: ${fullUrl} → HTTP ${pdfRes.status}`);
      return null;
    }

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const text   = await extractPdf(buffer);
    if (!text || text.length < 500) {
      console.warn(`[concall/nse] PDF too short for ${symbol}: ${text?.length ?? 0} chars`);
      return null;
    }

    console.log(`[concall/nse] SUCCESS for ${symbol}: ${text.length} chars`);
    return { text, url: fullUrl, provider: "nse" };
  }
}

// ── 2. BSE Filing Provider ────────────────────────────────────────────────────

// Multiple search terms — BSE filings use various phrases for concall docs
const BSE_SEARCH_TERMS = [
  "concall",
  "earnings call",
  "conference call",
  "analyst meet",
  "transcript",
];

class BSEFilingProvider {
  /**
   * Resolve NSE ticker → BSE security code.
   *
   * NOTE: BSE's API returns fields in UPPERCASE (e.g. NSEID, SCRIP_CD).
   * Always read both cases to be safe.
   */
  async resolveBseCode(symbol) {
    if (BSE_CODES[symbol]) {
      console.log(`[concall/bse] ${symbol} → BSE code ${BSE_CODES[symbol]} (static map)`);
      return BSE_CODES[symbol];
    }

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
      if (!searchRes.ok) {
        console.warn(`[concall/bse] QuickSearch HTTP ${searchRes.status} for ${symbol}`);
        return null;
      }
      const results = await searchRes.json();
      // BSE API may return fields in UPPERCASE — check both
      const match = Array.isArray(results)
        ? results.find(r => {
            const nseid = (r.nseid || r.NSEID || r.NSEId || "").toUpperCase();
            return nseid === symbol;
          })
        : null;
      if (match) {
        const code = match.scrip_cd || match.SCRIP_CD || match.Scrip_Cd || match.scripCd;
        if (code) {
          console.log(`[concall/bse] ${symbol} → BSE code ${code} (dynamic lookup)`);
          return String(code);
        }
      }
      console.warn(`[concall/bse] No match for ${symbol} in QuickSearch (${results?.length ?? 0} results)`);
    } catch (e) {
      console.warn(`[concall/bse] Dynamic BSE code lookup failed for ${symbol}:`, e.message);
    }
    return null;
  }

  async find(ticker) {
    const symbol  = ticker.toUpperCase().replace(/\.BO$/, "").replace(/\.NS$/, "");
    const bseCode = await this.resolveBseCode(symbol);
    if (!bseCode) {
      console.warn(`[concall/bse] No BSE code for ${symbol} — skipping provider`);
      return null;
    }

    let entry = null;
    for (const term of BSE_SEARCH_TERMS) {
      const searchUrl =
        `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
        `?strCat=-1&strPrevDate=&strScrip=${bseCode}&strSearch=${encodeURIComponent(term)}&strToDate=&strType=C&subcategory=-1`;

      try {
        const res = await timedFetch(searchUrl, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
            "Referer": "https://www.bseindia.com/",
          },
        });
        if (!res.ok) {
          console.warn(`[concall/bse] ${symbol} search "${term}" → HTTP ${res.status}`);
          continue;
        }
        const data  = await res.json();
        const items = data?.Table || [];
        console.log(`[concall/bse] ${symbol} (${bseCode}) + "${term}" → ${items.length} filings`);
        if (items.length > 0) {
          entry = items[0];
          console.log(`[concall/bse] Using: "${entry.NEWSSUB || entry.HEADLINE || "(no title)"}"`);
          break;
        }
      } catch (e) {
        console.warn(`[concall/bse] Search "${term}" error for ${symbol}:`, e.message);
      }
    }

    if (!entry) {
      console.warn(`[concall/bse] No concall filings for ${symbol} with any search term`);
      return null;
    }

    const pdfUrl = entry.ATTACHMENTNAME
      ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${entry.ATTACHMENTNAME}`
      : null;

    if (!pdfUrl) {
      console.warn(`[concall/bse] Filing found but no ATTACHMENTNAME for ${symbol}: "${entry.NEWSSUB}"`);
      return null;
    }

    const pdfRes = await timedFetch(pdfUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
    });
    if (!pdfRes.ok) {
      console.warn(`[concall/bse] PDF fetch failed: ${pdfUrl} → HTTP ${pdfRes.status}`);
      return null;
    }

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const text   = await extractPdf(buffer);
    if (!text || text.length < 500) {
      console.warn(`[concall/bse] PDF too short for ${symbol}: ${text?.length ?? 0} chars`);
      return null;
    }

    console.log(`[concall/bse] SUCCESS for ${symbol}: ${text.length} chars from ${pdfUrl}`);
    return { text, url: pdfUrl, provider: "bse" };
  }
}

// ── 3. Screener.in Provider ───────────────────────────────────────────────────

class ScreenerProvider {
  /**
   * Screener uses two URL patterns for Indian equities:
   *   - screener.in/company/{TICKER}/concall/
   *   - screener.in/company/{TICKER}-EQ/concall/
   *
   * Screener serves Django SSR pages — static cheerio CAN find links,
   * but unauthenticated requests sometimes get a login-page redirect.
   * We detect that and skip gracefully.
   */
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    const candidates = [
      `https://www.screener.in/company/${encodeURIComponent(symbol)}/concall/`,
      `https://www.screener.in/company/${encodeURIComponent(symbol)}-EQ/concall/`,
    ];

    for (const url of candidates) {
      try {
        const res = await timedFetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept":     "text/html",
            "Referer":    "https://www.screener.in/",
          },
        });
        if (!res.ok) {
          console.warn(`[concall/screener] ${url} → HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();

        // Detect login redirect — unauthenticated requests often serve login page
        if (
          html.includes('id="id_username"') ||
          html.includes('name="password"') ||
          html.includes("/accounts/login/")
        ) {
          console.warn(`[concall/screener] ${url} → login page (not authenticated)`);
          continue;
        }

        const $ = load(html);

        // Collect all links that look like concall-related PDFs
        // Screener typically links out to BSE/NSE filing PDFs
        const links = [];
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href") || "";
          if (
            href.endsWith(".pdf") ||
            href.includes("bseindia.com") ||
            href.includes("nseindia.com") ||
            href.includes("nsearchives") ||
            href.includes("concall") ||
            href.includes("transcript")
          ) {
            const full = href.startsWith("http") ? href : `https://www.screener.in${href}`;
            links.push(full);
          }
        });

        console.log(`[concall/screener] ${symbol} at ${url} → ${links.length} candidate links`);

        // Prefer a PDF that's clearly a BSE/NSE attachment
        const pdfLink =
          links.find(l => l.includes("bseindia.com/xml-data")) ||
          links.find(l => l.includes("nsearchives.nseindia.com")) ||
          links.find(l => l.endsWith(".pdf"));

        if (!pdfLink) {
          // Try inline transcript text from page body
          const bodyText = $(
            ".concall-transcript, .transcript-content, article, [class*='concall'], [class*='transcript']"
          ).text().trim();
          if (bodyText.length > 2000) {
            console.log(`[concall/screener] ${symbol}: using inline text (${bodyText.length} chars)`);
            return { text: bodyText, url, provider: "screener" };
          }
          console.warn(`[concall/screener] ${symbol}: no PDF links or inline text at ${url}`);
          continue;
        }

        const pdfRes = await timedFetch(pdfLink, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
        });
        if (!pdfRes.ok) {
          console.warn(`[concall/screener] PDF HTTP ${pdfRes.status} for ${pdfLink}`);
          continue;
        }

        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        const text   = await extractPdf(buffer);
        if (!text || text.length < 500) {
          console.warn(`[concall/screener] PDF too short for ${symbol}: ${text?.length ?? 0} chars`);
          continue;
        }

        console.log(`[concall/screener] SUCCESS for ${symbol}: ${text.length} chars from ${pdfLink}`);
        return { text, url: pdfLink, provider: "screener" };

      } catch (e) {
        console.warn(`[concall/screener] ${url} error:`, e.message);
      }
    }

    return null;
  }
}

// ── 4. Tickertape Provider ────────────────────────────────────────────────────

class TickertapeProvider {
  /**
   * IMPORTANT: tickertape.in is a React SPA — raw HTML fetch returns an
   * empty <div id="root"> shell with no concall data.
   *
   * Instead we probe their internal API endpoint. If it responds with
   * structured data we extract the PDF URL from it. If the API is private
   * or the shape changes this will gracefully return null.
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
      const match = results.find(r => (r.stock?.info?.ticker || "").toUpperCase() === symbol)
                 ?? results[0];
      return match?.sid ?? null;
    } catch {
      return null;
    }
  }

  async find(ticker) {
    const symbol = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    const sid = await this.resolveSid(symbol);
    if (!sid) {
      console.warn(`[concall/tickertape] Could not resolve SID for ${symbol}`);
      return null;
    }

    // Attempt Tickertape's internal concalls API (backing their React SPA)
    // The public page tickertape.in/stocks/{SID}/concalls is client-rendered
    // and returns no useful data via static fetch.
    const apiUrl = `https://api.tickertape.in/stocks/${encodeURIComponent(sid)}/concalls`;
    try {
      const apiRes = await timedFetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept":     "application/json",
          "Referer":    `https://www.tickertape.in/stocks/${sid}/concalls`,
          "Origin":     "https://www.tickertape.in",
        },
      });

      if (apiRes.ok) {
        const json = await apiRes.json();
        // Try to find a PDF URL in whatever shape the API returns
        const concalls = (
          json?.data?.concalls ||
          json?.data ||
          (Array.isArray(json) ? json : [])
        );
        for (const call of (Array.isArray(concalls) ? concalls : [])) {
          const pdfUrl =
            call.pdfUrl     ||
            call.pdf_url    ||
            call.transcript ||
            call.transcriptUrl ||
            call.url;
          if (pdfUrl) {
            const pdfRes = await timedFetch(pdfUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
            });
            if (pdfRes.ok) {
              const buffer = Buffer.from(await pdfRes.arrayBuffer());
              const text   = await extractPdf(buffer);
              if (text && text.length >= 500) {
                console.log(`[concall/tickertape] SUCCESS for ${symbol} (SID: ${sid}): ${text.length} chars`);
                return { text, url: pdfUrl, provider: "tickertape" };
              }
            }
          }
        }
        console.warn(`[concall/tickertape] API returned but no usable PDF for ${symbol} (SID: ${sid})`);
      } else {
        console.warn(`[concall/tickertape] API HTTP ${apiRes.status} for ${symbol} (SID: ${sid})`);
      }
    } catch (e) {
      console.warn(`[concall/tickertape] API error for ${symbol}:`, e.message);
    }

    // NOTE: Static HTML scrape of tickertape.in/stocks/{SID}/concalls is intentionally
    // omitted — the page is a React SPA and returns an empty shell without JS execution.
    return null;
  }
}

// ── 5. Motley Fool Provider (US stocks) ───────────────────────────────────────

class MotleyFoolProvider {
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.[A-Z]+$/, "");

    const indexUrl = `https://www.fool.com/earnings-call-transcripts/?filter=${encodeURIComponent(symbol)}`;
    let res;
    try {
      res = await timedFetch(indexUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
          "Accept":     "text/html",
        },
      });
    } catch (e) {
      console.warn(`[concall/motleyfool] Fetch failed for ${symbol}:`, e.message);
      return null;
    }
    if (!res.ok) {
      console.warn(`[concall/motleyfool] HTTP ${res.status} for ${symbol}`);
      return null;
    }

    const html  = await res.text();
    const $     = load(html);

    let transcriptUrl = null;
    $("a[href*='earnings-call-transcript']").each((_, el) => {
      if (!transcriptUrl) {
        const href = $(el).attr("href") || "";
        transcriptUrl = href.startsWith("http") ? href : `https://www.fool.com${href}`;
      }
    });
    if (!transcriptUrl) {
      console.warn(`[concall/motleyfool] No transcript links found for ${symbol}`);
      return null;
    }

    const pageRes = await timedFetch(transcriptUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
        "Accept":     "text/html",
      },
    });
    if (!pageRes.ok) {
      console.warn(`[concall/motleyfool] Transcript page HTTP ${pageRes.status}: ${transcriptUrl}`);
      return null;
    }

    const pageHtml = await pageRes.text();
    const $p       = load(pageHtml);

    const text = $p("article .article-body, .transcript-container, .article-content").text().trim();
    if (!text || text.length < 500) {
      console.warn(`[concall/motleyfool] Transcript too short for ${symbol}: ${text?.length ?? 0} chars`);
      return null;
    }

    console.log(`[concall/motleyfool] SUCCESS for ${symbol}: ${text.length} chars`);
    return { text, url: transcriptUrl, provider: "motleyfool" };
  }
}

// ── Exported provider chain ───────────────────────────────────────────────────

// IN chain: NSE → BSE → Screener → Tickertape
// BSE is the most reliable (direct JSON API, multiple search terms).
// NSE is often blocked by Cloudflare but still worth a try.
// Screener works when not behind login.
// Tickertape is experimental (internal API probe only — SPA scraping removed).
const IN_PROVIDERS = [
  new NSEFilingProvider(),
  new BSEFilingProvider(),
  new ScreenerProvider(),
  new TickertapeProvider(),
];
const US_PROVIDERS = [new MotleyFoolProvider()];

/**
 * Run each provider independently and return a diagnostic report.
 * Used by GET /api/concall/:holdingId/debug.
 *
 * @param {string} ticker
 * @param {string} assetType
 * @returns {Promise<Array<{name:string, status:string, chars:number|null, url:string|null, error:string|null}>>}
 */
export async function debugTranscript(ticker, assetType) {
  if (!ticker) return [{ name: "all", status: "error", chars: null, url: null, error: "No ticker" }];

  const isUS = ["US_STOCK", "US_ETF"].includes(assetType);
  const chain = isUS ? US_PROVIDERS : IN_PROVIDERS;

  const results = [];
  for (const provider of chain) {
    const name = provider.constructor.name;
    const entry = { name, status: "null", chars: null, url: null, error: null };
    try {
      const result = await provider.find(ticker);
      if (result) {
        entry.status = "success";
        entry.chars  = result.text?.length ?? null;
        entry.url    = result.url ?? null;
      }
    } catch (err) {
      entry.status = "error";
      entry.error  = err.message;
    }
    results.push(entry);
  }
  return results;
}

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
    const name = provider.constructor.name;
    try {
      console.log(`[concall/providers] Trying ${name} for ${ticker} (${assetType})`);
      const result = await provider.find(ticker);
      if (result) {
        console.log(`[concall/providers] ${name} succeeded for ${ticker}`);
        return result;
      }
      console.log(`[concall/providers] ${name} returned null for ${ticker} — trying next`);
    } catch (err) {
      console.warn(`[concall/providers] ${name} threw for ${ticker}:`, err.message);
    }
  }

  console.warn(`[concall/providers] All providers exhausted for ${ticker} — returning null`);
  return null;
}
