// BudgetTab.jsx — lines 3758–4365 of App.jsx
// All budget state is passed as props because it lives in parent App.jsx
// (no budget state is local-only; the parent needs it for persistence across tab switches).

import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../supabase.js';
import { readSSEStream } from '../../hooks/useGoalAI.js';

// ── AI Spend Insights panel ───────────────────────────────────────────────────

function SpendInsights({ analytics, catData, monthlyData, domCur, selMonth, fmtAmt }) {
  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const abortRef = useRef(null);

  // Re-run when analytics or month selection changes
  const analyticsKey = analytics ? `${analytics.totalDebit}-${selMonth}` : null;
  const prevKey = useRef(null);
  useEffect(() => {
    if (analyticsKey && analyticsKey !== prevKey.current) {
      prevKey.current = analyticsKey;
      setText('');
      setOpen(false);
    }
  }, [analyticsKey]);

  async function generate() {
    if (!analytics) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setText('');
    setOpen(true);

    // Build context from analytics data
    const topCats = catData.slice(0, 6).map(c =>
      `  ${c.icon || ''} ${c.name}: ${fmtAmt(c.value, domCur)} (${analytics.totalDebit > 0 ? ((c.value / analytics.totalDebit) * 100).toFixed(0) : 0}%)`
    ).join('\n');

    const trend = monthlyData.slice(-3).map(([mo, v]) =>
      `  ${mo}: ${fmtAmt(v, domCur)}`
    ).join('\n');

    // Month-over-month change
    let momStr = '';
    if (monthlyData.length >= 2) {
      const [, prev] = monthlyData[monthlyData.length - 2];
      const [, curr] = monthlyData[monthlyData.length - 1];
      const chg = prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : null;
      if (chg !== null) momStr = `\nMonth-over-month change: ${chg >= 0 ? '+' : ''}${chg}%`;
    }

    const period = selMonth
      ? new Date(selMonth + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
      : 'all time';

    const prompt = `Analyse this spending data for ${period} and provide a concise 3-sentence insight — no headers, no bullet points, flowing prose.

SPENDING SUMMARY:
- Total spent: ${fmtAmt(analytics.totalDebit, domCur)}
- Total income/credits: ${fmtAmt(analytics.totalCredit, domCur)}
- Net flow: ${fmtAmt(analytics.totalCredit - analytics.totalDebit, domCur)}${momStr}

TOP SPENDING CATEGORIES:
${topCats || '  No categories available'}

MONTHLY TREND (last 3 months):
${trend || '  No trend data'}

Write 3 sentences: (1) overall spending health — is this sustainable or concerning? (2) the single most notable category finding. (3) one specific, actionable recommendation to improve this spending pattern. Under 70 words total.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: 'You are a concise personal finance advisor. Write in flowing prose, no bullets or headers. Under 70 words.',
          messages: [{ role: 'user', content: prompt }],
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

  if (!analytics) return null;
  const hasContent = text || loading;

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button
        onClick={hasContent ? () => setOpen(p => !p) : generate}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: open && hasContent ? 'rgba(160,132,202,.08)' : 'rgba(160,132,202,.04)',
          border: `1px ${hasContent ? 'solid' : 'dashed'} rgba(160,132,202,.3)`,
          borderRadius: open && hasContent ? '8px 8px 0 0' : 8,
          padding: '.5rem .85rem', cursor: 'pointer',
          fontFamily: "'DM Sans',sans-serif", fontSize: '.72rem', color: '#a084ca',
        }}>
        <span>✦ Spend Insights</span>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {hasContent && !loading && (
            <span onClick={e => { e.stopPropagation(); generate(); }}
              style={{ fontSize: '.62rem', color: 'rgba(160,132,202,.6)', cursor: 'pointer' }}>⟳ Refresh</span>
          )}
          {loading && (
            <div style={{ width: 10, height: 10, border: '1.5px solid rgba(160,132,202,.25)', borderTopColor: '#a084ca', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          )}
          {hasContent && <span style={{ fontSize: '.6rem' }}>{open ? '▲' : '▼'}</span>}
          {!hasContent && <span style={{ fontSize: '.65rem', color: 'rgba(160,132,202,.5)' }}>Generate →</span>}
        </div>
      </button>

      {open && hasContent && (
        <div style={{
          background: 'rgba(160,132,202,.04)', border: '1px solid rgba(160,132,202,.15)',
          borderTop: 'none', borderRadius: '0 0 8px 8px',
          padding: '.75rem .9rem', fontSize: '.78rem', lineHeight: 1.7,
          color: 'var(--text-secondary)', fontFamily: "'DM Sans',sans-serif",
        }}>
          {loading && !text ? (
            <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
              {[0,1,2].map(j => (
                <span key={j} style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(160,132,202,.5)', display: 'inline-block', animation: `bounce 1.2s ${j * 0.2}s infinite` }} />
              ))}
            </div>
          ) : (
            <>
              {text}
              {loading && <span style={{ display: 'inline-block', width: '2px', height: '1em', background: '#a084ca', marginLeft: '2px', verticalAlign: 'text-bottom', animation: 'blink .9s step-end infinite' }} />}
            </>
          )}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}} @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  );
}

export default function BudgetTab({
  // Budget state
  budgetStatements,
  setBudgetStatements,
  budgetTxns,
  setBudgetTxns,
  budgetCategories,
  setBudgetCategories,
  budgetAnalytics,
  setBudgetAnalytics,
  budgetSelStmt,
  setBudgetSelStmt,
  budgetSelMonth,
  setBudgetSelMonth,
  budgetSelCat,
  setBudgetSelCat,
  budgetSearch,
  setBudgetSearch,
  budgetView,
  setBudgetView,
  budgetUploading,
  setBudgetUploading,
  budgetUploadForm,
  setBudgetUploadForm,
  budgetUploadFile,
  setBudgetUploadFile,
  budgetUploadMsg,
  setBudgetUploadMsg,
  budgetEditCat,
  setBudgetEditCat,
  budgetNewCat,
  setBudgetNewCat,
  selectedTxnIds,
  setSelectedTxnIds,
  bulkCatTarget,
  setBulkCatTarget,
  // Portfolio data for the spend-to-wealth bridge
  allCur,
  allInv,
  totInv,
  fmtCr,
  fmtPct,
  // API helper
  api,
  // Sub-components
  FG,
  MA,
  Overlay,
}) {
  // ── Load functions ──
  async function loadBudget(){
    try{
      const [stmts,cats,analytics]=await Promise.all([
        api("/api/budget/statements"),
        api("/api/budget/categories"),
        api(`/api/budget/analytics${budgetSelMonth?`?month=${budgetSelMonth}`:""}`)
      ]);
      setBudgetStatements(stmts||[]);
      setBudgetCategories(cats||[]);
      setBudgetAnalytics(analytics||null);
    }catch(e){console.error(e);}
  }
  async function loadTxns(){
    try{
      const params=new URLSearchParams();
      if(budgetSelStmt!=="all") params.set("statement_id",budgetSelStmt);
      if(budgetSelCat!=="All") params.set("category",budgetSelCat);
      if(budgetSelMonth) params.set("month",budgetSelMonth);
      if(budgetSearch) params.set("search",budgetSearch);
      const txns=await api(`/api/budget/transactions?${params}`);
      setBudgetTxns(txns||[]);
    }catch(e){console.error(e);}
  }

  // ── Charts ──
  const analytics=budgetAnalytics;
  const catData=analytics?Object.entries(analytics.byCategory||{}).map(([name,v])=>{
    const cat=budgetCategories.find(c=>c.name===name);
    return{name,value:v,color:cat?.color||"#6b6356",icon:cat?.icon||"📦"};
  }).sort((a,b)=>b.value-a.value):[];
  const totalSpend=catData.reduce((s,x)=>s+x.value,0);

  // Bar chart data (monthly trend)
  const monthlyData=analytics?Object.entries(analytics.monthly||{})
    .sort((a,b)=>a[0].localeCompare(b[0])).slice(-6):[];
  const maxMonthly=Math.max(...monthlyData.map(x=>x[1]),1);

  const fmtAmt=(n,cur)=>{
    if(cur==="USD") return n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1e3?`$${(n/1000).toFixed(1)}K`:`$${Math.round(n).toLocaleString("en-US")}`;
    return n>=1e7?`₹${(n/1e7).toFixed(2)}Cr`:n>=1e5?`₹${(n/1e5).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n).toLocaleString("en-IN")}`;
  };
  // Detect dominant currency from statements (for analytics overview)
  const usStmts = budgetStatements.filter(s=>s.region==="US").length;
  const inStmts = budgetStatements.filter(s=>s.region==="IN").length;
  const domCur = usStmts >= inStmts && usStmts > 0 ? "USD" : "INR";
  const TYPE_COLORS={"BANK":"#5a9ce0","CREDIT_CARD":"#e07c5a","UPI":"#4caf9a","OTHER":"#a084ca"};
  const TYPE_ICONS={"BANK":"🏦","CREDIT_CARD":"💳","UPI":"📲","OTHER":"📄"};

  return (
    <>
      {/* ── Sub-nav ── */}
      <div style={{display:"flex",gap:".4rem",marginBottom:"1.2rem",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:".35rem"}}>
          {["overview","transactions","categories","import"].map(v=>(
            <div key={v} onClick={async()=>{setBudgetView(v);if(v==="overview"||v==="categories")await loadBudget();if(v==="transactions")await loadTxns();}}
              style={{padding:".3rem .75rem",borderRadius:5,cursor:"pointer",fontSize:".73rem",fontWeight:500,
                background:budgetView===v?"rgba(201,168,76,.18)":"var(--text-muted)",
                border:budgetView===v?"1px solid rgba(201,168,76,.5)":"1px solid var(--border)",
                color:budgetView===v?"#c9a84c":"var(--text-dim)",transition:"all .15s",textTransform:"capitalize"}}>
              {v==="overview"?"📊 Overview":v==="transactions"?"📋 Transactions":v==="categories"?"🏷️ Categories":"📤 Import"}
            </div>
          ))}
        </div>
        {/* Month picker */}
        <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
          <input type="month" className="fi" style={{width:150,padding:".28rem .6rem",fontSize:".75rem"}}
            value={budgetSelMonth}
            onChange={e=>{
              const mo = e.target.value;
              setBudgetSelMonth(mo);
              (async()=>{
                try {
                  const [stmts,cats,analytics,txns] = await Promise.all([
                    api("/api/budget/statements"),
                    api("/api/budget/categories"),
                    api(`/api/budget/analytics${mo?`?month=${mo}`:""}`),
                    api(`/api/budget/transactions${mo?`?month=${mo}`:""}`)
                  ]);
                  setBudgetStatements(stmts||[]);
                  setBudgetCategories(cats||[]);
                  setBudgetAnalytics(analytics||null);
                  setBudgetTxns(txns||[]);
                } catch(err) { console.error("Month change reload:", err); }
              })();
            }}
            placeholder="All time"/>
          {budgetSelMonth&&<button onClick={()=>{
            setBudgetSelMonth("");
            (async()=>{
              try {
                const [stmts,cats,analytics,txns] = await Promise.all([
                  api("/api/budget/statements"),
                  api("/api/budget/categories"),
                  api("/api/budget/analytics"),
                  api("/api/budget/transactions")
                ]);
                setBudgetStatements(stmts||[]);
                setBudgetCategories(cats||[]);
                setBudgetAnalytics(analytics||null);
                setBudgetTxns(txns||[]);
              } catch(err) { console.error("Month clear reload:", err); }
            })();
          }} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:".9rem"}}>✕</button>}
        </div>
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {budgetView==="overview"&&(()=>{
        if(!analytics) return(<div style={{textAlign:"center",padding:"3rem",color:"var(--text-muted)"}}>
          <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📊</div>
          <div>Import a bank statement to see your spending overview</div>
          <button className="btns" style={{marginTop:"1rem"}} onClick={()=>setBudgetView("import")}>+ Import Statement</button>
        </div>);
        return(<>
          {/* ✦ AI Spend Insights */}
          <SpendInsights
            analytics={analytics}
            catData={catData}
            monthlyData={monthlyData}
            domCur={domCur}
            selMonth={budgetSelMonth}
            fmtAmt={fmtAmt}
          />
          {/* KPI row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".75rem",marginBottom:"1.2rem"}}>
            {[
              {label:"Total Spent",val:analytics.totalDebit,color:"#e07c5a"},
              {label:"Total Credited",val:analytics.totalCredit,color:"#4caf9a"},
              {label:"Net Flow",val:analytics.totalCredit-analytics.totalDebit,color:(analytics.totalCredit-analytics.totalDebit)>=0?"#4caf9a":"#e07c5a"},
              {label:"Categories",val:catData.length,color:"#c9a84c",isCnt:true},
            ].map(k=>(
              <div key={k.label} className="card" style={{padding:".85rem 1rem"}}>
                <div style={{fontSize:".62rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".4rem"}}>{k.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:k.isCnt?"1.4rem":"1.1rem",color:k.color}}>
                  {k.isCnt?k.val:fmtAmt(Math.abs(k.val),domCur)}
                </div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1.2rem"}}>
            {/* Spending donut */}
            <div className="card">
              <div className="ctitle">Spending by Category</div>
              {catData.length===0?<div className="empty">No spending data</div>:(
                <div style={{display:"flex",gap:"1rem",alignItems:"flex-start",flexWrap:"wrap"}}>
                  <svg viewBox="0 0 180 180" style={{width:160,height:160,flexShrink:0}}>
                    {(()=>{
                      let angle=-90;
                      return catData.map((d,i)=>{
                        const sweep=(d.value/totalSpend)*360;
                        if(sweep<0.5){angle+=sweep;return null;}
                        const r=72,ir=44,cx=90,cy=90;
                        const pt=(a,rad)=>({x:cx+rad*Math.cos(a*Math.PI/180),y:cy+rad*Math.sin(a*Math.PI/180)});
                        const sa=angle,ea=angle+sweep;
                        angle+=sweep;
                        const s=pt(sa,r),e=pt(ea,r),si=pt(sa,ir),ei=pt(ea,ir);
                        const lg=sweep>180?1:0;
                        const path=`M${s.x},${s.y}A${r},${r},0,${lg},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir},${ir},0,${lg},0,${si.x},${si.y}Z`;
                        return<path key={i} d={path} fill={d.color} opacity=".9"/>;
                      });
                    })()}
                    <text x="90" y="86" textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="'DM Mono',monospace">{fmtAmt(totalSpend,domCur)}</text>
                    <text x="90" y="100" textAnchor="middle" fill="var(--text-muted)" fontSize="8">spent</text>
                  </svg>
                  <div style={{flex:1,minWidth:120}}>
                    {catData.slice(0,8).map(d=>(
                      <div key={d.name} style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".35rem",fontSize:".72rem"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:d.color,flexShrink:0}}/>
                        <div style={{flex:1,color:"var(--text-dim)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.icon} {d.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",color:"var(--text-dim)",fontSize:".68rem"}}>{((d.value/totalSpend)*100).toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Monthly bar chart */}
            <div className="card">
              <div className="ctitle">Monthly Spending Trend</div>
              {monthlyData.length===0?<div className="empty">No trend data yet</div>:(
                <div style={{display:"flex",alignItems:"flex-end",gap:".4rem",height:140,padding:".5rem 0"}}>
                  {monthlyData.map(([mo,val])=>{
                    const pct=(val/maxMonthly)*100;
                    const label=new Date(mo+"-01").toLocaleDateString("en-IN",{month:"short"});
                    return(
                    <div key={mo} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:".3rem"}}>
                      <div style={{fontSize:".6rem",color:"var(--text-muted)",fontFamily:"'DM Mono',monospace"}}>{fmtAmt(val,domCur)}</div>
                      <div style={{width:"100%",background:"rgba(201,168,76,.12)",borderRadius:"3px 3px 0 0",height:100,display:"flex",alignItems:"flex-end"}}>
                        <div style={{width:"100%",background:"rgba(201,168,76,.7)",borderRadius:"3px 3px 0 0",height:`${pct}%`,transition:"height .6s ease"}}/>
                      </div>
                      <div style={{fontSize:".62rem",color:"var(--text-dim)"}}>{label}</div>
                    </div>);
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Category budget buckets */}
          {catData.length>0&&(
            <div className="card">
              <div className="ctitle">Budget Buckets</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(260px,100%),1fr))",gap:".75rem"}}>
                {catData.map(d=>{
                  const cat=budgetCategories.find(c=>c.name===d.name);
                  const limit=cat?.monthly_limit||0;
                  const pct=limit>0?Math.min((d.value/limit)*100,100):0;
                  const over=limit>0&&d.value>limit;
                  return(
                  <div key={d.name} style={{padding:".75rem .9rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:7}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:".45rem"}}>
                      <span style={{fontSize:".8rem",color:"var(--text)"}}>{d.icon} {d.name}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:".78rem",color:over?"#e07c5a":"#c9a84c"}}>{fmtAmt(d.value,domCur)}</span>
                    </div>
                    {limit>0&&(
                      <>
                        <div style={{height:4,background:"var(--bg-muted)",borderRadius:2,marginBottom:".3rem"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:over?"#e07c5a":d.color,borderRadius:2,transition:"width .6s"}}/>
                        </div>
                        <div style={{fontSize:".65rem",color:"var(--text-muted)"}}>
                          {over?<span style={{color:"#e07c5a"}}>Over by {fmtAmt(d.value-limit,domCur)}</span>:
                            <span>{fmtAmt(limit-d.value,domCur)} remaining of {fmtAmt(limit,domCur)}</span>}
                        </div>
                      </>
                    )}
                  </div>);
                })}
              </div>
            </div>
          )}

        {/* ── Budget ↔ Investment Bridge ── */}
        {analytics&&analytics.totalDebit>0&&(
          <div className="card" style={{borderTop:"2px solid rgba(201,168,76,.3)"}}>
            <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".85rem"}}>
              <div className="ctitle" style={{margin:0}}>💡 Spend-to-Wealth Bridge</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>What if you invested more?</div>
            </div>
            {(()=>{
              const topCats = catData.filter(d=>!["Investments","Transfers","Other"].includes(d.name)).slice(0,4);
              const CAGR = 0.12;
              const years = [5, 10, 15];
              return(
              <div style={{overflowX:"auto"}}>
                <table className="ht" style={{fontSize:".75rem"}}>
                  <thead><tr>
                    <th>Category</th><th className="r">Monthly Spend</th>
                    {years.map(y=><th key={y} className="r">SIP → {y}Y at 12%</th>)}
                    <th className="r">vs Your Return</th>
                  </tr></thead>
                  <tbody>
                    {topCats.map(d=>{
                      const monthly=d.value/Math.max(Object.keys(analytics.monthly||{}).length,1);
                      return(<tr key={d.name}>
                        <td><span style={{color:d.color}}>{d.icon}</span> {d.name}</td>
                        <td className="r mono" style={{color:"#e07c5a"}}>₹{Math.round(monthly).toLocaleString("en-IN")}</td>
                        {years.map(y=>{
                          const r=CAGR/12, n=y*12;
                          const fv=monthly*((Math.pow(1+r,n)-1)/r)*(1+r);
                          return <td key={y} className="r mono" style={{color:"#4caf9a"}}>{fmtCr(fv)}</td>;
                        })}
                        <td className="r" style={{fontSize:".68rem",color:"var(--text-muted)"}}>
                          {totInv>0?`Your portfolio: ${fmtPct((allCur-allInv)/allInv*100)}`:"—"}
                        </td>
                      </tr>);
                    })}
                  </tbody>
                </table>
                <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".5rem"}}>Assumes 12% CAGR. Monthly spend estimated from {budgetSelMonth||"all imported"} data.</div>
              </div>);
            })()}
          </div>
        )}
        </>);
      })()}

      {/* ═══ TRANSACTIONS ═══ */}
      {budgetView==="transactions"&&(()=>{
        return(<>
          {/* Filter bar */}
          <div style={{display:"flex",gap:".6rem",marginBottom:".85rem",flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{flex:2,minWidth:180}}>
              <label className="flbl">Search</label>
              <input className="fi" placeholder="Search transactions…" value={budgetSearch}
                onChange={e=>setBudgetSearch(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")loadTxns();}}/>
            </div>
            <div style={{flex:1,minWidth:140}}>
              <label className="flbl">Statement</label>
              <select className="fi fs" value={budgetSelStmt} onChange={e=>setBudgetSelStmt(e.target.value)}>
                <option value="all">All</option>
                {budgetStatements.map(s=><option key={s.id} value={s.id}>{s.source} · {s.period_start?.slice(0,7)||"?"}</option>)}
              </select>
            </div>
            <div style={{flex:1,minWidth:140}}>
              <label className="flbl">Category</label>
              <select className="fi fs" value={budgetSelCat} onChange={e=>setBudgetSelCat(e.target.value)}>
                <option value="All">All Categories</option>
                {budgetCategories.map(c=><option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <button className="btns" onClick={loadTxns} style={{alignSelf:"flex-end"}}>Filter</button>
          </div>

          {/* Bulk actions */}
          {selectedTxnIds.size>0&&(
            <div style={{display:"flex",alignItems:"center",gap:".7rem",padding:".6rem .9rem",background:"rgba(201,168,76,.08)",border:"1px solid rgba(201,168,76,.25)",borderRadius:7,marginBottom:".75rem"}}>
              <span style={{fontSize:".78rem",color:"#c9a84c"}}>{selectedTxnIds.size} selected</span>
              <select className="fi fs" style={{width:200,marginBottom:0}} value={bulkCatTarget} onChange={e=>setBulkCatTarget(e.target.value)}>
                <option value="">Move to category…</option>
                {budgetCategories.map(c=><option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
              <button className="btns" onClick={async()=>{
                if(!bulkCatTarget)return;
                await api("/api/budget/recategorise",{method:"POST",body:JSON.stringify({ids:[...selectedTxnIds],category:bulkCatTarget})});
                setSelectedTxnIds(new Set());setBulkCatTarget("");
                await loadTxns();
              }}>Apply</button>
              <button onClick={()=>setSelectedTxnIds(new Set())} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer"}}>✕ Clear</button>
            </div>
          )}

          {budgetTxns.length===0?(
            <div className="card empty">No transactions — adjust filters or import a statement</div>
          ):(
            <div className="card" style={{padding:0,overflow:"hidden"}}>
              <table className="ht">
                <thead><tr>
                  <th style={{width:32}}><input type="checkbox" onChange={e=>{
                    if(e.target.checked) setSelectedTxnIds(new Set(budgetTxns.map(t=>t.id)));
                    else setSelectedTxnIds(new Set());
                  }}/></th>
                  <th>Date</th><th>Description</th><th className="r">Amount</th><th>Type</th><th>Category</th>
                </tr></thead>
                <tbody>
                  {budgetTxns.slice(0,200).map(t=>{
                    const cat=budgetCategories.find(c=>c.name===t.category);
                    return(<tr key={t.id} style={{background:selectedTxnIds.has(t.id)?"rgba(201,168,76,.06)":""}}>
                      <td><input type="checkbox" checked={selectedTxnIds.has(t.id)}
                        onChange={e=>{const s=new Set(selectedTxnIds);e.target.checked?s.add(t.id):s.delete(t.id);setSelectedTxnIds(s);}}/></td>
                      <td className="mono dim" style={{fontSize:".75rem"}}>{t.txn_date}</td>
                      <td style={{maxWidth:"30vw",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:".78rem",color:"var(--text)"}}>{t.description}</td>
                      <td className="r mono" style={{color:t.txn_type==="DEBIT"?"#e07c5a":"#4caf9a",fontSize:".82rem"}}>
                        {t.txn_type==="DEBIT"?"-":"+"}{fmtAmt(t.amount,t.currency)}
                      </td>
                      <td><span className="tbadge2" style={{background:t.txn_type==="DEBIT"?"rgba(224,124,90,.15)":"rgba(76,175,154,.15)",color:t.txn_type==="DEBIT"?"#e07c5a":"#4caf9a",fontSize:".65rem"}}>{t.txn_type}</span></td>
                      <td>
                        <select value={t.category} style={{background:"transparent",border:"none",color:cat?.color||"#c9a84c",fontSize:".73rem",cursor:"pointer",fontFamily:"inherit",colorScheme:"dark"}}
                          onChange={async e=>{
                            await api(`/api/budget/transactions/${t.id}`,{method:"PATCH",body:JSON.stringify({category:e.target.value})});
                            setBudgetTxns(p=>p.map(x=>x.id===t.id?{...x,category:e.target.value}:x));
                          }}>
                          {budgetCategories.map(c=><option key={c.id} value={c.name} style={{background:"#0c1526",color:"var(--text)"}}>{c.icon} {c.name}</option>)}
                        </select>
                      </td>
                    </tr>);
                  })}
                </tbody>
              </table>
              {budgetTxns.length>200&&<div style={{padding:".65rem",textAlign:"center",fontSize:".72rem",color:"var(--text-muted)"}}>Showing 200 of {budgetTxns.length} transactions — apply filters to narrow</div>}
            </div>
          )}
        </>);
      })()}

      {/* ═══ CATEGORIES ═══ */}
      {budgetView==="categories"&&(<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <div className="ctitle" style={{margin:0}}>Spending Categories</div>
          <button className="btn-sm" onClick={()=>setBudgetEditCat("new")}>+ New Category</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))",gap:".75rem"}}>
          {budgetCategories.map(cat=>(
            <div key={cat.id} className="card" style={{borderLeft:`3px solid ${cat.color}`,padding:".85rem 1rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:".9rem",color:"var(--text)",marginBottom:".2rem"}}>{cat.icon} {cat.name}</div>
                  <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>
                    {cat.monthly_limit>0?`Budget: ₹${cat.monthly_limit.toLocaleString("en-IN")} /mo`:"No budget set"}
                  </div>
                  {cat.keywords&&<div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".2rem",lineHeight:1.5}}>Keywords: {cat.keywords.slice(0,60)}{cat.keywords.length>60?"…":""}</div>}
                </div>
                <div style={{display:"flex",gap:".3rem"}}>
                  <button className="delbtn" onClick={()=>setBudgetEditCat(cat)} title="Edit" aria-label="Edit">✎</button>
                  <button className="delbtn" onClick={async()=>{
                    if(!confirm(`Delete "${cat.name}"?`))return;
                    await api(`/api/budget/categories/${cat.id}`,{method:"DELETE"});
                    await loadBudget();
                  }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Edit/New category modal */}
        {budgetEditCat&&(
          <Overlay onClose={()=>setBudgetEditCat(null)} narrow>
            <div className="modtitle">{budgetEditCat==="new"?"New Category":"Edit Category"}</div>
            {(()=>{
              const isNew=budgetEditCat==="new";
              const form=isNew?budgetNewCat:budgetEditCat;
              const setForm=isNew?setBudgetNewCat:(f=>setBudgetEditCat(p=>typeof f==="function"?f(p):f));
              return(<>
                <div className="frow">
                  <FG label="Icon"><input className="fi" style={{width:60}} value={form.icon} onChange={e=>setForm(p=>({...p,icon:e.target.value}))}/></FG>
                  <FG label="Name"><input className="fi" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/></FG>
                  <FG label="Colour"><input type="color" className="fi" value={form.color} onChange={e=>setForm(p=>({...p,color:e.target.value}))} style={{height:40,padding:"4px 8px",cursor:"pointer"}}/></FG>
                </div>
                <FG label="Monthly Budget ₹ (0 = unlimited)">
                  <input type="number" className="fi" value={form.monthly_limit} onChange={e=>setForm(p=>({...p,monthly_limit:+e.target.value}))}/>
                </FG>
                <FG label="Auto-match Keywords (comma separated)">
                  <input className="fi" placeholder="e.g. swiggy,zomato,restaurant" value={form.keywords} onChange={e=>setForm(p=>({...p,keywords:e.target.value}))}/>
                </FG>
                <MA>
                  <button className="btnc" onClick={()=>setBudgetEditCat(null)}>Cancel</button>
                  <button className="btns" onClick={async()=>{
                    if(isNew){
                      await api("/api/budget/categories",{method:"POST",body:JSON.stringify(form)});
                      setBudgetNewCat({name:"",color:"#c9a84c",icon:"📁",monthly_limit:0,keywords:""});
                    } else {
                      await api(`/api/budget/categories/${form.id}`,{method:"PUT",body:JSON.stringify({name:form.name,color:form.color,icon:form.icon,monthly_limit:form.monthly_limit,keywords:form.keywords})});
                    }
                    setBudgetEditCat(null);
                    await loadBudget();
                  }} disabled={!form.name}>Save</button>
                </MA>
              </>);
            })()}
          </Overlay>
        )}
      </>)}

      {/* ═══ IMPORT ═══ */}
      {budgetView==="import"&&(<>

        {/* Manual Upload card */}
        <div className="card" style={{marginBottom:"1.2rem"}}>
          <div className="ctitle">Import Bank Statement</div>
          <div style={{fontSize:".77rem",color:"var(--text-dim)",marginBottom:"1rem",lineHeight:1.7}}>
            Upload CSV, Excel, or PDF statements from US banks (Chase, BofA, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank) and Indian banks (HDFC, ICICI, Axis, SBI, Kotak).
            Transactions are <span style={{color:"#4caf9a"}}>AES-256 encrypted</span> before storage. Statements older than 1 year are automatically purged.
          </div>
          <div className="frow">
            <FG label="Region">
              <select className="fi fs" value={budgetUploadForm.region}
                onChange={e=>{setBudgetUploadForm(p=>({...p,region:e.target.value,bank_key:""})); setBudgetUploadMsg("");}}>
                <option value="">Select region…</option>
                <option value="US">🇺🇸 US Bank</option>
                <option value="IN">🇮🇳 Indian Bank</option>
                <option value="AUTO">🔍 Auto-detect</option>
              </select>
            </FG>
            <FG label="Bank">
              <select className="fi fs" value={budgetUploadForm.bank_key}
                disabled={!budgetUploadForm.region}
                onChange={e=>setBudgetUploadForm(p=>({...p,bank_key:e.target.value}))}>
                {budgetUploadForm.region==="US"?(<>
                  <option value="">Select bank…</option>
                  <option value="chase">Chase</option>
                  <option value="bofa">Bank of America</option>
                  <option value="wells_fargo">Wells Fargo</option>
                  <option value="citi">Citi</option>
                  <option value="capital_one">Capital One</option>
                  <option value="amex">Amex</option>
                  <option value="discover">Discover</option>
                  <option value="us_bank">US Bank</option>
                  <option value="other_us">Other US Bank</option>
                </>):budgetUploadForm.region==="IN"?(<>
                  <option value="">Select bank…</option>
                  <option value="hdfc">HDFC</option>
                  <option value="icici">ICICI</option>
                  <option value="axis">Axis</option>
                  <option value="sbi">SBI</option>
                  <option value="kotak">Kotak</option>
                  <option value="other_in">Other Indian Bank</option>
                </>):budgetUploadForm.region==="AUTO"?(<>
                  <option value="auto">Auto-detect from file</option>
                </>):(<option value="">Pick a region first</option>)}
              </select>
            </FG>
          </div>
          <div className="frow">
            <FG label="Type">
              <select className="fi fs" value={budgetUploadForm.statement_type}
                onChange={e=>setBudgetUploadForm(p=>({...p,statement_type:e.target.value}))}>
                <option value="BANK">🏦 Bank Account</option>
                <option value="CREDIT_CARD">💳 Credit Card</option>
                <option value="UPI">📲 UPI / GPay</option>
                <option value="OTHER">📄 Other</option>
              </select>
            </FG>
            <FG label="Custom Label (optional)">
              <input className="fi" placeholder="e.g. Joint Savings, Salary Account"
                value={budgetUploadForm.custom_label}
                onChange={e=>setBudgetUploadForm(p=>({...p,custom_label:e.target.value}))}/>
            </FG>
          </div>
          <FG label="Statement File (CSV, XLSX, or PDF)">
            <input type="file" accept=".csv,.xlsx,.xls,.pdf" className="fi"
              onChange={e=>setBudgetUploadFile(e.target.files[0])}
              style={{paddingTop:".4rem",color:"var(--text)"}}/>
          </FG>
          <FG label="Notes (optional)">
            <input className="fi" placeholder="e.g. Jan–Mar 2026 statement"
              value={budgetUploadForm.notes}
              onChange={e=>setBudgetUploadForm(p=>({...p,notes:e.target.value}))}/>
          </FG>

          {budgetUploadMsg&&(
            <div style={{padding:".6rem .85rem",borderRadius:6,marginBottom:".75rem",fontSize:".78rem",
              whiteSpace:"pre-wrap",fontFamily:budgetUploadMsg.startsWith("📄")?"monospace":"inherit",
              maxHeight:budgetUploadMsg.startsWith("📄")?"400px":"none",overflow:"auto",
              background:budgetUploadMsg.startsWith("✓")?"rgba(76,175,154,.1)":budgetUploadMsg.startsWith("📄")?"rgba(90,156,224,.08)":"rgba(224,124,90,.1)",
              border:`1px solid ${budgetUploadMsg.startsWith("✓")?"rgba(76,175,154,.3)":budgetUploadMsg.startsWith("📄")?"rgba(90,156,224,.2)":"rgba(224,124,90,.3)"}`,
              color:budgetUploadMsg.startsWith("✓")?"#4caf9a":budgetUploadMsg.startsWith("📄")?"var(--text-dim)":"#e07c5a"}}>
              {budgetUploadMsg}
            </div>
          )}

          <button className="btns" disabled={!budgetUploadFile||!budgetUploadForm.region||budgetUploading}
            onClick={async()=>{
              if(!budgetUploadFile||!budgetUploadForm.region) return;
              const bankKey = budgetUploadForm.bank_key || (budgetUploadForm.region==="AUTO"?"auto":"");
              if(!bankKey){setBudgetUploadMsg("⚠ Please select a bank"); return;}
              setBudgetUploading(true); setBudgetUploadMsg("");
              try{
                const fd=new FormData();
                fd.append("file",budgetUploadFile);
                fd.append("bank_key",bankKey);
                fd.append("source",budgetUploadForm.custom_label||budgetUploadForm.bank_key||"Auto");
                fd.append("statement_type",budgetUploadForm.statement_type);
                fd.append("notes",budgetUploadForm.notes||"");
                const data=await api("/api/budget/upload",{method:"POST",body:fd});
                if(data.ok){
                  setBudgetUploadMsg(`✓ Imported ${data.txn_count} transactions (${data.period_start} to ${data.period_end})`);
                  setBudgetUploadFile(null);
                  setBudgetUploadForm({region:"",bank_key:"",statement_type:"BANK",notes:"",custom_label:""});
                  await loadBudget();
                  const stmts=await api("/api/budget/statements");
                  setBudgetStatements(stmts||[]);
                } else { setBudgetUploadMsg("⚠ "+data.error); }
              }catch(e){ setBudgetUploadMsg("⚠ "+e.message); }
              setBudgetUploading(false);
            }}>
            {budgetUploading?"Importing…":"Upload & Parse"}
          </button>
          {budgetUploadFile && budgetUploadFile.name.endsWith(".pdf") && (
            <button className="btnc" style={{marginLeft:".5rem",fontSize:".7rem"}}
              onClick={async()=>{
                setBudgetUploadMsg("Analyzing + importing PDF...");
                try{
                  const fd=new FormData();
                  fd.append("file",budgetUploadFile);
                  fd.append("import","true");
                  const data=await api("/api/budget/debug-pdf",{method:"POST",body:fd});
                  let msg = `📄 ${data.pages} pages, ${data.totalLines} lines, ${data.totalChars} chars\n` +
                    `US parser: ${data.usRowsParsed} rows | IN parser: ${data.inRowsParsed} rows\n`;
                  if (data.imported > 0) {
                    msg = `✓ Imported ${data.imported} transactions via debug endpoint\n` + msg;
                    await loadBudget();
                    setBudgetStatements(await api("/api/budget/statements") || []);
                  } else {
                    msg += `Import: ${data.imported} (${data.importError || "no rows to import"})\n`;
                  }
                  msg += `Sections: ${data.sectionHeaders?.join(" | ") || "none"}\n` +
                    `Date lines: ${data.dateLines?.slice(0,5).join(" | ") || "none"}\n` +
                    `--- First 15 lines ---\n${data.first80Lines?.slice(0,15).join("\n")}`;
                  setBudgetUploadMsg(msg);
                }catch(e){setBudgetUploadMsg("⚠ Debug: "+e.message);}
              }}>
              🔍 Debug + Import PDF
            </button>
          )}
        </div>

        {/* Statement history */}
        <div className="card">
          <div className="ctitle">Statement History (1-year rolling)</div>
          {budgetStatements.length===0?<div className="empty">No statements imported yet</div>:(
            <table className="ht">
              <thead><tr><th>Source</th><th>Type</th><th>Period</th><th className="r">Transactions</th><th>Uploaded</th><th>Notes</th><th/></tr></thead>
              <tbody>
                {budgetStatements.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontWeight:500,color:"var(--text)"}}>{s.source}</td>
                    <td><span style={{fontSize:".68rem",padding:"2px 7px",borderRadius:3,background:`${TYPE_COLORS[s.statement_type]||"#6b6356"}22`,color:TYPE_COLORS[s.statement_type]||"#6b6356",border:`1px solid ${TYPE_COLORS[s.statement_type]||"#6b6356"}44`}}>{TYPE_ICONS[s.statement_type]} {s.statement_type}</span></td>
                    <td className="dim" style={{fontSize:".75rem"}}>{s.period_start||"?"} → {s.period_end||"?"}</td>
                    <td className="r mono" style={{color:"#c9a84c"}}>{s.txn_count}</td>
                    <td className="dim" style={{fontSize:".72rem"}}>{s.upload_date?.slice(0,10)}</td>
                    <td className="dim" style={{fontSize:".72rem",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.notes||"—"}</td>
                    <td><button className="delbtn" onClick={async()=>{
                      if(!confirm(`Delete "${s.source}" statement and all its transactions?`))return;
                      await api(`/api/budget/statements/${s.id}`,{method:"DELETE"});
                      const stmts=await api("/api/budget/statements");
                      setBudgetStatements(stmts||[]);
                    }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </>)}
    </>
  );
}
