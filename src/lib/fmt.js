/**
 * src/lib/fmt.js — Shared formatting helpers for frontend components.
 *
 * Re-exports the canonical formatters from utils.js and adds display
 * helpers (gainColor, currentFY, fyList) that were previously duplicated
 * in TaxTab.jsx and other tabs.
 *
 * Import from here, not from utils.js directly, for any component that
 * only needs formatting — it avoids pulling in the heavy FX/XIRR logic.
 */

// ── Re-export core formatters from utils.js ───────────────────────────────────
export {
  fmt,
  fmtCr,
  fmtINR,
  fmtUSD,
  fmtCrINR,
  fmtCrUSD,
  fmtNative,
  fmtCrNative,
  fmtPct,
  fmtSec,
  fmtCrSec,
  fmtSize,
  ago,
  uid,
} from '../utils.js';

// ── Gain / loss color ─────────────────────────────────────────────────────────

/**
 * Returns a CSS color string for a positive (green) or negative (red) value.
 * @param {number|null} n
 * @returns {string}
 */
export function gainColor(n) {
  if (n == null || isNaN(n)) return 'var(--text-muted)';
  return n >= 0 ? '#4caf9a' : '#e07c5a';
}

// ── Indian FY helpers (previously duplicated in TaxTab.jsx) ──────────────────

/**
 * Returns the current Indian financial year as "YYYY-YY" (e.g. "2025-26").
 * April 1 marks the start of a new FY.
 */
export function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed; April = 3
  const start = m >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/**
 * Returns an ordered list of FY strings from current+1 down to 2021-22.
 * @returns {string[]}
 */
export function fyList() {
  const cur = parseInt(currentFY().split('-')[0], 10);
  const fys = [];
  for (let y = cur + 1; y >= 2021; y--) {
    fys.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return fys;
}

// ── Compact INR (for small labels, tooltips) ──────────────────────────────────

/**
 * Formats a number as a compact INR string (Cr / L / raw).
 * Identical to fmtCrINR but with 1 decimal for lakhs (matches TaxTab usage).
 * @param {number} n
 * @returns {string}
 */
export function fmtINRCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const abs  = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
