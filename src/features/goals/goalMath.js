/**
 * goalMath.js — Shared financial projection math for Goals features.
 * Imported by GoalsTab, GoalPlanModal, and useGoalAI.
 * Keep pure (no React, no API calls).
 */

// ── Expected CAGR per asset type ──────────────────────────────────────────────
export const ASSET_CAGR = {
  US_STOCK:    0.11,
  IN_STOCK:    0.11,
  CRYPTO:      0.12,
  US_ETF:      0.10,
  IN_ETF:      0.10,
  MF:          0.11,
  FD:          0.065,
  PPF:         0.071,
  EPF:         0.081,
  REAL_ESTATE: 0.07,
  CASH:        0.035,
  US_BOND:     0.045,
  OTHER:       0.08,
};

/** Weighted-average CAGR for a goal's linked asset types. Default 10%. */
export function goalCagr(linkedTypes) {
  if (!linkedTypes || linkedTypes.length === 0) return 0.10;
  const rates = linkedTypes.map(t => ASSET_CAGR[t] ?? 0.08);
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

/**
 * Future value of corpus + SIP using correct compounded formula.
 *   FV_corpus = cur × (1+r)^y
 *   FV_SIP    = monthly × [(1+r/12)^n − 1] / (r/12) × (1+r/12)  [annuity due]
 */
export function projectedFV(cur, monthly, r, yLeft) {
  const n        = yLeft * 12;
  const corpusFV = cur * Math.pow(1 + r, yLeft);
  if (monthly <= 0 || n <= 0) return corpusFV;
  const sipFV = monthly * ((Math.pow(1 + r / 12, n) - 1) / (r / 12)) * (1 + r / 12);
  return corpusFV + sipFV;
}

/**
 * Years until the goal corpus is reached at current growth + SIP.
 * Iterates month-by-month (max 50 years). Returns null if unreachable.
 */
export function projectedCompletionYears(cur, monthly, r, targetAmount) {
  if (cur >= targetAmount) return 0;
  const mRate = r / 12;
  let val = cur;
  for (let mo = 1; mo <= 600; mo++) {
    val = val * (1 + mRate) + monthly;
    if (val >= targetAmount) return mo / 12;
  }
  return null;
}

/** Monthly SIP required to close the remaining gap over yLeft years at rate r. */
export function sipRequired(remaining, r, yLeft) {
  const n = yLeft * 12;
  if (n <= 0 || remaining <= 0) return 0;
  const factor = ((Math.pow(1 + r / 12, n) - 1) / (r / 12)) * (1 + r / 12);
  return factor > 0 ? remaining / factor : 0;
}

/**
 * Single source of truth for goal status.
 * Shared by GoalsTab cards, GoalPlanModal table, and AI prompts.
 */
export function goalStatusCalc(g, cur) {
  const prog = g.targetAmount > 0 ? cur / g.targetAmount : 0;
  if (prog >= 1) return { label: 'Achieved', color: '#1d9e75' };

  const msLeft = Math.max(0, new Date(g.targetDate) - new Date());
  const yLeft  = msLeft / (864e5 * 365.25);
  if (yLeft <= 0) return { label: 'Overdue', color: '#e07c5a' };

  const r       = goalCagr(g.linkedTypes);
  const monthly = g.monthlyContribution || 0;
  const fv      = projectedFV(cur, monthly, r, yLeft);

  if (fv >= g.targetAmount * 0.95) return { label: 'On track',        color: '#1d9e75' };
  if (fv >= g.targetAmount * 0.70) return { label: 'Needs attention', color: '#d4a017' };
  return { label: 'Behind', color: '#e07c5a' };
}

// ── Tax-optimized path (static, category + horizon aware) ────────────────────

const BASE_TAX_PATHS = {
  short: {
    label: 'Short-term (< 2y)', color: '#6ec0c9',
    instruments: ['Liquid / Ultra-Short Funds (no exit load)', 'Arbitrage Funds (15% STCG, better than FD post-tax)', 'Sweep FD for guaranteed returns'],
    tip: 'Avoid STCG churn — prefer funds with low portfolio turnover. Target post-tax yield ≥ savings rate.',
  },
  medium: {
    label: 'Medium-term (2–5y)', color: '#a084ca',
    instruments: ['ELSS Funds (80C deduction — saves ₹46,800 in 30% bracket, 3y lock-in)', 'Debt MF (indexation benefit pre-2023 grandfathered units)', 'PPF top-up if 80C limit not exhausted'],
    tip: "ELSS gives equity-level returns + 80C deduction. Best if you haven't used the full ₹1.5L limit.",
  },
  long: {
    label: 'Long-term (5–10y)', color: '#5a9ce0',
    instruments: ['Index Funds via SIP (LTCG ₹1.25L exempt pa — harvest annually in March)', 'NPS Tier II (80CCD(1B) extra ₹50K deduction over 80C limit)', 'Balanced Advantage Funds (tax efficient rebalancing)'],
    tip: 'Harvest LTCG gains up to ₹1.25L each March to reset cost basis — compoundes the tax saving over 10y.',
  },
  verylong: {
    label: 'Very long-term (> 10y)', color: '#1d9e75',
    instruments: ['PPF (EEE status — fully tax-free at investment, growth, withdrawal)', 'NPS (80CCD deduction + ₹50K extra via 80CCD(1B), 60% corpus tax-free at retirement)', 'Direct equity SIP (harvest LTCG ₹1.25L pa; no DDT on dividends under ₹10L)', 'REITs / InvITs for real-estate goals (LTCG + pass-through structure)'],
    tip: 'PPF + NPS together give ₹2L+ deduction pa. Over 20 years, tax savings compound to significant corpus.',
  },
};

const CATEGORY_OVERRIDES = {
  'Emergency Fund': {
    instruments: ['Liquid Fund (T+1 redemption)', 'Overnight Fund (zero credit risk)', 'Arbitrage Fund (tax-efficient with 15d redemption)'],
    tip: 'Emergency fund must be instantly accessible. Avoid lock-in instruments regardless of tax benefit.',
  },
  'Retirement': {
    instruments: ['NPS Tier I (80CCD, 60% tax-free lump sum at 60)', 'PPF (EEE, 15y tenure — stagger withdrawals)', 'ELSS → switch to index funds post-3y lock-in', 'Direct equity (LTCG harvest annually)'],
    tip: 'NPS is the most tax-efficient retirement vehicle — ₹2L deduction pa + partial tax-free corpus.',
  },
  'Real Estate': {
    instruments: ['REITs (diversified, liquid real-estate, LTCG after 3y)', 'Debt MF for down-payment accumulation (stable)', 'Index funds for longer horizon'],
    tip: 'REITs distribute 90% income — tax-efficient at lower tax brackets vs. direct property.',
  },
};

export function getTaxPath(yLeft, category) {
  let base;
  if (yLeft < 2)  base = { ...BASE_TAX_PATHS.short };
  else if (yLeft < 5)  base = { ...BASE_TAX_PATHS.medium };
  else if (yLeft < 10) base = { ...BASE_TAX_PATHS.long };
  else base = { ...BASE_TAX_PATHS.verylong };

  const override = CATEGORY_OVERRIDES[category];
  if (override) {
    return { ...base, instruments: override.instruments, tip: override.tip };
  }
  return base;
}
