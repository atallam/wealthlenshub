/**
 * FDLadderPlanner.jsx — FD Ladder planning tool.
 *
 * User inputs a total investment amount (and optionally adjusts rates).
 * Shows recommended split across 4 tranches (3 / 6 / 12 / 24 months)
 * with maturity schedule and projected interest.
 *
 * Design principle: equal quarterly splits (25% each) as default,
 * with the option to customise. Equal splits maximise rolling liquidity.
 *
 * Used inside CalendarTab as a collapsible section.
 */

import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const DEFAULT_RATES = { 3: 7.0, 6: 7.25, 12: 7.5, 24: 7.75 };
const TENURES = [3, 6, 12, 24];
const TENURE_LABELS = { 3: '3 months', 6: '6 months', 12: '1 year', 24: '2 years' };
const TENURE_COLORS = { 3: '#4caf9a', 6: '#c9a84c', 12: '#5a9ce0', 24: '#a084ca' };

function fmtInr(v) {
  if (!v && v !== 0) return '—';
  return '₹' + Math.round(v).toLocaleString('en-IN');
}

function calcMaturity(principal, annualRate, months) {
  // Quarterly compounding (standard Indian FD)
  const q   = months / 3;
  const r   = annualRate / 100 / 4;
  return principal * Math.pow(1 + r, q);
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FDLadderPlanner({ initialAmount = '' }) {
  const [open,   setOpen]   = useState(!!initialAmount);
  const [amount, setAmount] = useState(initialAmount || '');
  const [rates,  setRates]  = useState(DEFAULT_RATES);
  const [splits, setSplits] = useState({ 3: 25, 6: 25, 12: 25, 24: 25 });

  // When a "Reinvest" button in CalendarTab sets a new initialAmount,
  // update the planner and open it.
  useEffect(() => {
    if (initialAmount) {
      setAmount(String(Math.round(Number(String(initialAmount).replace(/,/g, '')))));
      setOpen(true);
    }
  }, [initialAmount]);

  // Validate splits sum to 100
  const splitTotal = Object.values(splits).reduce((s, v) => s + Number(v || 0), 0);
  const splitOk    = Math.abs(splitTotal - 100) < 0.1;

  const totalAmt = parseFloat(amount.replace(/,/g, '')) || 0;

  const tranches = useMemo(() => {
    if (!totalAmt) return [];
    return TENURES.map(t => {
      const pct       = Number(splits[t]) / 100;
      const principal = totalAmt * pct;
      const rate      = Number(rates[t]);
      const maturity  = calcMaturity(principal, rate, t);
      const interest  = maturity - principal;
      return { tenure: t, principal, rate, maturity, interest, maturityDate: addMonths(new Date(), t) };
    });
  }, [totalAmt, rates, splits]);

  const totalInterest = tranches.reduce((s, tr) => s + tr.interest, 0);

  return (
    <div style={{ marginTop: '1.25rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(p => !p)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
      >
        <div>
          <div style={{ fontSize: '.85rem', color: 'var(--text)', fontWeight: 600 }}>🪜 FD Ladder Planner</div>
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
            Spread investments across tenures for rolling liquidity
          </div>
        </div>
        <span style={{ color: 'var(--text-muted)' }}>
          {open ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 1rem 1rem' }}>
          {/* Amount input */}
          <div style={{ marginBottom: '.85rem' }}>
            <label style={{ fontSize: '.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '.3rem' }}>Total amount to invest (₹)</label>
            <input
              className="fi"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 5,00,000"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Rate + split inputs */}
          <div style={{ marginBottom: '.85rem' }}>
            <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.4rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Tenure configuration
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.4rem .6rem', fontSize: '.72rem', marginBottom: '.3rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tenure</span>
              <span style={{ color: 'var(--text-muted)' }}>Rate (%)</span>
              <span style={{ color: 'var(--text-muted)' }}>Split (%)</span>
            </div>
            {TENURES.map(t => (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.4rem .6rem', alignItems: 'center', marginBottom: '.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.75rem', color: 'var(--text)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: TENURE_COLORS[t], flexShrink: 0, display: 'inline-block' }} />
                  {TENURE_LABELS[t]}
                </div>
                <input
                  className="fi"
                  type="number" step="0.05" min="1" max="15"
                  value={rates[t]}
                  onChange={e => setRates(p => ({ ...p, [t]: e.target.value }))}
                  style={{ padding: '.28rem .5rem', fontSize: '.72rem' }}
                />
                <input
                  className="fi"
                  type="number" step="5" min="0" max="100"
                  value={splits[t]}
                  onChange={e => setSplits(p => ({ ...p, [t]: e.target.value }))}
                  style={{ padding: '.28rem .5rem', fontSize: '.72rem', borderColor: !splitOk ? 'rgba(220,38,38,.5)' : undefined }}
                />
              </div>
            ))}
            {!splitOk && (
              <div style={{ fontSize: '.67rem', color: '#e07c5a', marginTop: '.2rem' }}>
                ⚠ Splits must add up to 100% (currently {splitTotal.toFixed(0)}%)
              </div>
            )}
          </div>

          {/* Results table */}
          {totalAmt > 0 && splitOk && tranches.length > 0 && (
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.5rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Maturity Schedule
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      {['Tenure', 'Principal', 'Rate', 'Matures on', 'Interest', 'Maturity Value'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Tenure' ? 'left' : 'right', padding: '.3rem .4rem', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tranches.map(tr => (
                      <tr key={tr.tenure} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '.35rem .4rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: TENURE_COLORS[tr.tenure], display: 'inline-block', flexShrink: 0 }} />
                          {TENURE_LABELS[tr.tenure]}
                        </td>
                        <td style={{ textAlign: 'right', padding: '.35rem .4rem', fontFamily: "'DM Mono',monospace" }}>{fmtInr(tr.principal)}</td>
                        <td style={{ textAlign: 'right', padding: '.35rem .4rem', color: 'var(--text-muted)' }}>{tr.rate}%</td>
                        <td style={{ textAlign: 'right', padding: '.35rem .4rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{tr.maturityDate}</td>
                        <td style={{ textAlign: 'right', padding: '.35rem .4rem', color: '#4caf9a', fontFamily: "'DM Mono',monospace" }}>+{fmtInr(tr.interest)}</td>
                        <td style={{ textAlign: 'right', padding: '.35rem .4rem', fontFamily: "'DM Mono',monospace", fontWeight: 600, color: 'var(--text)' }}>{fmtInr(tr.maturity)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                      <td style={{ padding: '.4rem .4rem', fontSize: '.72rem', color: 'var(--text)' }}>Total</td>
                      <td style={{ textAlign: 'right', padding: '.4rem .4rem', fontFamily: "'DM Mono',monospace" }}>{fmtInr(totalAmt)}</td>
                      <td />
                      <td />
                      <td style={{ textAlign: 'right', padding: '.4rem .4rem', color: '#4caf9a', fontFamily: "'DM Mono',monospace" }}>+{fmtInr(totalInterest)}</td>
                      <td style={{ textAlign: 'right', padding: '.4rem .4rem', fontFamily: "'DM Mono',monospace" }}>{fmtInr(totalAmt + totalInterest)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Tip */}
              <div style={{ marginTop: '.75rem', padding: '.55rem .75rem', background: 'rgba(201,168,76,.06)', border: '1px solid rgba(201,168,76,.18)', borderRadius: 8, fontSize: '.68rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                💡 <strong style={{ color: 'var(--text)' }}>Ladder tip:</strong> When the 3-month FD matures, reinvest at the longest available tenor. This keeps one tranche maturing every quarter for liquidity while maximising returns.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
