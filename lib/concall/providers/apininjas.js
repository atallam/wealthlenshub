import { timedFetch } from "./shared.js";

// ── 6. API Ninjas Provider (US stocks) ────────────────────────────────────────

export class ApiNinjasProvider {
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
