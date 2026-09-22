/**
 * lib/isinBackfill.js — resolve ISIN-shaped `ticker` values to real trading
 * symbols and persist them.
 *
 * Background: CAS-imported IN_STOCK/IN_ETF holdings historically ended up
 * with the ISIN (e.g. INE040A01034) stored in `ticker` instead of a real
 * NSE/BSE symbol, because depository CAS statements list holdings by ISIN
 * and lib/casDiff.js's normalizeCasHolding() falls back to the ISIN when no
 * ticker is parsed (`ticker: h.ticker || isin`). Neither the concall
 * provider chain (lib/concall/providers.js) nor Yahoo's `${ticker}.NS`
 * price lookup can work from an ISIN, so this used to silently break both
 * pricing and concall analysis for every CAS-imported stock — see
 * project memory "wealthlenshub-cron-and-pricing" for the original
 * diagnosis (Sep 2026).
 *
 * This helper is shared by two call sites:
 *   - POST /api/cron/backfill-isin-tickers (routes/cron.js) — one-off,
 *     re-runnable backfill across all users, for holdings imported before
 *     this fix existed.
 *   - services/casImport.service.js's applyCasImport() — runs automatically
 *     right after every future CAS import, so the bug can't be
 *     reintroduced by new imports going forward.
 *
 * Deliberately leaves holdings.isin (the CAS natural-key column, migration
 * 0029) untouched — this only fixes the column that pricing/concall read.
 * Best-effort: a holding whose ISIN can't be resolved (delisted, too new,
 * not in Yahoo's search) is left as-is and reported as unresolved, not
 * treated as an error.
 */
import { isIsin, resolveIsinSymbol } from "./prices.js";
import { pLimit } from "./utils.js";

/**
 * @param {Array<{id:string, name:string, ticker:string, type:string}>} holdings
 * @param {(id:string, ticker:string) => Promise<{error?:{message:string}}>} updateTicker
 * @param {number} concurrency
 * @returns {Promise<{checked:number, candidates:number, resolved:number, unresolved:number, results:Array}>}
 */
export async function backfillIsinTickers(holdings, updateTicker, concurrency = 5) {
  const candidates = (holdings || []).filter(h => isIsin(h.ticker));
  if (!candidates.length) {
    return { checked: holdings?.length || 0, candidates: 0, resolved: 0, unresolved: 0, results: [] };
  }

  const tasks = candidates.map(h => async () => {
    const symbol = await resolveIsinSymbol(h.ticker);
    if (!symbol) return { id: h.id, name: h.name, isin: h.ticker, resolved: false };
    const { error } = await updateTicker(h.id, symbol);
    return { id: h.id, name: h.name, isin: h.ticker, symbol, resolved: !error, error: error?.message || null };
  });

  const results  = await pLimit(tasks, concurrency);
  const resolved = results.filter(r => r.resolved).length;
  return {
    checked: holdings.length,
    candidates: candidates.length,
    resolved,
    unresolved: candidates.length - resolved,
    results,
  };
}
