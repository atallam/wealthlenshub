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
 *   2. BSEFilingProvider    — BSE API multi-term search; tries with no date
 *                             filter first, then an explicit ~2-year date
 *                             range as an unverified fallback (bseindia.com
 *                             403s direct fetches, so this couldn't be
 *                             confirmed ahead of deploying — check logs)
 *   3. ScreenerProvider     — Screener.in HTML scrape. As of Sep 2026 the old
 *                             /company/{T}/concall/ sub-page is gone for real
 *                             companies — transcripts moved into the main
 *                             company page's Documents section, linked from
 *                             an <a> tag whose text says "Transcript". Tries
 *                             the main page first, falls back to the legacy
 *                             /concall/ URL (PDF links, then inline text).
 *   4. TickertapeProvider   — Tickertape internal API attempt. As of Sep 2026
 *                             the /stocks/{sid}/concalls API appears retired
 *                             (404s) and the current UI has no concalls tab
 *                             — kept as a low-cost attempt, expect it to
 *                             usually return null.
 *
 * Chain order (US stocks):
 *   1. ApiNinjasProvider       — api-ninjas.com official API (needs API_NINJAS_KEY)
 *   2. EarningsCallsDevProvider — earningscalls.dev official API (needs EARNINGSCALLS_DEV_KEY)
 *   3. MotleyFoolProvider      — Motley Fool free transcripts (HTML scrape, no key — last resort)
 *
 * The two new US providers are official, key-based REST APIs, not scrapes —
 * unlike Concall.in (see BACKLOG.md), their business is licensing this data,
 * so programmatic access is the intended use. Both no-op (return null,
 * falling through to the next provider) if their env var isn't set, so
 * deploying without either key is safe — you just fall back to MotleyFool
 * exactly as before.
 *
 * Install: npm install cheerio
 *
 * NOTE — ISIN-as-ticker: CAS-imported IN_STOCK/IN_ETF holdings sometimes have
 * the ISIN (e.g. INE040A01034) stored as `ticker` instead of a real trading
 * symbol, because depository CAS statements list holdings by ISIN. None of
 * the IN providers below can look anything up by ISIN, so findTranscript()
 * resolves it to a trading symbol first via lib/prices.js's resolveIsinSymbol()
 * — the same resolver the price-refresh engine already uses for this exact
 * problem (see lib/refresh.js). This is a live-resolve safety net; the
 * canonical fix is backfilling holdings.ticker itself (POST
 * /api/cron/backfill-isin-tickers).
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { extractPdf } from "./extractor.js";
import { isIsin, resolveIsinSymbol } from "../prices.js";

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
   * Run BSE_SEARCH_TERMS against the announcements API with a given date
   * filter and return the first matching filing, or null.
   *
   * @param {string} bseCode
   * @param {string} symbol
   * @param {{strPrevDate:string, strToDate:string}} dateParams
   * @param {string} label  Human-readable tag for log lines (which pass this is)
   */
  async _searchTerms(bseCode, symbol, dateParams, label) {
    for (const term of BSE_SEARCH_TERMS) {
      const searchUrl =
        `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
        `?strCat=-1&strPrevDate=${encodeURIComponent(dateParams.strPrevDate)}` +
        `&strScrip=${bseCode}&strSearch=${encodeURIComponent(term)}` +
        `&strToDate=${encodeURIComponent(dateParams.strToDate)}&strType=C&subcategory=-1`;

      try {
        const res = await timedFetch(searchUrl, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)",
            "Referer": "https://www.bseindia.com/",
          },
        });
        if (!res.ok) {
          console.warn(`[concall/bse] ${symbol} search "${term}" [${label}] → HTTP ${res.status}`);
          continue;
        }
        const data  = await res.json();
        const items = data?.Table || [];
        console.log(`[concall/bse] ${symbol} (${bseCode}) + "${term}" [${label}] → ${items.length} filings`);
        if (items.length > 0) {
          const entry = items[0];
          console.log(`[concall/bse] Using: "${entry.NEWSSUB || entry.HEADLINE || "(no title)"}"`);
          return entry;
        }
      } catch (e) {
        console.warn(`[concall/bse] Search "${term}" [${label}] error for ${symbol}:`, e.message);
      }
    }
    return null;
  }

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

    // Pass 1: no date filter — this is BSE's own site default and was the
    // original behavior. Kept first since it's the cheapest and, per BSE's
    // UI, is meant to mean "no restriction."
    let entry = await this._searchTerms(bseCode, symbol, { strPrevDate: "", strToDate: "" }, "no date filter");

    // Pass 2 (fallback): an explicit ~2-year date range, in the DD/MM/YYYY
    // format BSE's own date pickers use. This is a best-effort guess, not a
    // verified fix — bseindia.com returns HTTP 403 to direct fetch attempts
    // from outside a browser session, so the exact semantics of an empty
    // strPrevDate/strToDate (whether it means "unrestricted" or silently
    // defaults to a narrow recent window) could not be confirmed ahead of
    // deploying. The clear [label] tags in the log lines above/below let the
    // next Render log paste confirm or rule this out.
    if (!entry) {
      const toDate   = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 730);
      const fmt = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      entry = await this._searchTerms(
        bseCode, symbol,
        { strPrevDate: fmt(fromDate), strToDate: fmt(toDate) },
        "2-year date range fallback"
      );
    }

    if (!entry) {
      console.warn(`[concall/bse] No concall filings for ${symbol} with any search term (with or without an explicit date range)`);
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
   * Screener.in restructured its site at some point before Sep 2026 — the
   * old dedicated /concall/ sub-page (screener.in/company/{TICKER}/concall/)
   * now 404s for real, large-cap companies (verified directly against
   * INDIGO). Transcripts now live in the main company page's "Documents"
   * section, where each transcript entry is an <a> tag whose visible text
   * literally contains the word "Transcript", linking out to a BSE/NSE
   * attachment PDF (or the company's own investor-relations domain).
   *
   * We try the main company page first (current, verified path), then fall
   * back to the legacy /concall/ URLs in case they still resolve for some
   * smaller or less-recently-reindexed companies.
   */
  async find(ticker) {
    const { load } = await getCheerio();
    const symbol   = ticker.toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");

    const mainCandidates = [
      `https://www.screener.in/company/${encodeURIComponent(symbol)}/`,
      `https://www.screener.in/company/${encodeURIComponent(symbol)}-EQ/`,
    ];
    const legacyCandidates = [
      `https://www.screener.in/company/${encodeURIComponent(symbol)}/concall/`,
      `https://www.screener.in/company/${encodeURIComponent(symbol)}-EQ/concall/`,
    ];

    for (const url of mainCandidates) {
      const result = await this._tryMainPage(url, symbol, load);
      if (result) return result;
    }
    for (const url of legacyCandidates) {
      const result = await this._tryLegacyConcallPage(url, symbol, load);
      if (result) return result;
    }

    return null;
  }

  async _fetchHtml(url) {
    const res = await timedFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "text/html",
        "Referer":    "https://www.screener.in/",
      },
    });
    if (!res.ok) return { html: null, status: res.status };
    return { html: await res.text(), status: res.status };
  }

  _isLoginPage(html) {
    return html.includes('id="id_username"') || html.includes('name="password"') || html.includes("/accounts/login/");
  }

  async _fetchAndExtractPdf(url, symbol, sourceLabel) {
    try {
      const pdfRes = await timedFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)" },
      });
      if (!pdfRes.ok) {
        console.warn(`[concall/screener] PDF HTTP ${pdfRes.status} for ${url} (${sourceLabel})`);
        return null;
      }
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const text   = await extractPdf(buffer);
      if (!text || text.length < 500) {
        console.warn(`[concall/screener] PDF too short for ${symbol}: ${text?.length ?? 0} chars (${sourceLabel})`);
        return null;
      }
      console.log(`[concall/screener] SUCCESS for ${symbol}: ${text.length} chars from ${url} (${sourceLabel})`);
      return { text, url, provider: "screener" };
    } catch (e) {
      console.warn(`[concall/screener] PDF fetch error for ${url} (${sourceLabel}):`, e.message);
      return null;
    }
  }

  async _tryMainPage(url, symbol, load) {
    let html, status;
    try {
      ({ html, status } = await this._fetchHtml(url));
    } catch (e) {
      console.warn(`[concall/screener] ${url} error:`, e.message);
      return null;
    }
    if (!html) {
      console.warn(`[concall/screener] ${url} → HTTP ${status}`);
      return null;
    }
    if (this._isLoginPage(html)) {
      console.warn(`[concall/screener] ${url} → login page (not authenticated)`);
      return null;
    }

    const $ = load(html);

    // Primary heuristic: an <a> tag whose visible text contains "transcript"
    // — Screener's current labeling convention in the Documents/Concalls
    // section of the main company page.
    const textMatches = [];
    $("a[href]").each((_, el) => {
      const label = $(el).text().trim().toLowerCase();
      if (label.includes("transcript")) {
        const href = $(el).attr("href") || "";
        textMatches.push(href.startsWith("http") ? href : `https://www.screener.in${href}`);
      }
    });

    if (textMatches.length) {
      console.log(`[concall/screener] ${symbol} at ${url} → ${textMatches.length} "transcript"-labeled link(s)`);
      const result = await this._fetchAndExtractPdf(textMatches[0], symbol, "main page, transcript label");
      if (result) return result;
    }

    // Fallback heuristic on the same page: domain-based matching, in case a
    // company's transcript link doesn't literally say "transcript".
    const domainMatches = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (
        href.includes("AnnPdfOpen") ||
        href.includes("bseindia.com") ||
        href.includes("nsearchives.nseindia.com") ||
        href.includes("nseindia.com")
      ) {
        domainMatches.push(href.startsWith("http") ? href : `https://www.screener.in${href}`);
      }
    });

    if (domainMatches.length) {
      console.log(`[concall/screener] ${symbol} at ${url} → ${domainMatches.length} domain-matched link(s) (no "transcript" text match)`);
      const result = await this._fetchAndExtractPdf(domainMatches[0], symbol, "main page, domain fallback");
      if (result) return result;
    }

    console.warn(`[concall/screener] ${symbol}: no transcript link found on main page ${url}`);
    return null;
  }

  async _tryLegacyConcallPage(url, symbol, load) {
    let html, status;
    try {
      ({ html, status } = await this._fetchHtml(url));
    } catch (e) {
      console.warn(`[concall/screener] ${url} error:`, e.message);
      return null;
    }
    if (!html) {
      console.warn(`[concall/screener] ${url} → HTTP ${status}`);
      return null;
    }
    if (this._isLoginPage(html)) {
      console.warn(`[concall/screener] ${url} → login page (not authenticated)`);
      return null;
    }

    const $ = load(html);
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
        links.push(href.startsWith("http") ? href : `https://www.screener.in${href}`);
      }
    });

    console.log(`[concall/screener] ${symbol} at ${url} (legacy) → ${links.length} candidate links`);

    const pdfLink =
      links.find(l => l.includes("bseindia.com/xml-data")) ||
      links.find(l => l.includes("nsearchives.nseindia.com")) ||
      links.find(l => l.endsWith(".pdf"));

    if (pdfLink) {
      const result = await this._fetchAndExtractPdf(pdfLink, symbol, "legacy /concall/ page");
      if (result) return result;
    }

    // Legacy inline transcript text, retained for any /concall/ pages that
    // still render the transcript as page body text rather than a PDF link.
    const bodyText = $(
      ".concall-transcript, .transcript-content, article, [class*='concall'], [class*='transcript']"
    ).text().trim();
    if (bodyText.length > 2000) {
      console.log(`[concall/screener] ${symbol}: using inline text from legacy page (${bodyText.length} chars)`);
      return { text: bodyText, url, provider: "screener" };
    }

    console.warn(`[concall/screener] ${symbol}: no PDF links or inline text at legacy ${url}`);
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

// ── 6. API Ninjas Provider (US stocks) ────────────────────────────────────────

class ApiNinjasProvider {
  /**
   * api-ninjas.com Earnings Call Transcript API — official, key-based REST API
   * (not a scrape). Free tier covers the last 5 years; paid tiers unlock the
   * full archive back to 2005. Get a key at https://api.api-ninjas.com/ and
   * set API_NINJAS_KEY. Silently skips (returns null) if the key isn't set.
   */
  async find(ticker) {
    const key = process.env.API_NINJAS_KEY;
    if (!key) {
      console.warn(`[concall/apininjas] API_NINJAS_KEY not set — skipping provider`);
      return null;
    }

    const symbol = ticker.toUpperCase().replace(/\.[A-Z]+$/, "");
    const url    = `https://api.api-ninjas.com/v1/earningstranscript?ticker=${encodeURIComponent(symbol)}`;

    let res;
    try {
      res = await timedFetch(url, {
        headers: { "X-Api-Key": key, "Accept": "application/json" },
      });
    } catch (e) {
      console.warn(`[concall/apininjas] Fetch failed for ${symbol}:`, e.message);
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      console.warn(`[concall/apininjas] Auth rejected (HTTP ${res.status}) — check API_NINJAS_KEY`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[concall/apininjas] HTTP ${res.status} for ${symbol}`);
      return null;
    }

    let data;
    try { data = await res.json(); } catch {
      console.warn(`[concall/apininjas] Non-JSON response for ${symbol}`);
      return null;
    }

    // No transcript on file for this ticker → API returns {} (or similar empty shape)
    const text = data?.transcript;
    if (!text || text.length < 500) {
      console.warn(`[concall/apininjas] No usable transcript for ${symbol}`);
      return null;
    }

    console.log(`[concall/apininjas] SUCCESS for ${symbol}: ${text.length} chars`);
    // API-only source — no stable public page to link back to for a single transcript.
    return { text, url: null, provider: "apininjas" };
  }
}

// ── 7. EarningsCalls.dev Provider (US stocks) ─────────────────────────────────

class EarningsCallsDevProvider {
  /**
   * earningscalls.dev REST API — official, key-based (not a scrape).
   * 255,000+ speaker-tagged transcripts across 12,000+ companies. Get a key
   * at https://earningscalls.dev/ and set EARNINGSCALLS_DEV_KEY. Silently
   * skips (returns null) if the key isn't set.
   */
  async find(ticker) {
    const key = process.env.EARNINGSCALLS_DEV_KEY;
    if (!key) {
      console.warn(`[concall/earningscallsdev] EARNINGSCALLS_DEV_KEY not set — skipping provider`);
      return null;
    }

    const symbol = ticker.toUpperCase().replace(/\.[A-Z]+$/, "");

    // Step 1: resolve the most recent earnings call id for this ticker
    let latestRes;
    try {
      latestRes = await timedFetch(
        `https://earningscalls.dev/api/v1/companies/ticker/${encodeURIComponent(symbol)}/latest`,
        { headers: { "X-API-Key": key, "Accept": "application/json" } }
      );
    } catch (e) {
      console.warn(`[concall/earningscallsdev] Lookup failed for ${symbol}:`, e.message);
      return null;
    }

    if (latestRes.status === 401 || latestRes.status === 403) {
      console.warn(`[concall/earningscallsdev] Auth rejected (HTTP ${latestRes.status}) — check EARNINGSCALLS_DEV_KEY`);
      return null;
    }
    if (!latestRes.ok) {
      console.warn(`[concall/earningscallsdev] HTTP ${latestRes.status} for ${symbol}`);
      return null;
    }

    let latest;
    try { latest = await latestRes.json(); } catch {
      console.warn(`[concall/earningscallsdev] Non-JSON lookup response for ${symbol}`);
      return null;
    }

    const earningsId = latest?.earnings_call_id || latest?.id;
    if (!earningsId) {
      console.warn(`[concall/earningscallsdev] No earnings call on file for ${symbol}`);
      return null;
    }

    // Step 2: fetch the full transcript by id
    let transcriptRes;
    try {
      transcriptRes = await timedFetch(
        `https://earningscalls.dev/api/v1/transcripts/${encodeURIComponent(earningsId)}`,
        { headers: { "X-API-Key": key, "Accept": "application/json" } }
      );
    } catch (e) {
      console.warn(`[concall/earningscallsdev] Transcript fetch failed for ${symbol}:`, e.message);
      return null;
    }
    if (!transcriptRes.ok) {
      console.warn(`[concall/earningscallsdev] Transcript HTTP ${transcriptRes.status} for ${symbol}`);
      return null;
    }

    let transcriptData;
    try { transcriptData = await transcriptRes.json(); } catch {
      console.warn(`[concall/earningscallsdev] Non-JSON transcript response for ${symbol}`);
      return null;
    }

    // Response may be a flat transcript string or an array of speaker segments
    // depending on endpoint/tier — handle both defensively.
    const text = typeof transcriptData?.transcript === "string"
      ? transcriptData.transcript
      : Array.isArray(transcriptData?.segments)
        ? transcriptData.segments.map(s => `${s.speaker_name ? s.speaker_name + ": " : ""}${s.text_content || ""}`).join("\n\n")
        : null;

    if (!text || text.length < 500) {
      console.warn(`[concall/earningscallsdev] No usable transcript text for ${symbol}`);
      return null;
    }

    console.log(`[concall/earningscallsdev] SUCCESS for ${symbol}: ${text.length} chars`);
    // API-only source — no stable public page to link back to for a single transcript.
    return { text, url: null, provider: "earningscallsdev" };
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
// US chain: API Ninjas → EarningsCalls.dev → Motley Fool
// The first two are official, key-based APIs (skip silently if unconfigured);
// Motley Fool is the free, keyless, scrape-based last resort — kept last
// since it's the least resilient of the three (see header comment above).
const US_PROVIDERS = [
  new ApiNinjasProvider(),
  new EarningsCallsDevProvider(),
  new MotleyFoolProvider(),
];

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
  const results = [];
  let symbol = ticker;

  // See header comment — CAS-imported IN_STOCK/IN_ETF holdings sometimes have
  // the ISIN stored as ticker. Surface the resolution step in the debug report
  // itself so it's visible when diagnosing "no transcript found" failures.
  if (!isUS && isIsin(ticker)) {
    const resolved = await resolveIsinSymbol(ticker);
    if (!resolved) {
      return [{ name: "isin-resolve", status: "error", chars: null, url: null, error: `Could not resolve ISIN ${ticker} to a trading symbol` }];
    }
    results.push({ name: "isin-resolve", status: "success", chars: null, url: null, error: null, resolved_to: resolved });
    symbol = resolved;
  }

  const chain = isUS ? US_PROVIDERS : IN_PROVIDERS;
  for (const provider of chain) {
    const name = provider.constructor.name;
    const entry = { name, status: "null", chars: null, url: null, error: null };
    try {
      const result = await provider.find(symbol);
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
  let symbol = ticker;

  // See header comment — resolve ISIN-as-ticker before running the IN chain,
  // since none of NSE/BSE/Screener/Tickertape can look anything up by ISIN.
  if (!isUS && isIsin(ticker)) {
    const resolved = await resolveIsinSymbol(ticker);
    if (!resolved) {
      console.warn(`[concall/providers] Could not resolve ISIN ${ticker} to a trading symbol — no providers to try`);
      return null;
    }
    console.log(`[concall/providers] Resolved ISIN ${ticker} → ${resolved}`);
    symbol = resolved;
  }

  const chain = isUS ? US_PROVIDERS : IN_PROVIDERS;

  for (const provider of chain) {
    const name = provider.constructor.name;
    try {
      console.log(`[concall/providers] Trying ${name} for ${symbol} (${assetType})`);
      const result = await provider.find(symbol);
      if (result) {
        console.log(`[concall/providers] ${name} succeeded for ${symbol}`);
        return result;
      }
      console.log(`[concall/providers] ${name} returned null for ${symbol} — trying next`);
    } catch (err) {
      console.warn(`[concall/providers] ${name} threw for ${symbol}:`, err.message);
    }
  }

  console.warn(`[concall/providers] All providers exhausted for ${symbol} — returning null`);
  return null;
}
