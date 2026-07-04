// GoalsTab.jsx — Financial Goals tab with all AI features
import { useState, useEffect, useRef } from 'react';
import {
  goalCagr, projectedFV, projectedCompletionYears, sipRequired,
  goalStatusCalc, getTaxPath,
} from './goalMath.js';
import { useGoalAI } from '../../hooks/useGoalAI.js';

const INFLATION_RATE = 0.05;

const GOAL_TEMPLATES = [
  { icon: '🏖️', name: 'Retirement Corpus',  category: 'Retirement',    color: '#c9a84c', targetAmount: 30000000, notes: 'Target corpus for retirement' },
  { icon: '🎓', name: "Child's Education",   category: 'Education',     color: '#a084ca', targetAmount: 5000000,  notes: 'Higher education fund' },
  { icon: '🏠', name: 'Dream Home',          category: 'Real Estate',   color: '#5a9ce0', targetAmount: 8000000,  notes: 'Down payment + purchase' },
  { icon: '🚨', name: 'Emergency Fund',      category: 'Emergency Fund',color: '#4caf9a', targetAmount: 1500000,  notes: '6 months expense buffer' },
];

// ── Inline streaming text component ─────────────────────────────────────────
function StreamingText({ text, loading }) {
  return (
    <div style={{ fontSize: '.78rem', lineHeight: 1.75, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
      {text}
      {loading && (
        <span style={{ display: 'inline-block', width: 7, height: 13, background: '#a084ca', borderRadius: 1, marginLeft: 2, animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom' }} />
      )}
    </div>
  );
}

// ── AI Nudges section ────────────────────────────────────────────────────────
function NudgesSection({ nudges, loading, loaded, dismissed, onLoad, onDismiss }) {
  const [open, setOpen] = useState(true);

  if (dismissed) return null;

  return (
    <div style={{ marginBottom: '1rem' }}>
      {!loaded && !loading && (
        <button onClick={onLoad}
          style={{ width: '100%', background: 'rgba(160,132,202,.06)', border: '1px dashed rgba(160,132,202,.3)', borderRadius: 8, padding: '.55rem', cursor: 'pointer', fontSize: '.7rem', color: '#a084ca', fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.4rem' }}>
          <span>✦</span> Load AI insights for your goals
        </button>
      )}

      {loading && (
        <div style={{ padding: '.6rem .9rem', background: 'rgba(160,132,202,.05)', border: '1px solid rgba(160,132,202,.15)', borderRadius: 8, fontSize: '.7rem', color: '#a084ca', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <div style={{ width: 12, height: 12, border: '1.5px solid rgba(160,132,202,.3)', borderTopColor: '#a084ca', borderRadius: '50%', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          Analysing your goals for gaps and opportunities…
        </div>
      )}

      {loaded && nudges.length > 0 && (
        <div style={{ background: 'rgba(160,132,202,.04)', border: '1px solid rgba(160,132,202,.18)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.5rem .8rem', borderBottom: open ? '1px solid rgba(160,132,202,.12)' : 'none', cursor: 'pointer' }}
            onClick={() => setOpen(p => !p)}>
            <span style={{ fontSize: '.68rem', color: '#a084ca', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>✦ AI Insights</span>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '.62rem', color: 'var(--text-muted)' }}>{nudges.length} finding{nudges.length !== 1 ? 's' : ''}</span>
              <button onClick={e => { e.stopPropagation(); onDismiss(); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '.75rem', lineHeight: 1 }}>✕</button>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
            </div>
          </div>
          {open && (
            <div style={{ padding: '.5rem .8rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
              {nudges.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', fontSize: '.72rem' }}>
                  <span style={{ flexShrink: 0, fontSize: '.85rem' }}>{n.icon || (n.severity === 'warning' ? '⚠' : '💡')}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: n.severity === 'warning' ? '#e07c5a' : 'var(--text)' }}>{n.text}</span>
                    {n.action && <span style={{ marginLeft: '.4rem', color: '#a084ca', fontWeight: 500 }}>→ {n.action}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conflict Banner ──────────────────────────────────────────────────────────
function ConflictBanner({ conflict, onResolve }) {
  const [open, setOpen] = useState(false);

  if (!conflict) return null;
  return (
    <div style={{ marginBottom: '1rem', background: 'rgba(224,124,90,.05)', border: '1px solid rgba(224,124,90,.25)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.55rem .85rem' }}>
        <div style={{ fontSize: '.72rem', color: '#e07c5a', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <span>⚡</span>
          <span>SIP conflict — goals need est. <strong>₹{Math.round(conflict.totalNeeded).toLocaleString('en-IN')}/mo</strong>, only <strong>₹{Math.round(conflict.totalCurrent).toLocaleString('en-IN')}/mo</strong> committed (est. shortfall ₹{Math.round(conflict.shortfall).toLocaleString('en-IN')}/mo)</span>
        </div>
        <button onClick={() => { setOpen(p => !p); if (!open) onResolve(); }}
          style={{ background: 'rgba(224,124,90,.12)', border: '1px solid rgba(224,124,90,.3)', color: '#e07c5a', borderRadius: 5, padding: '.22rem .6rem', cursor: 'pointer', fontSize: '.65rem', fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
          {open ? 'Hide' : '✦ Resolve with AI'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GoalsTab({
  goals, members, allHoldings, allCur, allInv,
  valINRCache, setGoals, setGoalForm, setEditGoalId, setModal,
  fmt, fmtCr, fmtPct, AT, BG,
}) {
  // ── Local UI state ─────────────────────────────────────────────────────────
  const [showInflation,   setShowInflation]   = useState(false);
  const [expandedGoalId,  setExpandedGoalId]  = useState(null);   // holdings drill-down
  const [expandedTaxId,   setExpandedTaxId]   = useState(null);   // tax path
  const [expandedWhatIf,  setExpandedWhatIf]  = useState(null);   // what-if simulator
  const [wipSip,          setWipSip]          = useState({});     // {goalId: extraMonthly}
  const [nlOpen,          setNlOpen]          = useState(false);  // NL input bar
  const [nlText,          setNlText]          = useState('');
  const [taxAIText,       setTaxAIText]       = useState({});     // {goalId: text}
  const [taxAILoading,    setTaxAILoading]    = useState({});     // {goalId: bool}
  const [conflictText,    setConflictText]    = useState('');
  const [conflictLoading, setConflictLoading] = useState(false);
  const [showConflictRes, setShowConflictRes] = useState(false);
  const taxAbortRef     = useRef({});
  const conflictAbortRef = useRef(null);

  const sortedGoals = [...goals].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  // ── AI hook ────────────────────────────────────────────────────────────────
  const {
    parseGoalText, nlLoading, nlError,
    nudges, nudgesLoading, nudgesLoaded, nudgesDismissed,
    loadNudges, dismissNudges,
    detectConflicts, resolveConflictsWithAI,
    getAITaxPath,
  } = useGoalAI({ goals, members, allCur });

  // Auto-load nudges once goals are present
  useEffect(() => {
    if (goals.length > 0 && !nudgesLoaded && !nudgesLoading) {
      loadNudges();
    }
  }, [goals.length]); // eslint-disable-line

  // ── Helpers ────────────────────────────────────────────────────────────────
  function goalCur(g) {
    const lt = g.linkedTypes  || [];
    const lm = g.linkedMembers || ['all'];
    const memberH = lm.includes('all') || lm.length === 0
      ? allHoldings
      : allHoldings.filter(h => lm.includes(h.member_id));
    const filtered = lt.length > 0
      ? memberH.filter(h => new Set(lt).has(h.type))
      : memberH;
    return filtered.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
  }

  function goalHoldings(g) {
    const lt = g.linkedTypes  || [];
    const lm = g.linkedMembers || ['all'];
    const memberH = lm.includes('all') || lm.length === 0
      ? allHoldings
      : allHoldings.filter(h => lm.includes(h.member_id));
    return (lt.length > 0 ? memberH.filter(h => new Set(lt).has(h.type)) : memberH)
      .map(h => ({ ...h, _val: valINRCache.get(h.id) || 0 }))
      .sort((a, b) => b._val - a._val);
  }

  // Double-allocation detection
  const typeGoalMap = {};
  goals.forEach(g => (g.linkedTypes || []).forEach(t => {
    if (!typeGoalMap[t]) typeGoalMap[t] = [];
    typeGoalMap[t].push(g.name);
  }));
  const doubleAllocated = Object.entries(typeGoalMap).filter(([, gs]) => gs.length > 1);

  // Conflict detection
  const conflict = detectConflicts();

  // ── Actions ────────────────────────────────────────────────────────────────
  function applyTemplate(tpl) {
    const td = new Date();
    td.setFullYear(td.getFullYear() + ({ Retirement: 20, Education: 10, 'Real Estate': 5 }[tpl.category] || 2));
    setGoalForm({ ...BG, name: tpl.name, category: tpl.category, color: tpl.color, targetAmount: tpl.targetAmount, targetDate: td.toISOString().slice(0, 10), notes: tpl.notes, priority: goals.length + 1 });
    setEditGoalId(null);
    setModal('goal');
  }

  async function handleNLParse() {
    const parsed = await parseGoalText(nlText);
    if (parsed) {
      setGoalForm({ ...BG, ...parsed, linkedMembers: ['all'], linkedTypes: [], priority: goals.length + 1 });
      setEditGoalId(null);
      setModal('goal');
      setNlText('');
      setNlOpen(false);
    }
  }

  async function handleResolveConflict() {
    if (!conflict) return;
    setShowConflictRes(true);
    setConflictText('');
    setConflictLoading(true);
    conflictAbortRef.current?.abort();
    const ctrl = new AbortController();
    conflictAbortRef.current = ctrl;
    try {
      await resolveConflictsWithAI(conflict, chunk => setConflictText(p => p + chunk), ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setConflictText('⚠ ' + e.message);
    } finally {
      setConflictLoading(false);
    }
  }

  async function handleAITaxPath(g, cur, yLeft) {
    const id = g.id;
    taxAbortRef.current[id]?.abort();
    const ctrl = new AbortController();
    taxAbortRef.current[id] = ctrl;
    setTaxAIText(p => ({ ...p, [id]: '' }));
    setTaxAILoading(p => ({ ...p, [id]: true }));
    try {
      await getAITaxPath(g, cur, yLeft, chunk => setTaxAIText(p => ({ ...p, [id]: (p[id] || '') + chunk })), ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setTaxAIText(p => ({ ...p, [id]: '⚠ ' + e.message }));
    } finally {
      setTaxAILoading(p => ({ ...p, [id]: false }));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.7rem' }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.1rem', color: 'var(--text)' }}>Financial Goals</div>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {goals.length > 0 && (
            <>
              <button className="btn-o" style={{ fontSize: '.68rem', padding: '.25rem .6rem' }}
                onClick={() => setNlOpen(p => !p)} title="Describe a goal in plain English">
                ✨ {nlOpen ? 'Close' : 'Describe a goal'}
              </button>
              <button className="btn-o" style={{ fontSize: '.68rem', padding: '.25rem .6rem', opacity: showInflation ? 1 : 0.65 }}
                onClick={() => setShowInflation(p => !p)} title="Inflation-adjusted targets at 5% pa">
                📉 Inflation
              </button>
              <button className="btn-o" onClick={() => setModal('goalplan')}>✦ Fulfillment Plan</button>
            </>
          )}
          <button className="btn-sm" onClick={() => { setGoalForm({ ...BG, priority: goals.length + 1 }); setEditGoalId(null); setModal('goal'); }}>
            + New Goal
          </button>
        </div>
      </div>

      {/* ── Natural Language Input Bar ─────────────────────────────────────── */}
      {nlOpen && (
        <div style={{ marginBottom: '1rem', padding: '.75rem 1rem', background: 'rgba(160,132,202,.06)', border: '1px solid rgba(160,132,202,.25)', borderRadius: 10 }}>
          <div style={{ fontSize: '.68rem', color: '#a084ca', marginBottom: '.5rem', fontWeight: 500 }}>
            ✨ Describe your goal in plain English
          </div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <input
              className="fi"
              style={{ flex: 1, fontSize: '.78rem' }}
              placeholder={`e.g. "I want to retire at 60 with 5 crore corpus" or "Save 50 lakh for daughter's education by 2035"`}
              value={nlText}
              onChange={e => setNlText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !nlLoading && nlText.trim() && handleNLParse()}
              autoFocus
            />
            <button className="btn-sm" onClick={handleNLParse} disabled={nlLoading || !nlText.trim()}
              style={{ flexShrink: 0, opacity: nlLoading || !nlText.trim() ? 0.5 : 1 }}>
              {nlLoading ? '…' : '→ Parse'}
            </button>
          </div>
          {nlError && <div style={{ marginTop: '.4rem', fontSize: '.68rem', color: '#e07c5a' }}>⚠ {nlError}</div>}
          <div style={{ marginTop: '.4rem', fontSize: '.63rem', color: 'var(--text-muted)' }}>
            AI will extract the goal name, target amount, date, and category — you can review and edit before saving.
          </div>
        </div>
      )}

      {/* ── Summary bar ────────────────────────────────────────────────────── */}
      {goals.length > 0 && (() => {
        const statuses    = sortedGoals.map(g => goalStatusCalc(g, goalCur(g)));
        const onTrack     = statuses.filter(s => s.label === 'On track' || s.label === 'Achieved').length;
        const behind      = statuses.filter(s => s.label === 'Behind'   || s.label === 'Overdue').length;
        const needsAttn   = statuses.filter(s => s.label === 'Needs attention').length;
        const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
        const totalFunded = sortedGoals.reduce((s, g) => s + goalCur(g), 0);
        const pct         = totalTarget > 0 ? (totalFunded / totalTarget * 100).toFixed(0) : 0;
        return (
          <div style={{ marginBottom: '1rem', padding: '.55rem .85rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '.72rem', color: 'var(--text-dim)', alignItems: 'center' }}>
            <span>{goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
            {onTrack   > 0 && <span style={{ color: '#1d9e75' }}>{onTrack} on track</span>}
            {needsAttn > 0 && <span style={{ color: '#d4a017' }}>{needsAttn} needs attention</span>}
            {behind    > 0 && <span style={{ color: '#e07c5a' }}>{behind} behind</span>}
            <span style={{ marginLeft: 'auto' }}>Target: <span style={{ color: 'var(--text)', fontFamily: "'DM Mono',monospace" }}>{fmtCr(totalTarget)}</span></span>
            <span>Funded: <span style={{ color: '#c9a84c', fontFamily: "'DM Mono',monospace" }}>{pct}%</span></span>
          </div>
        );
      })()}

      {/* ── Double-allocation warning ───────────────────────────────────────── */}
      {doubleAllocated.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '.55rem .85rem', background: 'rgba(224,124,90,.06)', border: '1px solid rgba(224,124,90,.2)', borderRadius: 8, fontSize: '.72rem', color: '#e07c5a', lineHeight: 1.6 }}>
          ⚠ Double-counted: {doubleAllocated.map(([t, gs]) => `${AT[t]?.icon || ''} ${AT[t]?.label || t} → ${gs.join(' & ')}`).join(' · ')}
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>Same asset type in multiple goals inflates funded %</span>
        </div>
      )}

      {/* ── AI Nudges ──────────────────────────────────────────────────────── */}
      {goals.length > 0 && (
        <NudgesSection
          nudges={nudges} loading={nudgesLoading} loaded={nudgesLoaded}
          dismissed={nudgesDismissed} onLoad={loadNudges} onDismiss={dismissNudges}
        />
      )}

      {/* ── Conflict Banner + Resolution ───────────────────────────────────── */}
      {conflict && (
        <>
          <ConflictBanner conflict={conflict} onResolve={handleResolveConflict} />
          {showConflictRes && (
            <div style={{ marginBottom: '1rem', padding: '.85rem 1rem', background: 'rgba(224,124,90,.04)', border: '1px solid rgba(224,124,90,.2)', borderRadius: 8 }}>
              <div style={{ fontSize: '.65rem', color: '#e07c5a', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.5rem' }}>✦ AI Conflict Resolution</div>
              {conflictText
                ? <StreamingText text={conflictText} loading={conflictLoading} />
                : <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <div style={{ width: 12, height: 12, border: '1.5px solid rgba(224,124,90,.3)', borderTopColor: '#e07c5a', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Planning how to balance your goals…
                  </div>
              }
            </div>
          )}
        </>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {goals.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>🎯</div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.1rem', color: 'var(--text)', marginBottom: '.35rem' }}>Set your first financial milestone</div>
          <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '1.2rem' }}>Start with a template or describe a goal in plain English</div>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '.9rem' }}>
            {GOAL_TEMPLATES.map(tpl => (
              <button key={tpl.name} onClick={() => applyTemplate(tpl)}
                style={{ background: `${tpl.color}14`, border: `1px solid ${tpl.color}44`, borderRadius: 8, padding: '.45rem .85rem', cursor: 'pointer', fontSize: '.72rem', color: tpl.color, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                {tpl.icon} {tpl.name}
              </button>
            ))}
          </div>
          <button className="btn-o" style={{ fontSize: '.72rem' }} onClick={() => setNlOpen(true)}>
            ✨ Or describe your goal in plain English
          </button>
        </div>
      )}

      {/* ── Goal cards grid ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: '1rem' }}>
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

          // Projections
          const projYears = projectedCompletionYears(cur, monthly, r, g.targetAmount);
          const projDate  = projYears !== null ? new Date(Date.now() + projYears * 864e5 * 365.25).getFullYear() : null;
          const targetYr  = new Date(g.targetDate).getFullYear();
          const projDiff  = projDate !== null ? projDate - targetYr : null;

          // SIP needed
          const sipNeeded = sipRequired(rem, r, yLeft);
          const sipGap    = sipNeeded - monthly;

          // What-if SIP
          const extra       = Number(wipSip[g.id] || 0);
          const simMonthly  = monthly + extra;
          const simProjYears = extra > 0 ? projectedCompletionYears(cur, simMonthly, r, g.targetAmount) : null;
          const simProjDate  = simProjYears !== null ? new Date(Date.now() + simProjYears * 864e5 * 365.25).getFullYear() : null;
          const simStatus    = extra > 0 ? goalStatusCalc({ ...g, monthlyContribution: simMonthly }, cur) : null;

          // Inflation
          const inflTarget = g.targetAmount * Math.pow(1 + INFLATION_RATE, yLeft);

          // Expand flags
          const holdingsExpanded = expandedGoalId === g.id;
          const taxExpanded      = expandedTaxId  === g.id;
          const whatIfExpanded   = expandedWhatIf === g.id;

          // Tax path
          const taxPath = getTaxPath(yLeft, g.category);

          return (
            <div key={g.id} className="card" style={{ borderTop: `3px solid ${g.color}`, position: 'relative' }}>

              {/* Priority + status pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginBottom: '.55rem' }}>
                <div style={{ background: `${g.color}22`, border: `1px solid ${g.color}55`, borderRadius: 3, padding: '1px 7px', fontSize: '.6rem', letterSpacing: '.08em', color: g.color, fontWeight: 600 }}>P{g.priority || idx + 1}</div>
                <div style={{ background: `${st.color}18`, border: `1px solid ${st.color}44`, borderRadius: 10, padding: '1px 8px', fontSize: '.58rem', color: st.color, fontWeight: 500 }}>{st.label}</div>
                <span style={{ fontSize: '.62rem', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginLeft: '.15rem' }}>{g.category}</span>
              </div>

              {/* Controls */}
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: '.2rem' }}>
                <button className="delbtn" title="Move up"   onClick={() => setGoals(p => { const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===0)return p;const np=[...s];[np[i-1],np[i]]=[np[i],np[i-1]];return np.map((x,j)=>({...x,priority:j+1})); })}>↑</button>
                <button className="delbtn" title="Move down" onClick={() => setGoals(p => { const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===s.length-1)return p;const np=[...s];[np[i],np[i+1]]=[np[i+1],np[i]];return np.map((x,j)=>({...x,priority:j+1})); })}>↓</button>
                <button className="delbtn" title="Edit goal" style={{ color: 'rgba(90,156,224,.5)' }}
                  onClick={() => { setGoalForm({ name:g.name, targetAmount:g.targetAmount, targetDate:g.targetDate, linkedMembers:g.linkedMembers||['all'], linkedTypes:g.linkedTypes||[], category:g.category, color:g.color, notes:g.notes||'', priority:g.priority||idx+1, monthlyContribution:g.monthlyContribution||'' }); setEditGoalId(g.id); setModal('goal'); }}>✎</button>
                <button className="delbtn" title="Delete" onClick={() => setGoals(p => p.filter(x => x.id !== g.id))}>✕</button>
              </div>

              {/* Name + notes */}
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.2rem', color: 'var(--text)', marginBottom: '.2rem' }}>{g.name}</div>
              {g.notes && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginBottom: '.6rem' }}>{g.notes}</div>}

              {/* Funded by */}
              <div style={{ marginBottom: '.5rem', fontSize: '.62rem', color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 500 }}>Funded by</div>
              <div style={{ marginBottom: '.65rem', display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                <span style={{ fontSize: '.65rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 9px', color: 'var(--text-dim)' }}>👤 {memberNames}</span>
                {(g.linkedTypes || []).length > 0 ? g.linkedTypes.map(t => {
                  const a = AT[t] || { icon: '📦', color: '#888', label: t };
                  const isDouble = typeGoalMap[t]?.length > 1;
                  return (
                    <span key={t} style={{ fontSize: '.6rem', background: `${a.color}15`, border: `1px solid ${a.color}${isDouble ? '88' : '44'}`, borderRadius: 4, padding: '2px 7px', color: a.color, fontWeight: 500 }}>
                      {a.icon} {a.label}{isDouble && <span style={{ color: '#e07c5a', marginLeft: 3 }}>⚠</span>}
                    </span>
                  );
                }) : (
                  <span style={{ fontSize: '.6rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', color: 'var(--text-muted)' }}>ℹ Entire portfolio</span>
                )}
              </div>

              {/* Progress bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.45rem' }}>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.05rem', color: g.color }}>{fmtCr(cur)}</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '.82rem', color: 'var(--text-muted)' }}>of {fmtCr(g.targetAmount)}</span>
              </div>
              <div className="gbbg"><div className="gbfill" style={{ width: `${prog}%`, background: g.color }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.55rem', fontSize: '.7rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Remaining <span style={{ color: 'var(--text)', fontFamily: "'DM Mono',monospace" }}>{fmtCr(rem)}</span></span>
                <span style={{ color: 'var(--text-muted)' }}>{yLeft.toFixed(1)}y · {prog.toFixed(0)}%</span>
              </div>

              {/* Inflation-adjusted target */}
              {showInflation && yLeft > 0.5 && (
                <div style={{ marginTop: '.45rem', padding: '.32rem .6rem', background: 'rgba(201,168,76,.06)', border: '1px solid rgba(201,168,76,.2)', borderRadius: 5, fontSize: '.67rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>📉 Inflation-adj at 5%</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: '#c9a84c' }}>{fmtCr(inflTarget)}</span>
                </div>
              )}

              {/* Projected completion */}
              {st.label !== 'Achieved' && yLeft > 0 && (
                <div style={{ marginTop: '.45rem', padding: '.32rem .6rem', background: 'var(--bg-muted)', borderRadius: 5, fontSize: '.67rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>📅 Projected</span>
                  {projDate !== null
                    ? <span style={{ fontFamily: "'DM Mono',monospace", color: projDiff > 0 ? '#e07c5a' : '#1d9e75', fontWeight: 500 }}>{projDate} {projDiff > 0 ? `(${projDiff}y late)` : projDiff < 0 ? `(${Math.abs(projDiff)}y early)` : '(on time)'}</span>
                    : <span style={{ color: '#e07c5a' }}>Won't reach at current rate</span>
                  }
                </div>
              )}

              {/* Monthly SIP */}
              {monthly > 0 && (
                <div style={{ marginTop: '.45rem', padding: '.38rem .65rem', background: 'var(--bg-muted)', borderRadius: 5, fontSize: '.68rem', color: 'var(--text-muted)' }}>
                  Monthly SIP: <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text)' }}>₹{monthly.toLocaleString('en-IN')}</span>
                </div>
              )}

              {/* SIP gap banner */}
              {st.label !== 'Achieved' && yLeft > 0 && sipGap > monthly * 0.1 && (
                <div style={{ marginTop: '.4rem', padding: '.32rem .6rem', background: 'rgba(224,124,90,.06)', border: '1px solid rgba(224,124,90,.2)', borderRadius: 5, fontSize: '.67rem', color: '#e07c5a', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Need to close gap</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 500 }}>₹{Math.round(sipNeeded).toLocaleString('en-IN')}/mo</span>
                </div>
              )}

              {/* ── Feature strip: 3 expand buttons ─────────────────────────── */}
              <div style={{ display: 'flex', gap: '.35rem', marginTop: '.7rem' }}>
                {/* 1. What-If SIP */}
                {st.label !== 'Achieved' && yLeft > 0 && (
                  <button onClick={() => setExpandedWhatIf(whatIfExpanded ? null : g.id)}
                    style={{ flex: 1, background: whatIfExpanded ? 'rgba(29,158,117,.1)' : 'none', border: `1px solid ${whatIfExpanded ? 'rgba(29,158,117,.4)' : 'var(--border)'}`, borderRadius: 5, padding: '.28rem .4rem', cursor: 'pointer', fontSize: '.62rem', color: whatIfExpanded ? '#1d9e75' : 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif" }}>
                    🎯 What-If SIP
                  </button>
                )}
                {/* 2. Tax Path */}
                <button onClick={() => setExpandedTaxId(taxExpanded ? null : g.id)}
                  style={{ flex: 1, background: taxExpanded ? 'rgba(160,132,202,.1)' : 'none', border: `1px solid ${taxExpanded ? 'rgba(160,132,202,.4)' : 'var(--border)'}`, borderRadius: 5, padding: '.28rem .4rem', cursor: 'pointer', fontSize: '.62rem', color: taxExpanded ? '#a084ca' : 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif" }}>
                  📋 Tax Path
                </button>
                {/* 3. Holdings drill-down */}
                <button onClick={() => setExpandedGoalId(holdingsExpanded ? null : g.id)}
                  style={{ flex: 1, background: holdingsExpanded ? 'rgba(90,156,224,.08)' : 'none', border: `1px solid ${holdingsExpanded ? 'rgba(90,156,224,.3)' : 'var(--border)'}`, borderRadius: 5, padding: '.28rem .4rem', cursor: 'pointer', fontSize: '.62rem', color: holdingsExpanded ? '#5a9ce0' : 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif" }}>
                  📊 Holdings
                </button>
              </div>

              {/* ── What-If SIP Simulator ─────────────────────────────────── */}
              {whatIfExpanded && (
                <div style={{ marginTop: '.5rem', padding: '.65rem .75rem', background: 'rgba(29,158,117,.05)', border: '1px solid rgba(29,158,117,.2)', borderRadius: 8 }}>
                  <div style={{ fontSize: '.63rem', color: '#1d9e75', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.5rem' }}>🎯 What-If SIP Simulator</div>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.5rem' }}>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>Add extra</span>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '.72rem', color: 'var(--text-muted)' }}>+₹</span>
                      <input type="number" min={0} step={1000}
                        style={{ width: '100%', paddingLeft: 26, paddingRight: 8, paddingTop: 5, paddingBottom: 5, background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: '.75rem', fontFamily: "'DM Mono',monospace" }}
                        placeholder="5000"
                        value={wipSip[g.id] || ''}
                        onChange={e => setWipSip(p => ({ ...p, [g.id]: Math.max(0, +e.target.value) }))}
                      />
                    </div>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>/mo</span>
                  </div>
                  {extra > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.7rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total SIP</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text)' }}>₹{simMonthly.toLocaleString('en-IN')}/mo</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>New projected year</span>
                        {simProjDate !== null
                          ? <span style={{ fontFamily: "'DM Mono',monospace", color: simProjDate <= targetYr ? '#1d9e75' : '#e07c5a', fontWeight: 600 }}>
                              {simProjDate} {simProjDate <= targetYr ? '✓ on time' : `(${simProjDate - targetYr}y late)`}
                            </span>
                          : <span style={{ color: '#e07c5a' }}>Still won't reach</span>
                        }
                      </div>
                      {simStatus && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>New status</span>
                          <span style={{ color: simStatus.color, fontWeight: 600 }}>{simStatus.label}</span>
                        </div>
                      )}
                      {simProjDate && projDate && simProjDate < projDate && (
                        <div style={{ marginTop: '.2rem', padding: '.3rem .5rem', background: 'rgba(29,158,117,.08)', border: '1px solid rgba(29,158,117,.2)', borderRadius: 5, color: '#1d9e75', fontSize: '.68rem' }}>
                          +₹{extra.toLocaleString('en-IN')}/mo saves {projDate - simProjDate} year{projDate - simProjDate !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tax-Optimized Path ─────────────────────────────────────── */}
              {taxExpanded && (
                <div style={{ marginTop: '.5rem', padding: '.65rem .75rem', background: 'rgba(160,132,202,.05)', border: '1px solid rgba(160,132,202,.2)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                    <div>
                      <div style={{ fontSize: '.63rem', color: '#a084ca', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>📋 Tax-Optimised Path</div>
                      <div style={{ fontSize: '.65rem', color: taxPath.color, marginTop: '.15rem' }}>{taxPath.label}</div>
                    </div>
                    {!taxAIText[g.id] && !taxAILoading[g.id] && (
                      <button onClick={() => { setExpandedTaxId(g.id); handleAITaxPath(g, cur, yLeft); }}
                        style={{ background: 'rgba(160,132,202,.12)', border: '1px solid rgba(160,132,202,.3)', color: '#a084ca', borderRadius: 5, padding: '.22rem .55rem', cursor: 'pointer', fontSize: '.62rem', fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>
                        ✦ Get AI advice
                      </button>
                    )}
                  </div>

                  {/* Static instruments */}
                  <ul style={{ paddingLeft: 14, margin: '0 0 .5rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                    {taxPath.instruments.map((ins, i) => (
                      <li key={i} style={{ fontSize: '.68rem', color: 'var(--text)', lineHeight: 1.5 }}>{ins}</li>
                    ))}
                  </ul>
                  <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', lineHeight: 1.5, background: 'var(--bg-muted)', borderRadius: 4, padding: '.3rem .5rem' }}>
                    💡 {taxPath.tip}
                  </div>

                  {/* AI personalised advice */}
                  {(taxAIText[g.id] || taxAILoading[g.id]) && (
                    <div style={{ marginTop: '.6rem', padding: '.55rem .65rem', background: 'var(--bg-muted)', borderRadius: 6, borderLeft: `2px solid #a084ca` }}>
                      <div style={{ fontSize: '.6rem', color: '#a084ca', fontWeight: 600, letterSpacing: '.06em', marginBottom: '.3rem' }}>✦ PERSONALISED AI ADVICE</div>
                      {taxAIText[g.id]
                        ? <StreamingText text={taxAIText[g.id]} loading={taxAILoading[g.id]} />
                        : <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                            <div style={{ width: 11, height: 11, border: '1.5px solid rgba(160,132,202,.3)', borderTopColor: '#a084ca', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            Generating personalised tax strategy…
                          </div>
                      }
                    </div>
                  )}
                </div>
              )}

              {/* ── Holdings drill-down ─────────────────────────────────────── */}
              {holdingsExpanded && (() => {
                const linked = goalHoldings(g);
                return (
                  <div style={{ marginTop: '.5rem', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                    {linked.length === 0
                      ? <div style={{ padding: '.6rem', fontSize: '.68rem', color: 'var(--text-muted)', textAlign: 'center' }}>No holdings linked</div>
                      : linked.slice(0, 8).map(h => {
                          const pct = cur > 0 ? (h._val / cur * 100).toFixed(0) : 0;
                          const a   = AT[h.type] || { icon: '📦', color: '#888' };
                          return (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem .65rem', borderBottom: '1px solid var(--border)', fontSize: '.67rem' }}>
                              <span style={{ color: a.color, width: 14, flexShrink: 0 }}>{a.icon}</span>
                              <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.name}>{h.name}</span>
                              <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text-dim)', flexShrink: 0 }}>{fmtCr(h._val)}</span>
                              <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)', flexShrink: 0, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
                            </div>
                          );
                        })
                    }
                    {linked.length > 8 && (
                      <div style={{ padding: '.35rem .65rem', fontSize: '.65rem', color: 'var(--text-muted)', textAlign: 'center' }}>+{linked.length - 8} more</div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </>
  );
}
