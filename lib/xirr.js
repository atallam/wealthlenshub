/**
 * lib/xirr.js — money-weighted return (XIRR) from a transaction ledger.
 *
 * Pure functions, no I/O. Used by routes/analytics.js for per-holding,
 * per-member and portfolio XIRR, and reusable by the AI advisor tools.
 *
 * Conventions (same as Excel XIRR): outflows negative, inflows positive,
 * dates as ISO strings. The current market value is appended as a final
 * positive cashflow dated today.
 */

const DAY_MS = 86_400_000;
const toDate = (d) => (d instanceof Date ? d : new Date(String(d).slice(0, 10) + "T00:00:00Z"));

/** Net present value of cashflows at annual rate r, relative to the first date. */
export function xnpv(rate, flows) {
  const t0 = toDate(flows[0].date).getTime();
  let s = 0;
  for (const f of flows) {
    const years = (toDate(f.date).getTime() - t0) / DAY_MS / 365;
    s += f.amount / Math.pow(1 + rate, years);
  }
  return s;
}

/**
 * XIRR by Newton–Raphson with bisection fallback.
 * @param {{date:string, amount:number}[]} flows
 * @returns {number|null} annualised rate (0.12 = 12%) or null if undefined
 */
export function xirr(flows, { guess = 0.1 } = {}) {
  const fl = (flows || [])
    .filter((f) => f && Number.isFinite(f.amount) && f.amount !== 0 && f.date)
    .sort((a, b) => toDate(a.date) - toDate(b.date));
  if (fl.length < 2) return null;
  const hasNeg = fl.some((f) => f.amount < 0), hasPos = fl.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const span = (toDate(fl[fl.length - 1].date) - toDate(fl[0].date)) / DAY_MS;
  if (span < 1) return null;

  const f = (r) => xnpv(r, fl);
  const df = (r) => {
    const t0 = toDate(fl[0].date).getTime();
    let s = 0;
    for (const c of fl) {
      const y = (toDate(c.date).getTime() - t0) / DAY_MS / 365;
      s += (-y * c.amount) / Math.pow(1 + r, y + 1);
    }
    return s;
  };

  // Newton
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const v = f(r), d = df(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (next <= -0.999999) break;
    if (Math.abs(next - r) < 1e-10) return finalize(next);
    r = next;
  }

  // Bisection on [-0.9999, 10]
  let lo = -0.9999, hi = 10;
  let flo = f(lo), fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.abs(fm) < 1e-8 || (hi - lo) < 1e-10) return finalize(mid);
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return finalize((lo + hi) / 2);

  function finalize(x) {
    if (!Number.isFinite(x)) return null;
    // Guard against nonsense from near-degenerate inputs (e.g. 2-day spans)
    if (x > 100 || x < -0.9999) return null;
    return x;
  }
}

/**
 * Convert ledger transactions + current value into XIRR cashflows.
 *
 * @param {Array} txns      rows { txn_type, units, price, amount, txn_date }
 * @param {number} currentValue  market value today (0 → treated as fully exited)
 * @param {string} [asOf]   ISO date for the terminal flow (default today)
 */
export function cashflowsFromLedger(txns, currentValue = 0, asOf = null) {
  const flows = [];
  for (const t of txns || []) {
    const units = Math.abs(Number(t.units) || 0);
    const price = Number(t.price) || 0;
    const amt = t.amount != null && t.amount !== "" ? Math.abs(Number(t.amount)) : units * price;
    if (!t.txn_date) continue;
    switch (t.txn_type) {
      case "BUY": case "SIP": case "RIGHTS":
        if (amt > 0) flows.push({ date: t.txn_date, amount: -amt, kind: "BUY" });
        break;
      case "SELL": case "SWP": case "REDEEM":
        if (amt > 0) flows.push({ date: t.txn_date, amount: amt, kind: "SELL" });
        break;
      case "DIVIDEND":
        if (amt > 0) flows.push({ date: t.txn_date, amount: amt, kind: "DIVIDEND" });
        break;
      default: break; // BONUS / SPLIT carry no cash
    }
  }
  const end = asOf || new Date().toISOString().slice(0, 10);
  if (currentValue > 0) flows.push({ date: end, amount: currentValue, kind: "VALUE" });
  return flows;
}

/** Simple summary stats alongside XIRR for a ledger. */
export function ledgerStats(txns, currentValue = 0, asOf = null) {
  const flows = cashflowsFromLedger(txns, currentValue, asOf);
  const invested  = flows.filter((f) => f.kind === "BUY").reduce((s, f) => s - f.amount, 0);
  const withdrawn = flows.filter((f) => f.kind === "SELL").reduce((s, f) => s + f.amount, 0);
  const dividends = flows.filter((f) => f.kind === "DIVIDEND").reduce((s, f) => s + f.amount, 0);
  const rate = xirr(flows);
  const first = flows.length ? flows.reduce((m, f) => (toDate(f.date) < toDate(m) ? f.date : m), flows[0].date) : null;
  return {
    xirr: rate,
    xirr_pct: rate == null ? null : Math.round(rate * 10000) / 100,
    invested, withdrawn, dividends,
    current_value: currentValue,
    absolute_gain: currentValue + withdrawn + dividends - invested,
    absolute_return_pct: invested > 0 ? Math.round(((currentValue + withdrawn + dividends - invested) / invested) * 10000) / 100 : null,
    since: first,
    cashflows: flows.length,
  };
}
