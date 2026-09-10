// Shared price-refresh engine — used by routes/prices.js (per-user, on demand)
// and routes/cron.js (all users, scheduled). One implementation so the cron
// can never drift behind the UI again.
import { supabase } from "./db.js";
import { fetchUsdInr, fetchMfNavByIsin, mfNav, stockPrice, indianStockPrice, isIsin } from "./prices.js";

// Concurrency limiter
export async function pLimit(fns, concurrency = 5) {
  const results = []; let i = 0;
  async function worker() { while (i < fns.length) { const idx = i++; results[idx] = await fns[idx]().catch(e => ({ _err: e.message })); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, worker));
  return results;
}

// MF: scheme_code → NAV; if no scheme_code, resolve from ISIN via AMFI and persist scheme_code.
async function mfPatch(h, now) {
  let sc = h.scheme_code;
  if (!sc && isIsin(h.ticker) && String(h.ticker).toUpperCase().startsWith("INF")) {
    const resolved = await fetchMfNavByIsin(String(h.ticker).toUpperCase());
    if (resolved?.scheme_code) sc = resolved.scheme_code;
  }
  if (!sc) return null;
  const nav = await mfNav(sc);
  if (!nav) return null;
  return { scheme_code: sc, current_nav: nav, current_value: (h.units || 0) * nav, price_fetched_at: now };
}

/**
 * Refresh prices for every holding of one user.
 * @returns {Promise<{updated:number, skipped:number, failed:number, usdInr:number, fxSource:string, results:object[], unpriced:object[]}>}
 */
export async function refreshUserHoldings(userId, { concurrency = 8 } = {}) {
  const { data: holdings } = await supabase.from("holdings")
    .select("id, name, type, ticker, scheme_code, units, usd_inr_rate")
    .eq("user_id", userId);
  if (!holdings?.length) return { updated: 0, skipped: 0, failed: 0, results: [], unpriced: [] };

  const fxPromise = fetchUsdInr();
  const now = new Date().toISOString();
  const PRICED = new Set(["MF", "IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF", "US_BOND", "CRYPTO", "CASH"]);

  const tasks = holdings.map(h => async () => {
    let patch = null;
    if (h.type === "MF") {
      patch = await mfPatch(h, now);
    } else if ((h.type === "IN_STOCK" || h.type === "IN_ETF") && h.ticker) {
      const price = await indianStockPrice(h.ticker);
      if (price) patch = { current_price: price, current_value: (h.units || 0) * price, price_fetched_at: now };
    } else if ((h.type === "US_STOCK" || h.type === "US_ETF" || h.type === "US_BOND") && h.ticker) {
      const q = await stockPrice(h.ticker.toUpperCase());
      if (q?.price) { const { rate } = await fxPromise; patch = { current_price: q.price, current_value: (h.units || 0) * q.price, usd_inr_rate: rate, price_fetched_at: now }; }
    } else if (h.type === "CRYPTO" && h.ticker) {
      const t = h.ticker.toUpperCase(); const sym = t.includes("-") ? t : `${t}-USD`;
      const q = await stockPrice(sym);
      if (q?.price) { const { rate } = await fxPromise; patch = { current_price: q.price, current_value: (h.units || 0) * q.price, usd_inr_rate: rate, price_fetched_at: now }; }
    } else if (h.type === "CASH") {
      const { rate } = await fxPromise;
      patch = { price_fetched_at: now };
      if (h.usd_inr_rate && Math.abs(h.usd_inr_rate - rate) > 0.01) patch.usd_inr_rate = rate;
    }
    return { h, patch };
  });

  const fetched = await pLimit(tasks, concurrency);

  const valid = fetched.filter(x => x && !x._err && x.patch);
  const updates = await Promise.all(valid.map(async x => {
    const { error } = await supabase.from("holdings").update(x.patch).eq("id", x.h.id);
    return error ? { id: x.h.id, _err: error.message } : { id: x.h.id, ...x.patch };
  }));

  const failed = fetched.filter(x => x?._err).length + updates.filter(u => u._err).length;
  const unpriced = fetched
    .map((x, i) => ({ x, h: holdings[i] }))
    .filter(({ x, h }) => PRICED.has(h.type) && !(x && x.patch))
    .map(({ h }) => ({ id: h.id, name: h.name, type: h.type, ticker: h.ticker }));
  const skipped = holdings.length - valid.length - fetched.filter(x => x?._err).length;

  const { rate: usdInr, source: fxSource } = await fxPromise;
  return { updated: updates.filter(u => !u._err).length, skipped, failed, usdInr, fxSource, results: updates.filter(u => !u._err), unpriced };
}
