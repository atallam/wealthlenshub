import { extractPdf } from "../extractor.js";
import { timedFetch } from "./shared.js";

// ── 4. Tickertape Provider ────────────────────────────────────────────────────

export class TickertapeProvider {
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
