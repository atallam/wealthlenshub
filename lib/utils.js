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

/**
 * Read every row of a Supabase query. PostgREST caps each response at 1000 rows
 * no matter what .limit() asks for, so any read that must see ALL rows (a full
 * ledger for FIFO tax math, an export, an aggregate) has to page.
 * `makeQ` must return a FRESH query builder each call; rows are ordered by id
 * (after any ordering the query already has) so pages never overlap or skip.
 */
export async function fetchAll(makeQ, pageSize = 1000, maxRows = 100000) {
  const out = [];
  for (let from = 0; out.length < maxRows; from += pageSize) {
    const { data, error } = await makeQ().order("id").range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
