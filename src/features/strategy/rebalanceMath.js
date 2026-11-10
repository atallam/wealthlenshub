// Pure rebalance maths, extracted from StrategyTab so it can be unit-tested.

/**
 * Per-asset-type trade list.
 *
 * A type with NO key in `targetAlloc` (never set by the user or a preset - e.g. a newly
 * added type such as IN_BOND) is "unmanaged": it is held at its current value and removed
 * from the base the managed targets apply to. An explicit 0 still means "sell down to zero".
 * With no unmanaged types this is identical to the original calculation.
 */
export function computeTrades({ types, curAlloc, normTarget, targetAlloc, rTotal, totalWithCash }) {
  const isManaged = (t) => Object.prototype.hasOwnProperty.call(targetAlloc, t);
  const unmanagedCur = Object.entries(curAlloc).reduce((s, [t, v]) => (isManaged(t) ? s : s + v), 0);
  const managedTotal = Math.max(totalWithCash - unmanagedCur, 0);
  const k = totalWithCash > 0 ? managedTotal / totalWithCash : 1;

  return types.map((type) => {
    const cur    = curAlloc[type] || 0;
    const curPct = rTotal > 0 ? (cur / rTotal) * 100 : 0;
    let tgtPct, tgtAmt;
    if (isManaged(type)) {
      tgtPct = (normTarget[type] || 0) * k;
      tgtAmt = totalWithCash * (tgtPct / 100);
    } else {
      tgtAmt = cur;
      tgtPct = totalWithCash > 0 ? (cur / totalWithCash) * 100 : 0;
    }
    return { type, cur, curPct, tgtPct, tgtAmt, delta: tgtAmt - cur };
  }).filter((r) => r.tgtPct > 0 || r.cur > 0);
}
