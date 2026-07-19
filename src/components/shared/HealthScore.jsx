/**
 * HealthScore.jsx — Portfolio Health Score widget.
 *
 * Computes a 0–100 composite score across 5 dimensions:
 *   1. Diversification      (30 pts) — # of distinct asset type buckets
 *   2. Goal Coverage        (25 pts) — has emergency fund + retirement goal
 *   3. Concentration Risk   (20 pts) — largest single holding as % of portfolio
 *   4. Equity/Debt Mix      (15 pts) — balanced exposure, not all in one class
 *   5. Positive Returns     (10 pts) — overall portfolio gain
 *
 * Props: allHoldings, byType, totCur, totPct, goals, valINRCache, AT
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const EQUITY_TYPES  = new Set(['IN_STOCK','IN_ETF','MF','US_STOCK','US_ETF','US_BOND','CRYPTO']);
const DEBT_TYPES    = new Set(['FD','PPF','EPF']);

function ScoreRing({ score }) {
  const size = 72;
  const r    = 28;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? '#4caf9a' : score >= 50 ? '#c9a84c' : '#e07c5a';

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={7}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .6s ease' }}
      />
      <text x={size / 2} y={size / 2 + 5}
        textAnchor="middle" fontSize={17} fontWeight={700}
        fill={color} style={{ transform: 'rotate(90deg)', transformOrigin: `${size / 2}px ${size / 2}px` }}
        fontFamily="'DM Mono',monospace"
      >
        {score}
      </text>
    </svg>
  );
}

function DimBar({ label, score, max, tip }) {
  const pct   = Math.round((score / max) * 100);
  const color = pct >= 75 ? '#4caf9a' : pct >= 40 ? '#c9a84c' : '#e07c5a';
  return (
    <div style={{ marginBottom: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem', fontSize: '.7rem' }}>
        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span style={{ color, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{score}/{max}</span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .5s ease' }} />
      </div>
      {tip && <div style={{ fontSize: '.63rem', color: 'var(--text-muted)', marginTop: '.18rem' }}>{tip}</div>}
    </div>
  );
}

export default function HealthScore({ allHoldings = [], byType = [], totCur = 0, totPct = 0, goals = [], valINRCache }) {
  const [open, setOpen] = useState(false);

  if (!allHoldings.length || totCur <= 0) return null;

  // ── 1. Diversification (30 pts) ───────────────────────────────────────────
  // Count distinct "buckets": Equity-India, Equity-US, Debt, FD/PPF/EPF, Real Estate, Cash/Other
  const buckets = new Set();
  for (const row of byType) {
    if (['IN_STOCK','IN_ETF','MF'].includes(row.t))         buckets.add('equity-in');
    else if (['US_STOCK','US_ETF','US_BOND'].includes(row.t)) buckets.add('equity-us');
    else if (['PPF','EPF'].includes(row.t))                  buckets.add('ppf-epf');
    else if (row.t === 'FD')                                 buckets.add('fd');
    else if (row.t === 'REAL_ESTATE')                        buckets.add('real-estate');
    else if (row.t === 'CRYPTO')                             buckets.add('crypto');
    else if (['CASH','OTHER'].includes(row.t))               buckets.add('cash');
  }
  const diversScore = Math.min(30, buckets.size * 6);  // 5 buckets = 30 pts
  const diversTip   = buckets.size < 3 ? 'Add more asset classes to reduce concentration risk' : buckets.size < 5 ? 'Good spread — consider adding real estate or international equity' : 'Excellent diversification';

  // ── 2. Goal Coverage (25 pts) ─────────────────────────────────────────────
  const hasEmergency  = goals.some(g => g.category === 'Emergency Fund' || (g.name||'').toLowerCase().includes('emergency'));
  const hasRetirement = goals.some(g => g.category === 'Retirement'     || (g.name||'').toLowerCase().includes('retirement'));
  const goalScore     = (hasEmergency ? 13 : 0) + (hasRetirement ? 12 : 0);
  const goalTip       = !hasEmergency && !hasRetirement ? 'Add an Emergency Fund and Retirement goal'
    : !hasEmergency ? 'Add an Emergency Fund goal (6× monthly expenses)'
    : !hasRetirement ? 'Add a Retirement Corpus goal'
    : 'Both critical goals are set';

  // ── 3. Concentration Risk (20 pts) ────────────────────────────────────────
  const vals = allHoldings.map(h => {
    const cached = valINRCache?.get ? valINRCache.get(h.id) : valINRCache?.[h.id];
    return cached ?? (+h.current_value || 0);
  });
  const maxVal       = vals.length ? Math.max(...vals) : 0;
  const topPct       = totCur > 0 ? (maxVal / totCur) * 100 : 0;
  // 20 pts for top holding < 10%; deduct proportionally up to 40%+
  const concScore    = topPct <= 10 ? 20 : topPct >= 40 ? 2 : Math.round(20 - ((topPct - 10) / 30) * 18);
  const concTip      = topPct > 25 ? `Largest holding is ${topPct.toFixed(0)}% of portfolio — consider trimming` : topPct > 15 ? `Top holding at ${topPct.toFixed(0)}% — within acceptable range` : `Well spread — top holding is only ${topPct.toFixed(0)}%`;

  // ── 4. Equity / Debt Balance (15 pts) ────────────────────────────────────
  const equityVal = byType.filter(r => EQUITY_TYPES.has(r.t)).reduce((s, r) => s + r.v, 0);
  const debtVal   = byType.filter(r => DEBT_TYPES.has(r.t)).reduce((s, r) => s + r.v, 0);
  const eqPct     = totCur > 0 ? (equityVal / totCur) * 100 : 0;
  // Ideal 40–75% equity; penalise extremes
  const mixScore  = eqPct >= 40 && eqPct <= 75 ? 15 : eqPct >= 25 && eqPct < 40 ? 10 : eqPct > 75 && eqPct <= 90 ? 8 : 4;
  const mixTip    = eqPct > 90 ? `${eqPct.toFixed(0)}% equity — consider adding debt for stability`
    : eqPct < 25 ? `Only ${eqPct.toFixed(0)}% equity — returns may lag inflation`
    : `${eqPct.toFixed(0)}% equity / ${(100 - eqPct).toFixed(0)}% debt — healthy balance`;

  // ── 5. Returns (10 pts) ──────────────────────────────────────────────────
  const retScore = totPct >= 15 ? 10 : totPct >= 8 ? 7 : totPct >= 0 ? 4 : 0;
  const retTip   = totPct < 0 ? 'Portfolio is in loss — review underperforming holdings'
    : totPct < 8 ? 'Returns are below long-term equity average of 12%'
    : totPct < 15 ? 'Solid returns — tracking market performance'
    : 'Excellent returns!';

  const total     = diversScore + goalScore + concScore + mixScore + retScore;
  const grade     = total >= 80 ? 'Excellent' : total >= 60 ? 'Good' : total >= 40 ? 'Fair' : 'Needs work';
  const gradeColor= total >= 80 ? '#4caf9a'  : total >= 60 ? '#c9a84c' : total >= 40 ? '#f0a050' : '#e07c5a';

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.2rem', marginBottom: '1rem' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }} onClick={() => setOpen(p => !p)}>
        <ScoreRing score={total} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Portfolio Health</div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.1rem', fontWeight: 700, color: gradeColor }}>
            {grade}
          </div>
          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.1rem' }}>
            {total}/100 · {buckets.size} asset class{buckets.size !== 1 ? 'es' : ''}
          </div>
        </div>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
          {open ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
        </button>
      </div>

      {/* Expanded dimension breakdown */}
      {open && (
        <div style={{ marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid var(--border)' }}>
          <DimBar label="Diversification"   score={diversScore} max={30} tip={diversTip} />
          <DimBar label="Goal Coverage"     score={goalScore}   max={25} tip={goalTip}   />
          <DimBar label="Concentration"     score={concScore}   max={20} tip={concTip}   />
          <DimBar label="Equity/Debt Mix"   score={mixScore}    max={15} tip={mixTip}    />
          <DimBar label="Portfolio Returns" score={retScore}    max={10} tip={retTip}    />
        </div>
      )}
    </div>
  );
}
