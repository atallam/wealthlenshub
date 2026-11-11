import { extractPdf } from "../extractor.js";
import { BSE_CODES, timedFetch } from "./shared.js";

// ── 2. BSE Filing Provider ────────────────────────────────────────────────────

// Multiple search terms — BSE filings use various phrases for concall docs
const BSE_SEARCH_TERMS = [
  "concall",
  "earnings call",
  "conference call",
  "analyst meet",
  "transcript",
];

export class BSEFilingProvider {
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
