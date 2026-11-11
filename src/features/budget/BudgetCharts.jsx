import { GOLD, GREEN, PALETTE, RED, fmtAmt, moLabel } from './budgetShared.jsx';

// ── Spending Donut ────────────────────────────────────────────────
export function SpendingDonut({ byCategory, categories, total }) {
  const catData = Object.entries(byCategory || {})
    .filter(([, v]) => v > 0)
    .map(([name, value], i) => {
      const cat = categories.find(c => c.name === name);
      return { name, value, color: cat?.color || PALETTE[i % PALETTE.length], icon: cat?.icon || '📦' };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  if (!catData.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '2rem', textAlign: 'center' }}>No spending data yet</div>;
  let angle = -90;
  return (
    <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 180 180" style={{ width: 150, height: 150, flexShrink: 0 }}>
        {catData.map((d, i) => {
          const sweep = (d.value / total) * 360;
          if (sweep < 1) { angle += sweep; return null; }
          const r = 72, ir = 44, cx = 90, cy = 90;
          const pt = (a, rad) => ({ x: cx + rad * Math.cos(a * Math.PI / 180), y: cy + rad * Math.sin(a * Math.PI / 180) });
          const sa = angle, ea = angle + sweep; angle += sweep;
          const s = pt(sa, r), e = pt(ea, r), si = pt(sa, ir), ei = pt(ea, ir);
          const lg = sweep > 180 ? 1 : 0;
          const path = `M${s.x},${s.y}A${r},${r},0,${lg},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir},${ir},0,${lg},0,${si.x},${si.y}Z`;
          return <path key={i} d={path} fill={d.color} opacity=".9" />;
        })}
        <text x="90" y="87" textAnchor="middle" fill="var(--text)" fontSize="11" fontFamily="'DM Mono',monospace" fontWeight="bold">{fmtAmt(total, true)}</text>
        <text x="90" y="101" textAnchor="middle" fill="var(--text-muted)" fontSize="8">spent</text>
      </svg>
      <div style={{ flex: 1, minWidth: 120, maxHeight: 150, overflowY: 'auto' }}>
        {catData.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem', fontSize: '.72rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>{d.icon} {d.name}</span>
            <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)', fontSize: '.65rem' }}>{((d.value / total) * 100).toFixed(1)}%</span>
            <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text)', fontSize: '.65rem' }}>{fmtAmt(d.value, true)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cashflow Chart ────────────────────────────────────────────────
export function CashflowChart({ cashflow }) {
  const months = Object.keys(cashflow || {}).sort().slice(-12);
  if (!months.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>No data</div>;
  const maxVal = Math.max(...months.flatMap(m => [cashflow[m].debit, cashflow[m].credit]), 1);
  return (
    <div className="chart-scroll-outer" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '.25rem', height: 130, minWidth: months.length * 48, padding: '.5rem 0' }}>
        {months.map(mo => {
          const { debit = 0, credit = 0 } = cashflow[mo];
          return (
            <div key={mo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100, width: '100%' }}>
                <div title={`Spend: ${fmtAmt(debit)}`} style={{ flex: 1, background: 'rgba(224,124,90,.8)', borderRadius: '3px 3px 0 0', height: `${(debit / maxVal) * 100}%`, minHeight: debit > 0 ? 2 : 0, transition: 'height .4s' }} />
                <div title={`Income: ${fmtAmt(credit)}`} style={{ flex: 1, background: 'rgba(76,175,154,.8)', borderRadius: '3px 3px 0 0', height: `${(credit / maxVal) * 100}%`, minHeight: credit > 0 ? 2 : 0, transition: 'height .4s' }} />
              </div>
              <div style={{ fontSize: '.58rem', color: 'var(--text-muted)', textAlign: 'center' }}>{moLabel(mo)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '.3rem' }}>
        {[['rgba(224,124,90,.8)', 'Expenses'], ['rgba(76,175,154,.8)', 'Income']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Budget Health Ring ────────────────────────────────────────────
export function HealthRing({ categories, byCategory }) {
  const budgeted = categories.filter(c => c.monthly_limit > 0);
  if (!budgeted.length) return null;
  const onBudget = budgeted.filter(c => (byCategory[c.name] || 0) <= c.monthly_limit).length;
  const score = Math.round((onBudget / budgeted.length) * 100);
  const color = score >= 80 ? GREEN : score >= 50 ? GOLD : RED;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-muted)" strokeWidth={9} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: 'stroke-dasharray .6s' }} />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize={16} fontFamily="'DM Mono',monospace" fontWeight="bold">{score}%</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fill="var(--text-muted)" fontSize={8}>on budget</text>
      </svg>
      <div style={{ fontSize: '.72rem', color: 'var(--text-dim)', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.2rem' }}>{onBudget}/{budgeted.length} categories on track</div>
        {budgeted.filter(c => (byCategory[c.name] || 0) > c.monthly_limit).map(c => (
          <div key={c.name} style={{ color: RED }}>{c.icon} {c.name} — over by {fmtAmt((byCategory[c.name] || 0) - c.monthly_limit, true)}</div>
        ))}
      </div>
    </div>
  );
}
