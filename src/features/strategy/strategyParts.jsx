import { goalStatusCalc } from "../goals/goalMath.js";
import { readSSEStream } from "../../hooks/useGoalAI.js";
import { supabase } from "../../supabase.js";
import { useMemo, useRef, useState } from "react";

export // ─── Tiny utilities ──────────────────────────────────────────────────────────
function daysUntil(d) {
  return d ? Math.round((new Date(d) - new Date()) / 864e5) : null;
}
export function heldYears(h) {
  const sd = h.start_date;
  return sd ? (new Date() - new Date(sd)) / (864e5 * 365.25) : null;
}

export // ─── Email Digest Button ───────────────────────────────────────────────────────
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

export // ─── Alert rule description ───────────────────────────────────────────────────
function alertRuleDesc(a, AT) {
  if (!a) return '';
  if (a.type === 'RETURN_TARGET')    return `Portfolio return below ${a.threshold}% target`;
  if (a.type === 'ALLOCATION_DRIFT') return `${AT[a.assetType]?.label || a.assetType} over ${a.threshold}% of portfolio`;
  if (a.type === 'CONCENTRATION')    return `${AT[a.assetType]?.label || a.assetType} under ${a.threshold}% of portfolio`;
  if (a.type === 'USD_INR_RATE')     return `USD/INR rate above ₹${a.threshold}`;
  return a.label || a.type;
}

export // ─── AI streaming explain panel ──────────────────────────────────────────────
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

export // ─── Computed warnings: FD maturity + goals behind schedule ──────────────────
function ComputedWarnings({ allHoldings, valINRCache, goals, fmtCr }) {
  const fdWarnings = useMemo(() => {
    return allHoldings
      .filter(h => h.type === 'FD' && h.maturity_date && (h.maturity_status || 'active') === 'active')
      .map(h => ({ ...h, days: daysUntil(h.maturity_date), val: valINRCache.get(h.id) || 0 }))
      // days < 0 = already matured and still unresolved — the most urgent case, listed first
      .filter(h => h.days !== null && h.days <= 90)
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
            const matured = h.days < 0;
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.38rem 0', borderBottom: '1px solid rgba(201,168,76,.1)', fontSize: '.72rem' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text)' }}>{h.name}</span>
                  {h.interest_rate && <span style={{ marginLeft: '.4rem', color: 'var(--text-muted)', fontSize: '.65rem' }}>{h.interest_rate}% p.a.</span>}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: 'var(--text-muted)' }}>{fmtCr(h.val)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: urgency, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
                  {matured ? `Matured ${-h.days}d ago` : h.days === 0 ? 'Today!' : h.days === 1 ? 'Tomorrow' : `${h.days}d`}
                </span>
              </div>
            );
          })}
          <div style={{ marginTop: '.4rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>
            {fdWarnings.some(h => h.days < 0)
              ? 'Matured FDs are idle money — go to Holdings to renew, convert to cash, or close them.'
              : 'Plan renewal or redirect into goal-aligned investments before maturity.'}
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

export // ─── Holdings drill-down for a trade row (LTCG-sorted for trims) ─────────────
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

export // ─── Strategy presets (module-level — no re-creation on each render) ─────────
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
