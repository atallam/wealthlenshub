// ── Tiny format helpers ───────────────────────────────────────────
export const GOLD = '#c9a84c', GREEN = '#4caf9a', RED = '#e07c5a', BLUE = '#5a8ee0', PURPLE = '#9b7ae0';
export const PALETTE = [GOLD, GREEN, RED, BLUE, PURPLE, '#e0a85a', '#5ac0e0', '#e05a8a', '#7ae05a', '#5ae0c0'];

export function fmtAmt(n = 0, compact = false) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
    if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
    if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
    return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  }
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

function pct(v, total) { return total > 0 ? Math.min((v / total) * 100, 100) : 0; }

export function moLabel(mo) {
  return mo ? new Date(mo + '-02').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '';
}

// ── KPI Card ─────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, color = GOLD, icon }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.2rem', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.3rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
        {icon && <span>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '1.35rem', fontFamily: "'DM Mono',monospace", fontWeight: 700, color, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>{sub}</div>}
    </div>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────
export function Bar({ value, max, color = GOLD, h = 6 }) {
  const p = pct(value, max);
  const over = value > max && max > 0;
  return (
    <div style={{ height: h, background: 'var(--bg-muted)', borderRadius: h, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${p}%`, background: over ? RED : color, borderRadius: h, transition: 'width .4s' }} />
    </div>
  );
}

// ── Trend Badge ──────────────────────────────────────────────────
export function TrendBadge({ current, previous }) {
  if (!previous || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  const up = delta > 0;
  const color = up ? RED : GREEN;
  return (
    <span style={{ fontSize: '.65rem', color, background: color + '18', borderRadius: 4, padding: '1px 5px', marginLeft: 6, fontFamily: "'DM Mono',monospace" }}>
      {up ? '↑' : '↓'}{Math.abs(delta).toFixed(0)}%
    </span>
  );
}

// ── Section Card ─────────────────────────────────────────────────
export function SectionCard({ title, children, action, badge }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.85rem 1.1rem .5rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
          {badge && <span style={{ background: GOLD + '25', color: GOLD, fontSize: '.6rem', borderRadius: 4, padding: '1px 5px' }}>{badge}</span>}
        </div>
        {action}
      </div>
      <div style={{ padding: '.9rem 1.1rem' }}>{children}</div>
    </div>
  );
}
