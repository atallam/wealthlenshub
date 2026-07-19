import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabase.js';
// Shared math — avoids circular dep with GoalsTab.jsx
import { goalStatusCalc, goalCagr } from '../../features/goals/goalMath.js';
import { readSSEStream } from '../../hooks/useGoalAI.js';

/* ══════════════════════════════════════════════
   GOAL PLAN MODAL — AI-generated goal fulfillment plan
   Extracted from App.jsx lines 6189–6344
══════════════════════════════════════════════ */

/**
 * GoalPlanModal
 * Props:
 *   open       — boolean
 *   onClose    — () => void
 *   goals      — goal array
 *   members    — member array
 *   holdings   — holdings array
 *   allCur     — total current value (INR)
 *   allInv     — total invested value (INR)
 *   AT         — asset type map
 *   getValINR  — (holding) => number
 *   usdInr     — live USD/INR rate (number)
 */
export default function GoalPlanModal({ open, onClose, goals, members, holdings, allCur, allInv, AT, getValINR, usdInr = 84 }) {
  const [loading, setLoading] = useState(false);
  const [plan,    setPlan]    = useState('');
  const [error,   setError]   = useState('');
  const abortRef = useRef(null);

  // ── Formatting using live FX rate ────────────────────────────────────────
  const fmtINR = n => '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const fmtCr  = n => {
    const a = Math.abs(n);
    if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `₹${(a / 1e5).toFixed(1)}L`;
    return fmtINR(n);
  };

  function goalCurVal(g) {
    const lt = g.linkedTypes    || [];
    const lm = g.linkedMembers  || ['all'];
    const lh = new Set(g.linkedHoldingIds || []);
    const memberH = lm.includes('all') || lm.length === 0
      ? holdings
      : holdings.filter(h => lm.includes(h.member_id));
    const typeSet = new Set(lt);
    const typeMatched = new Set(
      (lt.length > 0 ? memberH.filter(h => typeSet.has(h.type)) : memberH).map(h => h.id)
    );
    const matched = new Set([...typeMatched, ...lh]);
    return holdings
      .filter(h => matched.has(h.id))
      .reduce((s, h) => s + getValINR(h), 0);
  }

  useEffect(() => {
    if (!open) { setPlan(''); setError(''); return; }
    generate();
    return () => abortRef.current?.abort();
  }, [open]);

  async function generate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setPlan('');
    setError('');

    const sorted = [...goals].sort((a, b) => (a.priority || 99) - (b.priority || 99));

    const goalDetails = sorted.map((g, i) => {
      const cur    = goalCurVal(g);
      const pct    = g.targetAmount > 0 ? (cur / g.targetAmount * 100).toFixed(1) : 0;
      const rem    = Math.max(0, g.targetAmount - cur);
      const yLeft  = ((Math.max(0, new Date(g.targetDate) - new Date())) / (864e5 * 365.25)).toFixed(1);
      const lm     = g.linkedMembers || ['all'];
      const mNames = lm.includes('all') ? 'all family members' : lm.map(id => members.find(m => m.id === id)?.name || '?').join(', ');
      const lh     = g.linkedTypes || [];
      const linkedDetail = lh.length > 0 ? ` | Asset types: ${lh.map(t => AT[t]?.label || t).join(', ')}` : '';
      const cagr = (goalCagr(g.linkedTypes) * 100).toFixed(1);
      return `${i + 1}. ${g.name} [Priority ${g.priority || i + 1}] — Category: ${g.category} | Target: ${fmtCr(g.targetAmount)} by ${g.targetDate} | Current: ${fmtCr(cur)} (${pct}%) | Remaining: ${fmtCr(rem)} | Time left: ${yLeft}y | Expected CAGR: ${cagr}% p.a. (based on linked asset types) | Linked to: ${mNames}${g.monthlyContribution > 0 ? ` | Monthly SIP: ₹${(+g.monthlyContribution).toLocaleString('en-IN')}` : ''}${linkedDetail}`;
    }).join('\n');

    const memberBreakdown = members.map(m => {
      const mCur = holdings.reduce((s, h) => h.member_id === m.id ? s + getValINR(h) : s, 0);
      return `  ${m.name} (${m.relation}): ${fmtCr(mCur)}`;
    }).join('\n');

    const prompt = `You are a wealth advisor for an Indian family. Analyse their financial goals and provide a clear, prioritised fulfillment plan.

FAMILY PORTFOLIO SUMMARY:
- Total portfolio value: ${fmtCr(allCur)}
- Total invested: ${fmtCr(allInv)}
- Unrealised gain: ${fmtCr(allCur - allInv)}

MEMBER PORTFOLIOS:
${memberBreakdown}

GOALS (sorted by priority):
${goalDetails}

Please provide:
1. A brief assessment of each goal's feasibility given current portfolio and time horizon
2. A recommended monthly SIP allocation strategy across goals (if multiple goals compete for funds)
3. Specific action items for the top 3 priority goals
4. Any goals that are at risk of not being met and what corrective action to take
5. A summary recommendation on goal prioritisation

Keep the response practical, specific to the numbers, and formatted clearly with headings. Use Indian number formatting (Lakhs/Crores).`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/ai/chat/stream', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 2000,
          system:     'You are a concise, practical Indian family wealth advisor. Format with clear sections. Be specific with numbers.',
          messages:   [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`AI request failed: ${res.statusText}`);

      setLoading(false); // spinner off — text will start flowing

      await readSSEStream(res, chunk => setPlan(p => p + chunk), controller.signal);

    } catch (e) {
      if (e.name === 'AbortError') return;
      setError(e.message);
      setLoading(false);
    }
  }

  if (!open) return null;

  const sorted = [...goals].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  return (
    <div className="ovl" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mod" style={{ maxWidth: 700 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.2rem' }}>
          <div>
            <div className="modtitle" style={{ marginBottom:'.15rem' }}>✦ Goal Fulfillment Plan</div>
            <div style={{ fontSize:'.72rem', color:'var(--text)' }}>
              AI-powered analysis of your {goals.length} goal{goals.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ display:'flex', gap:'.4rem' }}>
            <button onClick={generate} disabled={loading}
              style={{ background:'rgba(160,132,202,.12)', border:'1px solid rgba(160,132,202,.3)', color:'#a084ca', borderRadius:5, padding:'.28rem .65rem', cursor:'pointer', fontSize:'.68rem', fontFamily:"'DM Sans',sans-serif", opacity: loading ? 0.5 : 1 }}>
              {loading ? '…' : '⟳ Refresh'}
            </button>
            <button className="delbtn" style={{ fontSize:'1rem' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Goal priority chips */}
        <div style={{ display:'flex', gap:'.4rem', flexWrap:'wrap', marginBottom:'1rem' }}>
          {sorted.map((g, i) => (
            <div key={g.id} style={{ display:'flex', alignItems:'center', gap:'.35rem', padding:'.28rem .65rem', background:`${g.color}14`, border:`1px solid ${g.color}44`, borderRadius:12, fontSize:'.68rem', color:g.color }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:g.color }}/>
              P{g.priority || i + 1} {g.name}
            </div>
          ))}
        </div>

        {/* Summary table — uses same goalStatusCalc as GoalsTab */}
        {(() => {
          // Detect double-allocated types for warning in table
          const typeGoalMap = {};
          sorted.forEach(g => (g.linkedTypes || []).forEach(t => {
            if (!typeGoalMap[t]) typeGoalMap[t] = [];
            typeGoalMap[t].push(g.id);
          }));
          const doubledTypes = new Set(
            Object.entries(typeGoalMap).filter(([, ids]) => ids.length > 1).map(([t]) => t)
          );
          // Which goal IDs have at least one doubled type
          const doubledGoalIds = new Set(
            sorted.filter(g => (g.linkedTypes || []).some(t => doubledTypes.has(t))).map(g => g.id)
          );

          return (
            <>
              {doubledGoalIds.size > 0 && (
                <div style={{ marginBottom:'.6rem', padding:'.4rem .75rem', background:'rgba(224,124,90,.06)', border:'1px solid rgba(224,124,90,.2)', borderRadius:6, fontSize:'.68rem', color:'#e07c5a', display:'flex', alignItems:'center', gap:'.5rem' }}>
                  <span>⚠</span>
                  <span>Goals marked <strong>⚠</strong> share asset types — funded % may be inflated. See Goals tab for details.</span>
                </div>
              )}
              <div style={{ marginBottom:'1rem', overflowX:'auto', border:'1px solid var(--border)', borderRadius:6 }}>
                <table style={{ width:'100%', fontSize:'.7rem', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--border)' }}>
                      {['Goal', 'Status', 'Funded', 'Gap', 'Monthly Needed'].map(h => (
                        <th key={h} style={{ padding:'.4rem .55rem', textAlign:'left', color:'var(--text)', fontWeight:500, fontSize:'.6rem', letterSpacing:'.06em', textTransform:'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(g => {
                      const cur           = goalCurVal(g);
                      const rem           = Math.max(0, g.targetAmount - cur);
                      const yLeft         = Math.max(0.1, (new Date(g.targetDate) - new Date()) / (864e5 * 365.25));
                      const monthlyNeeded = rem / (yLeft * 12);
                      const pct           = g.targetAmount > 0 ? (cur / g.targetAmount * 100) : 0;
                      const st            = goalStatusCalc(g, cur);
                      const isDoubled     = doubledGoalIds.has(g.id);
                      return (
                        <tr key={g.id} style={{ borderBottom:'1px solid var(--border)', background: isDoubled ? 'rgba(224,124,90,.03)' : '' }}>
                          <td style={{ padding:'.4rem .55rem', color:g.color, fontWeight:500 }}>
                            {g.name}
                            {isDoubled && <span title="Funded % may be inflated — shares asset types with another goal" style={{ marginLeft:5, color:'#e07c5a', fontSize:'.7rem' }}>⚠</span>}
                          </td>
                          <td style={{ padding:'.4rem .55rem' }}>
                            <span style={{ color:st.color, fontSize:'.65rem', background:`${st.color}15`, border:`1px solid ${st.color}33`, borderRadius:8, padding:'1px 7px' }}>{st.label}</span>
                          </td>
                          <td style={{ padding:'.4rem .55rem', fontFamily:"'DM Mono',monospace", color: isDoubled && pct > 100 ? '#e07c5a' : 'inherit' }}>
                            {pct.toFixed(0)}%{isDoubled && pct > 80 && <span style={{ fontSize:'.6rem', marginLeft:3, color:'#e07c5a' }}>*</span>}
                          </td>
                          <td style={{ padding:'.4rem .55rem', fontFamily:"'DM Mono',monospace" }}>{fmtCr(rem)}</td>
                          <td style={{ padding:'.4rem .55rem', fontFamily:"'DM Mono',monospace" }}>₹{Math.round(monthlyNeeded).toLocaleString('en-IN')}/mo</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {doubledGoalIds.size > 0 && (
                  <div style={{ padding:'.3rem .55rem', fontSize:'.65rem', color:'var(--text-muted)', borderTop:'1px solid var(--border)' }}>
                    * Funded % marked with ⚠ may be overstated due to shared asset types
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Plan content — streaming-aware */}
        <div style={{ background:'rgba(160,132,202,.04)', border:'1px solid rgba(160,132,202,.14)', borderRadius:8, padding:'1rem 1.2rem', maxHeight:440, overflowY:'auto', minHeight:180, display:'flex', alignItems: loading && !plan ? 'center' : 'flex-start', justifyContent: loading && !plan ? 'center' : 'flex-start' }}>
          {loading && !plan && (
            <div style={{ textAlign:'center' }}>
              <div style={{ width:28, height:28, border:'2px solid rgba(160,132,202,.2)', borderTopColor:'#a084ca', borderRadius:'50%', animation:'spin 1s linear infinite', margin:'0 auto .75rem' }}/>
              <div style={{ fontSize:'.78rem', color:'var(--text)' }}>Analysing your goals…</div>
            </div>
          )}
          {error && <div style={{ color:'#e07c5a', fontSize:'.8rem' }}>⚠ {error}</div>}
          {plan && (
            <div style={{ fontSize:'.8rem', lineHeight:1.75, color:'var(--text)', whiteSpace:'pre-wrap', width:'100%' }}>
              {plan}
              {loading && <span style={{ display:'inline-block', width:8, height:14, background:'#a084ca', borderRadius:1, marginLeft:2, animation:'blink 1s step-end infinite', verticalAlign:'text-bottom' }}/>}
            </div>
          )}
        </div>

        <div style={{ marginTop:'.75rem', textAlign:'right' }}>
          <button className="btnc" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
