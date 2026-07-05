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

/**
 * Filter an array of holdings to only the stale manual ones.
 *
 * @param {object[]} holdings  - Holdings rows (must include updated_at and type)
 * @param {Date}     [now]     - Injectable for testing; defaults to new Date()
 * @returns {object[]}         - Stale holdings, each augmented with:
 *                               .days_stale   (number)
 *                               .threshold    (number — days allowed)
 */
export function getStaleHoldings(holdings, now = new Date()) {
  const stale = [];

  for (const h of holdings) {
    if (!MANUAL_TYPES.has(h.type)) continue;

    const threshold  = STALE_THRESHOLDS_DAYS[h.type];
    const lastTouched = h.updated_at
      ? new Date(h.updated_at)
      : h.created_at
        ? new Date(h.created_at)
        : new Date(0);

    const daysStale = Math.floor((now - lastTouched) / 864e5);
    if (daysStale >= threshold) {
      stale.push({ ...h, days_stale: daysStale, threshold });
    }
  }

  // Most stale first — biggest attention first in the digest
  return stale.sort((a, b) => b.days_stale - a.days_stale);
}
