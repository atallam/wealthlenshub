// Shared low-level utilities used across lib/ and routes/.
// (P2-2 — previously pLimit lived only in lib/refresh.js and was borrowed via
// a named import in routes/import.js; it belongs here since it's a generic
// concurrency helper, not price-refresh-specific logic.)

/**
 * Run an array of zero-arg async functions with bounded concurrency.
 * Each function's rejection is caught and returned as `{ _err: message }`
 * so one failing task never aborts the batch.
 * @param {Array<() => Promise<any>>} fns
 * @param {number} concurrency
 * @returns {Promise<any[]>} results in the same order as `fns`
 */
export async function pLimit(fns, concurrency = 5) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      const idx = i++;
      results[idx] = await fns[idx]().catch(e => ({ _err: e.message }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, worker));
  return results;
}
