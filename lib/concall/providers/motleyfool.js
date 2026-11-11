import { getCheerio, timedFetch } from "./shared.js";

// ── 5. Motley Fool Provider (US stocks) ───────────────────────────────────────

export class MotleyFoolProvider {
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
