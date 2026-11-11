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
 * canonical fix is backfilling holdings.ticker itself (done after each
 * CAS import — see lib/isinBackfill.js).
 */

import { isIsin, resolveIsinSymbol } from "../prices.js";
import { NSEFilingProvider } from "./providers/nse.js";
import { BSEFilingProvider } from "./providers/bse.js";
import { ScreenerProvider } from "./providers/screener.js";
import { TickertapeProvider } from "./providers/tickertape.js";
import { MotleyFoolProvider } from "./providers/motleyfool.js";
import { ApiNinjasProvider } from "./providers/apininjas.js";
import { EarningsCallsDevProvider } from "./providers/earningscalls.js";

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
