// Budget2Tab.jsx — Ledgerly-inspired redesign of the budget view
// Features: period selector, savings rate, dual cash flow chart,
//           budget health ring, savings goals, recurring detection

import { useEffect, useState } from 'react';
import { useToast } from '../../components/shared/Toast.jsx';
import { PERIODS } from '../../hooks/useBudget2.js';

// ── Tiny helpers ─────────────────────────────────────────────────
function fmtAmt(n, cur = 'INR') {
  if (cur === 'USD') {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1000).toFixed(1)}K`;
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function pct(val, total) { return total > 0 ? Math.min((val / total) * 100, 100) : 0; }

function ProgressBar({ value, max, color = '#c9a84c', height = 6 }) {
  const p = pct(value, max);
  const over = value > max && max > 0;
  return (
    <div style={{ height, background: 'var(--bg-muted)', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${p}%`,
        background: over ? '#e07c5a' : color,
        borderRadius: height / 2, transition: 'width .5s ease',
      }} />
    </div>
  );
}

// ── Budget Health Ring (donut showing on-budget %) ───────────────
function HealthRing({ categories, byCategory, cur }) {
  if (!categories.length) return null;
  const budgeted = categories.filter(c => c.monthly_limit > 0);
  if (!budgeted.length) return null;
  const onBudget = budgeted.filter(c => (byCategory[c.name] || 0) <= c.monthly_limit).length;
  const score = Math.round((onBudget / budgeted.length) * 100);
  const color = score >= 80 ? '#4caf9a' : score >= 50 ? '#c9a84c' : '#e07c5a';
  const r = 44, cx = 56, cy = 56, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
      <svg width={112} height={112} viewBox="0 0 112 112">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-muted)" strokeWidth={10} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: 'stroke-dasharray .7s ease' }} />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize={18} fontFamily="'DM Mono',monospace" fontWeight="bold">{score}%</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-muted)" fontSize={9}>on budget</text>
      </svg>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '.75rem', color: 'var(--text)', marginBottom: '.5rem', fontWeight: 500 }}>Budget Health</div>
        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {onBudget} of {budgeted.length} categories on track
        </div>
        {budgeted.filter(c => (byCategory[c.name] || 0) > c.monthly_limit).map(c => (
          <div key={c.name} style={{ fontSize: '.68rem', color: '#e07c5a', marginTop: '.2rem' }}>
            {c.icon} {c.name} — over by {fmtAmt((byCategory[c.name] || 0) - c.monthly_limit, cur)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dual Cash Flow Chart (income + expense per month) ────────────
function CashflowChart({ cashflow, cur }) {
  const months = Object.keys(cashflow).sort().slice(-12);
  if (!months.length) return <div className="empty" style={{ padding: '2rem', textAlign: 'center' }}>Import or add transactions to see cash flow.</div>;
  const maxVal = Math.max(...months.flatMap(m => [cashflow[m].debit, cashflow[m].credit]), 1);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '.3rem', height: 150, minWidth: months.length * 52, padding: '.5rem 0' }}>
        {months.map(mo => {
          const { debit = 0, credit = 0 } = cashflow[mo];
          const dPct = (debit / maxVal) * 100;
          const cPct = (credit / maxVal) * 100;
          const label = new Date(mo + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          return (
            <div key={mo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110, width: '100%' }}>
                {/* Expense bar */}
                <div title={`Expense: ${fmtAmt(debit, cur)}`} style={{
                  flex: 1, background: 'rgba(224,124,90,.75)', borderRadius: '3px 3px 0 0',
                  height: `${dPct}%`, minHeight: 1, transition: 'height .5s ease',
                }} />
                {/* Income bar */}
                <div title={`Income: ${fmtAmt(credit, cur)}`} style={{
                  flex: 1, background: 'rgba(76,175,154,.75)', borderRadius: '3px 3px 0 0',
                  height: `${cPct}%`, minHeight: 1, transition: 'height .5s ease',
                }} />
              </div>
              <div style={{ fontSize: '.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '.4rem', justifyContent: 'center' }}>
        {[['rgba(224,124,90,.75)', 'Expenses'], ['rgba(76,175,154,.75)', 'Income']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.68rem', color: 'var(--text-muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Spending Donut ────────────────────────────────────────────────
function SpendingDonut({ catData, total, cur }) {
  if (!catData.length) return <div className="empty">No spending data for this period</div>;
  let angle = -90;
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 180 180" style={{ width: 160, height: 160, flexShrink: 0 }}>
        {catData.map((d, i) => {
          const sweep = (d.value / total) * 360;
          if (sweep < 0.5) { angle += sweep; return null; }
          const r = 72, ir = 44, cx = 90, cy = 90;
          const pt = (a, rad) => ({ x: cx + rad * Math.cos(a * Math.PI / 180), y: cy + rad * Math.sin(a * Math.PI / 180) });
          const sa = angle, ea = angle + sweep; angle += sweep;
          const s = pt(sa, r), e = pt(ea, r), si = pt(sa, ir), ei = pt(ea, ir);
          const lg = sweep > 180 ? 1 : 0;
          const path = `M${s.x},${s.y}A${r},${r},0,${lg},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir},${ir},0,${lg},0,${si.x},${si.y}Z`;
          return <path key={i} d={path} fill={d.color} opacity=".9" />;
        })}
        <text x="90" y="86" textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="'DM Mono',monospace">{fmtAmt(total, cur)}</text>
        <text x="90" y="100" textAnchor="middle" fill="var(--text-muted)" fontSize="8">spent</text>
      </svg>
      <div style={{ flex: 1, minWidth: 130, maxHeight: 160, overflowY: 'auto' }}>
        {catData.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem', fontSize: '.72rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <div style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.icon} {d.name}</div>
            <div style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)', fontSize: '.65rem' }}>
              {((d.value / total) * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Goal Card ─────────────────────────────────────────────────────
function GoalCard({ goal, cur, onEdit, onDelete }) {
  const progress = pct(goal.saved, goal.target);
  const remaining = Math.max(goal.target - goal.saved, 0);
  const daysLeft = goal.due_date ? Math.ceil((new Date(goal.due_date) - Date.now()) / 86400_000) : null;
  return (
    <div className="card" style={{ borderLeft: `3px solid ${goal.color}`, padding: '.9rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.6rem' }}>
        <div>
          <div style={{ fontSize: '.88rem', color: 'var(--text)', fontWeight: 500 }}>{goal.icon} {goal.name}</div>
          {goal.due_date && (
            <div style={{ fontSize: '.68rem', color: daysLeft < 30 ? '#e07c5a' : 'var(--text-muted)', marginTop: '.15rem' }}>
              {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due today' : 'Overdue'} · {goal.due_date}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.3rem' }}>
          <button className="delbtn" onClick={() => onEdit(goal)} title="Edit" aria-label="Edit goal">✎</button>
          <button className="delbtn" onClick={() => onDelete(goal.id)} title="Delete" aria-label="Delete goal">✕</button>
        </div>
      </div>
      <ProgressBar value={goal.saved} max={goal.target} color={goal.color} height={8} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.4rem', fontSize: '.72rem', color: 'var(--text-muted)' }}>
        <span style={{ fontFamily: "'DM Mono',monospace", color: goal.color }}>{fmtAmt(goal.saved, cur)}</span>
        <span>{Math.round(progress)}%</span>
        <span style={{ fontFamily: "'DM Mono',monospace" }}>of {fmtAmt(goal.target, cur)}</span>
      </div>
      {remaining > 0 && (
        <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.25rem', textAlign: 'right' }}>
          {fmtAmt(remaining, cur)} remaining
        </div>
      )}
      {goal.note && <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.4rem', fontStyle: 'italic' }}>{goal.note}</div>}
    </div>
  );
}

// ── Goal Form Modal ───────────────────────────────────────────────
function GoalModal({ form, onChange, onSave, onClose, isNew, Overlay }) {
  return (
    <Overlay onClose={onClose} narrow>
      <div className="modtitle">{isNew ? '🎯 New Goal' : '✎ Edit Goal'}</div>
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.75rem' }}>
        <div style={{ flex: '0 0 auto' }}>
          <label className="flbl">Icon</label>
          <input className="fi" style={{ width: 60 }} value={form.icon || '🎯'} onChange={e => onChange(p => ({ ...p, icon: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="flbl">Goal name</label>
          <input className="fi" placeholder="e.g. Emergency Fund" value={form.name || ''} onChange={e => onChange(p => ({ ...p, name: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.75rem' }}>
        <div style={{ flex: 1 }}>
          <label className="flbl">Target amount</label>
          <input type="number" className="fi" placeholder="500000" value={form.target || ''} onChange={e => onChange(p => ({ ...p, target: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="flbl">Amount saved so far</label>
          <input type="number" className="fi" placeholder="0" value={form.saved || ''} onChange={e => onChange(p => ({ ...p, saved: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.75rem' }}>
        <div style={{ flex: 1 }}>
          <label className="flbl">Target date (optional)</label>
          <input type="date" className="fi" value={form.due_date || ''} onChange={e => onChange(p => ({ ...p, due_date: e.target.value }))} />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <label className="flbl">Color</label>
          <input type="color" className="fi" value={form.color || '#c9a84c'}
            onChange={e => onChange(p => ({ ...p, color: e.target.value }))}
            style={{ height: 40, padding: '4px 8px', cursor: 'pointer', width: 70 }} />
        </div>
      </div>
      <div style={{ marginBottom: '.75rem' }}>
        <label className="flbl">Note (optional)</label>
        <input className="fi" placeholder="What is this goal for?" value={form.note || ''} onChange={e => onChange(p => ({ ...p, note: e.target.value }))} />
      </div>
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button className="btnc" onClick={onClose}>Cancel</button>
        <button className="btns" onClick={onSave} disabled={!form.name || !form.target}>Save Goal</button>
      </div>
    </Overlay>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function Budget2Tab({
  period, setPeriod,
  analytics2, categories2, goals,
  recurring, loading,
  goalForm, setGoalForm,
  newGoal, setNewGoal,
  b2View, setB2View,
  loadAnalytics,
  loadRecurring,
  ignorePattern,
  saveGoal,
  deleteGoal,
  // Shared
  api,
  Overlay,
}) {
  const toast = useToast();

  // Initial load
  useEffect(() => {
    loadAnalytics(period);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (b2View === 'recurring') loadRecurring();
  }, [b2View]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive currency from analytics data
  const domCur = 'INR'; // TODO: can detect from statements if needed

  // KPI calculations
  const totalIn  = analytics2?.totalCredit ?? 0;
  const totalOut = analytics2?.totalDebit  ?? 0;
  const netFlow  = totalIn - totalOut;
  const savings  = totalIn > 0 ? ((totalIn - totalOut) / totalIn) * 100 : 0;

  // Category spending data
  const byCategory = analytics2?.byCategory ?? {};
  const catData = categories2
    .map(c => ({ name: c.name, value: byCategory[c.name] || 0, color: c.color || '#6b6356', icon: c.icon || '📦' }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalSpend = catData.reduce((s, x) => s + x.value, 0);

  // Cashflow chart data
  const cashflow = analytics2?.cashflow ?? {};

  // Goal modal state
  const isNewGoal = goalForm === 'new';
  const editingGoal = goalForm && goalForm !== 'new';
  const modalForm = isNewGoal ? newGoal : goalForm;
  const setModalForm = isNewGoal ? setNewGoal : setGoalForm;

  async function handleSaveGoal() {
    if (!modalForm?.name || !modalForm?.target) return;
    try {
      await saveGoal({ ...modalForm, target: Number(modalForm.target), saved: Number(modalForm.saved || 0) }, isNewGoal);
      setGoalForm(null);
      if (isNewGoal) setNewGoal({ name: '', target: '', saved: '', due_date: '', note: '', color: '#c9a84c', icon: '🎯' });
    } catch (e) {
      toast.error('Failed to save goal: ' + e.message);
    }
  }

  async function handleDeleteGoal(id) {
    const ok = await toast.confirm('Delete this goal?', { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await deleteGoal(id); } catch (e) { toast.error(e.message); }
  }

  const kpiCards = [
    { label: 'Income',       val: totalIn,  color: '#4caf9a', fmt: v => fmtAmt(v, domCur) },
    { label: 'Spending',     val: totalOut, color: '#e07c5a', fmt: v => fmtAmt(v, domCur) },
    { label: 'Net Flow',     val: netFlow,  color: netFlow >= 0 ? '#4caf9a' : '#e07c5a', fmt: v => (v >= 0 ? '+' : '') + fmtAmt(Math.abs(v), domCur) },
    { label: 'Savings Rate', val: savings,  color: savings >= 20 ? '#4caf9a' : savings > 0 ? '#c9a84c' : '#e07c5a',
      fmt: v => totalIn === 0 ? '—' : `${v.toFixed(1)}%` },
  ];

  return (
    <>
      {/* ── Sub-nav ── */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.2rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '.35rem' }}>
          {[
            { key: 'dashboard', label: '📊 Dashboard' },
            { key: 'goals',     label: '🎯 Goals' },
            { key: 'recurring', label: '🔁 Recurring' },
          ].map(v => (
            <div key={v.key} onClick={() => setB2View(v.key)}
              style={{
                padding: '.3rem .75rem', borderRadius: 5, cursor: 'pointer', fontSize: '.73rem', fontWeight: 500,
                background: b2View === v.key ? 'rgba(201,168,76,.18)' : 'var(--text-muted)',
                border: b2View === v.key ? '1px solid rgba(201,168,76,.5)' : '1px solid var(--border)',
                color: b2View === v.key ? '#c9a84c' : 'var(--text-dim)', transition: 'all .15s',
              }}>
              {v.label}
            </div>
          ))}
        </div>

        {/* Period selector — shown on Dashboard */}
        {b2View === 'dashboard' && (
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {PERIODS.map(p => (
              <button key={p.key}
                onClick={async () => { setPeriod(p.key); await loadAnalytics(p.key); }}
                style={{
                  padding: '.28rem .65rem', borderRadius: 5, fontSize: '.7rem', fontWeight: 500,
                  cursor: 'pointer', border: '1px solid var(--border)', transition: 'all .15s',
                  background: period === p.key ? 'rgba(101,88,211,.2)' : 'transparent',
                  color: period === p.key ? '#a898f0' : 'var(--text-muted)',
                  borderColor: period === p.key ? 'rgba(101,88,211,.5)' : 'var(--border)',
                }}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {b2View === 'dashboard' && (
        <>
          {loading && !analytics2 && (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>⏳</div>
              Loading…
            </div>
          )}

          {!loading && !analytics2 && (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>📊</div>
              <div style={{ marginBottom: '1rem' }}>Import bank statements in the Budget tab to see your spending overview here.</div>
            </div>
          )}

          {analytics2 && (
            <>
              {/* KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: '.75rem', marginBottom: '1.2rem' }}>
                {kpiCards.map(k => (
                  <div key={k.label} className="card" style={{ padding: '.85rem 1rem' }}>
                    <div style={{ fontSize: '.65rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '.4rem' }}>
                      {k.label}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.1rem', color: k.color }}>
                      {k.fmt(k.val)}
                    </div>
                    {k.label === 'Savings Rate' && totalIn > 0 && (
                      <div style={{ marginTop: '.4rem' }}>
                        <ProgressBar value={Math.max(savings, 0)} max={100} color={k.color} height={4} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                {/* Cash flow chart */}
                <div className="card">
                  <div className="ctitle">Cash Flow (Last 12 months)</div>
                  <CashflowChart cashflow={cashflow} cur={domCur} />
                </div>

                {/* Spending donut */}
                <div className="card">
                  <div className="ctitle">Spending by Category</div>
                  <SpendingDonut catData={catData} total={totalSpend} cur={domCur} />
                </div>
              </div>

              {/* Budget health ring + per-category progress */}
              {categories2.some(c => c.monthly_limit > 0) && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="ctitle">Budget Health</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: '1rem', alignItems: 'flex-start' }}>
                    <HealthRing categories={categories2} byCategory={byCategory} cur={domCur} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '.65rem' }}>
                      {categories2.filter(c => c.monthly_limit > 0 && byCategory[c.name] != null).map(c => {
                        const spent = byCategory[c.name] || 0;
                        const over = spent > c.monthly_limit;
                        return (
                          <div key={c.id} style={{ padding: '.6rem .8rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 7 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.35rem' }}>
                              <span style={{ fontSize: '.75rem', color: 'var(--text)' }}>{c.icon} {c.name}</span>
                              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '.72rem', color: over ? '#e07c5a' : '#c9a84c' }}>
                                {fmtAmt(spent, domCur)}
                              </span>
                            </div>
                            <ProgressBar value={spent} max={c.monthly_limit} color={c.color || '#c9a84c'} height={5} />
                            <div style={{ fontSize: '.62rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
                              {over
                                ? <span style={{ color: '#e07c5a' }}>Over by {fmtAmt(spent - c.monthly_limit, domCur)}</span>
                                : <span>{fmtAmt(c.monthly_limit - spent, domCur)} left of {fmtAmt(c.monthly_limit, domCur)}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Insight: categories needing review */}
              {byCategory['Uncategorised'] > 0 && (
                <div className="card" style={{ borderLeft: '3px solid #c9a84c', padding: '.85rem 1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '.8rem', color: '#c9a84c', fontWeight: 500, marginBottom: '.25rem' }}>💡 Tip</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--text-dim)' }}>
                    {fmtAmt(byCategory['Uncategorised'], domCur)} is sitting in "Uncategorised".
                    Go to <strong>Budget → Categories</strong> to add keywords and auto-assign future transactions.
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ═══ GOALS ═══ */}
      {b2View === 'goals' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <div className="ctitle" style={{ margin: 0 }}>Savings Goals</div>
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>
                Track progress toward your financial targets
              </div>
            </div>
            <button className="btns" onClick={() => setGoalForm('new')}>+ New Goal</button>
          </div>

          {goals.length === 0 ? (
            <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🎯</div>
              <div style={{ marginBottom: '1rem' }}>No goals yet. Create your first savings goal.</div>
              <button className="btns" onClick={() => setGoalForm('new')}>+ Create Goal</button>
            </div>
          ) : (
            <>
              {/* Goals summary bar */}
              {goals.length > 1 && (
                <div className="card" style={{ padding: '.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Total target', val: fmtAmt(goals.reduce((s, g) => s + g.target, 0), domCur) },
                    { label: 'Total saved',  val: fmtAmt(goals.reduce((s, g) => s + g.saved,  0), domCur), color: '#4caf9a' },
                    { label: 'Remaining',    val: fmtAmt(goals.reduce((s, g) => s + Math.max(g.target - g.saved, 0), 0), domCur) },
                  ].map(k => (
                    <div key={k.label}>
                      <div style={{ fontSize: '.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '.08em' }}>{k.label}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.95rem', color: k.color || 'var(--text)' }}>{k.val}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(320px,100%),1fr))', gap: '.85rem' }}>
                {goals.map(g => (
                  <GoalCard key={g.id} goal={g} cur={domCur} onEdit={g => setGoalForm(g)} onDelete={handleDeleteGoal} />
                ))}
              </div>
            </>
          )}

          {/* Goal modal */}
          {goalForm && (
            <GoalModal
              form={modalForm}
              onChange={setModalForm}
              onSave={handleSaveGoal}
              onClose={() => setGoalForm(null)}
              isNew={isNewGoal}
              Overlay={Overlay}
            />
          )}
        </>
      )}

      {/* ═══ RECURRING ═══ */}
      {b2View === 'recurring' && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <div className="ctitle" style={{ margin: 0 }}>Recurring Pattern Detection</div>
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.25rem', lineHeight: 1.6 }}>
              Auto-detected from the last 12 months of transactions. Patterns need ≥2 occurrences at a consistent interval.
            </div>
          </div>

          {/* Monthly commitment summary */}
          {recurring.length > 0 && (
            <div className="card" style={{ padding: '.85rem 1rem', marginBottom: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '.08em' }}>Est. monthly</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.95rem', color: '#e07c5a' }}>
                  {fmtAmt(Math.round(recurring.reduce((s, r) => s + r.monthlyEquivalent, 0)), domCur)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '.08em' }}>Est. annual</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.95rem', color: '#c9a84c' }}>
                  {fmtAmt(Math.round(recurring.reduce((s, r) => s + r.monthlyEquivalent * 12, 0)), domCur)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '.08em' }}>Patterns</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '.95rem', color: 'var(--text)' }}>{recurring.length}</div>
              </div>
            </div>
          )}

          {recurring.length === 0 && (
            <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🔁</div>
              <div>No recurring patterns detected yet. Import more statements to enable detection.</div>
            </div>
          )}

          {recurring.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(340px,100%),1fr))', gap: '.75rem' }}>
              {recurring.map(r => (
                <div key={r.key} className="card" style={{
                  padding: '.9rem 1rem',
                  borderLeft: `3px solid ${r.isSubscription ? '#a084ca' : '#5a9ce0'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.5rem' }}>
                    <div>
                      <div style={{ fontSize: '.82rem', color: 'var(--text)', fontWeight: 500, marginBottom: '.15rem' }}>
                        {r.isSubscription ? '📦' : '🔄'} {r.merchant}
                      </div>
                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '.63rem', padding: '2px 6px', borderRadius: 3,
                          background: r.isSubscription ? 'rgba(160,132,202,.15)' : 'rgba(90,156,224,.15)',
                          color: r.isSubscription ? '#a084ca' : '#5a9ce0',
                          border: `1px solid ${r.isSubscription ? 'rgba(160,132,202,.3)' : 'rgba(90,156,224,.3)'}`,
                        }}>
                          {r.isSubscription ? 'Subscription' : 'Recurring'}
                        </span>
                        <span style={{
                          fontSize: '.63rem', padding: '2px 6px', borderRadius: 3,
                          background: r.confidence === 'High' ? 'rgba(76,175,154,.12)' : 'rgba(201,168,76,.12)',
                          color: r.confidence === 'High' ? '#4caf9a' : '#c9a84c',
                          border: `1px solid ${r.confidence === 'High' ? 'rgba(76,175,154,.25)' : 'rgba(201,168,76,.25)'}`,
                        }}>
                          {r.confidence} confidence
                        </span>
                      </div>
                    </div>
                    <button onClick={() => ignorePattern(r.key)}
                      title="Hide this pattern"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.68rem' }}>
                      Ignore
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem', fontSize: '.72rem', color: 'var(--text-dim)', marginTop: '.5rem' }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>Cadence: </span>{r.cadence}</div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Occurrences: </span>{r.occurrences}</div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Avg charge: </span>
                      <span style={{ fontFamily: "'DM Mono',monospace", color: '#e07c5a' }}>{fmtAmt(Math.round(r.avgAmount), domCur)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>≈ Monthly: </span>
                      <span style={{ fontFamily: "'DM Mono',monospace", color: '#c9a84c' }}>{fmtAmt(Math.round(r.monthlyEquivalent), domCur)}</span>
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Next expected: </span>
                      <span style={{ color: '#5a9ce0' }}>{r.nextDate}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
