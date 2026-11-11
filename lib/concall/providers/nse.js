import { extractPdf } from "../extractor.js";
import { timedFetch } from "./shared.js";

// ── 1. NSE Filing Provider ────────────────────────────────────────────────────

export class NSEFilingProvider {
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
