import { extractPdf } from "../extractor.js";
import { getCheerio, timedFetch } from "./shared.js";

// ── 3. Screener.in Provider ───────────────────────────────────────────────────

export class ScreenerProvider {
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
