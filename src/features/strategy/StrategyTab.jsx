// StrategyTab.jsx — Strategy, Alerts & Rebalance
// Improvements: AI explain, goal-conflict warnings, FD maturity, goal-behind-schedule,
// per-holding LTCG drill-down, undo-on-delete, inline preset desc, copy plan, SIP redirect hint

import { useState, useMemo, useRef, Fragment } from 'react';
import { supabase } from '../../supabase.js';
import { goalStatusCalc } from '../goals/goalMath.js';
import { readSSEStream } from '../../hooks/useGoalAI.js';

// ─── Tiny utilities ──────────────────────────────────────────────────────────
function daysUntil(d) {
  return d ? Math.round((new Date(d) - new Date()) / 864e5) : null;
}
function heldYears(h) {
  const sd = h.start_date;
  return sd ? (new Date() - new Date(sd)) / (864e5 * 365.25) : null;
}

// ─── Email Digest Button ───────────────────────────────────────────────────────
function EmailDigestButton({ trigAlerts }) {
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState("");

  async function send() {
    if (state === "sending") return;
    setState("sending");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const res = await fetch("/api/alerts/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ trigAlerts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setState("sent");
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setErrMsg(e.message);
      setState("error");
      setTimeout(() => setState("idle"), 5000);
    }
  }

  const label = state === "sending" ? "Sending…" : state === "sent" ? "✓ Sent!" : state === "error" ? `⚠ ${errMsg}` : "📧 Email Digest";
  const clr   = state === "sent" ? "#4caf9a" : state === "error" ? "#e07c5a" : "rgba(224,124,90,.8)";

  return (
    <button onClick={send} disabled={state === "sending"}
      style={{ fontSize: '.65rem', padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
        background: 'rgba(224,124,90,.1)', border: '1px solid rgba(224,124,90,.3)',
        color: clr, fontFamily: "'DM Sans',sans-serif", transition: 'all .2s' }}>
      {label}
    </button>
  );
}

// ─── Alert rule description ───────────────────────────────────────────────────
function alertRuleDesc(a, AT) {
  if (!a) return '';
  if (a.type === 'RETURN_TARGET')    return `Portfolio return below ${a.threshold}% target`;
  if (a.type === 'ALLOCATION_DRIFT') return `${AT[a.assetType]?.label || a.assetType} over ${a.threshold}% of portfolio`;
  if (a.type === 'CONCENTRATION')    return `${AT[a.assetType]?.label || a.assetType} under ${a.threshold}% of portfolio`;
  if (a.type === 'USD_INR_RATE')     return `USD/INR rate above ₹${a.threshold}`;
  return a.label || a.type;
}

// ─── AI streaming explain panel ──────────────────────────────────────────────
function AIExplainPanel({ trades, goals, members, rTotal, rebalMember, AT, fmtCr }) {
  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const abortRef = useRef(null);

  async function explain() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setText('');
    setOpen(true);

    const actionTrades = trades.filter(t => Math.abs(t.delta) >= 500);
    const tradeLines = actionTrades.length > 0
      ? actionTrades.map(t =>
          `  ${AT[t.type]?.label || t.type}: ${t.delta > 0 ? 'Invest' : 'Trim'} ${fmtCr(Math.abs(t.delta))} (current ${t.curPct.toFixed(1)}% → target ${t.tgtPct.toFixed(1)}%)`
        ).join('\n')
      : '  All allocations are already aligned.';

    const goalLines = (goals || []).length > 0
      ? [...goals].sort((a, b) => (a.priority || 99) - (b.priority || 99))
          .map(g => `  P${g.priority || 1} ${g.name}: ₹${(g.targetAmount / 1e5).toFixed(1)}L by ${g.targetDate} [types: ${(g.linkedTypes || []).map(t => AT[t]?.label || t).join(', ') || 'any'}]`)
          .join('\n')
      : '  No goals configured';

    const scopeLabel = rebalMember === 'all'
      ? 'all family members'
      : members.find(m => m.id === rebalMember)?.name || 'selected member';

    const prompt = `You are a concise Indian family wealth advisor. Explain the following rebalance plan in 150–200 words. Cover: why each major move makes sense, what risk it addresses, and one tax note (LTCG/STCG for equity, FD pre-closure penalty if relevant). Be specific with the amounts.

PORTFOLIO: ${scopeLabel} — total ${fmtCr(rTotal)}

REBALANCE ACTIONS:
${tradeLines}

FAMILY GOALS:
${goalLines}

Also mention if any "Trim" action could reduce funding for a goal that uses that asset type. End with a single-sentence takeaway.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/ai/chat/stream', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 600,
          system:     'You are a concise Indian wealth advisor. Plain language, specific numbers, under 220 words.',
          messages:   [{ role: 'user', content: prompt }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(res.statusText);
      setLoading(false);
      await readSSEStream(res, chunk => setText(p => p + chunk), ctrl.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setText(`⚠ ${e.message}`);
      setLoading(false);
    }
  }

  const hasContent = text || loading;

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button
        onClick={hasContent ? () => setOpen(p => !p) : explain}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--accent-2-dim)', border: '1px dashed rgba(160,132,202,.3)',
          borderRadius: open && hasContent ? '8px 8px 0 0' : 8,
          padding: '.5rem .85rem', cursor: 'pointer',
          fontSize: '.72rem', color: 'var(--accent-2)',
        }}>
        <span>
          {loading ? '✦ Analysing plan…' : '✦ Explain this rebalance plan'}
          {!hasContent && <span style={{ fontSize: '.65rem', color: 'rgba(160,132,202,.5)', marginLeft: '.5rem' }}>AI · streaming</span>}
        </span>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {hasContent && !loading && (
            <span onClick={e => { e.stopPropagation(); explain(); }}
              style={{ fontSize: '.65rem', color: 'rgba(160,132,202,.6)', cursor: 'pointer' }}>⟳ Refresh</span>
          )}
          {loading && <div style={{ width: 10, height: 10, border: '1.5px solid rgba(160,132,202,.25)', borderTopColor: 'var(--accent-2)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
          {hasContent && <span style={{ fontSize: '.6rem' }}>{open ? '▲' : '▼'}</span>}
        </div>
      </button>

      {open && hasContent && (
        <div style={{
          padding: '.9rem 1rem', background: 'var(--accent-2-dim)',
          border: '1px solid rgba(160,132,202,.18)', borderTop: 'none',
          borderRadius: '0 0 8px 8px', fontSize: '.78rem', lineHeight: 1.8,
          color: 'var(--text)', whiteSpace: 'pre-wrap',
        }}>
          {text}
          {loading && <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--accent-2)', borderRadius: 1, marginLeft: 2, animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom' }} />}
        </div>
      )}
    </div>
  );
}

// ─── Computed warnings: FD maturity + goals behind schedule ──────────────────
function ComputedWarnings({ allHoldings, valINRCache, goals, AT, fmtCr }) {
  const fdWarnings = useMemo(() => {
    return allHoldings
      .filter(h => h.type === 'FD' && h.maturity_date)
      .map(h => ({ ...h, days: daysUntil(h.maturity_date), val: valINRCache.get(h.id) || 0 }))
      .filter(h => h.days !== null && h.days >= 0 && h.days <= 90)
      .sort((a, b) => a.days - b.days);
  }, [allHoldings, valINRCache]);

  const goalWarnings = useMemo(() => {
    return (goals || [])
      .filter(g => g.targetAmount > 0 && g.targetDate)
      .map(g => {
        const lt  = g.linkedTypes   || [];
        const lm  = g.linkedMembers || ['all'];
        const lh  = new Set(g.linkedHoldingIds || []);
        const mH  = (lm.includes('all') || lm.length === 0) ? allHoldings : allHoldings.filter(h => lm.includes(h.member_id));
        const tS  = new Set(lt);
        const tM  = new Set((lt.length > 0 ? mH.filter(h => tS.has(h.type)) : mH).map(h => h.id));
        const matched = new Set([...tM, ...lh]);
        const cur = allHoldings.filter(h => matched.has(h.id)).reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
        const st  = goalStatusCalc(g, cur);
        const fundedPct = g.targetAmount > 0 ? (cur / g.targetAmount * 100) : 0;
        return { ...g, cur, fundedPct, st };
      })
      .filter(g => g.st.label === 'Behind' || g.st.label === 'At Risk');
  }, [goals, allHoldings, valINRCache]);

  if (fdWarnings.length === 0 && goalWarnings.length === 0) return null;

  return (
    <div style={{ marginBottom: '1.2rem' }}>
      {fdWarnings.length > 0 && (
        <div style={{ marginBottom: '.65rem', padding: '.75rem .9rem', background: 'var(--gold-dim)', border: '1px solid rgba(201,168,76,.25)', borderRadius: 8 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--gold)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
            🏦 FD Maturities
          </div>
          {fdWarnings.map(h => {
            const urgency = h.days <= 14 ? '#e07c5a' : h.days <= 30 ? 'var(--gold)' : 'var(--text-muted)';
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.38rem 0', borderBottom: '1px solid rgba(201,168,76,.1)', fontSize: '.72rem' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text)' }}>{h.name}</span>
                  {h.interest_rate && <span style={{ marginLeft: '.4rem', color: 'var(--text-muted)', fontSize: '.65rem' }}>{h.interest_rate}% p.a.</span>}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: 'var(--text-muted)' }}>{fmtCr(h.val)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: urgency, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
                  {h.days === 0 ? 'Today!' : h.days === 1 ? 'Tomorrow' : `${h.days}d`}
                </span>
              </div>
            );
          })}
          <div style={{ marginTop: '.4rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>
            Plan renewal or redirect into goal-aligned investments before maturity.
          </div>
        </div>
      )}

      {goalWarnings.length > 0 && (
        <div style={{ padding: '.75rem .9rem', background: 'rgba(224,124,90,.05)', border: '1px solid rgba(224,124,90,.2)', borderRadius: 8 }}>
          <div style={{ fontSize: '.68rem', color: '#e07c5a', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
            🎯 Goals Behind Schedule
          </div>
          {goalWarnings.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.38rem 0', borderBottom: '1px solid rgba(224,124,90,.1)', fontSize: '.72rem' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
              <div style={{ flex: 1, color: 'var(--text)' }}>{g.name}</div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: 'var(--text-muted)' }}>
                {g.fundedPct.toFixed(0)}% funded
              </span>
              <span style={{ fontSize: '.65rem', padding: '1px 8px', borderRadius: 8, background: `${g.st.color}15`, border: `1px solid ${g.st.color}33`, color: g.st.color }}>
                {g.st.label}
              </span>
            </div>
          ))}
          <div style={{ marginTop: '.4rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>
            Consider increasing SIP or redirecting from lower-priority goals.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Holdings drill-down for a trade row (LTCG-sorted for trims) ─────────────
function HoldingsDrillDown({ type, rHoldings, valINRCache, invINRCache, fmtCr, isTrim }) {
  const typeH = rHoldings
    .filter(h => h.type === type)
    .map(h => {
      const cur  = valINRCache.get(h.id) || 0;
      const inv  = invINRCache.get(h.id) || 0;
      const gain = inv > 0 ? ((cur - inv) / inv * 100) : 0;
      const yrs  = heldYears(h);
      const ltcg = yrs !== null && yrs >= 1;
      return { ...h, cur, inv, gain, yrs, ltcg };
    })
    .sort((a, b) => {
      if (isTrim) return (b.ltcg ? 1 : 0) - (a.ltcg ? 1 : 0) || b.cur - a.cur;
      return b.cur - a.cur;
    });

  if (typeH.length === 0) {
    return (
      <div style={{ padding: '.5rem .75rem', background: 'var(--bg-muted)', borderTop: '1px solid var(--border)', fontSize: '.68rem', color: 'var(--text-muted)' }}>
        No holdings in this category for the selected scope.
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-muted)', borderTop: '1px solid var(--border)' }}>
      {isTrim && (
        <div style={{ padding: '.3rem .75rem', fontSize: '.65rem', color: 'rgba(76,175,154,.7)', borderBottom: '1px solid var(--border)' }}>
          💡 LTCG-eligible first (held {'>'} 1 yr) — lower tax on equity gains
        </div>
      )}
      {typeH.map((h, i) => (
        <div key={h.id} style={{
          display: 'flex', alignItems: 'center', gap: '.55rem',
          padding: '.35rem .75rem', fontSize: '.68rem',
          borderBottom: i < typeH.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {h.name}
          </div>
          {h.ltcg ? (
            <span style={{ fontSize: '.65rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(76,175,154,.1)', border: '1px solid rgba(76,175,154,.25)', color: '#4caf9a', flexShrink: 0 }}>LTCG</span>
          ) : h.yrs !== null ? (
            <span style={{ fontSize: '.65rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(224,124,90,.1)', border: '1px solid rgba(224,124,90,.2)', color: '#e07c5a', flexShrink: 0 }}>STCG</span>
          ) : null}
          {h.yrs !== null && (
            <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>{h.yrs.toFixed(1)}yr</span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>{fmtCr(h.cur)}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.65rem', color: h.gain >= 0 ? '#4caf9a' : '#e07c5a', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
            {h.gain >= 0 ? '+' : ''}{h.gain.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Strategy presets (module-level — no re-creation on each render) ─────────
const PRESETS = [
  {
    name:   'Conservative',
    risk:   'Low risk',
    equity: 40, debt: 60, alt: 0,
    alloc:  { IN_STOCK:15, MF:20, IN_ETF:5, US_STOCK:0,  US_ETF:0,  US_BOND:5, CRYPTO:0, FD:25, PPF:15, EPF:15, REAL_ESTATE:0 },
  },
  {
    name:   'Balanced',
    risk:   'Medium risk',
    equity: 70, debt: 30, alt: 0,
    alloc:  { IN_STOCK:25, MF:25, IN_ETF:5, US_STOCK:8,  US_ETF:5,  US_BOND:0, CRYPTO:2, FD:10, PPF:10, EPF:10, REAL_ESTATE:0 },
  },
  {
    name:   'Aggressive',
    risk:   'High risk',
    equity: 85, debt: 15, alt: 0,
    alloc:  { IN_STOCK:30, MF:25, IN_ETF:5, US_STOCK:15, US_ETF:5,  US_BOND:0, CRYPTO:5, FD:5,  PPF:5,  EPF:5,  REAL_ESTATE:0 },
  },
  {
    name:   'Global',
    risk:   'Diversified',
    equity: 80, debt: 15, alt: 5,
    alloc:  { IN_STOCK:20, MF:15, IN_ETF:5, US_STOCK:20, US_ETF:15, US_BOND:0, CRYPTO:5, FD:5,  PPF:5,  EPF:5,  REAL_ESTATE:5 },
  },
];

// ════════════════════════════════════════════════════════════════════════════
export default function StrategyTab({
  // Alert data
  alerts, setAlerts, trigAlerts,
  // Portfolio data
  allHoldings, allCur, totPct, members, valINRCache, invINRCache,
  // Goals
  goals,
  // Rebalance controls
  targetAlloc, setTargetAlloc, rebalMember, setRebalMember, rebalCash, setRebalCash,
  // UI state
  showQuietAlerts, setShowQuietAlerts,
  // Modal triggers
  setAlertForm, setModal,
  // Formatting
  fmt, fmtCr, fmtPct,
  // Constants
  AT, BA,
  // Sub-components
  FmtInput,
}) {
  const [undoStack,    setUndoStack]    = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [copiedPlan,   setCopiedPlan]   = useState(false);

  const quietAlerts    = alerts.filter(a => a.active && !trigAlerts.find(t => t.id === a.id));
  const inactiveAlerts = alerts.filter(a => !a.active);

  // ── Rebalance computation ────────────────────────────────────────────────
  const rHoldings     = rebalMember === 'all' ? allHoldings : allHoldings.filter(h => h.member_id === rebalMember);
  const rTotal        = rHoldings.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
  const cash          = +rebalCash || 0;
  const totalWithCash = rTotal + cash;

  const curAlloc = {};
  for (const h of rHoldings) { curAlloc[h.type] = (curAlloc[h.type] || 0) + (valINRCache.get(h.id) || 0); }

  const tSum = Object.values(targetAlloc).reduce((s, v) => s + (+v || 0), 0);
  const normTarget = {};
  for (const [k, v] of Object.entries(targetAlloc)) {
    normTarget[k] = tSum > 0 ? (+v || 0) / tSum * 100 : 0;
  }

  const trades = Object.keys(AT).map(type => {
    const cur    = curAlloc[type] || 0;
    const curPct = rTotal > 0 ? (cur / rTotal) * 100 : 0;
    const tgtPct = normTarget[type] || 0;
    const tgtAmt = totalWithCash * (tgtPct / 100);
    const delta  = tgtAmt - cur;
    return { type, cur, curPct, tgtPct, tgtAmt, delta };
  }).filter(r => r.tgtPct > 0 || r.cur > 0);

  const totalBuy    = trades.filter(t => t.delta > 500).reduce((s, t) => s + t.delta, 0);
  const totalSell   = trades.filter(t => t.delta < -500).reduce((s, t) => s + Math.abs(t.delta), 0);
  const activeTypes = new Set(trades.map(t => t.type));
  const maxPct      = Math.max(...trades.map(x => Math.max(x.curPct, x.tgtPct)), 1);

  const bestRedirect = trades.filter(t => t.delta > 500).sort((a, b) => b.delta - a.delta)[0];

  const typeToGoals = useMemo(() => {
    const map = {};
    (goals || []).forEach(g => {
      (g.linkedTypes || []).forEach(t => {
        if (!map[t]) map[t] = [];
        map[t].push(g);
      });
      (g.linkedHoldingIds || []).forEach(id => {
        const h = allHoldings.find(x => x.id === id);
        if (h && !map[h.type]?.find(x => x.id === g.id)) {
          if (!map[h.type]) map[h.type] = [];
          map[h.type].push(g);
        }
      });
    });
    return map;
  }, [goals, allHoldings]);

  // ── Delete with 5-second undo ─────────────────────────────────────────────
  function deleteAlert(id) {
    const alert = alerts.find(a => a.id === id);
    if (!alert) return;
    setAlerts(p => p.filter(a => a.id !== id));
    const tid = setTimeout(() => setUndoStack(p => p.filter(u => u.alert.id !== id)), 5000);
    setUndoStack(p => [...p, { alert, tid }]);
  }

  function undoDelete(id) {
    const item = undoStack.find(u => u.alert.id === id);
    if (!item) return;
    clearTimeout(item.tid);
    setAlerts(p => [...p, item.alert]);
    setUndoStack(p => p.filter(u => u.alert.id !== id));
  }

  // ── Copy plan as plain text ───────────────────────────────────────────────
  function copyPlanText() {
    const scopeLabel = rebalMember === 'all' ? 'All members' : members.find(m => m.id === rebalMember)?.name;
    const lines = [
      `Rebalance Plan — ${new Date().toLocaleDateString('en-IN')}`,
      `Scope: ${scopeLabel} | Portfolio: ${fmtCr(rTotal)}${cash > 0 ? ` + ${fmtCr(cash)} fresh cash` : ''}`,
      '',
      ...trades
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .map(t => {
          if (Math.abs(t.delta) < 500) return `  ${AT[t.type]?.label || t.type}: ✓ Aligned (${t.curPct.toFixed(1)}%)`;
          return `  ${AT[t.type]?.label || t.type}: ${t.delta > 0 ? '▲ Invest' : '▼ Trim'} ${fmtCr(Math.abs(t.delta))} (${t.curPct.toFixed(1)}% → ${t.tgtPct.toFixed(1)}%)`;
        }),
      '',
      totalBuy  > 0 ? `Total to invest: ${fmtCr(totalBuy)}`  : '',
      totalSell > 0 ? `Total to trim:   ${fmtCr(totalSell)}` : '',
    ].filter(l => l !== undefined).join('\n');
    navigator.clipboard.writeText(lines).then(() => {
      setCopiedPlan(true);
      setTimeout(() => setCopiedPlan(false), 2000);
    });
  }

  function toggleRow(type) {
    setExpandedRows(p => {
      const n = new Set(p);
      n.has(type) ? n.delete(type) : n.add(type);
      return n;
    });
  }

  // ── Mirror current allocation → set target = what you already hold ────────
  function mirrorCurrentAlloc() {
    const mirrored = {};
    for (const [type, val] of Object.entries(curAlloc)) {
      mirrored[type] = rTotal > 0 ? Math.round(val / rTotal * 100) : 0;
    }
    setTargetAlloc(p => ({ ...p, ...mirrored }));
  }

  // ── Clear all target allocations ──────────────────────────────────────────
  function clearAlloc() {
    setTargetAlloc(p => Object.fromEntries(Object.keys(p).map(k => [k, 0])));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ═══ UNDO TOAST ═══ */}
      {undoStack.map(u => (
        <div key={u.alert.id} style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 2000,
          display: 'flex', alignItems: 'center', gap: '.85rem',
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '.6rem 1rem', fontSize: '.72rem',
          color: 'var(--text)', boxShadow: '0 4px 20px rgba(0,0,0,.25)',
        }}>
          <span>Alert deleted</span>
          <button onClick={() => undoDelete(u.alert.id)}
            style={{ background: 'none', border: '1px solid rgba(90,156,224,.4)', color: '#5a9ce0', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
            Undo
          </button>
        </div>
      ))}

      {/* ═══ TAB HEADER ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '.7rem' }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.1rem', color: 'var(--text)' }}>Strategy & Alerts</div>
        <button className="btn-sm" onClick={() => { setAlertForm(BA); setModal('alert'); }}>+ New Alert</button>
      </div>

      {/* ═══ COMPUTED WARNINGS: FD maturity + goal behind schedule ═══ */}
      <ComputedWarnings
        allHoldings={allHoldings}
        valINRCache={valINRCache}
        goals={goals || []}
        AT={AT}
        fmtCr={fmtCr}
      />

      {/* ═══ TRIGGERED ALERTS ═══ */}
      {trigAlerts.length > 0 && (
        <div style={{ marginBottom: '1.2rem', padding: '1rem', borderRadius: 8, background: 'rgba(224,124,90,.06)', border: '1px solid rgba(224,124,90,.25)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: '.7rem' }}>
            <div style={{ fontSize: '.72rem', letterSpacing: '.1em', textTransform: 'uppercase', color: '#e07c5a', fontWeight: 600 }}>
              ⚠ {trigAlerts.length} Alert{trigAlerts.length > 1 ? 's' : ''} Triggered
            </div>
            <EmailDigestButton trigAlerts={trigAlerts} />
          </div>
          {trigAlerts.map(a => {
            const rule   = alerts.find(r => r.id === a.id);
            const curVal = (() => {
              if (!rule || rule.type === 'USD_INR_RATE') return null;
              if (rule.type === 'RETURN_TARGET') return totPct;
              const v = allHoldings.filter(h => h.type === rule.assetType).reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
              return allCur > 0 ? (v / allCur) * 100 : 0;
            })();
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.7rem .85rem', background: 'rgba(224,124,90,.08)', borderRadius: 6, marginBottom: '.4rem', border: '1px solid rgba(224,124,90,.18)' }}>
                <div style={{ fontSize: '1.1rem' }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.82rem', color: '#e07c5a', fontWeight: 500 }}>{a.label}</div>
                  <div style={{ fontSize: '.68rem', color: 'rgba(224,124,90,.65)', marginTop: 2 }}>
                    {alertRuleDesc(rule || a, AT)}
                    {curVal !== null && ` — currently ${curVal.toFixed(1)}%`}
                  </div>
                </div>
                <button className="btn-o" onClick={() => setAlerts(p => p.map(x => x.id === a.id ? { ...x, active: !x.active } : x))}
                  style={{ fontSize: '.65rem', color: 'rgba(224,124,90,.8)' }}>
                  Pause
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ ALERT RULES ═══ */}
      <div style={{ marginBottom: '1.2rem' }}>
        <div style={{ marginBottom: '.7rem' }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.05rem', color: 'var(--text)' }}>Alert Rules</div>
        </div>

        {alerts.length === 0 ? (
          <div className="card" style={{ padding: '1.2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: '.4rem' }}>No alert rules configured</div>
            <div style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>Monitor allocation drift, concentration risk, return targets, or USD/INR rate</div>
          </div>
        ) : (
          <div className="card">
            {/* Triggered (firing) alerts */}
            {alerts.filter(a => a.active && trigAlerts.find(t => t.id === a.id)).map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.55rem .7rem', borderRadius: 5, marginBottom: '.35rem', background: 'rgba(224,124,90,.04)', border: '1px solid rgba(224,124,90,.15)' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#e07c5a', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.78rem', color: '#e07c5a' }}>{a.label}</div>
                  <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{alertRuleDesc(a, AT)}</div>
                </div>
                <button className="btn-o" onClick={() => setAlerts(p => p.map(x => x.id === a.id ? { ...x, active: !x.active } : x))}
                  style={{ fontSize: '.65rem', color: '#4caf9a' }}>Pause</button>
                <button className="delbtn" onClick={() => deleteAlert(a.id)}>✕</button>
              </div>
            ))}

            {/* Quiet / passing alerts */}
            {quietAlerts.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.55rem .7rem', borderRadius: 5, marginBottom: '.35rem', background: 'rgba(76,175,154,.03)', border: '1px solid rgba(76,175,154,.1)' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4caf9a', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.78rem', color: 'var(--text)' }}>{a.label}</div>
                  <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{alertRuleDesc(a, AT)}</div>
                </div>
                <span style={{ fontSize: '.6rem', color: 'rgba(76,175,154,.6)', padding: '2px 7px', borderRadius: 3, background: 'rgba(76,175,154,.08)', border: '1px solid rgba(76,175,154,.15)', flexShrink: 0 }}>✓ Passing</span>
                <button className="btn-o" onClick={() => setAlerts(p => p.map(x => x.id === a.id ? { ...x, active: !x.active } : x))}
                  style={{ fontSize: '.65rem', color: '#4caf9a' }}>Pause</button>
                <button className="delbtn" onClick={() => deleteAlert(a.id)}>✕</button>
              </div>
            ))}

            {/* Paused alerts (collapsible) */}
            {inactiveAlerts.length > 0 && (
              <>
                <div onClick={() => setShowQuietAlerts(p => !p)}
                  style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.45rem .7rem', marginTop: '.3rem', cursor: 'pointer', borderRadius: 5, background: 'var(--bg-muted)' }}>
                  <span style={{ fontSize: '.6rem', color: 'var(--text-muted)', transform: showQuietAlerts ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
                  <span style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>{inactiveAlerts.length} paused rule{inactiveAlerts.length > 1 ? 's' : ''}</span>
                </div>
                {showQuietAlerts && inactiveAlerts.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.45rem .7rem', borderRadius: 5, marginBottom: '.2rem', opacity: .55 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--border)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{a.label}</div>
                      <div style={{ fontSize: '.6rem', color: 'var(--text-muted)', marginTop: 1 }}>{alertRuleDesc(a, AT)}</div>
                    </div>
                    <button className="btn-o" onClick={() => setAlerts(p => p.map(x => x.id === a.id ? { ...x, active: !x.active } : x))}
                      style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>Activate</button>
                    <button className="delbtn" onClick={() => deleteAlert(a.id)}>✕</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ DIVIDER ═══ */}
      <div style={{ height: 1, background: 'var(--bg-muted)', margin: '0.5rem 0 1.2rem' }} />

      {/* ═══ ASSET ALLOCATION HEADER ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.8rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: '1.05rem', color: 'var(--text)' }}>Asset Allocation</div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {rTotal > 0 && (
            <button className="btn-o" onClick={mirrorCurrentAlloc}
              style={{ fontSize: '.65rem' }} title="Set target = your current allocation">
              ↺ Mirror current
            </button>
          )}
          <button className="btn-o" onClick={clearAlloc}
            style={{ fontSize: '.65rem', color: 'var(--text-muted)' }} title="Clear all target percentages">
            ✕ Clear
          </button>
          {rTotal > 0 && (
            <button className="btn-o" onClick={copyPlanText}
              style={{ fontSize: '.65rem', color: copiedPlan ? '#4caf9a' : undefined, transition: 'color .2s' }}>
              {copiedPlan ? '✓ Copied!' : '⎘ Copy plan'}
            </button>
          )}
        </div>
      </div>

      {/* Member selector + Cash */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label className="flbl">Member</label>
          {/* Change 2: fchip / fchip.act replacing inline gold chips */}
          <div className="tbar" style={{ marginTop: '.3rem', marginBottom: 0 }}>
            {['all', ...members.map(m => m.id)].map(id => (
              <div key={id}
                className={`fchip${rebalMember === id ? ' act' : ''}`}
                onClick={() => setRebalMember(id)}>
                {id === 'all' ? 'All' : members.find(m => m.id === id)?.name}
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: '0 0 180px' }}>
          <label className="flbl">Fresh Cash to Deploy</label>
          <FmtInput value={rebalCash} placeholder="e.g. 50000" onChange={e => setRebalCash(e.target.value)} style={{ marginTop: '.3rem' }} />
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Portfolio</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', color: 'var(--text)' }}>{fmtCr(rTotal)}</div>
          {cash > 0 && <div style={{ fontSize: '.65rem', color: 'var(--gold)' }}>+ {fmtCr(cash)} cash</div>}
        </div>
      </div>

      {/* Strategy preset cards — visual with stacked allocation bars */}
      <div style={{ marginBottom: '.5rem' }}>
        <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Strategy Presets</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '.5rem', marginBottom: '.75rem' }}>
          {PRESETS.map(p => (
            <button key={p.name} onClick={() => setTargetAlloc(p.alloc)}
              style={{
                background: 'var(--bg-muted)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '.6rem .75rem', cursor: 'pointer',
                textAlign: 'left', transition: 'border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,.5)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ fontSize: '.75rem', color: 'var(--text)', fontWeight: 600, marginBottom: '.18rem' }}>{p.name}</div>
              <div style={{ fontSize: '.62rem', color: 'var(--text-muted)', marginBottom: '.45rem' }}>{p.risk}</div>
              {/* Stacked mini bar: green = equity, blue = debt, purple = alt */}
              <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', display: 'flex', marginBottom: '.38rem', background: 'var(--border)' }}>
                <div style={{ width: `${p.equity}%`, background: '#4caf9a', transition: 'width .3s' }} />
                <div style={{ width: `${p.debt}%`,   background: '#5a9ce0', transition: 'width .3s' }} />
                {p.alt > 0 && <div style={{ width: `${p.alt}%`, background: '#a084ca', transition: 'width .3s' }} />}
              </div>
              <div style={{ display: 'flex', gap: '.45rem', fontSize: '.62rem' }}>
                <span style={{ color: '#4caf9a' }}>E {p.equity}%</span>
                <span style={{ color: '#5a9ce0' }}>D {p.debt}%</span>
                {p.alt > 0 && <span style={{ color: '#a084ca' }}>A {p.alt}%</span>}
              </div>
            </button>
          ))}
        </div>
        {/* Legend for bar colours */}
        <div style={{ display: 'flex', gap: '.75rem', fontSize: '.6rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><span style={{ width: 8, height: 5, borderRadius: 1, background: '#4caf9a', display: 'inline-block' }} /> Equity</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><span style={{ width: 8, height: 5, borderRadius: 1, background: '#5a9ce0', display: 'inline-block' }} /> Debt</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><span style={{ width: 8, height: 5, borderRadius: 1, background: '#a084ca', display: 'inline-block' }} /> Alt</span>
        </div>
      </div>

      {/* Target % progress bar */}
      {tSum > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.85rem' }}>
          <div style={{ flex: 1, height: 5, background: 'var(--bg-muted)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(tSum, 100)}%`,
              background: Math.abs(tSum - 100) < 0.5 ? '#4caf9a' : tSum > 100 ? '#e07c5a' : 'var(--gold)',
              borderRadius: 3, transition: 'width .3s',
            }} />
          </div>
          <div style={{ fontSize: '.68rem', fontFamily: 'var(--font-mono)', minWidth: 120, textAlign: 'right',
            color: Math.abs(tSum - 100) < 0.5 ? '#4caf9a' : tSum > 100 ? '#e07c5a' : 'var(--gold)' }}>
            {tSum.toFixed(0)}% {Math.abs(tSum - 100) < 0.5
              ? '✓ totals 100'
              : tSum > 100
                ? `— reduce by ${(tSum - 100).toFixed(0)}%`
                : `— add ${(100 - tSum).toFixed(0)}% more`}
          </div>
        </div>
      )}

      {/* Allocation + Drift + Action table */}
      <div className="card" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
        {rTotal === 0 ? (
          <div className="empty">Add holdings to see your allocation plan</div>
        ) : (
          <>
            <table className="ht" style={{ fontSize: '.78rem' }}>
              <thead>
                <tr>
                  <th>Asset Class</th>
                  <th className="r" style={{ width: 90 }}>Target %</th>
                  <th className="r">Current %</th>
                  <th style={{ width: '22%' }}>Drift</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {trades.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map(t => {
                  const at      = AT[t.type] || { icon: '?', label: t.type, color: '#999' };
                  const isFlat  = Math.abs(t.delta) < 500;
                  const isTrim  = t.delta < -500;
                  const isBuy   = t.delta > 500;
                  const isOver  = t.curPct > t.tgtPct + 1;
                  const isUnder = t.curPct < t.tgtPct - 1;
                  const driftPct     = t.curPct - t.tgtPct;
                  const absDelta     = Math.abs(t.delta);
                  const monthlySIP   = absDelta > 5000 ? Math.round(absDelta / 12) : 0;
                  const conflictGoals = isTrim ? (typeToGoals[t.type] || []) : [];
                  const isExpanded   = expandedRows.has(t.type);
                  const showEffPct   = tSum > 0 && Math.abs(tSum - 100) > 0.5 && (normTarget[t.type] || 0) > 0;

                  return (
                    <Fragment key={t.type}>
                      {/* Main row */}
                      <tr
                        style={{ cursor: !isFlat ? 'pointer' : 'default' }}
                        onClick={() => !isFlat && toggleRow(t.type)}
                        title={!isFlat ? 'Click to see individual holdings' : ''}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <span style={{ color: at.color }}>{at.icon}</span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                {at.label}
                                {!isFlat && (
                                  <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
                                )}
                              </div>
                              <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: 1 }}>{fmtCr(t.cur)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="r">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.2rem' }}>
                            <input
                              type="number" min="0" max="100" step="1"
                              value={targetAlloc[t.type] || 0}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setTargetAlloc(p => ({ ...p, [t.type]: +e.target.value }))}
                              style={{ width: 44, textAlign: 'right', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 3, padding: '.18rem .35rem', color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontSize: '.78rem' }}
                            />
                            <span style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>%</span>
                          </div>
                          {showEffPct && (
                            <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
                              ≈{normTarget[t.type].toFixed(0)}% effective
                            </div>
                          )}
                        </td>
                        <td className="r mono" style={{ color: 'var(--text-dim)', fontSize: '.75rem' }}>{t.curPct.toFixed(1)}%</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--bg-muted)', borderRadius: 3, overflow: 'visible', position: 'relative' }}>
                              <div style={{ position: 'absolute', left: `${Math.min(t.tgtPct / maxPct * 100, 100)}%`, top: -1, width: 2, height: 8, background: 'var(--gold-border)', borderRadius: 1, transform: 'translateX(-50%)', zIndex: 2 }} />
                              <div style={{ height: '100%', width: `${Math.min(t.curPct / maxPct * 100, 100)}%`, background: isOver ? `${at.color}cc` : isUnder ? `${at.color}55` : `${at.color}88`, borderRadius: 3, transition: 'width .4s' }} />
                            </div>
                            <span style={{ fontSize: '.6rem', fontFamily: 'var(--font-mono)', minWidth: 40, textAlign: 'right', color: isFlat ? 'var(--text-muted)' : isOver ? '#e07c5a' : '#4caf9a' }}>
                              {isFlat ? '—' : `${driftPct > 0 ? '+' : ''}${driftPct.toFixed(1)}%`}
                            </span>
                          </div>
                        </td>
                        <td className="r">
                          {isFlat ? (
                            <span style={{ color: 'rgba(76,175,154,.6)', fontSize: '.68rem' }}>✓ Aligned</span>
                          ) : isBuy ? (
                            <div>
                              <span style={{ background: 'rgba(76,175,154,.12)', color: '#4caf9a', border: '1px solid rgba(76,175,154,.3)', borderRadius: 4, padding: '3px 8px', fontSize: '.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                ▲ Invest {fmtCr(absDelta)}
                              </span>
                              {monthlySIP > 0 && (
                                <div style={{ fontSize: '.65rem', color: 'rgba(76,175,154,.5)', marginTop: 3 }}>
                                  {absDelta > 50000 ? `SIP ~${fmtCr(monthlySIP)}/mo × 12` : 'lump sum'}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <span style={{ background: 'rgba(224,124,90,.12)', color: '#e07c5a', border: '1px solid rgba(224,124,90,.3)', borderRadius: 4, padding: '3px 8px', fontSize: '.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                ▼ Trim {fmtCr(absDelta)}
                              </span>
                              <div style={{ fontSize: '.65rem', color: 'rgba(224,124,90,.45)', marginTop: 3 }}>
                                {bestRedirect
                                  ? `→ redirect to ${AT[bestRedirect.type]?.label || bestRedirect.type}`
                                  : absDelta > 100000 ? 'redeem or pause SIPs' : 'pause new investments'}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Goal-conflict warning row */}
                      {isTrim && conflictGoals.length > 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: '.3rem .75rem', background: 'var(--gold-dim)', borderBottom: '1px solid rgba(201,168,76,.15)' }}>
                            <span style={{ fontSize: '.65rem', color: 'var(--gold)' }}>
                              ⚠ {at.label} is earmarked by{' '}
                              <strong>{conflictGoals.map(g => g.name).join(', ')}</strong>
                              {' '}— trimming may reduce {conflictGoals.length > 1 ? 'their' : 'its'} funded %.
                            </span>
                          </td>
                        </tr>
                      )}

                      {/* Holdings drill-down */}
                      {isExpanded && !isFlat && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0 }}>
                            <HoldingsDrillDown
                              type={t.type}
                              rHoldings={rHoldings}
                              valINRCache={valINRCache}
                              invINRCache={invINRCache}
                              fmtCr={fmtCr}
                              isTrim={isTrim}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Summary row */}
            <div style={{ marginTop: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
              <div style={{ fontSize: '.72rem', display: 'flex', gap: '1rem' }}>
                {totalBuy  > 0 && <span style={{ color: '#4caf9a' }}>Invest {fmtCr(totalBuy)}</span>}
                {totalSell > 0 && <span style={{ color: '#e07c5a' }}>Trim {fmtCr(totalSell)}</span>}
              </div>
            </div>

            <div style={{ marginTop: '.6rem', fontSize: '.65rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              ℹ️ Click any non-aligned row to see individual holdings. "Trim" = redeem or redirect future SIPs. Selling may have tax implications — consult your CA.
              {cash > 0 && <span style={{ color: 'var(--gold)' }}> Fresh cash of {fmtCr(cash)} is factored into Invest amounts.</span>}
            </div>

            {/* Legend */}
            <div style={{ marginTop: '.5rem', display: 'flex', gap: '.8rem', fontSize: '.6rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><div style={{ width: 8, height: 2, background: 'var(--gold-border)' }} /> Target</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><div style={{ width: 8, height: 6, background: 'rgba(76,175,154,.5)', borderRadius: 1 }} /> Under</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}><div style={{ width: 8, height: 6, background: 'rgba(224,124,90,.5)', borderRadius: 1 }} /> Over</div>
            </div>
          </>
        )}
      </div>

      {/* AI explain panel — below the table so the action area is immediately accessible */}
      {rTotal > 0 && (
        <AIExplainPanel
          trades={trades} goals={goals || []} members={members}
          rTotal={rTotal} rebalMember={rebalMember} AT={AT} fmtCr={fmtCr}
        />
      )}

      {/* Show hidden asset types — Change 5: div → button.btn-sm */}
      {Object.keys(AT).filter(t => !activeTypes.has(t) && (+targetAlloc[t] || 0) === 0).length > 0 && (
        <button
          className="btn-sm"
          style={{ width: '100%' }}
          onClick={() => {
            const missing = Object.keys(AT).filter(t => !activeTypes.has(t) && (+targetAlloc[t] || 0) === 0);
            if (missing.length) setTargetAlloc(p => { const n = { ...p }; missing.forEach(t => n[t] = 0); return n; });
          }}>
          + Show all asset types ({Object.keys(AT).filter(t => !activeTypes.has(t) && (+targetAlloc[t] || 0) === 0).length} hidden)
        </button>
      )}
    </>
  );
}
