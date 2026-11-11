import { getInv, getInvINR, getInvINRHist, getLiveUsdInr, getVal, getValINR, getXIRR, isUSDHolding } from '../utils.js';
import { useMemo } from 'react';

// Derived portfolio values (member/type-scoped holdings, INR/native caches, totals, NRI split,
// allocation by type, per-member summary, triggered alerts). Extracted from App.jsx; pure memoised maths.
export function usePortfolioDerived({ selMember, filterType, holdings, members, alerts }) {
  // ── Computed / memoized values ────────────────────────────────

  const allHoldings = holdings;
  const allMembers  = members;

  // Member-scoped only — drives Overview, Goals, Calendar, Health Score, etc.
  // Not affected by the Holdings type filter.
  const memberH = useMemo(() =>
    selMember === 'all' ? allHoldings : allHoldings.filter(h => h.member_id === selMember),
    [allHoldings, selMember]
  );

  // Type-filtered on top of memberH — used exclusively by HoldingsTab grid.
  const visH = useMemo(() => {
    if (filterType === 'ALL') return memberH;
    return memberH.filter(h => h.type === filterType);
  }, [memberH, filterType]);

  const valINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getValINR(h));
    return m;
  }, [allHoldings]);

  const invINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInvINR(h));
    return m;
  }, [allHoldings]);

  const valNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getVal(h));
    return m;
  }, [allHoldings]);

  const invNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInv(h));
    return m;
  }, [allHoldings]);

  const xirrCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getXIRR(h));
    return m;
  }, [allHoldings]);

  const allCur = useMemo(
    () => allHoldings.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0),
    [allHoldings, valINRCache]
  );
  // allInv excludes holdings with unknown cost basis (null) — prevents gain % distortion
  const allInv = useMemo(
    () => allHoldings.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null ? s : s+v; }, 0),
    [allHoldings, invINRCache]
  );

  // totCur/totInv are member-scoped but NOT type-filtered — Overview always shows the full member picture.
  const totCur  = useMemo(() => memberH.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0), [memberH, valINRCache]);
  const totInv  = useMemo(() => memberH.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null ? s : s+v; }, 0), [memberH, invINRCache]);
  const totGain = totCur - totInv;
  const totPct  = totInv > 0 ? ((totCur - totInv) / totInv) * 100 : 0;

  // ── NRI split: Indian (₹ native) vs US ($ native) ────────────────
  const nriMetrics = useMemo(() => {
    const liveRate = getLiveUsdInr();
    let india_cur = 0, india_inv = 0;
    let us_cur = 0,    us_inv = 0;
    let us_inv_hist_inr = 0; // US invested at purchase-time rate (for FX impact)
    for (const h of memberH) {
      const natVal = valNativeCache.get(h.id) || 0;
      const natInv = invNativeCache.get(h.id); // may be null
      if (isUSDHolding(h)) {
        us_cur += natVal;
        if (natInv != null) us_inv += natInv;
        const hist = getInvINRHist(h);
        if (hist != null) us_inv_hist_inr += hist;
      } else {
        india_cur += natVal;
        if (natInv != null) india_inv += natInv;
      }
    }
    const india_gain = india_cur - india_inv;
    const india_pct  = india_inv > 0 ? (india_gain / india_inv) * 100 : 0;
    const us_gain    = us_cur - us_inv;
    const us_pct     = us_inv > 0 ? (us_gain / us_inv) * 100 : 0;
    // Combined in ₹ (US converted at live rate — pure price gain, no FX noise)
    const combined_cur  = india_cur + us_cur * liveRate;
    const combined_inv  = india_inv + us_inv * liveRate;
    const combined_gain = combined_cur - combined_inv;
    const combined_pct  = combined_inv > 0 ? (combined_gain / combined_inv) * 100 : 0;
    // FX impact = what exchange-rate movement added/removed on US invested amount
    const fx_gain = us_inv * liveRate - us_inv_hist_inr;
    return {
      india_cur, india_inv, india_gain, india_pct,
      us_cur,    us_inv,    us_gain,    us_pct,
      combined_cur, combined_inv, combined_gain, combined_pct,
      fx_gain, liveRate,
    };
  }, [memberH, valNativeCache, invNativeCache]);

  const byType = useMemo(() => {
    const map = {};
    for (const h of memberH) {
      if (!map[h.type]) map[h.type] = { cur: 0, inv: 0, count: 0 };
      map[h.type].cur   += valINRCache.get(h.id) || 0;
      map[h.type].inv   += invINRCache.get(h.id) || 0;
      map[h.type].count += 1;
    }
    const total = Object.values(map).reduce((s, v) => s + v.cur, 0);
    return Object.entries(map)
      .map(([t, v]) => ({ t, v: v.cur, i: v.inv, count: v.count, pct: total > 0 ? (v.cur / total) * 100 : 0 }))
      .sort((a, b) => b.v - a.v);
  }, [memberH, valINRCache, invINRCache]);

  const mSum = useMemo(() =>
    allMembers.map(m => {
      const mh  = allHoldings.filter(h => h.member_id === m.id);
      const cur = mh.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
      const inv = mh.reduce((s, h) => s + (invINRCache.get(h.id) || 0), 0);
      const pct = inv > 0 ? ((cur - inv) / inv) * 100 : 0;
      return { ...m, cur, inv, gain: cur - inv, pct };
    }),
    [allMembers, allHoldings, valINRCache, invINRCache]
  );

  const trigAlerts = useMemo(() => {
    const triggered = [];
    // Derive current USD/INR rate from any USD holding
    const usdInrRate = allHoldings.find(h => (h.usd_inr_rate || 0) > 0)?.usd_inr_rate || 0;
    for (const a of alerts) {
      if (!a.active) continue;
      if (a.type === 'RETURN_TARGET') {
        if (totPct < a.threshold) triggered.push(a);
      } else if (a.type === 'USD_INR_RATE') {
        if (usdInrRate > 0 && usdInrRate > +a.threshold) triggered.push(a);
      } else if (a.type === 'HOLDING_PRICE' || a.type === 'HOLDING_RETURN') {
        const h = allHoldings.find(hh => hh.id === a.holdingId);
        if (!h) continue;
        if (a.type === 'HOLDING_PRICE') {
          const price = Number(h.current_price || h.current_nav || 0);
          if (a.direction === 'above' && price > +a.threshold) triggered.push(a);
          if (a.direction === 'below' && price > 0 && price < +a.threshold) triggered.push(a);
        } else {
          const cur = valINRCache.get(h.id) || 0;
          const inv = invINRCache.get(h.id) || 0;
          if (inv <= 0) continue;
          const ret = ((cur - inv) / inv) * 100;
          if (a.direction === 'above' && ret > +a.threshold) triggered.push(a);
          if (a.direction === 'below' && ret < +a.threshold) triggered.push(a);
        }
      } else {
        const typeVal = allHoldings
          .filter(h => h.type === a.assetType)
          .reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
        const pct = allCur > 0 ? (typeVal / allCur) * 100 : 0;
        if (a.type === 'ALLOCATION_DRIFT' && pct > a.threshold) triggered.push(a);
        if (a.type === 'CONCENTRATION'    && pct < a.threshold) triggered.push(a);
      }
    }
    return triggered;
  }, [alerts, allHoldings, allCur, totPct, valINRCache, invINRCache]);

  return { allHoldings, allMembers, visH, valINRCache, invINRCache, valNativeCache, invNativeCache, xirrCache, allCur, allInv, totCur, totInv, totGain, totPct, nriMetrics, byType, mSum, trigAlerts };
}
