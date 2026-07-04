// GoalsTab.jsx
import { useState } from 'react';

// ── Financial helpers ────────────────────────────────────────────────────────

/** Expected CAGR per asset type, used for goal projection. */
const ASSET_CAGR = {
  US_STOCK: 0.11, IN_STOCK: 0.11, CRYPTO: 0.12,
  US_ETF:   0.10, IN_ETF:   0.10, MF:     0.11,
  FD:       0.065, PPF:     0.071, EPF:   0.081,
  REAL_ESTATE: 0.07, CASH:  0.035,
  US_BOND:  0.045, OTHER:   0.08,
};

/** Weighted-average CAGR across linked asset types. Falls back to 10% when unlinked. */
function goalCagr(linkedTypes) {
  if (!linkedTypes || linkedTypes.length === 0) return 0.10;
  const rates = linkedTypes.map(t => ASSET_CAGR[t] ?? 0.08);
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

/**
 * Projected corpus at target date using correct compounded SIP FV formula.
 * FV_corpus  = cur × (1+r)^y
 * FV_SIP     = monthly × [(1+r/12)^n − 1] / (r/12) × (1+r/12)  (annuity due)
 */
function projectedFV(cur, monthly, r, yLeft) {
  const n = yLeft * 12;
  const corpusFV = cur * Math.pow(1 + r, yLeft);
  if (monthly <= 0 || n <= 0) return corpusFV;
  const sipFV = monthly * ((Math.pow(1 + r / 12, n) - 1) / (r / 12)) * (1 + r / 12);
  return corpusFV + sipFV;
}

/**
 * How many years until the goal is reached at current portfolio growth + SIP.
 * Returns null if it won't be reached within 50 years.
 */
function projectedCompletionYears(cur, monthly, r, targetAmount) {
  if (cur >= targetAmount) return 0;
  const mRate = r / 12;
  let val = cur;
  for (let mo = 1; mo <= 600; mo++) {
    val = val * (1 + mRate) + monthly;
    if (val >= targetAmount) return mo / 12;
  }
  return null;
}

/** Monthly SIP required to reach the remaining gap over yLeft years at rate r. */
function sipRequired(remaining, r, yLeft) {
  const n = yLeft * 12;
  if (n <= 0 || remaining <= 0) return 0;
  const factor = ((Math.pow(1 + r / 12, n) - 1) / (r / 12)) * (1 + r / 12);
  return factor > 0 ? remaining / factor : 0;
}

// ── Goal status (single source of truth — GoalPlanModal imports this shape too) ─

export function goalStatusCalc(g, cur) {
  const prog = g.targetAmount > 0 ? cur / g.targetAmount : 0;
  if (prog >= 1) return { label: 'Achieved', color: '#1d9e75' };
  const msLeft = Math.max(0, new Date(g.targetDate) - new Date());
  const yLeft = msLeft / (864e5 * 365.25);
  if (yLeft <= 0) return { label: 'Overdue', color: '#e07c5a' };
  const r = goalCagr(g.linkedTypes);
  const monthly = g.monthlyContribution || 0;
  const fv = projectedFV(cur, monthly, r, yLeft);
  if (fv >= g.targetAmount * 0.95) return { label: 'On track',        color: '#1d9e75' };
  if (fv >= g.targetAmount * 0.70) return { label: 'Needs attention', color: '#d4a017' };
  return { label: 'Behind', color: '#e07c5a' };
}

// ── Goal card templates for empty state ──────────────────────────────────────

const GOAL_TEMPLATES = [
  { icon: '🏖️', name: 'Retirement Corpus',    category: 'Retirement',    color: '#c9a84c', targetAmount: 30000000, notes: 'Target corpus for retirement' },
  { icon: '🎓', name: "Child's Education",     category: 'Education',     color: '#a084ca', targetAmount: 5000000,  notes: 'Higher education fund' },
  { icon: '🏠', name: 'Dream Home',            category: 'Real Estate',   color: '#5a9ce0', targetAmount: 8000000,  notes: 'Down payment + purchase' },
  { icon: '🚨', name: 'Emergency Fund',        category: 'Emergency Fund',color: '#4caf9a', targetAmount: 1500000,  notes: '6 months expense buffer' },
];

const INFLATION_RATE = 0.05; // 5% pa

// ─────────────────────────────────────────────────────────────────────────────

export default function GoalsTab({
  goals,
  members,
  allHoldings,
  valINRCache,
  setGoals,
  setGoalForm,
  setEditGoalId,
  setModal,
  fmt,
  fmtCr,
  fmtPct,
  AT,
  BG,
}) {
  const [showInflation,  setShowInflation]  = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState(null);

  const sortedGoals = [...goals].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  function goalCur(g) {
    const lt = g.linkedTypes  || [];
    const lm = g.linkedMembers || ['all'];
    const memberH = lm.includes('all') || lm.length === 0
      ? allHoldings
      : allHoldings.filter(h => lm.includes(h.member_id));
    if (lt.length > 0) {
      const typeSet = new Set(lt);
      return memberH.filter(h => typeSet.has(h.type)).reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
    }
    return memberH.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
  }

  function goalHoldings(g) {
    const lt = g.linkedTypes  || [];
    const lm = g.linkedMembers || ['all'];
    const memberH = lm.includes('all') || lm.length === 0
      ? allHoldings
      : allHoldings.filter(h => lm.includes(h.member_id));
    const filtered = lt.length > 0
      ? memberH.filter(h => new Set(lt).has(h.type))
      : memberH;
    return filtered
      .map(h => ({ ...h, _val: valINRCache.get(h.id) || 0 }))
      .sort((a, b) => b._val - a._val);
  }

  // Detect asset types allocated to multiple goals
  const typeGoalMap = {};
  goals.forEach(g => (g.linkedTypes || []).forEach(t => {
    if (!typeGoalMap[t]) typeGoalMap[t] = [];
    typeGoalMap[t].push(g.name);
  }));
  const doubleAllocated = Object.entries(typeGoalMap).filter(([, gs]) => gs.length > 1);

  // ── Template handler ───────────────────────────────────────────────────────
  function applyTemplate(tpl) {
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() +
      (tpl.category === 'Retirement' ? 20 : tpl.category === 'Education' ? 10 : tpl.category === 'Real Estate' ? 5 : 2));
    setGoalForm({
      ...BG,
      name:         tpl.name,
      category:     tpl.category,
      color:        tpl.color,
      targetAmount: tpl.targetAmount,
      targetDate:   targetDate.toISOString().slice(0, 10),
      notes:        tpl.notes,
      priority:     goals.length + 1,
    });
    setEditGoalId(null);
    setModal('goal');
  }

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.2rem', flexWrap:'wrap', gap:'.7rem' }}>
        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.1rem', color:'var(--text)' }}>Financial Goals</div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'center' }}>
          {goals.length > 0 && (
            <>
              <button
                className="btn-o"
                style={{ fontSize:'.68rem', padding:'.25rem .6rem', opacity: showInflation ? 1 : 0.65 }}
                onClick={() => setShowInflation(p => !p)}
                title="Toggle inflation-adjusted targets at 5% pa"
              >
                {showInflation ? '📉 Hide Inflation' : '📉 Show Inflation'}
              </button>
              <button className="btn-o" onClick={() => setModal('goalplan')}>✦ Fulfillment Plan</button>
            </>
          )}
          <button className="btn-sm" onClick={() => { setGoalForm({ ...BG, priority: goals.length + 1 }); setEditGoalId(null); setModal('goal'); }}>
            + New Goal
          </button>
        </div>
      </div>

      {/* Goal summary bar */}
      {goals.length > 0 && (() => {
        const statuses    = sortedGoals.map(g => goalStatusCalc(g, goalCur(g)));
        const onTrack     = statuses.filter(s => s.label === 'On track' || s.label === 'Achieved').length;
        const behind      = statuses.filter(s => s.label === 'Behind'   || s.label === 'Overdue').length;
        const needsAttn   = statuses.filter(s => s.label === 'Needs attention').length;
        const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
        const totalFunded = sortedGoals.reduce((s, g) => s + goalCur(g), 0);
        const pct         = totalTarget > 0 ? (totalFunded / totalTarget * 100).toFixed(0) : 0;
        return (
          <div style={{ marginBottom:'1rem', padding:'.55rem .85rem', background:'var(--bg-muted)', border:'1px solid var(--border)', borderRadius:8, display:'flex', gap:'1.5rem', flexWrap:'wrap', fontSize:'.72rem', color:'var(--text-dim)', alignItems:'center' }}>
            <span>{goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
            {onTrack   > 0 && <span style={{ color:'#1d9e75' }}>{onTrack} on track</span>}
            {needsAttn > 0 && <span style={{ color:'#d4a017' }}>{needsAttn} needs attention</span>}
            {behind    > 0 && <span style={{ color:'#e07c5a' }}>{behind} behind</span>}
            <span style={{ marginLeft:'auto' }}>Target: <span style={{ color:'var(--text)', fontFamily:"'DM Mono',monospace" }}>{fmtCr(totalTarget)}</span></span>
            <span>Funded: <span style={{ color:'#c9a84c', fontFamily:"'DM Mono',monospace" }}>{pct}%</span></span>
          </div>
        );
      })()}

      {/* Double-allocation warning */}
      {doubleAllocated.length > 0 && (
        <div style={{ marginBottom:'1rem', padding:'.55rem .85rem', background:'rgba(224,124,90,.06)', border:'1px solid rgba(224,124,90,.2)', borderRadius:8, fontSize:'.72rem', color:'#e07c5a', lineHeight:1.6 }}>
          ⚠ Double-counted: {doubleAllocated.map(([t, gs]) => `${AT[t]?.icon || ''} ${AT[t]?.label || t} → ${gs.join(' & ')}`).join(' · ')}
          <span style={{ color:'var(--text-muted)', marginLeft:6 }}>Same asset type in multiple goals inflates funded %</span>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {goals.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:'2rem 1.5rem' }}>
          <div style={{ fontSize:'1.5rem', marginBottom:'.5rem' }}>🎯</div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.1rem', color:'var(--text)', marginBottom:'.4rem' }}>
            Set your first financial milestone
          </div>
          <div style={{ fontSize:'.75rem', color:'var(--text-muted)', marginBottom:'1.2rem' }}>
            Start with a template or create your own
          </div>
          <div style={{ display:'flex', gap:'.55rem', justifyContent:'center', flexWrap:'wrap' }}>
            {GOAL_TEMPLATES.map(tpl => (
              <button key={tpl.name} onClick={() => applyTemplate(tpl)}
                style={{ background:`${tpl.color}14`, border:`1px solid ${tpl.color}44`, borderRadius:8, padding:'.5rem .9rem', cursor:'pointer', fontSize:'.72rem', color:tpl.color, fontFamily:"'DM Sans',sans-serif", display:'flex', alignItems:'center', gap:'.35rem' }}>
                {tpl.icon} {tpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Goal cards ──────────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:'1rem' }}>
        {sortedGoals.map((g, idx) => {
          const cur      = goalCur(g);
          const prog     = Math.min((cur / g.targetAmount) * 100, 100);
          const rem      = Math.max(0, g.targetAmount - cur);
          const msLeft   = Math.max(0, new Date(g.targetDate) - new Date());
          const yLeft    = msLeft / (864e5 * 365.25);
          const lm       = g.linkedMembers || ['all'];
          const memberNames = lm.includes('all') ? 'All members' : lm.map(id => members.find(m => m.id === id)?.name || '?').join(', ');
          const monthly  = g.monthlyContribution || 0;
          const st       = goalStatusCalc(g, cur);
          const r        = goalCagr(g.linkedTypes);

          // Projected completion date
          const projYears = projectedCompletionYears(cur, monthly, r, g.targetAmount);
          const projDate  = projYears !== null
            ? new Date(Date.now() + projYears * 864e5 * 365.25).getFullYear()
            : null;
          const targetYear = new Date(g.targetDate).getFullYear();
          const projDiff   = projDate !== null ? projDate - targetYear : null;

          // Monthly SIP needed to close gap on time
          const sipNeeded = sipRequired(rem, r, yLeft);
          const sipGap    = sipNeeded - monthly;

          // Inflation-adjusted target
          const inflTarget = g.targetAmount * Math.pow(1 + INFLATION_RATE, yLeft);

          // Holdings drill-down
          const isExpanded  = expandedGoalId === g.id;
          const linkedHolds = isExpanded ? goalHoldings(g) : [];

          return (
            <div key={g.id} className="card" style={{ borderTop:`3px solid ${g.color}`, position:'relative' }}>
              {/* Priority + status pills */}
              <div style={{ display:'flex', alignItems:'center', gap:'.35rem', marginBottom:'.55rem' }}>
                <div style={{ background:`${g.color}22`, border:`1px solid ${g.color}55`, borderRadius:3, padding:'1px 7px', fontSize:'.6rem', letterSpacing:'.08em', color:g.color, fontWeight:600 }}>
                  P{g.priority || idx + 1}
                </div>
                <div style={{ background:`${st.color}18`, border:`1px solid ${st.color}44`, borderRadius:10, padding:'1px 8px', fontSize:'.58rem', color:st.color, fontWeight:500 }}>
                  {st.label}
                </div>
                <span style={{ fontSize:'.62rem', letterSpacing:'.1em', textTransform:'uppercase', color:'var(--text-muted)', marginLeft:'.15rem' }}>
                  {g.category}
                </span>
              </div>

              {/* Controls */}
              <div style={{ position:'absolute', top:8, right:8, display:'flex', gap:'.2rem' }}>
                <button className="delbtn" title="Move up"   onClick={() => setGoals(p => { const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99)); const i=s.findIndex(x=>x.id===g.id); if(i===0)return p; const np=[...s];[np[i-1],np[i]]=[np[i],np[i-1]]; return np.map((x,j)=>({...x,priority:j+1})); })}>↑</button>
                <button className="delbtn" title="Move down" onClick={() => setGoals(p => { const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99)); const i=s.findIndex(x=>x.id===g.id); if(i===s.length-1)return p; const np=[...s];[np[i],np[i+1]]=[np[i+1],np[i]]; return np.map((x,j)=>({...x,priority:j+1})); })}>↓</button>
                <button className="delbtn" title="Edit goal" style={{ color:'rgba(90,156,224,.5)' }}
                  onClick={() => { setGoalForm({ name:g.name, targetAmount:g.targetAmount, targetDate:g.targetDate, linkedMembers:g.linkedMembers||['all'], linkedTypes:g.linkedTypes||[], category:g.category, color:g.color, notes:g.notes||'', priority:g.priority||idx+1, monthlyContribution:g.monthlyContribution||'' }); setEditGoalId(g.id); setModal('goal'); }}>✎
                </button>
                <button className="delbtn" title="Delete goal" onClick={() => setGoals(p => p.filter(x => x.id !== g.id))}>✕</button>
              </div>

              {/* Goal name */}
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.2rem', color:'var(--text)', marginBottom:'.2rem' }}>{g.name}</div>
              {g.notes && <div style={{ fontSize:'.72rem', color:'var(--text-muted)', marginBottom:'.6rem' }}>{g.notes}</div>}

              {/* Funded by */}
              <div style={{ marginBottom:'.5rem', fontSize:'.62rem', color:'var(--text-muted)', letterSpacing:'.04em', textTransform:'uppercase', fontWeight:500 }}>Funded by</div>
              <div style={{ marginBottom:'.65rem', display:'flex', flexWrap:'wrap', gap:'.35rem' }}>
                <span style={{ fontSize:'.65rem', background:'var(--bg-muted)', border:'1px solid var(--border)', borderRadius:12, padding:'2px 9px', color:'var(--text-dim)' }}>
                  👤 {memberNames}
                </span>
                {(g.linkedTypes || []).length > 0 ? g.linkedTypes.map(t => {
                  const a = AT[t] || { icon:'📦', color:'#888', label:t };
                  const isDouble = typeGoalMap[t]?.length > 1;
                  return (
                    <span key={t} style={{ fontSize:'.6rem', background:`${a.color}15`, border:`1px solid ${a.color}${isDouble ? '88' : '44'}`, borderRadius:4, padding:'2px 7px', color:a.color, fontWeight:500 }}>
                      {a.icon} {a.label}{isDouble && <span style={{ color:'#e07c5a', marginLeft:3 }} title={`Also in: ${typeGoalMap[t].filter(n => n !== g.name).join(', ')}`}>⚠</span>}
                    </span>
                  );
                }) : (
                  <span style={{ fontSize:'.6rem', background:'var(--bg-muted)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 7px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'.25rem' }}>
                    <span style={{ fontSize:'.7rem', opacity:.6 }}>ℹ</span> Entire portfolio
                  </span>
                )}
              </div>

              {/* Progress */}
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.45rem' }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'1.05rem', color:g.color }}>{fmtCr(cur)}</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'.82rem', color:'var(--text-muted)' }}>of {fmtCr(g.targetAmount)}</span>
              </div>
              <div className="gbbg"><div className="gbfill" style={{ width:`${prog}%`, background:g.color }}/></div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:'.55rem', fontSize:'.7rem' }}>
                <span style={{ color:'var(--text-muted)' }}>Remaining <span style={{ color:'var(--text)', fontFamily:"'DM Mono',monospace" }}>{fmtCr(rem)}</span></span>
                <span style={{ color:'var(--text-muted)' }}>{yLeft.toFixed(1)}y · {prog.toFixed(0)}%</span>
              </div>

              {/* ── Inflation-adjusted target ──────────────────────────── */}
              {showInflation && yLeft > 0.5 && (
                <div style={{ marginTop:'.5rem', padding:'.35rem .65rem', background:'rgba(201,168,76,.06)', border:'1px solid rgba(201,168,76,.2)', borderRadius:5, fontSize:'.67rem', color:'var(--text-muted)', display:'flex', justifyContent:'space-between' }}>
                  <span>📉 Inflation-adj target (5%)</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", color:'#c9a84c' }}>{fmtCr(inflTarget)}</span>
                </div>
              )}

              {/* ── Projected completion ───────────────────────────────── */}
              {st.label !== 'Achieved' && yLeft > 0 && (
                <div style={{ marginTop:'.55rem', padding:'.38rem .65rem', background:'var(--bg-muted)', borderRadius:5, fontSize:'.67rem', color:'var(--text-muted)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>📅 Projected to reach</span>
                  {projDate !== null ? (
                    <span style={{ fontFamily:"'DM Mono',monospace", color: projDiff > 0 ? '#e07c5a' : '#1d9e75', fontWeight:500 }}>
                      {projDate} {projDiff > 0 ? `(${projDiff}y late)` : projDiff < 0 ? `(${Math.abs(projDiff)}y early)` : '(on time)'}
                    </span>
                  ) : (
                    <span style={{ color:'#e07c5a' }}>Won't reach at current rate</span>
                  )}
                </div>
              )}

              {/* ── Monthly SIP info ───────────────────────────────────── */}
              {monthly > 0 && (
                <div style={{ marginTop:'.55rem', padding:'.4rem .7rem', background:'var(--bg-muted)', borderRadius:5, fontSize:'.68rem', color:'var(--text-muted)' }}>
                  Monthly SIP: <span style={{ fontFamily:"'DM Mono',monospace", color:'var(--text)' }}>₹{monthly.toLocaleString('en-IN')}</span>
                </div>
              )}

              {/* SIP gap — only show when behind and gap is meaningful */}
              {st.label !== 'Achieved' && yLeft > 0 && sipNeeded > 0 && sipGap > monthly * 0.1 && (
                <div style={{ marginTop:'.4rem', padding:'.38rem .65rem', background:'rgba(224,124,90,.06)', border:'1px solid rgba(224,124,90,.2)', borderRadius:5, fontSize:'.67rem', color:'#e07c5a', display:'flex', justifyContent:'space-between' }}>
                  <span>Need to reach on time</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontWeight:500 }}>₹{Math.round(sipNeeded).toLocaleString('en-IN')}/mo</span>
                </div>
              )}

              {/* ── Holdings drill-down ─────────────────────────────────── */}
              <button
                onClick={() => setExpandedGoalId(isExpanded ? null : g.id)}
                style={{ marginTop:'.65rem', width:'100%', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'.3rem .6rem', cursor:'pointer', fontSize:'.65rem', color:'var(--text-muted)', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:"'DM Sans',sans-serif" }}>
                <span>Contributing holdings</span>
                <span>{isExpanded ? '▲' : '▼'}</span>
              </button>

              {isExpanded && (
                <div style={{ marginTop:'.4rem', border:'1px solid var(--border)', borderRadius:5, overflow:'hidden' }}>
                  {linkedHolds.length === 0 ? (
                    <div style={{ padding:'.6rem', fontSize:'.68rem', color:'var(--text-muted)', textAlign:'center' }}>No holdings linked</div>
                  ) : (
                    linkedHolds.slice(0, 8).map(h => {
                      const pct = cur > 0 ? (h._val / cur * 100).toFixed(0) : 0;
                      const a = AT[h.type] || { icon:'📦', color:'#888' };
                      return (
                        <div key={h.id} style={{ display:'flex', alignItems:'center', gap:'.5rem', padding:'.35rem .65rem', borderBottom:'1px solid var(--border)', fontSize:'.67rem' }}>
                          <span style={{ color:a.color, width:14 }}>{a.icon}</span>
                          <span style={{ flex:1, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={h.name}>{h.name}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", color:'var(--text-dim)', flexShrink:0 }}>{fmtCr(h._val)}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", color:'var(--text-muted)', flexShrink:0, minWidth:32, textAlign:'right' }}>{pct}%</span>
                        </div>
                      );
                    })
                  )}
                  {linkedHolds.length > 8 && (
                    <div style={{ padding:'.35rem .65rem', fontSize:'.65rem', color:'var(--text-muted)', textAlign:'center' }}>
                      +{linkedHolds.length - 8} more holdings
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
