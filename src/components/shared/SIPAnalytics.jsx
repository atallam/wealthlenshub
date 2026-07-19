/**
 * SIPAnalytics.jsx — SIP (Systematic Investment Plan) analytics panel.
 *
 * Uses sip_active / sip_day / sip_avg_amount fields already computed
 * server-side in services/holdings.service.js → computeSipFields().
 *
 * Shows:
 *   • Total monthly SIP commitment
 *   • Per-fund breakdown: amount, SIP date, invested vs current, XIRR
 *   • Portfolio-level SIP return vs total invested
 *   • Visual bar showing relative SIP size per fund
 *
 * Props: allHoldings, valINRCache, invINRCache, fmtCr, fmtPct
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function MonthBar({ pct, color }) {
  return (
    <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: '.2rem' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .5s ease' }} />
    </div>
  );
}

export default function SIPAnalytics({ allHoldings = [], valINRCache, invINRCache, fmtCr, fmtPct }) {
  const [open, setOpen] = useState(true);

  // Active SIPs only
  const sipHoldings = allHoldings
    .filter(h => h.sip_active && h.sip_avg_amount > 0)
    .sort((a, b) => (b.sip_avg_amount || 0) - (a.sip_avg_amount || 0));

  if (!sipHoldings.length) return null;

  const totalMonthly = sipHoldings.reduce((s, h) => s + (h.sip_avg_amount || 0), 0);

  // Portfolio-level SIP totals using cache
  const totalInvested = sipHoldings.reduce((s, h) => {
    const inv = invINRCache?.get ? invINRCache.get(h.id) : (invINRCache?.[h.id] ?? +h.invested_value ?? 0);
    return s + (inv || 0);
  }, 0);
  const totalCurrent = sipHoldings.reduce((s, h) => {
    const cur = valINRCache?.get ? valINRCache.get(h.id) : (valINRCache?.[h.id] ?? +h.current_value ?? 0);
    return s + (cur || 0);
  }, 0);
  const totalGain    = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const maxSip = sipHoldings[0]?.sip_avg_amount || 1;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? '.85rem' : 0, cursor: 'pointer' }}
        onClick={() => setOpen(p => !p)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <TrendingUp size={14} strokeWidth={1.8} style={{ color: '#4caf9a' }} />
          <span className="ctitle" style={{ margin: 0 }}>SIP Overview</span>
          <span style={{ fontSize: '.65rem', background: 'rgba(76,175,154,.12)', color: '#4caf9a', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
            {sipHoldings.length} active
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.82rem', fontWeight: 700, color: '#4caf9a' }}>
              {fmtCr(totalMonthly)}<span style={{ fontSize: '.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span>
            </div>
          </div>
          <span style={{ color: 'var(--text-muted)' }}>
            {open ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </span>
        </div>
      </div>

      {open && (
        <>
          {/* Summary row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', marginBottom: '.85rem' }}>
            {[
              { label: 'Monthly Commitment', value: fmtCr(totalMonthly), color: '#c9a84c' },
              { label: 'Total Invested',     value: fmtCr(totalInvested), color: 'var(--text)' },
              { label: 'Current Value',      value: fmtCr(totalCurrent), color: totalGain >= 0 ? '#4caf9a' : '#e07c5a' },
            ].map(m => (
              <div key={m.label} style={{ padding: '.45rem .6rem', background: 'var(--bg-muted)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.2rem' }}>{m.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.78rem', fontWeight: 700, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Overall SIP return */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.85rem', padding: '.45rem .7rem', borderRadius: 8, background: totalGain >= 0 ? 'rgba(76,175,154,.06)' : 'rgba(224,124,90,.06)', border: `1px solid ${totalGain >= 0 ? 'rgba(76,175,154,.15)' : 'rgba(224,124,90,.15)'}` }}>
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>SIP portfolio gain</span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '.78rem', fontWeight: 700, color: totalGain >= 0 ? '#4caf9a' : '#e07c5a', marginLeft: 'auto' }}>
              {totalGain >= 0 ? '+' : ''}{fmtCr(totalGain)} ({totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(1)}%)
            </span>
          </div>

          {/* Per-fund table */}
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: '.4rem' }}>
            Active SIPs
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {sipHoldings.map(h => {
              const cur = valINRCache?.get ? valINRCache.get(h.id) : (valINRCache?.[h.id] ?? +h.current_value ?? 0);
              const inv = invINRCache?.get ? invINRCache.get(h.id) : (invINRCache?.[h.id] ?? +h.invested_value ?? 0);
              const gain    = cur - inv;
              const gainPct = inv > 0 ? (gain / inv) * 100 : 0;
              const barPct  = maxSip > 0 ? ((h.sip_avg_amount || 0) / maxSip) * 100 : 0;
              const xirr    = h.xirr != null ? Number(h.xirr) : null;

              return (
                <div key={h.id} style={{ padding: '.5rem .65rem', background: 'var(--bg-muted)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.5rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.75rem', color: 'var(--text)', fontWeight: 500, lineHeight: 1.3, marginBottom: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.name}
                      </div>
                      <div style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>
                        {h.sip_day ? `${ordinal(h.sip_day)} of month` : 'Monthly'}
                        {h.member_name ? ` · ${h.member_name}` : ''}
                      </div>
                      <MonthBar pct={barPct} color="#4caf9a" />
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.78rem', fontWeight: 700, color: '#c9a84c' }}>
                        {fmtCr(h.sip_avg_amount)}<span style={{ fontSize: '.6rem', color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span>
                      </div>
                      <div style={{ fontSize: '.65rem', color: gainPct >= 0 ? '#4caf9a' : '#e07c5a', marginTop: '.1rem' }}>
                        {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
                        {xirr !== null && <span style={{ color: 'var(--text-muted)', marginLeft: '.3rem' }}>· {xirr.toFixed(1)}% XIRR</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tip */}
          <div style={{ marginTop: '.75rem', fontSize: '.67rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            💡 SIPs detected from ≥3 monthly BUY transactions within 6 months. Amounts are averages of last 3 instalments.
          </div>
        </>
      )}
    </div>
  );
}
