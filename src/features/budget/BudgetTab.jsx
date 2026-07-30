// BudgetTab.jsx — lines 3758–4365 of App.jsx
// All budget state is passed as props because it lives in parent App.jsx
// (no budget state is local-only; the parent needs it for persistence across tab switches).

import { useState, useRef, useEffect } from 'react';
import { useToast } from '../../components/shared/Toast.jsx';
// Ported from Budget2 (see project notes): period presets + client-side recurring-
// pattern detection are generic, analytics-shape-agnostic helpers with no
// Budget2-specific state, so they're reused here directly rather than duplicated.
import { PERIODS, periodToDateRange, detectRecurring } from '../../hooks/useBudget2.js';

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
  budgetUploadMsgKind,
  budgetPdfPasswordNeeded,
  setBudgetPdfPasswordNeeded,
  budgetPdfPassword,
  setBudgetPdfPassword,
  budgetPwAttempt,
  budgetEditCat,
  setBudgetEditCat,
  budgetNewCat,
  setBudgetNewCat,
  selectedTxnIds,
  setSelectedTxnIds,
  bulkCatTarget,
  setBulkCatTarget,
  budgetBanks = [],
  // Portfolio data for the spend-to-wealth bridge + nudge
  allCur,
  allInv,
  totInv,
  totPct,
  sipHoldings = [],
  allMembers = [],
  fmtCr,
  fmtPct,
  // API helper
  api,
  // Sub-components
  FG,
  MA,
  Overlay,
  // Load handlers + upload handler from useBudget hook (avoids duplicate definitions)
  loadBanks,
  loadBudget: loadBudgetHook,
  loadTxns:   loadTxnsHook,
  uploadBudgetStatement,
  debugImportFile,
  assignStatementMember,
}) {
  const toast = useToast();
  // Wrap hook functions with current filter state so callers inside JSX don't need to pass args
  function loadBudget() { return loadBudgetHook(budgetSelMonth); }
  function loadTxns()   { return loadTxnsHook(budgetSelStmt, budgetSelCat, budgetSelMonth, budgetSearch); }

  // Bank list is fetched once (server-driven, from BANK_REGISTRY) rather than hardcoded here,
  // so the dropdown can never drift out of sync with what the parser actually supports.
  useEffect(() => { if (!budgetBanks.length) loadBanks?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Editable CAGR for Spend-to-Wealth Bridge (default 12%)
  const [sipCagr, setSipCagr] = useState(12);

  // Drag-and-drop state + hidden file input ref for the Import file dropzone.
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileInputRef = useRef(null);
  function pickFile(f) {
    if (!f) return;
    setBudgetUploadFile(f);
    setBudgetUploadMsg("");
    setBudgetPdfPasswordNeeded(false);
    setBudgetPdfPassword("");
  }
  const fmtBytes = n => n>=1e6?`${(n/1e6).toFixed(1)} MB`:n>=1e3?`${(n/1e3).toFixed(0)} KB`:`${n} B`;

  // ── Period preset (Overview) — ported from Budget2 ──
  // Independent of the month picker in the sub-nav (which also drives Transactions/
  // Categories filtering): choosing a preset here fetches its own analytics snapshot
  // so switching periods on Overview doesn't disturb the Transactions tab's filter.
  const [ovPeriod, setOvPeriod] = useState("all-time");
  const [ovAnalytics, setOvAnalytics] = useState(null);
  const [ovLoading, setOvLoading] = useState(false);
  async function loadOverviewPeriod(period) {
    setOvLoading(true);
    try {
      const { from, to } = periodToDateRange(period);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      setOvAnalytics(await api(`/api/budget/analytics?${params}`));
    } catch (e) { console.error(e); }
    setOvLoading(false);
  }
  // Until the user picks a non-default period, fall back to the analytics already
  // loaded by the hook (avoids a duplicate fetch on first render).
  const overviewAnalytics = ovAnalytics || budgetAnalytics;

  // ── Savings Goals — ported from Budget2 ──
  const [budgetGoals, setBudgetGoals] = useState([]);
  const [budgetGoalsLoaded, setBudgetGoalsLoaded] = useState(false);
  const [budgetGoalForm, setBudgetGoalForm] = useState(null); // null | "new" | goal object
  const [budgetNewGoal, setBudgetNewGoal] = useState({ name:"", target:"", saved:"", due_date:"", note:"", color:"#c9a84c", icon:"🎯" });
  async function loadBudgetGoals() {
    try { setBudgetGoals(await api("/api/budget/goals")); } catch (e) { console.error(e); }
    setBudgetGoalsLoaded(true);
  }
  const isNewGoal = budgetGoalForm === "new";
  const goalModalForm = isNewGoal ? budgetNewGoal : budgetGoalForm;
  const setGoalModalForm = isNewGoal ? setBudgetNewGoal : (f=>setBudgetGoalForm(p=>typeof f==="function"?f(p):f));
  async function saveBudgetGoal() {
    if (!goalModalForm?.name || !goalModalForm?.target) return;
    const payload = { ...goalModalForm, target: Number(goalModalForm.target), saved: Number(goalModalForm.saved||0) };
    try {
      if (isNewGoal) {
        const created = await api("/api/budget/goals", { method:"POST", body: JSON.stringify(payload) });
        setBudgetGoals(g=>[...g, created]);
        setBudgetNewGoal({ name:"", target:"", saved:"", due_date:"", note:"", color:"#c9a84c", icon:"🎯" });
      } else {
        const updated = await api(`/api/budget/goals/${payload.id}`, { method:"PUT", body: JSON.stringify(payload) });
        setBudgetGoals(g=>g.map(x=>x.id===payload.id?updated:x));
      }
      setBudgetGoalForm(null);
    } catch (e) { toast.error("Failed to save goal: " + e.message); }
  }
  async function deleteBudgetGoal(id) {
    const ok = await toast.confirm("Delete this goal?", { confirmLabel:"Delete", danger:true });
    if (!ok) return;
    try {
      await api(`/api/budget/goals/${id}`, { method:"DELETE" });
      setBudgetGoals(g=>g.filter(x=>x.id!==id));
    } catch (e) { toast.error(e.message); }
  }

  // ── Recurring pattern detection — ported from Budget2 ──
  const [budgetRecurring, setBudgetRecurring] = useState([]);
  const [budgetRecurringLoaded, setBudgetRecurringLoaded] = useState(false);
  const [budgetIgnoredKeys, setBudgetIgnoredKeys] = useState([]);
  async function loadBudgetRecurring() {
    try {
      const from = new Date(Date.now() - 365*86400_000).toISOString().slice(0,10);
      const txns = await api(`/api/budget/transactions?from=${from}&limit=2000`);
      setBudgetRecurring(detectRecurring(txns||[], budgetIgnoredKeys));
    } catch (e) { console.error(e); }
    setBudgetRecurringLoaded(true);
  }
  function ignoreBudgetRecurringPattern(key) {
    setBudgetIgnoredKeys(k=>[...k, key]);
    setBudgetRecurring(r=>r.filter(p=>p.key!==key));
  }

  // ── Charts ──
  const analytics=overviewAnalytics;
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
      {/* ── Page header ── */}
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)",marginBottom:".7rem"}}>
        Budget & Spending
      </div>

      {/* ── Sub-nav ── */}
      <div style={{display:"flex",gap:".4rem",marginBottom:".6rem",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div className="tbar" style={{marginBottom:0}}>
          {["overview","goals","recurring","transactions","categories","import"].map(v=>(
            <button key={v} type="button" role="tab" aria-selected={budgetView===v}
              className={`fchip${budgetView===v?" act":""}`}
              onClick={async()=>{
                setBudgetView(v);
                if(v==="overview"||v==="categories")await loadBudget();
                if(v==="transactions")await loadTxns();
                if(v==="goals"&&!budgetGoalsLoaded)await loadBudgetGoals();
                if(v==="recurring"&&!budgetRecurringLoaded)await loadBudgetRecurring();
              }}>
              {v==="overview"?"📊 Overview":v==="goals"?"🎯 Goals":v==="recurring"?"🔁 Recurring":v==="transactions"?"📋 Transactions":v==="categories"?"🏷️ Categories":"📤 Import"}
            </button>
          ))}
        </div>
        {/* Month picker — filters Transactions/Categories only */}
        {(budgetView==="transactions"||budgetView==="categories")&&(
          <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
            <input type="month" className="fi" style={{width:150,padding:".28rem .6rem",fontSize:".75rem"}}
              value={budgetSelMonth}
              onChange={async e=>{
                const mo = e.target.value;
                setBudgetSelMonth(mo);
                await Promise.all([loadBudgetHook(mo), loadTxnsHook(budgetSelStmt, budgetSelCat, mo, budgetSearch)]);
              }}
              placeholder="All time"/>
            {budgetSelMonth&&<button className="delbtn" aria-label="Clear month filter" onClick={async()=>{
              setBudgetSelMonth("");
              await Promise.all([loadBudgetHook(""), loadTxnsHook(budgetSelStmt, budgetSelCat, "", budgetSearch)]);
            }} style={{color:"var(--text-muted)"}}>✕</button>}
          </div>
        )}
        {/* Period preset — filters the Overview analytics only */}
        {budgetView==="overview"&&(
          <div className="tbar" style={{marginBottom:0}}>
            {PERIODS.map(p=>(
              <button key={p.key} type="button" className={`fchip${ovPeriod===p.key?" act":""}`}
                onClick={async()=>{setOvPeriod(p.key);await loadOverviewPeriod(p.key);}}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {budgetView==="overview"&&(()=>{
        if(!analytics) return(<div className="card" style={{textAlign:"center",padding:"2.5rem 1.5rem"}}>
          <div style={{fontSize:"2.2rem",marginBottom:".7rem"}}>📊</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.15rem",color:"var(--text)",marginBottom:".4rem"}}>
            See where your money goes
          </div>
          <div style={{fontSize:".78rem",color:"var(--text-muted)",maxWidth:380,margin:"0 auto 1.2rem",lineHeight:1.6}}>
            Import a bank or credit-card statement (CSV, Excel, or PDF) and WealthLens will auto-categorise your
            spending, track it against monthly budgets, and surface a spend-to-wealth view of what you could be investing instead.
          </div>
          <button className="btns" onClick={()=>setBudgetView("import")}>+ Import Statement</button>
        </div>);
        return(<>
          {/* KPI row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".75rem",marginBottom:"1.2rem"}}>
            {[
              {label:"Total Spent",val:analytics.totalDebit,color:"#e07c5a"},
              {label:"Total Credited",val:analytics.totalCredit,color:"#4caf9a"},
              {label:"Net Flow",val:analytics.totalCredit-analytics.totalDebit,color:(analytics.totalCredit-analytics.totalDebit)>=0?"#4caf9a":"#e07c5a"},
              {label:"Categories",val:catData.length,color:"#c9a84c",isCnt:true},
              {label:"Savings Rate",val:analytics.totalCredit>0?((analytics.totalCredit-analytics.totalDebit)/analytics.totalCredit)*100:null,
                color:analytics.totalCredit<=0?"var(--text-muted)":((analytics.totalCredit-analytics.totalDebit)/analytics.totalCredit)*100>=20?"#4caf9a":((analytics.totalCredit-analytics.totalDebit)/analytics.totalCredit)*100>0?"#c9a84c":"#e07c5a",isPct:true},
            ].map(k=>(
              <div key={k.label} className="card" style={{padding:".85rem 1rem"}}>
                <div style={{fontSize:".65rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".4rem"}}>{k.label}</div>
                <div style={{fontFamily:"var(--font-mono)",fontSize:k.isCnt?"1.4rem":"1.1rem",color:k.color}}>
                  {k.isCnt?k.val:k.isPct?(k.val==null?"—":`${k.val.toFixed(1)}%`):fmtAmt(Math.abs(k.val),domCur)}
                </div>
                {k.isPct&&k.val!=null&&(
                  <div style={{height:4,background:"var(--bg-muted)",borderRadius:2,marginTop:".4rem"}}>
                    <div style={{height:"100%",width:`${Math.min(Math.max(k.val,0),100)}%`,background:k.color,borderRadius:2,transition:"width .5s"}}/>
                  </div>
                )}
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
                      <div style={{fontSize:".65rem",color:"var(--text-dim)"}}>{label}</div>
                    </div>);
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Category budget buckets + health ring */}
          {catData.length>0&&(
            <div className="card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".75rem",marginBottom:"1rem"}}>
                <div className="ctitle" style={{margin:0}}>Budget Buckets</div>
                {(()=>{
                  const budgeted = budgetCategories.filter(c=>c.monthly_limit>0);
                  if(!budgeted.length) return null;
                  const onBudget = budgeted.filter(c=>(analytics.byCategory?.[c.name]||0)<=c.monthly_limit).length;
                  const score = Math.round((onBudget/budgeted.length)*100);
                  const ringColor = score>=80?"#4caf9a":score>=50?"#c9a84c":"#e07c5a";
                  const r=22,cx=28,cy=28,circ=2*Math.PI*r,dash=(score/100)*circ;
                  return(
                    <div style={{display:"flex",alignItems:"center",gap:".55rem"}}>
                      <svg width={56} height={56} viewBox="0 0 56 56">
                        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-muted)" strokeWidth={6}/>
                        <circle cx={cx} cy={cy} r={r} fill="none" stroke={ringColor} strokeWidth={6}
                          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                          transform={`rotate(-90 ${cx} ${cy})`} style={{transition:"stroke-dasharray .7s ease"}}/>
                        <text x={cx} y={cy+4} textAnchor="middle" fill={ringColor} fontSize="12" fontFamily="var(--font-mono)" fontWeight="bold">{score}%</text>
                      </svg>
                      <div style={{fontSize:".68rem",color:"var(--text-muted)",lineHeight:1.4}}>
                        <div style={{color:"var(--text)",fontWeight:500}}>Budget Health</div>
                        {onBudget} of {budgeted.length} categories on track
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(260px,100%),1fr))",gap:".75rem"}}>
                {catData.map(d=>{
                  const cat=budgetCategories.find(c=>c.name===d.name);
                  const limit=cat?.monthly_limit||0;
                  const pct=limit>0?Math.min((d.value/limit)*100,100):0;
                  const over=limit>0&&d.value>limit;
                  return(
                  <div key={d.name} style={{padding:".75rem .9rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)"}}>
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
            <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".85rem",flexWrap:"wrap"}}>
              <div className="ctitle" style={{margin:0}}>💡 Spend-to-Wealth Bridge</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>What if you invested more?</div>
              {/* Editable CAGR */}
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:".4rem"}}>
                <label style={{fontSize:".68rem",color:"var(--text-muted)"}}>CAGR %</label>
                <input
                  type="number" min="1" max="40" step="0.5"
                  value={sipCagr}
                  onChange={e=>setSipCagr(Math.min(40,Math.max(1,+e.target.value||12)))}
                  style={{width:58,padding:".2rem .4rem",fontSize:".75rem",fontFamily:"var(--font-mono)",
                    background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--gold)",textAlign:"right"}}
                />
                {totInv>0&&allCur>allInv&&(
                  <button
                    onClick={()=>setSipCagr(+((allCur-allInv)/allInv*100/3).toFixed(1))}
                    title="Use your portfolio's estimated 3Y annualised return"
                    style={{fontSize:".65rem",color:"rgba(76,175,154,.8)",background:"none",border:"1px dashed rgba(76,175,154,.3)",
                      borderRadius:4,padding:".15rem .45rem",cursor:"pointer"}}>
                    Use mine ↗
                  </button>
                )}
              </div>
            </div>
            {(()=>{
              const topCats = catData.filter(d=>!["Investments","Transfers","Other"].includes(d.name)).slice(0,4);
              const CAGR = sipCagr / 100;
              const years = [5, 10, 15];
              const numMonths = Math.max(Object.keys(analytics.monthly||{}).length, 1);
              return(
              <div style={{overflowX:"auto"}}>
                <table className="ht" style={{fontSize:".75rem"}}>
                  <thead><tr>
                    <th>Category</th><th className="r">Monthly Spend</th>
                    {years.map(y=><th key={y} className="r">SIP → {y}Y at {sipCagr}%</th>)}
                    <th className="r">vs Portfolio</th>
                  </tr></thead>
                  <tbody>
                    {topCats.map(d=>{
                      const monthly=d.value/numMonths;
                      return(<tr key={d.name}>
                        <td><span style={{color:d.color}}>{d.icon}</span> {d.name}</td>
                        <td className="r mono" style={{color:"#e07c5a"}}>{fmtAmt(Math.round(monthly),domCur)}</td>
                        {years.map(y=>{
                          const r=CAGR/12, n=y*12;
                          const fv=monthly*((Math.pow(1+r,n)-1)/r)*(1+r);
                          return <td key={y} className="r mono" style={{color:"#4caf9a"}}>{fmtCr(fv)}</td>;
                        })}
                        <td className="r" style={{fontSize:".68rem",color:"var(--text-muted)"}}>
                          {totInv>0?fmtPct((allCur-allInv)/allInv*100):"—"}
                        </td>
                      </tr>);
                    })}
                  </tbody>
                </table>
                <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".5rem"}}>
                  SIP projection at {sipCagr}% CAGR. Monthly spend averaged over {numMonths} month{numMonths!==1?"s":""} of imported data.
                  {totInv>0&&allCur>allInv&&<span style={{color:"rgba(76,175,154,.7)"}}> · Your portfolio: {fmtPct((allCur-allInv)/allInv*100)} total gain.</span>}
                </div>
              </div>);
            })()}
          </div>
        )}

        {/* ── Investment Nudge ── */}
        {analytics&&budgetCategories.length>0&&sipHoldings.length>0&&(()=>{
          // Find categories where actual spend > monthly_limit (over-budget)
          const overBudget = catData
            .filter(d=>{
              const cat=budgetCategories.find(c=>c.name===d.name);
              return cat?.monthly_limit>0 && d.value>cat.monthly_limit;
            })
            .map(d=>{
              const cat=budgetCategories.find(c=>c.name===d.name);
              const numMo=Math.max(Object.keys(analytics.monthly||{}).length,1);
              const monthlyOver=(d.value-cat.monthly_limit)/numMo;
              return{...d,limit:cat.monthly_limit,over:d.value-cat.monthly_limit,monthlyOver};
            })
            .sort((a,b)=>b.monthlyOver-a.monthlyOver)
            .slice(0,3);
          if(!overBudget.length) return null;
          return(
          <div className="card" style={{borderTop:"2px solid rgba(76,175,154,.25)",marginTop:".1rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".85rem"}}>
              <div className="ctitle" style={{margin:0}}>🌱 Investment Nudge</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>Redirect over-budget spend to your SIPs</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:".7rem"}}>
              {overBudget.map((d,i)=>{
                const fund=sipHoldings[i%sipHoldings.length];
                const r=sipCagr/100/12, n=10*12;
                const fv10=d.monthlyOver*((Math.pow(1+r,n)-1)/r)*(1+r);
                return(
                <div key={d.name} style={{padding:".85rem 1rem",background:"var(--bg-muted)",
                  border:"1px solid rgba(76,175,154,.2)",borderLeft:`3px solid ${d.color}`,borderRadius:"var(--radius-sm)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:".55rem"}}>
                    <div>
                      <div style={{fontSize:".82rem",color:"var(--text)",fontWeight:500}}>{d.icon} {d.name}</div>
                      <div style={{fontSize:".68rem",color:"#e07c5a",marginTop:".1rem"}}>
                        Over budget by {fmtAmt(d.monthlyOver,domCur)}/mo avg
                      </div>
                    </div>
                    <span style={{fontSize:".65rem",padding:"2px 7px",borderRadius:3,
                      background:"rgba(224,124,90,.12)",color:"#e07c5a",border:"1px solid rgba(224,124,90,.25)"}}>
                      Over limit
                    </span>
                  </div>
                  <div style={{fontSize:".72rem",color:"var(--text-dim)",lineHeight:1.6,
                    padding:".5rem .65rem",background:"rgba(76,175,154,.06)",borderRadius:5,
                    border:"1px dashed rgba(76,175,154,.2)"}}>
                    💡 Redirect <span style={{color:"#4caf9a",fontWeight:600}}>{fmtAmt(Math.round(d.monthlyOver),domCur)}/mo</span> to{" "}
                    <span style={{color:"var(--text)"}}>{fund.name}</span>
                    {" "}→ grows to <span style={{color:"#4caf9a",fontWeight:600}}>{fmtCr(fv10)}</span> in 10Y at {sipCagr}% CAGR
                  </div>
                </div>);
              })}
            </div>
            {sipHoldings.length===0&&(
              <div style={{fontSize:".72rem",color:"var(--text-muted)"}}>
                No mutual fund holdings found. Add MF holdings in the Holdings tab to see personalised SIP suggestions.
              </div>
            )}
          </div>);
        })()}

        </>);
      })()}

      {/* ═══ GOALS ═══ */}
      {budgetView==="goals"&&(<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:".6rem"}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"var(--text)"}}>Savings Goals</div>
            <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:".2rem"}}>Track progress toward your financial targets</div>
          </div>
          <button className="btns" onClick={()=>setBudgetGoalForm("new")}>+ New Goal</button>
        </div>

        {budgetGoals.length===0?(
          <div className="card" style={{padding:"2.5rem 1.5rem",textAlign:"center"}}>
            <div style={{fontSize:"2.2rem",marginBottom:".7rem"}}>🎯</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)",marginBottom:".4rem"}}>Set your first savings goal</div>
            <div style={{fontSize:".78rem",color:"var(--text-muted)",maxWidth:340,margin:"0 auto 1.2rem",lineHeight:1.6}}>
              Track an emergency fund, a big purchase, or any target amount — with a due date and progress bar.
            </div>
            <button className="btns" onClick={()=>setBudgetGoalForm("new")}>+ Create Goal</button>
          </div>
        ):(<>
          {budgetGoals.length>1&&(
            <div className="card" style={{padding:".75rem 1rem",marginBottom:"1rem",display:"flex",gap:"2rem",flexWrap:"wrap"}}>
              {[
                {label:"Total target",val:fmtAmt(budgetGoals.reduce((s,g)=>s+g.target,0),domCur)},
                {label:"Total saved",val:fmtAmt(budgetGoals.reduce((s,g)=>s+g.saved,0),domCur),color:"#4caf9a"},
                {label:"Remaining",val:fmtAmt(budgetGoals.reduce((s,g)=>s+Math.max(g.target-g.saved,0),0),domCur)},
              ].map(k=>(
                <div key={k.label}>
                  <div style={{fontSize:".65rem",textTransform:"uppercase",color:"var(--text-muted)",letterSpacing:".08em"}}>{k.label}</div>
                  <div style={{fontFamily:"var(--font-mono)",fontSize:".95rem",color:k.color||"var(--text)"}}>{k.val}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:".85rem"}}>
            {budgetGoals.map(g=>{
              const progress = g.target>0?Math.min((g.saved/g.target)*100,100):0;
              const remaining = Math.max(g.target-g.saved,0);
              const daysLeft = g.due_date?Math.ceil((new Date(g.due_date)-Date.now())/86400_000):null;
              return(
                <div key={g.id} className="card" style={{borderLeft:`3px solid ${g.color}`,padding:".9rem 1rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:".6rem"}}>
                    <div>
                      <div style={{fontSize:".88rem",color:"var(--text)",fontWeight:500}}>{g.icon} {g.name}</div>
                      {g.due_date&&(
                        <div style={{fontSize:".68rem",color:daysLeft<30?"#e07c5a":"var(--text-muted)",marginTop:".15rem"}}>
                          {daysLeft>0?`${daysLeft} days left`:daysLeft===0?"Due today":"Overdue"} · {g.due_date}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:".3rem"}}>
                      <button className="delbtn" onClick={()=>setBudgetGoalForm(g)} title="Edit" aria-label="Edit goal">✎</button>
                      <button className="delbtn" onClick={()=>deleteBudgetGoal(g.id)} title="Delete" aria-label="Delete goal">✕</button>
                    </div>
                  </div>
                  <div style={{height:8,background:"var(--bg-muted)",borderRadius:4,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${progress}%`,background:g.target>0&&g.saved>g.target?"#e07c5a":g.color,borderRadius:4,transition:"width .5s ease"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:".4rem",fontSize:".72rem",color:"var(--text-muted)"}}>
                    <span style={{fontFamily:"var(--font-mono)",color:g.color}}>{fmtAmt(g.saved,domCur)}</span>
                    <span>{Math.round(progress)}%</span>
                    <span style={{fontFamily:"var(--font-mono)"}}>of {fmtAmt(g.target,domCur)}</span>
                  </div>
                  {remaining>0&&<div style={{fontSize:".68rem",color:"var(--text-muted)",marginTop:".25rem",textAlign:"right"}}>{fmtAmt(remaining,domCur)} remaining</div>}
                  {g.note&&<div style={{fontSize:".68rem",color:"var(--text-muted)",marginTop:".4rem",fontStyle:"italic"}}>{g.note}</div>}
                </div>
              );
            })}
          </div>
        </>)}

        {budgetGoalForm&&(
          <Overlay onClose={()=>setBudgetGoalForm(null)} narrow>
            <div className="modtitle">{isNewGoal?"🎯 New Goal":"✎ Edit Goal"}</div>
            <div style={{display:"flex",gap:".75rem",marginBottom:".75rem"}}>
              <div style={{flex:"0 0 auto"}}>
                <label className="flbl">Icon</label>
                <input className="fi" style={{width:60}} value={goalModalForm.icon||"🎯"} onChange={e=>setGoalModalForm(p=>({...p,icon:e.target.value}))}/>
              </div>
              <div style={{flex:1}}>
                <label className="flbl">Goal name</label>
                <input className="fi" placeholder="e.g. Emergency Fund" value={goalModalForm.name||""} onChange={e=>setGoalModalForm(p=>({...p,name:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:"flex",gap:".75rem",marginBottom:".75rem"}}>
              <div style={{flex:1}}>
                <label className="flbl">Target amount</label>
                <input type="number" className="fi" placeholder="500000" value={goalModalForm.target||""} onChange={e=>setGoalModalForm(p=>({...p,target:e.target.value}))}/>
              </div>
              <div style={{flex:1}}>
                <label className="flbl">Amount saved so far</label>
                <input type="number" className="fi" placeholder="0" value={goalModalForm.saved||""} onChange={e=>setGoalModalForm(p=>({...p,saved:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:"flex",gap:".75rem",marginBottom:".75rem"}}>
              <div style={{flex:1}}>
                <label className="flbl">Target date (optional)</label>
                <input type="date" className="fi" value={goalModalForm.due_date||""} onChange={e=>setGoalModalForm(p=>({...p,due_date:e.target.value}))}/>
              </div>
              <div style={{flex:"0 0 auto"}}>
                <label className="flbl">Color</label>
                <input type="color" className="fi" value={goalModalForm.color||"#c9a84c"} onChange={e=>setGoalModalForm(p=>({...p,color:e.target.value}))} style={{height:40,padding:"4px 8px",cursor:"pointer",width:70}}/>
              </div>
            </div>
            <div style={{marginBottom:".75rem"}}>
              <label className="flbl">Note (optional)</label>
              <input className="fi" placeholder="What is this goal for?" value={goalModalForm.note||""} onChange={e=>setGoalModalForm(p=>({...p,note:e.target.value}))}/>
            </div>
            <MA>
              <button className="btnc" onClick={()=>setBudgetGoalForm(null)}>Cancel</button>
              <button className="btns" onClick={saveBudgetGoal} disabled={!goalModalForm.name||!goalModalForm.target}>Save Goal</button>
            </MA>
          </Overlay>
        )}
      </>)}

      {/* ═══ RECURRING ═══ */}
      {budgetView==="recurring"&&(<>
        <div style={{marginBottom:"1rem"}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"var(--text)"}}>Recurring Pattern Detection</div>
          <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:".25rem",lineHeight:1.6}}>
            Auto-detected from the last 12 months of transactions. Patterns need ≥2 occurrences at a consistent interval.
          </div>
        </div>

        {budgetRecurring.length>0&&(
          <div className="card" style={{padding:".85rem 1rem",marginBottom:"1rem",display:"flex",gap:"2rem",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:".65rem",textTransform:"uppercase",color:"var(--text-muted)",letterSpacing:".08em"}}>Est. monthly</div>
              <div style={{fontFamily:"var(--font-mono)",fontSize:".95rem",color:"#e07c5a"}}>{fmtAmt(Math.round(budgetRecurring.reduce((s,r)=>s+r.monthlyEquivalent,0)),domCur)}</div>
            </div>
            <div>
              <div style={{fontSize:".65rem",textTransform:"uppercase",color:"var(--text-muted)",letterSpacing:".08em"}}>Est. annual</div>
              <div style={{fontFamily:"var(--font-mono)",fontSize:".95rem",color:"#c9a84c"}}>{fmtAmt(Math.round(budgetRecurring.reduce((s,r)=>s+r.monthlyEquivalent*12,0)),domCur)}</div>
            </div>
            <div>
              <div style={{fontSize:".65rem",textTransform:"uppercase",color:"var(--text-muted)",letterSpacing:".08em"}}>Patterns</div>
              <div style={{fontFamily:"var(--font-mono)",fontSize:".95rem",color:"var(--text)"}}>{budgetRecurring.length}</div>
            </div>
          </div>
        )}

        {budgetRecurring.length===0?(
          <div className="card" style={{padding:"2.5rem 1.5rem",textAlign:"center"}}>
            <div style={{fontSize:"2.2rem",marginBottom:".7rem"}}>🔁</div>
            <div style={{fontSize:".78rem",color:"var(--text-muted)"}}>No recurring patterns detected yet. Import more statements to enable detection.</div>
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(340px,100%),1fr))",gap:".75rem"}}>
            {budgetRecurring.map(r=>(
              <div key={r.key} className="card" style={{padding:".9rem 1rem",borderLeft:`3px solid ${r.isSubscription?"#a084ca":"#5a9ce0"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:".5rem"}}>
                  <div>
                    <div style={{fontSize:".82rem",color:"var(--text)",fontWeight:500,marginBottom:".15rem"}}>{r.isSubscription?"📦":"🔄"} {r.merchant}</div>
                    <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
                      <span style={{fontSize:".63rem",padding:"2px 6px",borderRadius:3,
                        background:r.isSubscription?"rgba(160,132,202,.15)":"rgba(90,156,224,.15)",
                        color:r.isSubscription?"#a084ca":"#5a9ce0",
                        border:`1px solid ${r.isSubscription?"rgba(160,132,202,.3)":"rgba(90,156,224,.3)"}`}}>
                        {r.isSubscription?"Subscription":"Recurring"}
                      </span>
                      <span style={{fontSize:".63rem",padding:"2px 6px",borderRadius:3,
                        background:r.confidence==="High"?"rgba(76,175,154,.12)":"rgba(201,168,76,.12)",
                        color:r.confidence==="High"?"#4caf9a":"#c9a84c",
                        border:`1px solid ${r.confidence==="High"?"rgba(76,175,154,.25)":"rgba(201,168,76,.25)"}`}}>
                        {r.confidence} confidence
                      </span>
                    </div>
                  </div>
                  <button onClick={()=>ignoreBudgetRecurringPattern(r.key)} title="Hide this pattern"
                    style={{background:"none",border:"1px solid var(--border)",borderRadius:4,padding:"2px 8px",cursor:"pointer",color:"var(--text-muted)",fontSize:".68rem"}}>
                    Ignore
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".4rem",fontSize:".72rem",color:"var(--text-dim)",marginTop:".5rem"}}>
                  <div><span style={{color:"var(--text-muted)"}}>Cadence: </span>{r.cadence}</div>
                  <div><span style={{color:"var(--text-muted)"}}>Occurrences: </span>{r.occurrences}</div>
                  <div><span style={{color:"var(--text-muted)"}}>Avg charge: </span><span style={{fontFamily:"var(--font-mono)",color:"#e07c5a"}}>{fmtAmt(Math.round(r.avgAmount),domCur)}</span></div>
                  <div><span style={{color:"var(--text-muted)"}}>≈ Monthly: </span><span style={{fontFamily:"var(--font-mono)",color:"#c9a84c"}}>{fmtAmt(Math.round(r.monthlyEquivalent),domCur)}</span></div>
                  <div style={{gridColumn:"1/-1"}}><span style={{color:"var(--text-muted)"}}>Next expected: </span><span style={{color:"#5a9ce0"}}>{r.nextDate}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>)}

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
            <div style={{display:"flex",alignItems:"center",gap:".7rem",padding:".6rem .9rem",background:"rgba(201,168,76,.08)",border:"1px solid rgba(201,168,76,.25)",borderRadius:"var(--radius-sm)",marginBottom:".75rem"}}>
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
                  {budgetTxns.map(t=>{
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
              {budgetTxns.length>=500&&<div style={{padding:".65rem",textAlign:"center",fontSize:".72rem",color:"var(--text-muted)"}}>Showing first 500 transactions — apply filters or select a month to narrow</div>}
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
                    {cat.monthly_limit>0?`Budget: ${fmtAmt(cat.monthly_limit, domCur)} /mo`:"No budget set"}
                  </div>
                  {cat.keywords&&<div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".2rem",lineHeight:1.5}}>Keywords: {cat.keywords.slice(0,60)}{cat.keywords.length>60?"…":""}</div>}
                </div>
                <div style={{display:"flex",gap:".3rem"}}>
                  <button className="delbtn" onClick={()=>setBudgetEditCat(cat)} title="Edit" aria-label="Edit">✎</button>
                  <button className="delbtn" aria-label="Delete category" onClick={async()=>{
                    const ok = await toast.confirm(`Delete "${cat.name}"?`, { confirmLabel: "Delete", danger: true });
                    if(!ok)return;
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
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"var(--text)",marginBottom:"1rem"}}>Import Bank Statement</div>
          <div style={{fontSize:".77rem",color:"var(--text-dim)",marginBottom:"1.1rem",lineHeight:1.7}}>
            Upload CSV, Excel, or PDF statements from US banks (Chase, BofA, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank) and Indian banks (HDFC, ICICI, Axis, SBI, Kotak).
            Transactions are <span style={{color:"#4caf9a"}}>AES-256 encrypted</span> before storage. Statements older than 1 year are automatically purged.
          </div>

          {/* ── Step 1: statement details ── */}
          <div style={{fontSize:".68rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".55rem"}}>
            1 · Statement Details
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
                {budgetUploadForm.region==="AUTO"?(
                  <option value="auto">Auto-detect from file</option>
                ):budgetUploadForm.region?(<>
                  <option value="">Select bank…</option>
                  {budgetBanks
                    .filter(b=>b.region===budgetUploadForm.region)
                    .map(b=>(<option key={b.key} value={b.key}>{b.label}</option>))}
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
          <div className="frow">
            {allMembers.length>1&&(
              <FG label="Assign to">
                <select className="fi fs" value={budgetUploadForm.member_id}
                  onChange={e=>setBudgetUploadForm(p=>({...p,member_id:e.target.value}))}>
                  <option value="">🔍 Auto-detect from statement</option>
                  {allMembers.map(m=>(<option key={m.id} value={m.id}>{m.name}</option>))}
                </select>
              </FG>
            )}
            <FG label="Notes (optional)">
              <input className="fi" placeholder="e.g. Jan–Mar 2026 statement"
                value={budgetUploadForm.notes}
                onChange={e=>setBudgetUploadForm(p=>({...p,notes:e.target.value}))}/>
            </FG>
          </div>

          {/* ── Step 2: file ── */}
          <div style={{fontSize:".68rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)",
            marginTop:".3rem",marginBottom:".55rem",paddingTop:"1rem",borderTop:"1px solid var(--border)"}}>
            2 · Statement File
          </div>
          <FG label="CSV, XLSX, or PDF">
            <div
              onClick={()=>fileInputRef.current?.click()}
              onDragOver={e=>{e.preventDefault();setFileDragOver(true);}}
              onDragLeave={()=>setFileDragOver(false)}
              onDrop={e=>{e.preventDefault();setFileDragOver(false);pickFile(e.dataTransfer.files?.[0]);}}
              style={{
                border:`1.5px dashed ${fileDragOver?"var(--primary)":"var(--border)"}`,
                borderRadius:"var(--radius-sm)",
                background:fileDragOver?"var(--primary-dim)":"var(--bg-muted)",
                padding:budgetUploadFile?".65rem .85rem":"1.3rem 1rem",
                textAlign:budgetUploadFile?"left":"center",
                cursor:"pointer",transition:"all .15s"}}>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" style={{display:"none"}}
                onChange={e=>pickFile(e.target.files[0])}/>
              {budgetUploadFile?(
                <div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                  <span style={{fontSize:"1.1rem"}}>{/\.pdf$/i.test(budgetUploadFile.name)?"📕":/\.(xlsx|xls)$/i.test(budgetUploadFile.name)?"📗":"📄"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:".8rem",color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{budgetUploadFile.name}</div>
                    <div style={{fontSize:".65rem",color:"var(--text-muted)"}}>{fmtBytes(budgetUploadFile.size)}</div>
                  </div>
                  <button type="button" className="delbtn" aria-label="Remove file" title="Remove file"
                    onClick={e=>{e.stopPropagation();setBudgetUploadFile(null);setBudgetUploadMsg("");setBudgetPdfPasswordNeeded(false);setBudgetPdfPassword("");}}>
                    ✕
                  </button>
                </div>
              ):(
                <>
                  <div style={{fontSize:"1.4rem",marginBottom:".3rem"}}>📥</div>
                  <div style={{fontSize:".78rem",color:"var(--text-dim)"}}>Drag & drop a statement here, or click to browse</div>
                  <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".2rem"}}>CSV, XLSX, or PDF</div>
                </>
              )}
            </div>
          </FG>

          {/* Most Indian bank/card PDF statements are encrypted (DOB/PAN/mobile
              as password) — this field only appears once the server tells us a
              password is actually needed, so it doesn't clutter the common
              CSV/XLSX/unencrypted-PDF case. `key` is bumped on every wrong-password
              retry so the input remounts and `autoFocus` fires again. */}
          {budgetPdfPasswordNeeded && (
            <FG label="PDF Password">
              <input key={budgetPwAttempt} type="password" className="fi" placeholder="e.g. your DOB as DDMMYYYY, or PAN"
                value={budgetPdfPassword}
                onChange={e=>setBudgetPdfPassword(e.target.value)}
                autoFocus/>
            </FG>
          )}

          {/* Diagnostic tool — deliberately de-emphasized (small, muted text link,
              not a "btns" button) so it reads as a "having trouble?" utility, not
              an alternative to the primary Upload action below. Runs the exact
              same parsing path as a real upload (including PDF password), just
              without saving anything. Visible as a standing hint even before a
              file is picked, so first-time users know it exists before hitting
              a failed import — not just as an afterthought once something's wrong. */}
          <div style={{display:"flex",alignItems:"center",gap:".6rem",marginTop:budgetUploadFile?"-.3rem":".5rem",marginBottom:"1rem",flexWrap:"wrap"}}>
            <span style={{fontSize:".68rem",color:"var(--text-muted)"}}>
              {budgetUploadFile?"Statement not importing correctly?":"Not sure this file will parse cleanly?"}
            </span>
            <button style={{fontSize:".7rem",background:"none",border:"none",color:"var(--primary)",cursor:budgetUploadFile?"pointer":"not-allowed",padding:0,textDecoration:"underline dotted",opacity:budgetUploadFile?1:.55}}
              disabled={budgetUploading||!budgetUploadFile}
              onClick={()=>debugImportFile(budgetUploadFile, budgetUploadForm, budgetPdfPassword)}
              title={budgetUploadFile?"Parses the file and shows what would be imported, without saving anything.":"Pick a file above first"}>
              🔍 Check this file first
            </button>
          </div>

          {budgetUploadMsg&&(
            <div role={budgetUploadMsgKind==="error"?"alert":"status"} style={{padding:".6rem .85rem",borderRadius:"var(--radius-sm)",marginBottom:".9rem",fontSize:".78rem",
              whiteSpace:"pre-wrap",fontFamily:budgetUploadMsgKind==="debug"?"var(--font-mono)":"inherit",
              maxHeight:budgetUploadMsgKind==="debug"?"400px":"none",overflow:"auto",
              background:budgetUploadMsgKind==="success"?"var(--gain-dim)":budgetUploadMsgKind==="debug"?"rgba(90,156,224,.08)":budgetUploadMsgKind==="error"?"var(--loss-dim)":"var(--primary-dim)",
              border:`1px solid ${budgetUploadMsgKind==="success"?"rgba(5,150,105,.3)":budgetUploadMsgKind==="debug"?"rgba(90,156,224,.2)":budgetUploadMsgKind==="error"?"rgba(220,38,38,.3)":"var(--border)"}`,
              color:budgetUploadMsgKind==="success"?"var(--gain)":budgetUploadMsgKind==="debug"?"var(--text-dim)":budgetUploadMsgKind==="error"?"var(--loss)":"var(--text-dim)"}}>
              {budgetUploadMsg}
            </div>
          )}

          {/* ── Primary action — alone, unambiguous ── */}
          <button className="btns"
            disabled={!budgetUploadFile||!budgetUploadForm.region||budgetUploading||(budgetPdfPasswordNeeded&&!budgetPdfPassword)}
            onClick={()=>uploadBudgetStatement(budgetUploadFile, budgetUploadForm, budgetPdfPassword)}>
            {budgetUploading?"Importing…":budgetPdfPasswordNeeded?"Unlock & Upload":"Upload & Parse"}
          </button>
        </div>

        {/* Statement history */}
        <div className="card">
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"var(--text)",marginBottom:"1rem"}}>Statement History <span style={{fontFamily:"var(--font-ui)",fontSize:".68rem",color:"var(--text-muted)",fontWeight:500}}>(1-year rolling)</span></div>
          {budgetStatements.length===0?<div className="empty">No statements imported yet</div>:(<>
            <table className="ht ht-desktop">
              <thead><tr><th>Source</th><th>Type</th>{allMembers.length>1&&<th>Assigned to</th>}<th>Period</th><th className="r">Transactions</th><th>Uploaded</th><th>Notes</th><th/></tr></thead>
              <tbody>
                {budgetStatements.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontWeight:500,color:"var(--text)"}}>{s.source}</td>
                    <td><span style={{fontSize:".68rem",padding:"2px 7px",borderRadius:3,background:`${TYPE_COLORS[s.statement_type]||"#6b6356"}22`,color:TYPE_COLORS[s.statement_type]||"#6b6356",border:`1px solid ${TYPE_COLORS[s.statement_type]||"#6b6356"}44`}}>{TYPE_ICONS[s.statement_type]} {s.statement_type}</span></td>
                    {allMembers.length>1&&(
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:".3rem"}}>
                          <span style={{fontSize:".7rem",opacity:s.member_id?0.7:0.4}}>{s.member_id?"👤":"⚠️"}</span>
                          <select className="fi" style={{fontSize:".73rem",padding:"3px 6px",minWidth:110,
                              fontWeight:s.member_id?400:600,
                              color:s.member_id?"var(--text-dim)":"#e07c5a",
                              border:s.member_id?"1px solid var(--border)":"1px solid #e07c5a88",
                              background:s.member_id?"transparent":"rgba(224,124,90,.08)"}}
                            value={s.member_id||""}
                            onChange={e=>assignStatementMember?.(s.id, e.target.value)}
                            title={s.member_id?"Reassign this statement":"No family member matched automatically — assign one"}>
                            <option value="">Unassigned</option>
                            {allMembers.map(m=>(<option key={m.id} value={m.id}>{m.name}</option>))}
                          </select>
                        </div>
                      </td>
                    )}
                    <td className="dim" style={{fontSize:".75rem"}}>{s.period_start||"?"} → {s.period_end||"?"}</td>
                    <td className="r mono" style={{color:"#c9a84c"}}>{s.txn_count}</td>
                    <td className="dim" style={{fontSize:".72rem"}}>{s.upload_date?.slice(0,10)}</td>
                    <td className="dim" style={{fontSize:".72rem",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.notes||"—"}</td>
                    <td><button className="delbtn" aria-label="Delete statement" onClick={async()=>{
                      const ok = await toast.confirm(`Delete "${s.source}" statement and all its transactions?`, { confirmLabel: "Delete", danger: true });
                      if(!ok)return;
                      await api(`/api/budget/statements/${s.id}`,{method:"DELETE"});
                      await loadBudget(); // re-fetches statements + analytics
                    }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile card list — avoids horizontal table scroll on small screens */}
            <div className="m-budget-list">
              {budgetStatements.map(s=>(
                <div key={s.id} className="m-bsc">
                  <div className="m-bsc-top">
                    <div style={{flex:1,minWidth:0}}>
                      <div className="m-bsc-name">{s.source}</div>
                      <div className="m-bsc-period">{s.period_start||"?"} → {s.period_end||"?"}</div>
                    </div>
                    <span style={{fontSize:".65rem",padding:"2px 7px",borderRadius:3,flexShrink:0,background:`${TYPE_COLORS[s.statement_type]||"#6b6356"}22`,color:TYPE_COLORS[s.statement_type]||"#6b6356",border:`1px solid ${TYPE_COLORS[s.statement_type]||"#6b6356"}44`}}>{TYPE_ICONS[s.statement_type]} {s.statement_type}</span>
                  </div>
                  <div className="m-bsc-grid">
                    <div><div className="m-bsc-lbl">Transactions</div><div className="m-bsc-val" style={{color:"var(--gold)"}}>{s.txn_count}</div></div>
                    <div><div className="m-bsc-lbl">Uploaded</div><div className="m-bsc-val">{s.upload_date?.slice(0,10)}</div></div>
                    {s.notes&&<div style={{gridColumn:"1 / -1"}}><div className="m-bsc-lbl">Notes</div><div className="m-bsc-val" style={{fontWeight:400,fontFamily:"var(--font-ui)"}}>{s.notes}</div></div>}
                  </div>
                  <div className="m-bsc-actions">
                    {allMembers.length>1?(
                      <div style={{display:"flex",alignItems:"center",gap:".3rem",flex:1,minWidth:0}}>
                        <span style={{fontSize:".7rem",opacity:s.member_id?0.7:0.4,flexShrink:0}}>{s.member_id?"👤":"⚠️"}</span>
                        <select className="fi" style={{fontSize:".73rem",padding:"5px 6px",minHeight:38,width:"100%",
                            fontWeight:s.member_id?400:600,
                            color:s.member_id?"var(--text-dim)":"#e07c5a",
                            border:s.member_id?"1px solid var(--border)":"1px solid #e07c5a88",
                            background:s.member_id?"transparent":"rgba(224,124,90,.08)"}}
                          value={s.member_id||""}
                          onChange={e=>assignStatementMember?.(s.id, e.target.value)}>
                          <option value="">Unassigned</option>
                          {allMembers.map(m=>(<option key={m.id} value={m.id}>{m.name}</option>))}
                        </select>
                      </div>
                    ):<span/>}
                    <button className="delbtn" aria-label="Delete statement" style={{minWidth:42,minHeight:38}} onClick={async()=>{
                      const ok = await toast.confirm(`Delete "${s.source}" statement and all its transactions?`, { confirmLabel: "Delete", danger: true });
                      if(!ok)return;
                      await api(`/api/budget/statements/${s.id}`,{method:"DELETE"});
                      await loadBudget();
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </>)}
        </div>

      </>)}
    </>
  );
}
