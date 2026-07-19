// CalendarTab.jsx — Financial Events Calendar

import { useState } from 'react';
import FDLadderPlanner from '../../components/shared/FDLadderPlanner.jsx';

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const FILTER_TYPES = ['All','SIP','FD','Tax','Insurance','Goal','PPF'];

// Maps an event type string → filter chip key
function getFilterKey(type) {
  if (type === 'SIP')                                       return 'SIP';
  if (type === 'FD Maturity' || type === 'Policy Maturity') return 'FD';
  if (type === 'Insurance')                                 return 'Insurance';
  if (type === 'Tax' || type === '80C')                     return 'Tax';
  if (type === 'Goal')                                      return 'Goal';
  if (type === 'PPF')                                       return 'PPF';
  return null;
}

function fmtCr(v) {
  if (!v && v !== 0) return '—';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarTab({ holdings, goals, calMonth, setCalMonth }) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const [calY, calMo] = calMonth.split('-').map(Number);
  const firstDay    = new Date(calY, calMo - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calY, calMo, 0).getDate();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [expandedDay,    setExpandedDay]    = useState(null);   // "YYYY-MM-DD"
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [yearPickerY,    setYearPickerY]    = useState(calY);
  const [upcomingDays,   setUpcomingDays]   = useState(60);
  const [upcomingFilter, setUpcomingFilter] = useState('All');
  const [ladderAmount,   setLadderAmount]   = useState('');

  // ── Build events ──────────────────────────────────────────────────────────
  const events = {}; // "YYYY-MM-DD" → [{type, label, color, icon, amount?}]
  const addEvent = (date, ev) => {
    if (!date) return;
    const d = date.slice(0, 10);
    if (!events[d]) events[d] = [];
    events[d].push(ev);
  };

  const viewMonthStr = `${calY}-${String(calMo).padStart(2, '0')}`;
  const nowMonthStr  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let monthInflows = 0, monthSIPOut = 0, monthPremiumOut = 0;

  for (const h of holdings) {
    // FD maturity
    if (h.type === 'FD' && h.maturity_date) {
      const dLeft   = Math.ceil((new Date(h.maturity_date) - now) / 864e5);
      const fdColor = dLeft > 90 ? '#4caf9a' : dLeft > 30 ? '#f0a050' : '#e07c5a';
      const fdLabel = `${h.name}${h.interest_rate ? ` · ${h.interest_rate}%` : ''}`;
      const fdAmt   = +(h.current_value || h.invested_value || 0);
      addEvent(h.maturity_date, { type: 'FD Maturity', label: fdLabel, color: fdColor, icon: '🏦', amount: fdAmt });
      if (h.maturity_date.slice(0, 7) === viewMonthStr) monthInflows += fdAmt;
    }

    // Insurance: policy maturity + recurring premium
    if (h.type === 'INSURANCE' && h.start_date) {
      if (h.maturity_date)
        addEvent(h.maturity_date, { type: 'Policy Maturity', label: h.name, color: '#e07b8c', icon: '🛡️' });

      const freqMap = { ANNUAL: 12, SEMI: 6, QUARTERLY: 3, MONTHLY: 1 };
      const monthInterval = freqMap[h.premium_frequency || h.ticker || 'ANNUAL'] || 12;
      const startDt    = new Date(h.start_date);
      const startAbsMo = startDt.getFullYear() * 12 + startDt.getMonth();
      const viewAbsMo  = calY * 12 + (calMo - 1);
      const diff       = viewAbsMo - startAbsMo;

      if (diff > 0 && diff % monthInterval === 0) {
        const premDay   = Math.min(startDt.getDate(), new Date(calY, calMo, 0).getDate());
        const d         = `${calY}-${String(calMo).padStart(2,'0')}-${String(premDay).padStart(2,'0')}`;
        const premAmt   = +(h.premium || h.interest_rate) || 0;
        const premLabel = `${h.name.length > 22 ? h.name.slice(0, 22) + '...' : h.name}${premAmt ? ` (₹${Math.round(premAmt / 1000)}K)` : ''}`;
        addEvent(d, { type: 'Insurance', label: premLabel, color: '#e07b8c', icon: '🛡️' });
        monthPremiumOut += premAmt;
      }
    }

    // Active SIPs (only future/current months)
    if (h.type === 'MF' && h.sip_active && h.sip_day) {
      if (viewMonthStr >= nowMonthStr) {
        const daysInCalMo = new Date(calY, calMo, 0).getDate();
        const day = Math.min(h.sip_day, daysInCalMo);
        const ds  = `${calY}-${String(calMo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const avgAmt = h.sip_avg_amount || 0;
        const lbl    = `${h.name.length > 22 ? h.name.slice(0, 22) + '...' : h.name}${avgAmt ? ` (₹${Math.round(avgAmt / 1000)}K)` : ''}`;
        addEvent(ds, { type: 'SIP', label: lbl, color: '#4caf9a', icon: '📈' });
        monthSIPOut += avgAmt;
      }
    }
  }

  // Goal target dates
  for (const g of goals) {
    if (g.targetDate)
      addEvent(g.targetDate, { type: 'Goal', label: g.name, color: g.color || '#c9a84c', icon: '🎯' });
  }

  // Indian financial calendar — fixed annual events
  const finCalendar = [
    { mo: 3,  d: 31, label: 'FY End — File ITR / Last date for 80C investments', color: '#e07c5a', icon: '📋', type: 'Tax' },
    { mo: 7,  d: 31, label: 'ITR Filing Deadline (non-audit)',                    color: '#e07c5a', icon: '📋', type: 'Tax' },
    { mo: 9,  d: 15, label: 'Advance Tax Q2 (45%)',                               color: '#e07c5a', icon: '📋', type: 'Tax' },
    { mo: 12, d: 15, label: 'Advance Tax Q3 (75%)',                               color: '#e07c5a', icon: '📋', type: 'Tax' },
    { mo: 3,  d: 15, label: 'Advance Tax Q4 (100%)',                              color: '#e07c5a', icon: '📋', type: 'Tax' },
    { mo: 4,  d: 5,  label: 'PPF — Deposit before 5th for full month interest',   color: '#a084ca', icon: '💰', type: 'PPF' },
    { mo: 3,  d: 31, label: 'PPF Annual Contribution Deadline',                   color: '#a084ca', icon: '💰', type: 'PPF' },
    { mo: 3,  d: 31, label: 'ELSS / 80C — Last date for tax-saving investments',  color: '#5a9ce0', icon: '📑', type: '80C' },
  ];
  for (const e of finCalendar) {
    if (e.mo === calMo) {
      const d = `${calY}-${String(e.mo).padStart(2,'0')}-${String(e.d).padStart(2,'0')}`;
      addEvent(d, { type: e.type, label: e.label, color: e.color, icon: e.icon });
    }
  }

  // ── Upcoming list ─────────────────────────────────────────────────────────
  const upcoming = [];
  const cutoff   = new Date(Date.now() + upcomingDays * 864e5);
  for (const [d, evs] of Object.entries(events)) {
    const dt = new Date(d);
    if (dt >= now && dt <= cutoff) evs.forEach(e => upcoming.push({ date: d, ...e }));
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // Filter counts for chip badges
  const filterCounts = { All: upcoming.length };
  for (const e of upcoming) {
    const k = getFilterKey(e.type);
    if (k) filterCounts[k] = (filterCounts[k] || 0) + 1;
  }

  const filteredUpcoming = upcomingFilter === 'All'
    ? upcoming
    : upcoming.filter(e => getFilterKey(e.type) === upcomingFilter);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isToday  = (y, m, d) =>
    `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` === todayStr;
  const cellDate = (d) =>
    `${calY}-${String(calMo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const monthName = new Date(calY, calMo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const DAYS      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const goToday = () =>
    setCalMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`);
  const prevMo = () => {
    let m = calMo - 1, y = calY;
    if (m < 1) { m = 12; y--; }
    setCalMonth(`${y}-${String(m).padStart(2,'0')}`);
  };
  const nextMo = () => {
    let m = calMo + 1, y = calY;
    if (m > 12) { m = 1; y++; }
    setCalMonth(`${y}-${String(m).padStart(2,'0')}`);
  };

  const jumpToLadder = (amt) => {
    setLadderAmount(String(Math.round(amt)));
    setTimeout(() => document.getElementById('fd-ladder')?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  const showCashFlow = monthInflows > 0 || monthSIPOut > 0 || monthPremiumOut > 0;
  const netCashFlow  = monthInflows - monthSIPOut - monthPremiumOut;

  // Shared modal overlay style
  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1rem',
  };
  const boxStyle = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '1.25rem',
    width: '100%', maxWidth: 380, maxHeight: '80vh', overflowY: 'auto',
  };
  const navBtnStyle = {
    background: 'var(--bg-muted)', border: '1px solid var(--border)',
    color: 'var(--text-dim)', borderRadius: 5,
    padding: '.25rem .55rem', cursor: 'pointer',
    fontSize: '.9rem', minHeight: 36, minWidth: 36, flexShrink: 0,
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Day-expand modal ─────────────────────────────────────────────── */}
      {expandedDay && (
        <div style={overlayStyle} onClick={() => setExpandedDay(null)}>
          <div style={boxStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem' }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1rem', color:'var(--text)' }}>
                {new Date(expandedDay + 'T12:00:00').toLocaleDateString('en-IN',
                  { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
              </div>
              <button
                onClick={() => setExpandedDay(null)}
                style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem', lineHeight:1, padding:'.1rem .4rem' }}
              >×</button>
            </div>

            {(events[expandedDay] || []).map((e, i) => (
              <div key={i} style={{ display:'flex', gap:'.65rem', padding:'.6rem 0', borderBottom:'1px solid var(--border)', alignItems:'flex-start' }}>
                <div style={{ fontSize:'1.1rem', flexShrink:0, marginTop:'.1rem' }}>{e.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'.8rem', color:'var(--text)', lineHeight:1.45 }}>{e.label}</div>
                  <div style={{ fontSize:'.67rem', color:e.color, marginTop:'.2rem' }}>{e.type}</div>
                </div>
                {e.type === 'FD Maturity' && e.amount > 0 && (
                  <button
                    onClick={() => { jumpToLadder(e.amount); setExpandedDay(null); }}
                    style={{ fontSize:'.65rem', padding:'.22rem .5rem', background:'rgba(74,175,154,.1)', border:'1px solid rgba(74,175,154,.3)', borderRadius:5, color:'#4caf9a', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}
                  >🪜 Reinvest</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Year/month picker modal ───────────────────────────────────────── */}
      {showYearPicker && (
        <div style={overlayStyle} onClick={() => setShowYearPicker(false)}>
          <div style={{ ...boxStyle, maxWidth: 270 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'.85rem' }}>
              <button onClick={() => setYearPickerY(y => y - 1)} style={navBtnStyle}>‹</button>
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.05rem', color:'var(--text)' }}>{yearPickerY}</div>
              <button onClick={() => setYearPickerY(y => y + 1)} style={navBtnStyle}>›</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'.45rem' }}>
              {MONTH_NAMES.map((m, idx) => {
                const mo       = idx + 1;
                const isActive = mo === calMo && yearPickerY === calY;
                return (
                  <button
                    key={m}
                    onClick={() => { setCalMonth(`${yearPickerY}-${String(mo).padStart(2,'0')}`); setShowYearPicker(false); }}
                    style={{
                      background:   isActive ? 'rgba(201,168,76,.15)' : 'var(--bg-muted)',
                      border:       isActive ? '1px solid rgba(201,168,76,.4)' : '1px solid var(--border)',
                      borderRadius: 7, padding:'.45rem .3rem', cursor:'pointer',
                      fontSize:'.75rem', color: isActive ? '#c9a84c' : 'var(--text-dim)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >{m.slice(0, 3)}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap:'1rem', alignItems:'start' }}>

        {/* ── Calendar card ──────────────────────────────────────────────── */}
        <div className="card" style={{ padding:'1rem' }}>

          {/* Header: ‹ | [month ▾] | › | Today */}
          <div style={{ display:'flex', alignItems:'center', gap:'.4rem', marginBottom:'.75rem' }}>
            <button onClick={prevMo} aria-label="Previous month" style={navBtnStyle}>‹</button>

            <button
              onClick={() => { setYearPickerY(calY); setShowYearPicker(true); }}
              title="Jump to month"
              style={{ flex:1, background:'none', border:'none', cursor:'pointer', textAlign:'center', fontFamily:"'Cormorant Garamond',serif", fontSize:'1.05rem', color:'var(--text)', display:'flex', alignItems:'center', justifyContent:'center', gap:'.3rem' }}
            >
              {monthName}
              <span style={{ fontSize:'.6rem', color:'var(--text-muted)', marginTop:'.05rem' }}>▾</span>
            </button>

            <button onClick={nextMo} aria-label="Next month" style={navBtnStyle}>›</button>

            <button
              onClick={goToday}
              style={{ ...navBtnStyle, fontSize:'.7rem', minWidth:'auto', padding:'.25rem .55rem', whiteSpace:'nowrap' }}
            >Today</button>
          </div>

          {/* Cash flow summary strip */}
          {showCashFlow && (
            <div style={{ display:'flex', gap:'.4rem', marginBottom:'.75rem', flexWrap:'wrap' }}>
              {monthInflows > 0 && (
                <div style={{ flex:'1 1 auto', background:'rgba(74,175,154,.07)', border:'1px solid rgba(74,175,154,.2)', borderRadius:7, padding:'.35rem .55rem', textAlign:'center' }}>
                  <div style={{ fontSize:'.57rem', color:'var(--text-muted)', marginBottom:'.1rem', textTransform:'uppercase', letterSpacing:'.05em' }}>FD In</div>
                  <div style={{ fontSize:'.75rem', color:'#4caf9a', fontFamily:"'DM Mono',monospace" }}>+{fmtCr(monthInflows)}</div>
                </div>
              )}
              {monthSIPOut > 0 && (
                <div style={{ flex:'1 1 auto', background:'rgba(90,156,224,.07)', border:'1px solid rgba(90,156,224,.2)', borderRadius:7, padding:'.35rem .55rem', textAlign:'center' }}>
                  <div style={{ fontSize:'.57rem', color:'var(--text-muted)', marginBottom:'.1rem', textTransform:'uppercase', letterSpacing:'.05em' }}>SIP Out</div>
                  <div style={{ fontSize:'.75rem', color:'#5a9ce0', fontFamily:"'DM Mono',monospace" }}>−{fmtCr(monthSIPOut)}</div>
                </div>
              )}
              {monthPremiumOut > 0 && (
                <div style={{ flex:'1 1 auto', background:'rgba(224,123,140,.07)', border:'1px solid rgba(224,123,140,.2)', borderRadius:7, padding:'.35rem .55rem', textAlign:'center' }}>
                  <div style={{ fontSize:'.57rem', color:'var(--text-muted)', marginBottom:'.1rem', textTransform:'uppercase', letterSpacing:'.05em' }}>Premium</div>
                  <div style={{ fontSize:'.75rem', color:'#e07b8c', fontFamily:"'DM Mono',monospace" }}>−{fmtCr(monthPremiumOut)}</div>
                </div>
              )}
              {/* Net only shown when there is both an inflow and an outflow */}
              {monthInflows > 0 && (monthSIPOut > 0 || monthPremiumOut > 0) && (
                <div style={{ flex:'1 1 auto', background: netCashFlow >= 0 ? 'rgba(74,175,154,.07)' : 'rgba(224,124,90,.07)', border:`1px solid ${netCashFlow >= 0 ? 'rgba(74,175,154,.2)' : 'rgba(224,124,90,.2)'}`, borderRadius:7, padding:'.35rem .55rem', textAlign:'center' }}>
                  <div style={{ fontSize:'.57rem', color:'var(--text-muted)', marginBottom:'.1rem', textTransform:'uppercase', letterSpacing:'.05em' }}>Net</div>
                  <div style={{ fontSize:'.75rem', color: netCashFlow >= 0 ? '#4caf9a' : '#e07c5a', fontFamily:"'DM Mono',monospace" }}>
                    {netCashFlow >= 0 ? '+' : ''}{fmtCr(netCashFlow)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign:'center', fontSize:'.62rem', color:'var(--text-muted)', letterSpacing:'.04em', padding:'.3rem 0' }}>{d}</div>
            ))}
          </div>

          {/* Calendar cells — clickable when they have events */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
            {Array.from({ length: firstDay }, (_, i) => <div key={'e' + i} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day       = i + 1;
              const key       = cellDate(day);
              const dayEvents = events[key] || [];
              const today     = isToday(calY, calMo, day);
              const hasEvents = dayEvents.length > 0;

              return (
                <div
                  key={day}
                  onClick={() => hasEvents && setExpandedDay(key)}
                  style={{
                    minHeight: 56, padding: '.3rem .28rem', borderRadius: 5,
                    background: today ? 'rgba(201,168,76,.12)' : 'var(--bg-muted)',
                    border:     today ? '1px solid rgba(201,168,76,.3)' : '1px solid var(--border)',
                    cursor:     hasEvents ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontSize:'.72rem', color: today ? '#c9a84c' : 'var(--text-dim)', fontWeight: today ? 600 : 400, marginBottom:'.2rem' }}>{day}</div>
                  {dayEvents.slice(0, 2).map((e, idx) => (
                    <div key={idx} title={e.label}
                      style={{ fontSize:'.62rem', lineHeight:1.3, padding:'1px 3px', borderRadius:2, marginBottom:1,
                        background:`${e.color}22`, color:e.color, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {e.icon} {e.label.slice(0, 13)}{e.label.length > 13 ? '…' : ''}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div style={{ fontSize:'.62rem', color:'var(--text-muted)' }}>+{dayEvents.length - 2} more</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div>
          {/* Upcoming events card */}
          <div className="card" style={{ marginBottom:'1rem' }}>
            {/* Title + day-range toggle */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'.55rem', gap:'.5rem', flexWrap:'wrap' }}>
              <div className="ctitle" style={{ marginBottom:0 }}>Upcoming</div>
              <div style={{ display:'flex', background:'var(--bg-muted)', border:'1px solid var(--border)', borderRadius:6, padding:2, gap:1 }}>
                {[30, 60, 90].map(d => (
                  <button key={d} onClick={() => setUpcomingDays(d)} style={{
                    fontSize:'.65rem', padding:'.2rem .45rem', borderRadius:4, border:'none', cursor:'pointer',
                    background: upcomingDays === d ? 'var(--bg-card)' : 'transparent',
                    color:      upcomingDays === d ? 'var(--text)'    : 'var(--text-muted)',
                    fontWeight: upcomingDays === d ? 600              : 400,
                  }}>{d}d</button>
                ))}
              </div>
            </div>

            {/* Filter chips — only show types that have events */}
            <div style={{ display:'flex', gap:'.3rem', flexWrap:'wrap', marginBottom:'.75rem' }}>
              {FILTER_TYPES.filter(f => f === 'All' || filterCounts[f]).map(f => (
                <button key={f} onClick={() => setUpcomingFilter(f)} style={{
                  fontSize:'.64rem', padding:'.18rem .48rem', borderRadius:12, cursor:'pointer',
                  border:     upcomingFilter === f ? '1px solid rgba(201,168,76,.5)' : '1px solid var(--border)',
                  background: upcomingFilter === f ? 'rgba(201,168,76,.1)'           : 'transparent',
                  color:      upcomingFilter === f ? '#c9a84c'                        : 'var(--text-dim)',
                  fontWeight: upcomingFilter === f ? 600 : 400,
                }}>
                  {f}{f !== 'All' && filterCounts[f] ? ` · ${filterCounts[f]}` : ''}
                </button>
              ))}
            </div>

            {filteredUpcoming.length === 0
              ? <div className="empty" style={{ padding:'.75rem 0' }}>Nothing due in {upcomingDays} days</div>
              : filteredUpcoming.map((e, i) => {
                  const dt       = new Date(e.date);
                  const daysLeft = Math.ceil((dt - now) / 864e5);
                  return (
                    <div key={i} style={{ display:'flex', gap:'.6rem', padding:'.6rem 0', borderBottom:'1px solid var(--border)', alignItems:'flex-start' }}>
                      <div style={{ fontSize:'1.05rem', flexShrink:0, marginTop:'.1rem' }}>{e.icon}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'.75rem', color:'var(--text)', lineHeight:1.4, marginBottom:'.12rem' }}>{e.label}</div>
                        <div style={{ fontSize:'.65rem', color:'var(--text-muted)' }}>{e.type}</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'.22rem', flexShrink:0 }}>
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'.7rem', color:e.color }}>
                          {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d`}
                        </div>
                        <div style={{ fontSize:'.63rem', color:'var(--text-muted)' }}>
                          {dt.toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
                        </div>
                        {e.type === 'FD Maturity' && e.amount > 0 && (
                          <button
                            onClick={() => jumpToLadder(e.amount)}
                            style={{ fontSize:'.6rem', padding:'.15rem .4rem', background:'rgba(74,175,154,.1)', border:'1px solid rgba(74,175,154,.25)', borderRadius:4, color:'#4caf9a', cursor:'pointer', whiteSpace:'nowrap' }}
                          >🪜 Reinvest</button>
                        )}
                      </div>
                    </div>
                  );
                })
            }
          </div>

          {/* Legend card */}
          <div className="card">
            <div className="ctitle">Event Types</div>
            {[
              { icon:'📈', label:'SIP Dues',          color:'#4caf9a' },
              { icon:'🏦', label:'FD Maturity',        color:'#f0a050' },
              { icon:'🎯', label:'Goal Targets',        color:'#c9a84c' },
              { icon:'📋', label:'Tax Deadlines',       color:'#e07c5a' },
              { icon:'💰', label:'PPF Dates',           color:'#a084ca' },
              { icon:'📑', label:'80C Deadlines',       color:'#5a9ce0' },
              { icon:'🛡️', label:'Insurance Premium',   color:'#e07b8c' },
            ].map(l => (
              <div key={l.label} style={{ display:'flex', alignItems:'center', gap:'.5rem', marginBottom:'.35rem' }}>
                <div style={{ fontSize:'.85rem' }}>{l.icon}</div>
                <div style={{ fontSize:'.73rem', color:'var(--text-dim)' }}>{l.label}</div>
                <div style={{ width:8, height:8, borderRadius:'50%', background:l.color, marginLeft:'auto', flexShrink:0 }}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FD Ladder Planner ─────────────────────────────────────────────── */}
      <div id="fd-ladder" style={{ marginTop:'1rem' }}>
        <FDLadderPlanner initialAmount={ladderAmount} />
      </div>
    </>
  );
}
