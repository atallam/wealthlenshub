/**
 * src/lib/amortization.js
 *
 * Reducing-balance amortization utility for liability auto-calculation.
 *
 * computeOutstanding(liability, asOfDate?)
 *   Returns the estimated current outstanding balance based on:
 *     - outstanding_amount  — principal at the time of start_date (or current balance if no start_date)
 *     - interest_rate       — annual rate in % (e.g. 8.5)
 *     - emi                 — fixed monthly EMI amount
 *     - start_date          — "YYYY-MM" string, when EMI payments began
 *     - tenure_months       — total loan tenure (used for payoff date, not required for balance calc)
 *
 * If any of interest_rate, emi, or start_date are missing, returns outstanding_amount as-is
 * (manual / static mode).
 *
 * getPayoffDate(liability)
 *   Returns a Date for when the loan will be fully paid off, or null if insufficient data.
 *
 * isAutoCalc(liability)
 *   Returns true if the liability has enough data for auto-calculation.
 */

/**
 * Parse "YYYY-MM" → Date at start of that month (UTC noon to avoid TZ edge cases).
 */
function parseYearMonth(ym) {
  if (!ym || typeof ym !== "string") return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 15));
}

/**
 * Number of full months between two dates (start → end).
 * Returns 0 if end is before start.
 */
function monthsBetween(start, end) {
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

/**
 * Returns true when the liability has the fields needed for auto-calculation.
 */
export function isAutoCalc(liability) {
  return (
    !!liability.start_date &&
    !!liability.interest_rate &&
    +liability.interest_rate > 0 &&
    !!liability.emi &&
    +liability.emi > 0 &&
    !!liability.outstanding_amount &&
    +liability.outstanding_amount > 0
  );
}

/**
 * Compute the current outstanding balance.
 *
 * Formula (standard reducing balance):
 *   B(n) = P × (1+r)^n − EMI × [(1+r)^n − 1] / r
 * where:
 *   P   = initial principal (outstanding_amount at start_date)
 *   r   = monthly interest rate = annual_rate / 12 / 100
 *   n   = months elapsed since start_date
 *
 * Clamps to 0 (loan fully paid).
 *
 * @param {object} liability
 * @param {Date}   [asOfDate=new Date()]
 * @returns {number}
 */
export function computeOutstanding(liability, asOfDate = new Date()) {
  if (!isAutoCalc(liability)) {
    return +liability.outstanding_amount || 0;
  }

  const P = +liability.outstanding_amount;
  const r = +liability.interest_rate / 12 / 100;
  const emi = +liability.emi;
  const startDate = parseYearMonth(liability.start_date);

  if (!startDate) return P;

  const n = monthsBetween(startDate, asOfDate);
  if (n === 0) return P;

  const factor = Math.pow(1 + r, n);
  const balance = P * factor - emi * (factor - 1) / r;
  return Math.max(0, Math.round(balance));
}

/**
 * Estimated payoff date — month when balance reaches 0.
 * Uses the amortization formula solved for n:
 *   n = log(EMI / (EMI − P×r)) / log(1+r)
 *
 * Returns null if not enough data or EMI ≤ monthly interest (loan never paid off).
 *
 * @param {object} liability
 * @returns {Date|null}
 */
export function getPayoffDate(liability) {
  if (!isAutoCalc(liability)) return null;

  const P = +liability.outstanding_amount;
  const r = +liability.interest_rate / 12 / 100;
  const emi = +liability.emi;
  const startDate = parseYearMonth(liability.start_date);

  if (!startDate) return null;

  const monthlyInterest = P * r;
  if (emi <= monthlyInterest) return null; // EMI doesn't cover interest — never paid off

  const totalMonths = Math.ceil(Math.log(emi / (emi - P * r)) / Math.log(1 + r));
  const payoff = new Date(startDate);
  payoff.setUTCMonth(payoff.getUTCMonth() + totalMonths);
  return payoff;
}

/**
 * Human-readable payoff label, e.g. "Mar 2031 (4 yrs 8 mo left)".
 *
 * @param {object} liability
 * @param {Date}   [asOfDate=new Date()]
 * @returns {string|null}
 */
export function payoffLabel(liability, asOfDate = new Date()) {
  const payoff = getPayoffDate(liability);
  if (!payoff) return null;

  const monthsLeft = monthsBetween(asOfDate, payoff);
  if (monthsLeft <= 0) return "Fully paid off";

  const yrs = Math.floor(monthsLeft / 12);
  const mo = monthsLeft % 12;
  const parts = [];
  if (yrs > 0) parts.push(`${yrs} yr${yrs > 1 ? "s" : ""}`);
  if (mo > 0) parts.push(`${mo} mo`);

  const monthName = payoff.toLocaleString("default", { month: "short", timeZone: "UTC" });
  const year = payoff.getUTCFullYear();
  return `${monthName} ${year} · ${parts.join(" ")} left`;
}
