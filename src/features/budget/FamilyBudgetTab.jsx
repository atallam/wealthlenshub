// FamilyBudgetTab.jsx — Unified Family Budget tracker (Phases 1-5)
// Features:
//   Phase 1 — Unified tab with 5 sub-views + person selector
//   Phase 2 — Per-member analytics, member comparison panel
//   Phase 3 — 3-step import wizard with preview before save
//   Phase 4 — Merchant rollup, recurring detection, burn rate, trend badges, Budget vs Actual
//   Phase 5 — AI Spending Coach, Wants/Needs tagging

import { useEffect, useRef, useState } from 'react';
import { useFamilyBudget } from '../../hooks/useFamilyBudget.js';
import { useToast } from '../../components/shared/Toast.jsx';

// ── Tiny format helpers ───────────────────────────────────────────
const GOLD = '#c9a84c', GREEN = '#4caf9a', RED = '#e07c5a', BLUE = '#5a8ee0', PURPLE = '#9b7ae0';
const PALETTE = [GOLD, GREEN, RED, BLUE, PURPLE, '#e0a85a', '#5ac0e0', '#e05a8a', '#7ae05a', '#5ae0c0'];

function fmtAmt(n = 0, compact = false) {
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

function moLabel(mo) {
  return mo ? new Date(mo + '-02').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '';
}

// ── KPI Card ─────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = GOLD, icon }) {
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
function Bar({ value, max, color = GOLD, h = 6 }) {
  const p = pct(value, max);
  const over = value > max && max > 0;
  return (
    <div style={{ height: h, background: 'var(--bg-muted)', borderRadius: h, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${p}%`, background: over ? RED : color, borderRadius: h, transition: 'width .4s' }} />
    </div>
  );
}

// ── Trend Badge ──────────────────────────────────────────────────
function TrendBadge({ current, previous }) {
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

// ── Spending Donut ────────────────────────────────────────────────
function SpendingDonut({ byCategory, categories, total }) {
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
function CashflowChart({ cashflow }) {
  const months = Object.keys(cashflow || {}).sort().slice(-12);
  if (!months.length) return <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>No data</div>;
  const maxVal = Math.max(...months.flatMap(m => [cashflow[m].debit, cashflow[m].credit]), 1);
  return (
    <div style={{ overflowX: 'auto' }}>
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
function HealthRing({ categories, byCategory }) {
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

// ── Budget vs Actual Table ────────────────────────────────────────
function BudgetVsActual({ categories, byCategory, prevByCategory = {} }) {
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
function MerchantRollup({ merchants, loading }) {
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
function RecurringPanel({ recurring, loading }) {
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
function MemberComparison({ breakdown }) {
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
function BurnRateBanner({ totalDebit, qFrom, qTo }) {
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

// ── Section Card ─────────────────────────────────────────────────
function SectionCard({ title, children, action, badge }) {
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

// ── Import Wizard ─────────────────────────────────────────────────
function ImportWizard({ fb, members }) {
  const { fbImportStep: step, setFbImportStep: setStep, fbUploadForm: form, setFbUploadForm: setForm,
    fbUploadFile: file, setFbUploadFile: setFile, fbUploading: uploading, fbUploadMsg: msg,
    fbUploadKind: kind, fbPdfPwNeeded: pdfPwNeeded, fbPdfPw: pdfPw, setFbPdfPw, fbPwAttempt,
    fbBanks: banks, loadBanks, uploadStatement, previewImport, fbStatements: statements, loadStatements } = fb;
  const dropRef = useRef(null);

  useEffect(() => { if (banks.length === 0) loadBanks(); if (statements.length === 0) loadStatements(); }, []);

  const regions = [...new Set(banks.map(b => b.region))].filter(Boolean).sort();
  const banksForRegion = form.region ? banks.filter(b => b.region === form.region) : [];

  function handleDrop(e) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }
  function handleDragOver(e) { e.preventDefault(); }

  const msgStyle = {
    '': { background: 'var(--bg-muted)', color: 'var(--text-muted)' },
    info: { background: BLUE + '18', color: BLUE },
    success: { background: GREEN + '18', color: GREEN },
    error: { background: RED + '18', color: RED },
    debug: { background: PURPLE + '18', color: PURPLE },
  }[kind] || {};

  const canUpload = form.member_id && form.region && form.bank_key && file;

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Step breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '1.5rem' }}>
        {['👤 Person', '🏦 Bank', '📤 Upload'].map((label, i) => {
          const n = i + 1, active = step === n, done = step > n;
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => done && setStep(n)} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.35rem .7rem', borderRadius: 20, border: `1.5px solid ${active ? GOLD : done ? GREEN : 'var(--border)'}`, background: active ? GOLD + '20' : 'transparent', color: active ? GOLD : done ? GREEN : 'var(--text-muted)', fontSize: '.72rem', fontWeight: active ? 700 : 400, cursor: done ? 'pointer' : 'default' }}>
                {done ? '✓' : n} {label}
              </button>
              {i < 2 && <div style={{ width: 24, height: 1, background: done ? GREEN : 'var(--border)' }} />}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Person */}
      {step === 1 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Who does this statement belong to?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {members.map(m => (
              <button key={m.id} onClick={() => { setForm(p => ({ ...p, member_id: m.id })); setStep(2); }}
                style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.75rem 1rem', borderRadius: 10, border: `1.5px solid ${form.member_id === m.id ? GOLD : 'var(--border)'}`, background: form.member_id === m.id ? GOLD + '15' : 'var(--bg-card)', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: GOLD + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>{m.avatar || m.name?.charAt(0)}</span>
                <span style={{ fontSize: '.85rem', fontWeight: 500 }}>{m.name}</span>
                {form.member_id === m.id && <span style={{ marginLeft: 'auto', color: GOLD }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — Bank */}
      {step === 2 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Select bank / card</div>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
            <select className="fi fs" value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value, bank_key: '' }))} style={{ flex: 1, minWidth: 140 }}>
              <option value="">— Region —</option>
              <option value="AUTO">Auto-detect</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.region && form.region !== 'AUTO' && (
              <select className="fi fs" value={form.bank_key} onChange={e => setForm(p => ({ ...p, bank_key: e.target.value }))} style={{ flex: 1, minWidth: 160 }}>
                <option value="">— Bank —</option>
                {banksForRegion.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            )}
            {form.region === 'AUTO' && !form.bank_key && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Bank will be auto-detected from the file</div>}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
            {['BANK', 'CREDIT_CARD'].map(t => (
              <button key={t} onClick={() => setForm(p => ({ ...p, statement_type: t }))}
                style={{ padding: '.35rem .8rem', borderRadius: 6, border: `1.5px solid ${form.statement_type === t ? GOLD : 'var(--border)'}`, background: form.statement_type === t ? GOLD + '20' : 'transparent', color: form.statement_type === t ? GOLD : 'var(--text-muted)', fontSize: '.72rem', cursor: 'pointer' }}>
                {t === 'BANK' ? '🏦 Bank Account' : '💳 Credit Card'}
              </button>
            ))}
          </div>
          <input className="fi fs" placeholder="Custom label (optional, e.g. 'Axis Salary Account')" value={form.custom_label} onChange={e => setForm(p => ({ ...p, custom_label: e.target.value }))} style={{ width: '100%', marginBottom: '.5rem' }} />
          <button onClick={() => setStep(3)} disabled={!form.region} style={{ padding: '.5rem 1.2rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: form.region ? 'pointer' : 'not-allowed', opacity: form.region ? 1 : .5, fontSize: '.82rem' }}>
            Next →
          </button>
        </div>
      )}

      {/* Step 3 — Upload */}
      {step === 3 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Upload statement file</div>

          {/* Drag-drop zone */}
          <div ref={dropRef} onDrop={handleDrop} onDragOver={handleDragOver}
            onClick={() => document.getElementById('fb-file-input').click()}
            style={{ border: `2px dashed ${file ? GREEN : 'var(--border)'}`, borderRadius: 12, padding: '2rem', textAlign: 'center', cursor: 'pointer', background: file ? GREEN + '08' : 'var(--bg-muted)', marginBottom: '.75rem', transition: 'all .2s' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.4rem' }}>{file ? '✅' : '📂'}</div>
            <div style={{ fontSize: '.8rem', color: file ? GREEN : 'var(--text-muted)' }}>
              {file ? file.name : 'Drop file here or click to browse'}
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>CSV · XLSX · PDF · up to 20 MB</div>
          </div>
          <input id="fb-file-input" type="file" accept=".csv,.xlsx,.xls,.pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />

          {/* PDF password */}
          {pdfPwNeeded && (
            <div style={{ marginBottom: '.75rem' }}>
              <input key={fbPwAttempt} type="password" className="fi fs" autoFocus placeholder="PDF password" value={pdfPw} onChange={e => setFbPdfPw(e.target.value)} style={{ width: '100%' }} />
            </div>
          )}

          {/* Status message */}
          {msg && (
            <div style={{ ...msgStyle, borderRadius: 8, padding: '.6rem .9rem', fontSize: '.75rem', marginBottom: '.75rem', whiteSpace: 'pre-wrap', fontFamily: kind === 'debug' ? "'DM Mono',monospace" : 'inherit' }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => previewImport(file, form, pdfPw)} disabled={!file || uploading}
              style={{ padding: '.45rem 1rem', border: `1px solid ${BLUE}`, borderRadius: 8, background: 'transparent', color: BLUE, fontSize: '.78rem', cursor: 'pointer', opacity: file ? 1 : .5 }}>
              🔍 Preview
            </button>
            <button onClick={() => uploadStatement(file, form, pdfPw)} disabled={!canUpload || uploading}
              style={{ padding: '.45rem 1.2rem', background: canUpload && !uploading ? GOLD : 'var(--bg-muted)', color: canUpload ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: canUpload && !uploading ? 'pointer' : 'not-allowed', fontSize: '.82rem' }}>
              {uploading ? '⏳ Importing…' : '📥 Import'}
            </button>
            <button onClick={() => { setStep(1); setFile(null); fb.setFbUploadMsg(''); }}
              style={{ padding: '.45rem .8rem', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', fontSize: '.75rem', cursor: 'pointer' }}>
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Recent imports */}
      {statements.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.6rem', fontSize: '.8rem' }}>Recent imports</div>
          {statements.slice(0, 6).map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '.75rem' }}>
              <span style={{ flex: 1, color: 'var(--text-dim)' }}>{s.source} {s.custom_label ? `· ${s.custom_label}` : ''}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '.68rem' }}>{s.txn_count} txns</span>
              <span style={{ color: s.member_id ? 'var(--text-muted)' : RED, fontSize: '.65rem' }}>
                {s.member_id ? '👤' : '⚠️ unassigned'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Transaction List ──────────────────────────────────────────────
function TransactionList({ fb }) {
  const { fbTxns: txns, fbTxnsLoading: loading, fbTxnCat: cat, setFbTxnCat, fbTxnSearch: search, setFbTxnSearch,
    fbSelTxnIds: sel, setFbSelTxnIds, fbBulkCat: bulkCat, setFbBulkCat, fbCategories: categories, bulkCategorize, categorizeTxn } = fb;

  function toggleSel(id) { setFbSelTxnIds(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  const allSel = txns.length > 0 && txns.every(t => sel.has(t.id));

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <input className="fi" placeholder="Search transactions…" value={search} onChange={e => setFbTxnSearch(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <select className="fi" value={cat} onChange={e => setFbTxnCat(e.target.value)} style={{ minWidth: 130 }}>
          <option value="All">All categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
        </select>
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.5rem .8rem', background: GOLD + '18', borderRadius: 8, marginBottom: '.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.75rem', color: GOLD }}>{sel.size} selected</span>
          <select className="fi" value={bulkCat} onChange={e => setFbBulkCat(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            <option value="">— Assign category —</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
          <button onClick={() => bulkCategorize(sel, bulkCat)} disabled={!bulkCat} style={{ padding: '.3rem .8rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.75rem', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
          <button onClick={() => setFbSelTxnIds(new Set())} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Clear</button>
        </div>
      )}

      {loading ? <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading…</div> : txns.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>No transactions found</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '.68rem', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '.3rem', width: 24 }}>
                  <input type="checkbox" checked={allSel} onChange={() => allSel ? setFbSelTxnIds(new Set()) : setFbSelTxnIds(new Set(txns.map(t => t.id)))} />
                </th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500 }}>Description</th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500, minWidth: 110 }}>Category</th>
                <th style={{ textAlign: 'right', padding: '.4rem .5rem', fontWeight: 500 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {txns.slice(0, 300).map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: sel.has(t.id) ? GOLD + '0a' : 'transparent' }}>
                  <td style={{ padding: '.3rem' }}><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} /></td>
                  <td style={{ padding: '.4rem .5rem', color: 'var(--text-muted)', fontFamily: "'DM Mono',monospace", fontSize: '.68rem', whiteSpace: 'nowrap' }}>{t.txn_date}</td>
                  <td style={{ padding: '.4rem .5rem', color: 'var(--text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.description}>{t.description}</td>
                  <td style={{ padding: '.4rem .5rem' }}>
                    <select value={t.category || 'Other'} onChange={e => categorizeTxn(t.id, e.target.value)}
                      style={{ fontSize: '.7rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', color: 'var(--text)', width: '100%' }}>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '.4rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: t.txn_type === 'DEBIT' ? RED : GREEN, fontWeight: 500 }}>
                    {t.txn_type === 'CREDIT' ? '+' : '-'}{fmtAmt(t.amount, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {txns.length > 300 && <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', padding: '.5rem', textAlign: 'center' }}>Showing 300 of {txns.length}</div>}
        </div>
      )}
    </div>
  );
}

// ── Categories Manager ────────────────────────────────────────────
function CategoriesManager({ fb }) {
  const { fbCategories: cats, fbEditCat: editing, setFbEditCat, fbNewCat: newCat, setFbNewCat, saveCategory, deleteCategory } = fb;
  const toast = useToast();

  const essential = cats.filter(c => c.is_essential);
  const discretionary = cats.filter(c => !c.is_essential);
  const total = cats.reduce((s, c) => s + (c.monthly_limit || 0), 0);

  return (
    <div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {cats.filter(c => c.monthly_limit > 0).length} categories with limits · Total budget: {fmtAmt(total)}
      </div>

      {/* Add new category inline */}
      <SectionCard title="New Category">
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="fi" placeholder="Name" value={newCat.name} onChange={e => setFbNewCat(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
          <input className="fi" placeholder="Icon 📦" value={newCat.icon} onChange={e => setFbNewCat(p => ({ ...p, icon: e.target.value }))} style={{ width: 60 }} />
          <input type="color" value={newCat.color} onChange={e => setFbNewCat(p => ({ ...p, color: e.target.value }))} style={{ width: 36, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer' }} />
          <input className="fi" type="number" placeholder="Monthly limit ₹" value={newCat.monthly_limit || ''} onChange={e => setFbNewCat(p => ({ ...p, monthly_limit: Number(e.target.value) }))} style={{ width: 130 }} />
          <input className="fi" placeholder="Keywords (comma-sep)" value={newCat.keywords} onChange={e => setFbNewCat(p => ({ ...p, keywords: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={newCat.is_essential || false} onChange={e => setFbNewCat(p => ({ ...p, is_essential: e.target.checked }))} />Essential
          </label>
          <button onClick={() => saveCategory(newCat, true)} disabled={!newCat.name}
            style={{ padding: '.4rem .9rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: newCat.name ? 'pointer' : 'not-allowed', fontSize: '.78rem' }}>
            + Add
          </button>
        </div>
      </SectionCard>

      {/* Essential vs Discretionary */}
      {[{ label: '✅ Essential', items: essential }, { label: '💸 Discretionary', items: discretionary }].map(({ label, items }) => (
        items.length > 0 && (
          <SectionCard key={label} title={label} badge={`${items.length}`}>
            {items.map(c => (
              editing?.id === c.id ? (
                <div key={c.id} style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', padding: '.4rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <input className="fi" value={editing.name} onChange={e => setFbEditCat(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 100 }} />
                  <input className="fi" value={editing.icon} onChange={e => setFbEditCat(p => ({ ...p, icon: e.target.value }))} style={{ width: 54 }} />
                  <input type="color" value={editing.color} onChange={e => setFbEditCat(p => ({ ...p, color: e.target.value }))} style={{ width: 32, height: 30, border: 'none', borderRadius: 5 }} />
                  <input className="fi" type="number" placeholder="Limit ₹" value={editing.monthly_limit || ''} onChange={e => setFbEditCat(p => ({ ...p, monthly_limit: Number(e.target.value) }))} style={{ width: 110 }} />
                  <input className="fi" placeholder="Keywords" value={editing.keywords || ''} onChange={e => setFbEditCat(p => ({ ...p, keywords: e.target.value }))} style={{ flex: 1, minWidth: 150 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.2rem', fontSize: '.72rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.is_essential || false} onChange={e => setFbEditCat(p => ({ ...p, is_essential: e.target.checked }))} />Essential
                  </label>
                  <button onClick={() => saveCategory(editing, false)} style={{ padding: '.3rem .7rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setFbEditCat(null)} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                </div>
              ) : (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color || GOLD, flexShrink: 0 }} />
                  <span style={{ fontSize: '.75rem', color: 'var(--text)', flex: 1 }}>{c.icon} {c.name}</span>
                  {c.monthly_limit > 0 && <span style={{ fontSize: '.7rem', fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)' }}>{fmtAmt(c.monthly_limit, true)}/mo</span>}
                  <button onClick={() => setFbEditCat({ ...c })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem' }}>✏️</button>
                  <button onClick={() => deleteCategory(c, toast.confirm)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: '.75rem' }}>🗑</button>
                </div>
              )
            ))}
          </SectionCard>
        )
      ))}
    </div>
  );
}

// ── Goals Panel ───────────────────────────────────────────────────
function GoalsPanel({ fb }) {
  const { fbGoals: goals, fbEditGoal: editing, setFbEditGoal, fbNewGoal: newGoal, setFbNewGoal, saveGoal, deleteGoal, fbAiQuery: aiQuery, setFbAiQuery, fbAiResponse: aiResponse, fbAiLoading: aiLoading, askAiCoach, fbAnalytics: analytics } = fb;
  const toast = useToast();
  return (
    <div>
      {/* AI Spending Coach (Phase 5) */}
      <SectionCard title="🤖 AI Spending Coach">
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.7rem' }}>
          Ask about your spending, get advice to cut costs or improve savings.
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <input className="fi" placeholder="e.g. Where am I overspending this month?" value={aiQuery} onChange={e => setFbAiQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !aiLoading && askAiCoach(aiQuery, analytics)}
            style={{ flex: 1 }} />
          <button onClick={() => askAiCoach(aiQuery, analytics)} disabled={!aiQuery.trim() || aiLoading}
            style={{ padding: '.4rem 1rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: aiQuery.trim() && !aiLoading ? 'pointer' : 'not-allowed', fontSize: '.8rem' }}>
            {aiLoading ? '⏳' : 'Ask'}
          </button>
        </div>
        {aiResponse && (
          <div style={{ marginTop: '.8rem', background: 'var(--bg-muted)', borderRadius: 8, padding: '.75rem', fontSize: '.78rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {aiResponse}
          </div>
        )}
      </SectionCard>

      {/* Savings Goals */}
      <SectionCard title="🎯 Savings Goals">
        {/* Add new goal */}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '.6rem', background: 'var(--bg-muted)', borderRadius: 8 }}>
          <input className="fi" placeholder="Goal name" value={newGoal.name} onChange={e => setFbNewGoal(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
          <input className="fi" placeholder="Icon" value={newGoal.icon} onChange={e => setFbNewGoal(p => ({ ...p, icon: e.target.value }))} style={{ width: 50 }} />
          <input className="fi" type="number" placeholder="Target ₹" value={newGoal.target} onChange={e => setFbNewGoal(p => ({ ...p, target: e.target.value }))} style={{ width: 110 }} />
          <input className="fi" type="number" placeholder="Saved so far ₹" value={newGoal.saved} onChange={e => setFbNewGoal(p => ({ ...p, saved: e.target.value }))} style={{ width: 130 }} />
          <input className="fi" type="date" value={newGoal.due_date} onChange={e => setFbNewGoal(p => ({ ...p, due_date: e.target.value }))} style={{ width: 130 }} />
          <button onClick={() => saveGoal(newGoal, true)} disabled={!newGoal.name || !newGoal.target}
            style={{ padding: '.4rem .9rem', background: GREEN, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '.78rem' }}>
            + Add Goal
          </button>
        </div>

        {/* Goals list */}
        {goals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', textAlign: 'center', padding: '.8rem' }}>No goals yet — add your first savings goal above</div>
        ) : goals.map(g => {
          const progress = Math.min(100, g.target > 0 ? (g.saved / g.target) * 100 : 0);
          const daysLeft = g.due_date ? Math.max(0, Math.ceil((new Date(g.due_date) - new Date()) / 86400000)) : null;
          return editing?.id === g.id ? (
            <div key={g.id} style={{ padding: '.6rem', border: `1px solid ${GOLD}40`, borderRadius: 10, marginBottom: '.6rem' }}>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <input className="fi" value={editing.name} onChange={e => setFbEditGoal(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
                <input className="fi" type="number" placeholder="Target" value={editing.target} onChange={e => setFbEditGoal(p => ({ ...p, target: e.target.value }))} style={{ width: 110 }} />
                <input className="fi" type="number" placeholder="Saved" value={editing.saved} onChange={e => setFbEditGoal(p => ({ ...p, saved: e.target.value }))} style={{ width: 110 }} />
                <input className="fi" type="date" value={editing.due_date || ''} onChange={e => setFbEditGoal(p => ({ ...p, due_date: e.target.value }))} style={{ width: 130 }} />
                <button onClick={() => saveGoal(editing, false)} style={{ padding: '.3rem .8rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.75rem', cursor: 'pointer' }}>Save</button>
                <button onClick={() => setFbEditGoal(null)} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={g.id} style={{ padding: '.75rem', border: '1px solid var(--border)', borderRadius: 10, marginBottom: '.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{g.icon || '🎯'}</span>
                  <span style={{ fontWeight: 600, fontSize: '.82rem', color: 'var(--text)' }}>{g.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <button onClick={() => setFbEditGoal({ ...g })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem' }}>✏️</button>
                  <button onClick={() => deleteGoal(g, toast.confirm)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: '.75rem' }}>🗑</button>
                </div>
              </div>
              <Bar value={g.saved || 0} max={g.target || 1} color={g.color || GREEN} h={8} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.35rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: "'DM Mono',monospace" }}>{fmtAmt(g.saved || 0, true)} / {fmtAmt(g.target || 0, true)}</span>
                <span style={{ color: progress >= 100 ? GREEN : 'var(--text-muted)' }}>
                  {progress >= 100 ? '✅ Complete!' : `${progress.toFixed(0)}% · ${daysLeft !== null ? `${daysLeft}d left` : 'No deadline'}`}
                </span>
              </div>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────
function OverviewTab({ fb, members, selectedMember }) {
  const { fbAnalytics: anal, fbAnalLoading: loading, fbMerchants: merchants, fbMerchLoading, fbRecurring: recurring, fbRecLoading, fbCategories: categories } = fb;
  if (loading && !anal) return <div style={{ color: 'var(--text-muted)', padding: '3rem', textAlign: 'center' }}>Loading analytics…</div>;
  const byCategory = anal?.byCategory || {};
  const totalDebit = anal?.totalDebit || 0;
  const totalCredit = anal?.totalCredit || 0;
  const savingsRate = anal?.savingsRate || 0;
  const memberBreakdown = anal?.memberBreakdown || [];

  return (
    <div>
      {/* Burn rate banner */}
      {anal && <BurnRateBanner totalDebit={totalDebit} qFrom={anal.qFrom} qTo={anal.qTo} />}
      {anal && <div style={{ marginBottom: '1rem' }} />}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <KpiCard icon="💸" label="Total Spent" value={fmtAmt(totalDebit, true)} color={RED} sub={`${Object.keys(byCategory).length} categories`} />
        <KpiCard icon="💰" label="Total Income" value={fmtAmt(totalCredit, true)} color={GREEN} />
        <KpiCard icon="📈" label="Savings Rate" value={`${savingsRate.toFixed(1)}%`} color={savingsRate > 20 ? GREEN : savingsRate > 0 ? GOLD : RED} sub={savingsRate > 20 ? 'Great!' : savingsRate > 0 ? 'Room to grow' : 'Spending > income'} />
        <KpiCard icon="🔄" label="Recurring" value={fmtAmt(fb.fbRecurring.reduce((s, r) => s + r.typicalAmount, 0), true)} color={PURPLE} sub={`${fb.fbRecurring.length} detected`} />
      </div>

      {/* Health ring + member comparison side by side */}
      {(categories.some(c => c.monthly_limit > 0) || memberBreakdown.length > 0) && (
        <SectionCard title="Budget Health">
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <HealthRing categories={categories} byCategory={byCategory} />
            </div>
            {memberBreakdown.length > 1 && (
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '.6rem' }}>Family Comparison</div>
                <MemberComparison breakdown={memberBreakdown} />
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Spending donut + Budget vs Actual */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <SectionCard title="Spending by Category">
          <SpendingDonut byCategory={byCategory} categories={categories} total={totalDebit} />
        </SectionCard>
        <SectionCard title="Budget vs Actual">
          <BudgetVsActual categories={categories} byCategory={byCategory} />
        </SectionCard>
      </div>

      {/* Cash flow chart */}
      <SectionCard title="12-Month Cash Flow">
        <CashflowChart cashflow={anal?.cashflow || {}} />
      </SectionCard>

      {/* Merchants + Recurring side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
        <SectionCard title="Top Merchants" badge={`${merchants.length}`}>
          <MerchantRollup merchants={merchants} loading={fbMerchLoading} />
        </SectionCard>
        <SectionCard title="Recurring Charges" badge={`${recurring.length}`}>
          <RecurringPanel recurring={recurring} loading={fbRecLoading} />
        </SectionCard>
      </div>
    </div>
  );
}

// ── Main FamilyBudgetTab ──────────────────────────────────────────
export default function FamilyBudgetTab({ user, members = [], Overlay }) {
  const toast = useToast();
  const fb = useFamilyBudget(user);
  const { fbView: view, setFbView, fbMember: memberFilter, setFbMember, fbMonth: month, setFbMonth, fbPeriod: period, setFbPeriod,
    loadAnalytics, loadMerchants, loadRecurring, loadTransactions, loadCategories, loadGoals, loadBanks, loadStatements,
    fbTxnCat, fbTxnSearch } = fb;

  // Initial load on mount
  useEffect(() => {
    loadCategories();
    loadGoals();
    loadBanks();
    loadStatements();
  }, []);

  // Reload analytics + merchants + recurring when person/period/month changes
  useEffect(() => {
    loadAnalytics(period, month, memberFilter);
    loadMerchants(period, month, memberFilter);
    loadRecurring(memberFilter);
  }, [memberFilter, period, month]);

  // Reload transactions when filters change
  useEffect(() => {
    if (view === 'transactions') {
      loadTransactions(period, month, memberFilter, fbTxnCat, fbTxnSearch);
    }
  }, [view, memberFilter, period, month, fbTxnCat, fbTxnSearch]);

  const SUB_TABS = [
    { key: 'overview',      label: '📊 Overview' },
    { key: 'import',        label: '📥 Import' },
    { key: 'transactions',  label: '📋 Transactions' },
    { key: 'categories',    label: '📂 Categories' },
    { key: 'goals',         label: '🎯 Goals' },
  ];

  // Period quick-picks
  const PERIODS = [
    { key: 'month',   label: 'This Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year',    label: 'Year' },
    { key: 'alltime', label: 'All Time' },
  ];

  // Month picker: last 24 months
  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return { val, label };
  });

  return (
    <div style={{ padding: '1rem', maxWidth: 960, margin: '0 auto' }}>
      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          💰 Family Budget
        </div>

        {/* Person selector */}
        <select className="fi" value={memberFilter || ''} onChange={e => setFbMember(e.target.value || null)}
          style={{ minWidth: 130, fontWeight: memberFilter ? 600 : 400, color: memberFilter ? GOLD : 'var(--text)' }}>
          <option value="">👨‍👩‍👧 All Family</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.avatar || '👤'} {m.name}</option>)}
        </select>

        {/* Period selector */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setFbPeriod(p.key)}
              style={{ padding: '.3rem .65rem', border: 'none', background: period === p.key ? GOLD : 'transparent', color: period === p.key ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontSize: '.7rem', fontWeight: period === p.key ? 700 : 400 }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Month picker — only when period=month */}
        {period === 'month' && (
          <select className="fi" value={month} onChange={e => setFbMonth(e.target.value)} style={{ minWidth: 120 }}>
            {monthOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        )}
      </div>

      {/* ── Sub-tab nav ── */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setFbView(t.key)}
            style={{ padding: '.5rem 1rem', border: 'none', borderBottom: `2px solid ${view === t.key ? GOLD : 'transparent'}`, background: 'transparent', color: view === t.key ? GOLD : 'var(--text-muted)', cursor: 'pointer', fontSize: '.78rem', fontWeight: view === t.key ? 700 : 400, whiteSpace: 'nowrap', transition: 'color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sub-tab content ── */}
      {view === 'overview' && <OverviewTab fb={fb} members={members} selectedMember={memberFilter} />}
      {view === 'import' && <ImportWizard fb={fb} members={members} />}
      {view === 'transactions' && (
        <SectionCard title="Transactions">
          <TransactionList fb={fb} />
        </SectionCard>
      )}
      {view === 'categories' && <CategoriesManager fb={fb} />}
      {view === 'goals' && <GoalsPanel fb={fb} />}
    </div>
  );
}
