import { useState } from 'react';
import { Bar, GOLD, GREEN, PALETTE, RED, TrendBadge, fmtAmt } from './budgetShared.jsx';

// ── Budget vs Actual Table ────────────────────────────────────────
export function BudgetVsActual({ categories, byCategory, prevByCategory = {} }) {
  const rows = categories.filter(c => c.monthly_limit > 0 || byCategory[c.name] > 0).map(c => ({
    ...c, actual: byCategory[c.name] || 0, prev: prevByCategory[c.name] || 0,
  })).sort((a, b) => b.actual - a.actual);
  if (!rows.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>Set category limits to see Budget vs Actual</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', fontSize: '.68rem', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '.4rem .6rem', fontWeight: 500 }}>Category</th>
            <th style={{ textAlign: 'right', padding: '.4rem .6rem', fontWeight: 500 }}>Budget</th>
            <th style={{ textAlign: 'right', padding: '.4rem .6rem', fontWeight: 500 }}>Spent</th>
            <th style={{ textAlign: 'right', padding: '.4rem .6rem', fontWeight: 500 }}>Left</th>
            <th style={{ textAlign: 'left', padding: '.4rem .6rem', fontWeight: 500, minWidth: 80 }}>Used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const over = r.monthly_limit > 0 && r.actual > r.monthly_limit;
            const left = r.monthly_limit > 0 ? r.monthly_limit - r.actual : null;
            return (
              <tr key={r.id || r.name} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '.5rem .6rem', color: 'var(--text)' }}>{r.icon} {r.name}</td>
                <td style={{ padding: '.5rem .6rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)', fontSize: '.72rem' }}>
                  {r.monthly_limit > 0 ? fmtAmt(r.monthly_limit, true) : '—'}
                </td>
                <td style={{ padding: '.5rem .6rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: over ? RED : 'var(--text)' }}>
                  {fmtAmt(r.actual, true)}
                  <TrendBadge current={r.actual} previous={r.prev} />
                </td>
                <td style={{ padding: '.5rem .6rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: over ? RED : (left > 0 ? GREEN : 'var(--text-muted)'), fontSize: '.72rem' }}>
                  {left !== null ? (over ? `-${fmtAmt(-left, true)}` : fmtAmt(left, true)) : '—'}
                </td>
                <td style={{ padding: '.5rem .6rem' }}>
                  {r.monthly_limit > 0 ? <Bar value={r.actual} max={r.monthly_limit} color={over ? RED : GOLD} h={6} /> : <div style={{ color: 'var(--text-muted)', fontSize: '.65rem' }}>No limit</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Merchant Rollup ───────────────────────────────────────────────
export function MerchantRollup({ merchants, loading }) {
  const [show, setShow] = useState(10);
  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem' }}>Loading merchants…</div>;
  if (!merchants.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>No merchant data for this period</div>;
  const top = merchants.slice(0, show);
  const maxAmt = top[0]?.total || 1;
  return (
    <div>
      {top.map((m, i) => (
        <div key={m.merchant} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.5rem' }}>
          <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', width: 18, textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem' }}>
              <span style={{ fontSize: '.75rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{m.merchant}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>×{m.count}</span>
                <span style={{ fontSize: '.75rem', fontFamily: "'DM Mono',monospace", color: GOLD }}>{fmtAmt(m.total, true)}</span>
              </div>
            </div>
            <Bar value={m.total} max={maxAmt} color={PALETTE[i % PALETTE.length]} h={4} />
          </div>
        </div>
      ))}
      {merchants.length > show && (
        <button onClick={() => setShow(s => s + 10)} style={{ fontSize: '.7rem', color: GOLD, background: 'none', border: 'none', cursor: 'pointer', padding: '.3rem 0' }}>
          + Show {Math.min(10, merchants.length - show)} more
        </button>
      )}
    </div>
  );
}

// ── Recurring Panel ───────────────────────────────────────────────
export function RecurringPanel({ recurring, loading }) {
  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem' }}>Detecting recurring…</div>;
  if (!recurring.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>No recurring transactions detected</div>;
  const total = recurring.reduce((s, r) => s + r.typicalAmount, 0);
  return (
    <div>
      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.6rem' }}>
        {recurring.length} recurring · est. {fmtAmt(total, true)}/month
      </div>
      {recurring.map(r => (
        <div key={r.merchant} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.45rem 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '1rem' }}>{r.isSubscription ? '🔄' : '📅'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '.75rem', color: 'var(--text)', fontWeight: 500 }}>{r.merchant}</div>
            <div style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{r.category} · {r.monthCount} months</div>
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", color: GOLD, fontSize: '.78rem' }}>{fmtAmt(r.typicalAmount, true)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Member Comparison ─────────────────────────────────────────────
export function MemberComparison({ breakdown }) {
  if (!breakdown?.length) return null;
  const maxSpend = Math.max(...breakdown.map(m => m.debit), 1);
  return (
    <div>
      {breakdown.map(m => (
        <div key={m.id} style={{ marginBottom: '.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.25rem' }}>
            <span style={{ fontSize: '.75rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: GOLD + '30', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '.6rem' }}>{(m.avatar || m.name?.charAt(0) || '?')}</span>
              {m.name}
            </span>
            <span style={{ fontFamily: "'DM Mono',monospace", color: GOLD, fontSize: '.75rem' }}>{fmtAmt(m.debit, true)}</span>
          </div>
          <Bar value={m.debit} max={maxSpend} color={GOLD} h={6} />
        </div>
      ))}
    </div>
  );
}

// ── Burn Rate Banner ─────────────────────────────────────────────
export function BurnRateBanner({ totalDebit, qFrom, qTo }) {
  if (!qFrom) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (today < qFrom || today > qTo) return null; // only for current period
  const startDate = new Date(qFrom), endDate = new Date(qTo), nowDate = new Date();
  const daysIn = Math.max(1, Math.round((nowDate - startDate) / 86400000));
  const daysTotal = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  const daysLeft = Math.max(0, daysTotal - daysIn);
  const dailyRate = totalDebit / daysIn;
  const projected = Math.round(dailyRate * daysTotal);
  return (
    <div style={{ background: RED + '12', border: `1px solid ${RED}30`, borderRadius: 10, padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '1.2rem' }}>🔥</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '.78rem', color: 'var(--text)', fontWeight: 600 }}>Daily burn rate: {fmtAmt(dailyRate, true)}/day</div>
        <div style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>
          {daysIn} days in · {daysLeft} days left · Projected month total: <span style={{ color: GOLD, fontFamily: "'DM Mono',monospace" }}>{fmtAmt(projected, true)}</span>
        </div>
      </div>
    </div>
  );
}
