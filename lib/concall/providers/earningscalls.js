import { timedFetch } from "./shared.js";

// ── 7. EarningsCalls.dev Provider (US stocks) ─────────────────────────────────

export class EarningsCallsDevProvider {
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
