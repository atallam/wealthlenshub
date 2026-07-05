/**
 * lib/stale-holdings.js
 *
 * Identifies "manual" holdings — assets with no live API or CAS feed —
 * that haven't been updated within a per-type staleness threshold.
 *
 * Manual types (no ticker / scheme_code feed):
 *   FD, PPF, EPF, REAL_ESTATE, CASH, INSURANCE, OTHER
 *
 * API-tracked types (skipped here — prices refresh automatically):
 *   IN_STOCK, IN_ETF, US_STOCK, US_ETF, US_BOND, CRYPTO, MF
 */

/** Days before a manual holding is considered stale. */
export const STALE_THRESHOLDS_DAYS = {
  FD:          90,
  PPF:         90,
  EPF:         90,
  REAL_ESTATE: 180,
  CASH:        14,
  INSURANCE:   365,
  OTHER:       60,
};

export const MANUAL_TYPES = new Set(Object.keys(STALE_THRESHOLDS_DAYS));

/** @param {object} h  @param {Date} now  @returns {{ days_stale: number, threshold: number } | null} */
function staleness(h, now) {
  const threshold = STALE_THRESHOLDS_DAYS[h.type];
  if (!threshold) return null;
  const lastTouched = h.updated_at
    ? new Date(h.updated_at)
    : h.created_at
      ? new Date(h.created_at)
      : new Date(0);
  const days_stale = Math.floor((now - lastTouched) / 864e5);
  return { days_stale, threshold };
}

/**
 * All manual holdings that are past their threshold.
 * Used by the in-app banner — shows everything overdue, not just new crossings.
 *
 * @param {object[]} holdings
 * @param {Date}     [now]
 * @returns {object[]}  sorted most-stale first, each with .days_stale and .threshold
 */
export function getStaleHoldings(holdings, now = new Date()) {
  const result = [];
  for (const h of holdings) {
    if (!MANUAL_TYPES.has(h.type)) continue;
    const s = staleness(h, now);
    if (s && s.days_stale >= s.threshold) {
      result.push({ ...h, ...s });
    }
  }
  return result.sort((a, b) => b.days_stale - a.days_stale);
}

/**
 * Holdings that crossed their threshold THIS WEEK (days_stale in [threshold, threshold + 6]).
 * Used by the email nudge cron — fires once per crossing, not repeatedly.
 *
 * A holding that went stale 8+ days ago has already been nudged; skip it until
 * the user updates it and it crosses the threshold again.
 *
 * @param {object[]} holdings
 * @param {Date}     [now]
 * @returns {object[]}  sorted most-stale first
 */
export function getCrossingHoldings(holdings, now = new Date()) {
  const WINDOW = 6; // days after threshold to still send (catches weekend/holiday drift)
  const result = [];
  for (const h of holdings) {
    if (!MANUAL_TYPES.has(h.type)) continue;
    const s = staleness(h, now);
    if (s && s.days_stale >= s.threshold && s.days_stale <= s.threshold + WINDOW) {
      result.push({ ...h, ...s });
    }
  }
  return result.sort((a, b) => b.days_stale - a.days_stale);
}
