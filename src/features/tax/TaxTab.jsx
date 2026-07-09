/**
 * TaxTab.jsx — LTCG / STCG tax calculator
 *
 * • FY selector (2021-22 → current+1)
 * • Fetches /api/tax/gains?fy=...&member=...
 * • Shows realized STCG / LTCG, estimated tax liability
 * • Shows unrealized position for tax-loss harvesting hints
 * • Per-transaction detail table (collapsible)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabase.js';
import { gainColor, currentFY, fyList, fmtINRCompact as fmtINR } from '../../lib/fmt.js';
import { readSSEStream } from '../../hooks/useStreamAI.js';

// ── sub-components ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '1rem 1.2rem',
    }}>
      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.35rem' }}>{label}</div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.15rem', fontWeight: 700, color: color || 'var(--text)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '.67rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>{sub}</div>}
    </div>
  );
}

function DetailTable({ rows, title, emptyMsg }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) {
    return (
      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', padding: '.5rem 0' }}>{emptyMsg}</div>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--accent)', fontSize: '.75rem', padding: '0',
          marginBottom: open ? '.6rem' : 0,
        }}
      >
        {open ? '▾' : '▸'} {title} ({rows.length} transactions)
      </button>
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.68rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {['Asset', 'Type', 'Buy Date', 'Sell Date', 'Months', 'Units', 'Buy ₹', 'Sell ₹', 'Gain/Loss', 'STCG/LTCG'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '.35rem .5rem', whiteSpace: 'nowrap', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-faint, rgba(255,255,255,.05))' }}>
                  <td style={{ padding: '.35rem .5rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.symbol || r.name}
                  </td>
                  <td style={{ padding: '.35rem .5rem', color: 'var(--text-muted)' }}>{r.type}</td>
                  <td style={{ padding: '.35rem .5rem', fontFamily: "'DM Mono',monospace" }}>{r.buy_date}</td>
                  <td style={{ padding: '.35rem .5rem', fontFamily: "'DM Mono',monospace" }}>{r.sell_date}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right' }}>{r.hold_months}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>
                    {(+r.units).toFixed(3)}
                  </td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>
                    {fmtINR(r.buy_price)}
                  </td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>
                    {fmtINR(r.sell_price)}
                  </td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: gainColor(r.gain) }}>
                    {fmtINR(r.gain)}
                  </td>
                  <td style={{ padding: '.35rem .5rem' }}>
                    <span style={{
                      fontSize: '.65rem', padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                      background: r.is_ltcg ? 'rgba(76,175,154,.15)' : 'rgba(224,124,90,.15)',
                      color: r.is_ltcg ? '#4caf9a' : '#e07c5a',
                    }}>
                      {r.is_ltcg ? 'LTCG' : 'STCG'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UnrealizedTable({ rows }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(p => !p)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '.75rem', padding: 0, marginBottom: open ? '.6rem' : 0 }}
      >
        {open ? '▾' : '▸'} Open positions ({rows.length} lots)
      </button>
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.68rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {['Asset', 'Type', 'Buy Date', 'Months Held', 'Units', 'Cost', 'Current', 'Unrealized', 'Category'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '.35rem .5rem', whiteSpace: 'nowrap', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-faint, rgba(255,255,255,.05))' }}>
                  <td style={{ padding: '.35rem .5rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.symbol || r.name}</td>
                  <td style={{ padding: '.35rem .5rem', color: 'var(--text-muted)' }}>{r.type}</td>
                  <td style={{ padding: '.35rem .5rem', fontFamily: "'DM Mono',monospace" }}>{r.buy_date}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right' }}>{r.hold_months}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>{(+r.units).toFixed(3)}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>{fmtINR(r.buy_price)}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace" }}>{fmtINR(r.current_price)}</td>
                  <td style={{ padding: '.35rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: gainColor(r.gain) }}>{fmtINR(r.gain)}</td>
                  <td style={{ padding: '.35rem .5rem' }}>
                    <span style={{
                      fontSize: '.65rem', padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                      background: r.is_ltcg ? 'rgba(76,175,154,.15)' : 'rgba(224,124,90,.15)',
                      color: r.is_ltcg ? '#4caf9a' : '#e07c5a',
                    }}>
                      {r.is_ltcg ? 'LTCG' : 'STCG'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── AI Tax Strategy streaming panel ────────────────────────────────────────

function AiTaxStrategy({ data, fy }) {
  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const abortRef  = useRef(null);
  const fullRef   = useRef('');

  async function generate() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setText('');
    setOpen(true);
    fullRef.current = '';

    const R = data?.realized;
    const U = data?.unrealized;
    const harvestable = (U?.details || [])
      .filter(d => d.gain < -1000)
      .sort((a, b) => a.gain - b.gain)
      .slice(0, 5);

    const prompt = `You are a concise Indian tax advisor. Write a structured tax strategy for this portfolio — FY ${fy}.

TAX SUMMARY:
- STCG: ₹${(R?.stcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} | Tax @ 20%: ₹${(R?.stcg_tax || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- LTCG: ₹${(R?.ltcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} | Taxable LTCG (after ₹1.25L exemption): ₹${(R?.ltcg_taxable || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} | Tax @ 12.5%: ₹${(R?.ltcg_tax || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Total tax liability: ₹${(R?.total_tax || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- LTCG exemption used: ₹${Math.min(R?.ltcg || 0, 125000).toLocaleString('en-IN', { maximumFractionDigits: 0 })} of ₹1,25,000
- LTCG exemption headroom remaining: ₹${Math.max(0, 125000 - (R?.ltcg || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

HARVEST CANDIDATES (unrealized losses > ₹1000):
${harvestable.length > 0
  ? harvestable.map(d => `  ${d.symbol || d.name} (${d.type}): unrealized loss ₹${Math.abs(d.gain).toLocaleString('en-IN', { maximumFractionDigits: 0 })}, held ${d.hold_months} months`).join('\n')
  : '  None identified'}

UNREALIZED GAINS:
- Unrealized STCG: ₹${(U?.stcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Unrealized LTCG: ₹${(U?.ltcg || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Respond with EXACTLY this structure (no extra headers):

**LTCG Exemption Headroom**
One sentence on how much of the ₹1.25L exemption is left this FY and whether the investor should book more LTCG to use it.

**Tax-Loss Harvest Candidates**
List up to 3 specific holdings to sell to book losses, ranked by impact. If none, say so. Each item: holding name → loss amount → why it makes sense.

**FD Renewal Tax Angle**
One sentence on whether any FD interest this FY pushes the investor into a higher slab and what to consider at renewal.

**3-Step Action Plan**
Numbered list. Three concrete actions to take before 31 March. Be specific — name amounts and asset types.

Keep the entire response under 200 words. No disclaimers.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: 'You are a concise Indian tax advisor. Use markdown bold (**) for section headers only. Be precise and actionable.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `AI error (${res.status})`); }
      await readSSEStream(res, chunk => {
        fullRef.current += chunk;
        setText(fullRef.current);
      }, ctrl.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setText(`⚠ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function renderText(t) {
    // Minimal markdown: **bold** → <strong>
    return t.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={j} style={{ color: '#c9a84c' }}>{p.slice(2, -2)}</strong>
          : p
      );
      return <div key={i} style={{ minHeight: line ? undefined : '.4rem' }}>{parts}</div>;
    });
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div className="ctitle" style={{ marginBottom: '.15rem' }}>✦ AI Tax Strategy</div>
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>LTCG headroom · harvest candidates · FD angle · 3-step plan</div>
        </div>
        <button
          onClick={loading ? () => abortRef.current?.abort() : generate}
          style={{
            fontSize: '.75rem', padding: '.38rem .85rem',
            background: loading ? 'rgba(224,124,90,.12)' : 'rgba(201,168,76,.12)',
            border: `1px solid ${loading ? 'rgba(224,124,90,.35)' : 'rgba(201,168,76,.35)'}`,
            color: loading ? '#e07c5a' : '#c9a84c',
            borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
          }}
        >
          {loading ? '⏹ Stop' : open ? '↻ Regenerate' : '✦ Generate Strategy'}
        </button>
        {open && !loading && (
          <button onClick={() => setOpen(false)}
            style={{ fontSize: '.7rem', padding: '.3rem .6rem', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 5, cursor: 'pointer' }}>
            Hide
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '.9rem', borderTop: '1px solid var(--border)', paddingTop: '.85rem' }}>
          {loading && !text && (
            <div style={{ color: 'var(--text-muted)', fontSize: '.82rem' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>✦</span> Analysing tax position…
            </div>
          )}
          {text && (
            <div style={{ fontSize: '.82rem', color: 'var(--text)', lineHeight: 1.7, fontFamily: "'DM Sans',sans-serif" }}>
              {renderText(text)}
              {loading && <span style={{ opacity: .5 }}> ▋</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function TaxTab({ members = [], selMember = 'all' }) {
  const [fy,      setFy]      = useState(currentFY());
  const [member,  setMember]  = useState('all');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const fys = fyList();

  const fetchGains = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams({ fy, member });
      const r = await fetch(`/api/tax/gains?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      setData(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fy, member]);

  useEffect(() => { fetchGains(); }, [fetchGains]);

  // ── render ───────────────────────────────────────────────────────────────

  const R = data?.realized;
  const U = data?.unrealized;

  // Harvest hint: unrealized losses that could offset gains
  const harvestable = (U?.details || []).filter(d => d.gain < -1000);
  const harvestTotal = harvestable.reduce((s, d) => s + d.gain, 0);

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto' }}>

      {/* ── Header / controls ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          📊 Capital Gains Tax
        </h2>

        {/* FY selector */}
        <select
          className="fi fs"
          value={fy}
          onChange={e => setFy(e.target.value)}
          style={{ fontSize: '.78rem', padding: '.35rem .7rem' }}
        >
          {fys.map(f => (
            <option key={f} value={f}>
              FY {f}
              {f === currentFY() ? ' (current)' : ''}
            </option>
          ))}
        </select>

        {/* Member filter */}
        {members.length > 1 && (
          <select
            className="fi fs"
            value={member}
            onChange={e => setMember(e.target.value)}
            style={{ fontSize: '.78rem', padding: '.35rem .7rem' }}
          >
            <option value="all">All members</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        <button
          className="btn-o"
          onClick={fetchGains}
          disabled={loading}
          style={{ fontSize: '.75rem', padding: '.35rem .7rem' }}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(224,124,90,.12)', border: '1px solid rgba(224,124,90,.3)', borderRadius: 8, padding: '.75rem 1rem', color: '#e07c5a', fontSize: '.8rem', marginBottom: '1rem' }}>
          ⚠ {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem', fontSize: '.85rem' }}>
          Computing gains…
        </div>
      )}

      {data && (
        <>
          {/* ── Disclaimer ─────────────────────────────────────────────── */}
          <div style={{ fontSize: '.67rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '.5rem .8rem', marginBottom: '1rem' }}>
            <strong>Disclaimer:</strong> Estimates only. Based on FIFO lot matching using transaction data. Indian Budget 2024 rates (STCG 20 %, LTCG 12.5 % above ₹1.25 L). Consult your CA before filing ITR.
          </div>

          {/* ── Realized Gains ─────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="ctitle" style={{ marginBottom: '.85rem' }}>Realized Gains — FY {fy}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '.65rem', marginBottom: '1rem' }}>
              <SummaryCard
                label="Short-Term Gains (STCG)"
                value={fmtINR(R?.stcg || 0)}
                sub="< 12 months"
                color={gainColor(R?.stcg)}
              />
              <SummaryCard
                label="Long-Term Gains (LTCG)"
                value={fmtINR(R?.ltcg || 0)}
                sub="≥ 12 months"
                color={gainColor(R?.ltcg)}
              />
              <SummaryCard
                label="LTCG Exemption"
                value={fmtINR(R?.ltcg_exemption || 125000)}
                sub="per FY (Section 112A)"
                color="var(--text-muted)"
              />
              <SummaryCard
                label="Taxable LTCG"
                value={fmtINR(R?.ltcg_taxable || 0)}
                sub="after exemption"
                color={gainColor(R?.ltcg_taxable)}
              />
            </div>

            {/* Tax estimates */}
            <div style={{ background: 'var(--bg-muted)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '.5rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>Estimated Tax</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>STCG @ 20%</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: R?.stcg_tax > 0 ? '#e07c5a' : 'var(--text-muted)' }}>
                    {fmtINR(R?.stcg_tax || 0)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>LTCG @ 12.5%</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: R?.ltcg_tax > 0 ? '#e07c5a' : 'var(--text-muted)' }}>
                    {fmtINR(R?.ltcg_tax || 0)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.88rem', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: '.35rem', marginTop: '.15rem' }}>
                  <span style={{ color: 'var(--text)' }}>Total Tax Liability</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", color: (R?.total_tax || 0) > 0 ? '#e07c5a' : '#4caf9a' }}>
                    {fmtINR(R?.total_tax || 0)}
                  </span>
                </div>
              </div>
            </div>

            <DetailTable
              rows={R?.details || []}
              title="Realized transaction details"
              emptyMsg={`No taxable sell transactions found in FY ${fy}.`}
            />
          </div>

          {/* ── Unrealized / Harvesting ─────────────────────────────────── */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="ctitle" style={{ marginBottom: '.6rem' }}>Unrealized Positions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '.65rem', marginBottom: '1rem' }}>
              <SummaryCard
                label="Unrealized STCG"
                value={fmtINR(U?.stcg || 0)}
                sub="open short-term lots"
                color={gainColor(U?.stcg)}
              />
              <SummaryCard
                label="Unrealized LTCG"
                value={fmtINR(U?.ltcg || 0)}
                sub="open long-term lots"
                color={gainColor(U?.ltcg)}
              />
              {harvestable.length > 0 && (
                <SummaryCard
                  label="Harvest Opportunities"
                  value={fmtINR(harvestTotal)}
                  sub={`${harvestable.length} losing lots to book`}
                  color="#e07c5a"
                />
              )}
            </div>

            {harvestable.length > 0 && (
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', background: 'rgba(76,175,154,.07)', border: '1px solid rgba(76,175,154,.2)', borderRadius: 8, padding: '.6rem .8rem', marginBottom: '.8rem' }}>
                💡 <strong style={{ color: 'var(--text)' }}>Tax-loss harvesting tip:</strong> You have {harvestable.length} lot{harvestable.length > 1 ? 's' : ''} with unrealized losses totalling {fmtINR(Math.abs(harvestTotal))}. Booking these before 31 March can offset your realized gains.
              </div>
            )}

            <UnrealizedTable rows={U?.details || []} />
          </div>

          {/* ── AI Tax Strategy ─────────────────────────────────────────── */}
          <AiTaxStrategy data={data} fy={fy} />

          {/* ── Notes ────────────────────────────────────────────────────── */}
          <div className="card" style={{ fontSize: '.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <div className="ctitle" style={{ marginBottom: '.4rem', fontSize: '.75rem' }}>ℹ Tax Notes</div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
              <li>STCG (equity / equity MF): <strong>20%</strong> for assets held &lt; 12 months (Budget 2024 rate)</li>
              <li>LTCG (equity / equity MF): <strong>12.5%</strong> on gains exceeding ₹1,25,000 (Section 112A)</li>
              <li>Grandfathering (pre-Jan 31, 2018 purchases) is <em>not</em> applied here — consult your CA</li>
              <li>Debt MF gains are taxed as per your slab — not covered here</li>
              <li>Surcharge and cess not included in estimates above</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
