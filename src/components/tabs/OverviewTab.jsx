// OverviewTab.jsx — lines 2480–2865 of App.jsx
// Props: all from parent App component (no local-only state to extract)

import LiabilitiesPanel from '../shared/LiabilitiesPanel.jsx';

export default function OverviewTab({
  // Data
  demoMode,
  holdings,
  sharedHoldings,
  allHoldings,
  allMembers,
  members,
  loaded,
  sharedWithMe,
  // Computed / cached
  valINRCache,
  invINRCache,
  totCur,
  totInv,
  totGain,
  totPct,
  byType,
  mSum,
  wealthSnapshots,
  benchmark,
  nriMetrics,
  // Controls
  bmPeriod,
  setBmPeriod,
  api,
  setBenchmark,
  nwMember,
  setNwMember,
  // Formatting functions
  fmt,
  fmtCr,
  fmtCrINR,
  fmtCrUSD,
  fmtINR,
  fmtUSD,
  fmtPct,
  // Liabilities
  liabilities,
  setLiabilities,
  // Actions
  exitDemoMode,
  setModal,
  setShowSettings,
  loadDemoData,
  // AT (asset types map)
  AT,
  // Sub-components
  DonutChart,
}) {
  return (
    <>
      {/* Demo data banner */}
      {demoMode&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".6rem",
          padding:".7rem 1rem",marginBottom:"1rem",
          background:"rgba(160,132,202,.08)",border:"1px solid rgba(160,132,202,.25)",borderRadius:8}}>
          <div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
            <span style={{fontSize:"1.1rem"}}>👋</span>
            <div>
              <div style={{fontSize:".8rem",color:"rgba(160,132,202,.9)",fontWeight:500}}>You're viewing sample data (view only)</div>
              <div style={{fontSize:".7rem",color:"var(--text-dim)",marginTop:".1rem"}}>This is not saved anywhere. Add your own data to get started — sample data disappears automatically.</div>
            </div>
          </div>
          <button className="btn-sm" style={{borderColor:"rgba(160,132,202,.4)",color:"rgba(160,132,202,.8)",whiteSpace:"nowrap"}}
            onClick={exitDemoMode}>
            ✕ Exit Demo
          </button>
        </div>
      )}
      {/* Empty state — Welcome Card + Import Guide */}
      {loaded&&!demoMode&&holdings.length===0&&sharedHoldings.length===0&&(<>
        <div style={{background:"rgba(201,168,76,.03)",border:"1px solid rgba(201,168,76,.18)",borderRadius:12,padding:"1.3rem 1.5rem",marginBottom:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:"1rem"}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:"rgba(201,168,76,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".85rem",color:"#c9a84c",fontWeight:600}}>W</div>
            <div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"var(--text)",fontWeight:500}}>Welcome to WealthLens Hub</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>3 steps to see your complete portfolio</div>
            </div>
          </div>
          {/* Step 1: Done */}
          <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(76,175,154,.15)",border:"1.5px solid #4caf9a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#4caf9a",flexShrink:0,marginTop:2}}>✓</div>
            <div>
              <div style={{fontSize:".82rem",color:"var(--text-dim)",textDecoration:"line-through"}}>Create your account</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>Signed in — you're all set</div>
            </div>
          </div>
          {/* Step 2: Add holdings */}
          <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid #c9a84c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"#c9a84c",fontWeight:600,flexShrink:0,marginTop:2}}>2</div>
            <div style={{flex:1}}>
              <div style={{fontSize:".82rem",color:"var(--text)",fontWeight:500}}>Add your first holdings</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)",marginBottom:".5rem",lineHeight:1.5}}>Import from your broker, connect a US brokerage, or add manually.</div>
              <div style={{display:"flex",gap:".35rem",flexWrap:"wrap"}}>
                <button className="btns" style={{fontSize:".7rem",padding:".32rem .7rem"}} onClick={()=>setModal("quickadd")}>Add your first investment</button>
                <button className="btn-o" style={{fontSize:".7rem",padding:".32rem .7rem"}} onClick={()=>setModal("add")}>Import CSV / Connect broker</button>
              </div>
            </div>
          </div>
          {/* Step 3: Currency */}
          <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0"}}>
            <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid var(--border-mid)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"var(--text-muted)",flexShrink:0,marginTop:2}}>3</div>
            <div>
              <div style={{fontSize:".82rem",color:"var(--text-muted)"}}>Set your base currency</div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)"}}>Open <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setShowSettings(true)}>⚙️ Settings</span> to choose USD, INR, or 8 other currencies.</div>
            </div>
          </div>
          {/* Explore with demo */}
          <div style={{borderTop:"1px solid var(--border)",marginTop:".4rem",paddingTop:".6rem",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:".7rem",color:"var(--text-muted)"}}>Want to explore first?</span>
            <button className="btn-o" style={{fontSize:".68rem",padding:".3rem .65rem"}} onClick={loadDemoData}>Load sample portfolio</button>
          </div>
        </div>
        {/* Import guidance cards — US first */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:".55rem",marginBottom:"1rem"}}>
          {[
            {title:"US Brokerages",desc:"Connect Fidelity, Schwab, Robinhood, Vanguard + 22 more via SnapTrade OAuth.",badge:"Auto-sync",badgeBg:"rgba(90,156,224,.12)",badgeC:"#5a9ce0"},
            {title:"US Broker CSV",desc:"Export from Fidelity, Schwab, E*TRADE, Merrill, Webull, SoFi etc. Drag & drop.",badge:"Supported",badgeBg:"rgba(76,175,154,.12)",badgeC:"#4caf9a"},
            {title:"CDSL / NSDL CAS",desc:"One PDF covers ALL Indian brokers. Request at cdslIndia.com. Password = PAN.",badge:"Best for India",badgeBg:"rgba(201,168,76,.12)",badgeC:"#c9a84c"},
            {title:"Indian Broker CSV",desc:"Zerodha Console, Groww, ICICI Direct, HDFC Sec, Upstox, Angel One exports.",badge:"Supported",badgeBg:"rgba(76,175,154,.12)",badgeC:"#4caf9a"},
          ].map(c=>(
            <div key={c.title} style={{background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:8,padding:".75rem",cursor:"pointer",transition:"all .15s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(201,168,76,.4)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}
              onClick={()=>setModal("add")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".3rem"}}>
                <span style={{fontSize:".8rem",color:"var(--text)",fontWeight:500}}>{c.title}</span>
                <span style={{fontSize:".55rem",padding:"2px 6px",borderRadius:3,background:c.badgeBg,color:c.badgeC}}>{c.badge}</span>
              </div>
              <div style={{fontSize:".68rem",color:"var(--text-muted)",lineHeight:1.5}}>{c.desc}</div>
            </div>
          ))}
        </div>
      </>)}
      {/* User has no own holdings but has shared data */}
      {loaded&&!demoMode&&holdings.length===0&&sharedHoldings.length>0&&(
        <div style={{textAlign:"center",padding:"1.5rem 1rem",marginBottom:"1rem",background:"rgba(167,139,250,.04)",border:"1px solid rgba(167,139,250,.15)",borderRadius:12}}>
          <div style={{fontSize:".85rem",color:"rgba(167,139,250,.8)",marginBottom:".3rem"}}>You're viewing shared portfolios</div>
          <div style={{fontSize:".72rem",color:"var(--text-dim)"}}>
            {sharedHoldings.length} holdings from {sharedWithMe.length} shared portfolio{sharedWithMe.length>1?"s":""}. Add your own holdings to see the combined family view.
          </div>
        </div>
      )}
      {/* ── NRI Portfolio Summary — 3-panel view ── */}
      {(()=>{
        const nm = nriMetrics || {};
        const hasIndia = nm.india_cur > 0;
        const hasUS    = nm.us_cur > 0;
        const panelStyle = {
          flex:1, minWidth:0,
          background:"var(--bg-muted)",
          border:"1px solid var(--border)",
          borderRadius:10, padding:".9rem 1rem",
        };
        const labelStyle = {fontSize:".65rem",color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:".3rem",display:"flex",alignItems:"center",gap:".3rem"};
        const bigVal = {fontFamily:"'DM Mono',monospace",fontSize:"1.25rem",fontWeight:700,color:"var(--text)",lineHeight:1};
        const secVal = {fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"var(--text-dim)",marginTop:".2rem"};
        const rowVal = {display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:".55rem",fontSize:".78rem"};
        const gainColor = g => g >= 0 ? "#4caf9a" : "#e07c5a";
        const sign     = g => g >= 0 ? "+" : "−";
        return (
          <div style={{display:"flex",gap:".6rem",marginBottom:"1rem",flexWrap:"wrap"}}>
            {/* India panel */}
            {hasIndia&&(
              <div style={panelStyle}>
                <div style={labelStyle}>🇮🇳 <span>India Portfolio</span></div>
                <div style={bigVal}>{fmtCrINR(nm.india_cur)}</div>
                <div style={secVal}>≈ {fmtCrUSD(nm.india_cur / nm.liveRate)}</div>
                <div style={rowVal}>
                  <span style={{color:"var(--text-dim)"}}>Invested</span>
                  <span style={{fontFamily:"'DM Mono',monospace",color:"var(--text)"}}>{fmtCrINR(nm.india_inv)}</span>
                </div>
                <div style={rowVal}>
                  <span style={{color:"var(--text-dim)"}}>Gain</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:gainColor(nm.india_gain)}}>
                    {sign(nm.india_gain)}{fmtCrINR(Math.abs(nm.india_gain))}
                    <span style={{fontSize:".68rem",marginLeft:".3rem"}}>({fmtPct(nm.india_pct)})</span>
                  </span>
                </div>
              </div>
            )}
            {/* US panel */}
            {hasUS&&(
              <div style={panelStyle}>
                <div style={labelStyle}>🇺🇸 <span>US Portfolio</span></div>
                <div style={bigVal}>{fmtCrUSD(nm.us_cur)}</div>
                <div style={secVal}>≈ {fmtCrINR(nm.us_cur * nm.liveRate)}</div>
                <div style={rowVal}>
                  <span style={{color:"var(--text-dim)"}}>Invested</span>
                  <span style={{fontFamily:"'DM Mono',monospace",color:"var(--text)"}}>{fmtCrUSD(nm.us_inv)}</span>
                </div>
                <div style={rowVal}>
                  <span style={{color:"var(--text-dim)"}}>Gain</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:gainColor(nm.us_gain)}}>
                    {sign(nm.us_gain)}{fmtCrUSD(Math.abs(nm.us_gain))}
                    <span style={{fontSize:".68rem",marginLeft:".3rem"}}>({fmtPct(nm.us_pct)})</span>
                  </span>
                </div>
              </div>
            )}
            {/* Combined panel — always shown */}
            <div style={{...panelStyle, border:"1px solid rgba(201,168,76,.3)", background:"rgba(201,168,76,.03)"}}>
              <div style={labelStyle}>📊 <span>Combined (₹)</span></div>
              <div style={bigVal}>{fmtCrINR(nm.combined_cur || totCur)}</div>
              <div style={secVal}>≈ {fmtCrUSD((nm.combined_cur || totCur) / (nm.liveRate||94.5))} · {holdings.length} holdings</div>
              <div style={rowVal}>
                <span style={{color:"var(--text-dim)"}}>Invested</span>
                <span style={{fontFamily:"'DM Mono',monospace",color:"var(--text)"}}>{fmtCrINR(nm.combined_inv || totInv)}</span>
              </div>
              <div style={rowVal}>
                <span style={{color:"var(--text-dim)"}}>Gain</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:gainColor(nm.combined_gain || totGain)}}>
                  {sign(nm.combined_gain || totGain)}{fmtCrINR(Math.abs(nm.combined_gain || totGain))}
                  <span style={{fontSize:".68rem",marginLeft:".3rem"}}>({fmtPct(nm.combined_pct || totPct)})</span>
                </span>
              </div>
              {/* FX impact strip — only shown when there are US holdings */}
              {hasUS && nm.fx_gain != null && Math.abs(nm.fx_gain) > 100 && (
                <div style={{marginTop:".55rem",paddingTop:".45rem",borderTop:"1px solid var(--border)",fontSize:".65rem",color:"var(--text-muted)",display:"flex",justifyContent:"space-between"}}>
                  <span>FX impact (₹/$)</span>
                  <span style={{fontFamily:"'DM Mono',monospace",color:gainColor(nm.fx_gain)}}>
                    {sign(nm.fx_gain)}{fmtCrINR(Math.abs(nm.fx_gain))}
                  </span>
                </div>
              )}
              {/* Net worth strip — shown when liabilities exist */}
              {(liabilities||[]).length>0&&(()=>{
                const totalLiab=(liabilities||[]).reduce((s,l)=>s+(+l.outstanding_amount||0),0);
                const assets=nm.combined_cur||totCur;
                const netWorth=assets-totalLiab;
                return(
                  <div style={{marginTop:".55rem",paddingTop:".45rem",borderTop:"1px solid rgba(224,124,90,.3)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:".65rem",color:"var(--text-muted)",marginBottom:".2rem"}}>
                      <span>Total Liabilities</span>
                      <span style={{fontFamily:"'DM Mono',monospace",color:"#e07c5a"}}>−{fmtCrINR(totalLiab)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:".72rem",fontWeight:600}}>
                      <span style={{color:"var(--text)"}}>True Net Worth</span>
                      <span style={{fontFamily:"'DM Mono',monospace",color:netWorth>=0?"#4caf9a":"#e07c5a"}}>{fmtCrINR(netWorth)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* Liabilities tracking */}
      {setLiabilities&&(
        <LiabilitiesPanel
          liabilities={liabilities||[]}
          setLiabilities={setLiabilities}
          fmtCrINR={fmtCrINR}
        />
      )}

      <div className="sg">
        <div className="card"><div className="ctitle">Asset Allocation</div>
          {byType.length===0&&<div className="empty">No holdings</div>}
          {byType.map(row=>{
            const a=AT[row.t],g=row.v-row.i;
            // US asset types: show $ value; Indian/other: show ₹ value
            const isUS=["US_STOCK","US_ETF","US_BOND","CRYPTO","CASH"].includes(row.t);
            const dispVal=isUS?fmtCrUSD(row.v/(nriMetrics?.liveRate||94.5)):fmtCrINR(row.v);
            return(<div key={row.t} className="arow"><div className="aicon">{a.icon}</div><div className="ainfo"><div className="aname">{a.label}</div><div className="abg"><div className="afill" style={{width:`${row.pct}%`,background:a.color}}/></div></div><div className="argt"><div className="aval">{dispVal}</div><div className={`apct${g>=0?" gain":" loss"}`}>{row.pct.toFixed(1)}% · {fmtPct(row.i>0?(g/row.i)*100:0)}</div></div></div>);
          })}
        </div>
        <div className="card"><div className="ctitle">Member Breakdown</div>
          {mSum.map(m=>{const share=totCur>0?(m.cur/totCur)*100:0;return(<div key={m.id} className="msrow">
<div className="av">{m.name[0]}</div>
<div style={{flex:1}}>
  <div style={{fontSize:".88rem",color:"var(--text)"}}>{m.name}</div>
  <div style={{fontSize:".68rem",color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".05em"}}>{m.relation}</div>
  <div style={{marginTop:".35rem",height:3,background:"var(--bg-hover)",borderRadius:2,overflow:"hidden"}}>
    <div style={{height:"100%",width:`${share}%`,background:"rgba(201,168,76,.55)",borderRadius:2,transition:"width .8s ease"}}/>
  </div>
</div>
<div style={{marginLeft:".75rem",textAlign:"right",minWidth:90}}>
  <div style={{fontFamily:"'DM Mono',monospace",fontSize:".85rem",color:"var(--text)"}}>{fmt(m.cur)}</div>
  <div style={{display:"flex",gap:".4rem",justifyContent:"flex-end",marginTop:".18rem"}}>
    <span style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"#c9a84c",fontWeight:600}}>{share.toFixed(1)}%</span>
    <span style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"var(--text-dim)"}}>|</span>
    <span className={m.gain>=0?"gain":"loss"} style={{fontSize:".68rem"}}>{fmtPct(m.pct)}</span>
  </div>
</div>
</div>);})}
        </div>
      </div>
      <div className="card"><div className="ctitle">Category Distribution</div><DonutChart data={byType} total={totCur} AT={AT}/></div>

      {/* ── DATA FRESHNESS CARD ── */}
      {(()=>{
        const srcMap = {};
        for (const h of allHoldings) {
          const src = h.source === "cas" ? "CAS" : h.source === "snaptrade" ? "SnapTrade" : h.source === "csv" ? "CSV" : "Manual";
          const mem = allMembers.find(m => m.id === h.member_id)?.name || (h._shared_owner ? h._shared_owner : "Unassigned");
          const key = `${src}|${mem}`;
          if (!srcMap[key]) srcMap[key] = { src, member: mem, date: h.source_date || null, count: 0, hasLive: src === "SnapTrade", lastRefresh: null, casPeriodStart: null, casPeriodEnd: null, importDate: null };
          srcMap[key].count++;
          if (h.source_date && (!srcMap[key].date || h.source_date > srcMap[key].date)) srcMap[key].date = h.source_date;
          if (h.price_fetched_at && (!srcMap[key].lastRefresh || h.price_fetched_at > srcMap[key].lastRefresh)) srcMap[key].lastRefresh = h.price_fetched_at;
          if (h.cas_period_start && (!srcMap[key].casPeriodStart || h.cas_period_start < srcMap[key].casPeriodStart)) srcMap[key].casPeriodStart = h.cas_period_start;
          if (h.cas_period_end && (!srcMap[key].casPeriodEnd || h.cas_period_end > srcMap[key].casPeriodEnd)) srcMap[key].casPeriodEnd = h.cas_period_end;
          if (h.created_at && (!srcMap[key].importDate || h.created_at > srcMap[key].importDate)) srcMap[key].importDate = h.created_at;
        }
        const rows = Object.values(srcMap);
        if (rows.length === 0) return null;
        const dfmt = (d) => new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
        const dfmtShort = (d) => new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
        return (
          <div className="card">
            <div className="ctitle">Data Freshness</div>
            <div style={{display:"grid",gap:".4rem"}}>
              {rows.map((r,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .65rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:6}}>
                  <div style={{fontSize:".95rem",width:22,textAlign:"center"}}>{r.src==="CAS"?"📥":r.src==="SnapTrade"?"🔗":r.src==="CSV"?"📄":"✍️"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".75rem",color:"var(--text)",fontWeight:500}}>{r.member}</div>
                    <div style={{fontSize:".62rem",color:"var(--text-muted)"}}>{r.src} · {r.count} holding{r.count!==1?"s":""}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {r.hasLive ? (
                      <div style={{fontSize:".72rem",color:"#4caf9a",fontWeight:500}}>Live</div>
                    ) : r.casPeriodEnd ? (
                      <>
                        <div style={{fontSize:".72rem",color:"#c9a84c",fontWeight:500}}>{r.casPeriodStart ? `${dfmtShort(r.casPeriodStart)} → ${dfmt(r.casPeriodEnd)}` : dfmt(r.casPeriodEnd)}</div>
                        {r.importDate && <div style={{fontSize:".58rem",color:"var(--text-muted)"}}>Imported: {dfmtShort(r.importDate)}</div>}
                      </>
                    ) : r.date ? (
                      <>
                        <div style={{fontSize:".72rem",color:"#c9a84c",fontWeight:500}}>{dfmt(r.date)}</div>
                        {r.importDate && r.importDate.slice(0,10) !== r.date && <div style={{fontSize:".58rem",color:"var(--text-muted)"}}>Imported: {dfmtShort(r.importDate)}</div>}
                      </>
                    ) : r.lastRefresh ? (
                      <div style={{fontSize:".72rem",color:"rgba(201,168,76,.6)",fontWeight:500}}>Price: {dfmt(r.lastRefresh)}</div>
                    ) : (
                      <div style={{fontSize:".72rem",color:"var(--text-muted)"}}>—</div>
                    )}
                    {r.lastRefresh && (r.casPeriodEnd || r.date) && (
                      <div style={{fontSize:".58rem",color:"var(--text-muted)"}}>Price: {dfmtShort(r.lastRefresh)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── NET WORTH TIMELINE ── */}
      {(()=>{
        const nwHoldings = nwMember==="all" ? allHoldings : allHoldings.filter(h=>h.member_id===nwMember);
        const nwCur = nwHoldings.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
        const nwInv = nwHoldings.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);

        // Build cumulative invested per month from transactions
        const monthlyInv = {};
        for(const h of nwHoldings){
          for(const t of (h.transactions||[])){
            const mo=t.txn_date.slice(0,7);
            const delta=(t.txn_type==="BUY"?1:-1)*(+t.units)*(+t.price);
            monthlyInv[mo]=(monthlyInv[mo]||0)+delta;
          }
          if(["FD","PPF","EPF","REAL_ESTATE"].includes(h.type)&&h.start_date){
            const mo=h.start_date.slice(0,7);
            monthlyInv[mo]=(monthlyInv[mo]||0)+(invINRCache.get(h.id)||0);
          }
        }
        // Convert to cumulative
        const sortedMos = Object.keys(monthlyInv).sort();
        let cum=0; const cumByMo={};
        for(const mo of sortedMos){ cum+=monthlyInv[mo]; cumByMo[mo]=Math.max(0,cum); }
        const last24=sortedMos.slice(-24);
        if(last24.length<2) return null;

        const [hovIdx,setHovIdx]=window.__nwHov||[null,null];
        const maxV=Math.max(...last24.map(m=>cumByMo[m]),nwCur)*1.05;
        const W=580,H=180,pad={l:58,r:16,t:14,b:32};
        const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
        const xPos=(i)=>pad.l+i*(iW/Math.max(last24.length-1,1));
        const yPos=(v)=>pad.t+iH-((v/maxV)*iH);
        const pts=last24.map((m,i)=>`${xPos(i)},${yPos(cumByMo[m]||0)}`).join(" ");
        const labels=last24.filter((_,i)=>i===0||(i%4===0)||i===last24.length-1);

        return(
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".85rem",flexWrap:"wrap",gap:".5rem"}}>
            <div className="ctitle" style={{margin:0}}>Net Worth Timeline</div>
            <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
              <select className="fi fs" style={{width:140,marginBottom:0,fontSize:".72rem",padding:".28rem .6rem"}}
                value={nwMember} onChange={e=>setNwMember(e.target.value)}>
                <option value="all">All Members</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",overflow:"visible"}}
            onMouseLeave={()=>{if(window.__nwSetHov)window.__nwSetHov(null);}}>
            <defs>
              <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.3"/>
                <stop offset="100%" stopColor="#c9a84c" stopOpacity="0.02"/>
              </linearGradient>
            </defs>
            {/* Y grid + labels */}
            {[0,.25,.5,.75,1].map(p=>{
              const y=pad.t+iH*(1-p);
              return <g key={p}>
                <line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="#D1E8E0" strokeWidth="1"/>
                <text x={pad.l-6} y={y+4} textAnchor="end" fill="#7FA898" fontSize="9" fontFamily="'DM Mono',monospace">
                  {fmtCr(maxV*p)}
                </text>
              </g>;
            })}
            {/* Area fill */}
            <polygon points={`${pad.l},${pad.t+iH} ${pts} ${xPos(last24.length-1)},${pad.t+iH}`} fill="url(#nwGrad)"/>
            {/* Main line */}
            <polyline points={pts} fill="none" stroke="#c9a84c" strokeWidth="2" strokeLinejoin="round"/>
            {/* Today dot */}
            <circle cx={xPos(last24.length-1)} cy={yPos(nwCur)} r="5" fill="#4caf9a" stroke="#0c1526" strokeWidth="1.5"/>
            <line x1={xPos(last24.length-1)} y1={yPos(cumByMo[last24[last24.length-1]]||0)}
              x2={xPos(last24.length-1)} y2={yPos(nwCur)}
              stroke="#4caf9a" strokeWidth="1.2" strokeDasharray="3,2"/>
            {/* Hover dots with value tooltip */}
            {last24.map((m,i)=>{
              const v=cumByMo[m]||0;
              const cx=xPos(i),cy=yPos(v);
              return <g key={m}>
                <circle cx={cx} cy={cy} r="4" fill="#c9a84c" opacity="0" style={{cursor:"crosshair"}}
                  onMouseEnter={()=>{if(window.__nwSetHov)window.__nwSetHov(i);}}/>
                {/* Always show value above dot for every other point */}
                {(i%2===0||i===last24.length-1)&&(
                  <text x={cx} y={cy-8} textAnchor="middle" fill="rgba(201,168,76,.7)" fontSize="7.5" fontFamily="'DM Mono',monospace">
                    {fmtCr(v)}
                  </text>
                )}
              </g>;
            })}
            {/* X labels */}
            {last24.map((m,i)=>labels.includes(m)?(
              <text key={m} x={xPos(i)} y={H-4} textAnchor="middle" fill="#5E7A72" fontSize="8.5">
                {new Date(m+"-01").toLocaleDateString("en-IN",{month:"short",year:"2-digit"})}
              </text>
            ):null)}
          </svg>
          <div style={{display:"flex",gap:"1.5rem",marginTop:".6rem",fontSize:".72rem"}}>
            <div><span style={{color:"var(--text-dim)"}}>Invested: </span><span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{fmtCr(nwInv)}</span></div>
            <div><span style={{color:"var(--text-dim)"}}>Current: </span><span style={{fontFamily:"'DM Mono',monospace",color:"var(--text)"}}>{fmtCr(nwCur)}</span></div>
            <div><span style={{color:"var(--text-dim)"}}>Gain: </span><span style={{fontFamily:"'DM Mono',monospace",color:nwCur>=nwInv?"#4caf9a":"#e07c5a"}}>{fmtCr(nwCur-nwInv)} ({fmtPct(nwInv>0?(nwCur-nwInv)/nwInv*100:0)})</span></div>
          </div>
        </div>);
      })()}

      {/* ── WEALTH PROGRESSION (from monthly snapshots) ── */}
      {wealthSnapshots.length>=2&&(()=>{
        const snaps=wealthSnapshots.slice(-24);
        const maxV=Math.max(...snaps.map(s=>Math.max(s.total_current,s.total_invested)))*1.08;
        const W=580,H=220,pad={l:62,r:16,t:14,b:36};
        const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
        const xP=(i)=>pad.l+i*(iW/Math.max(snaps.length-1,1));
        const yP=(v)=>pad.t+iH-((v/maxV)*iH);
        const curPts=snaps.map((s,i)=>`${xP(i)},${yP(s.total_current)}`).join(" ");
        const invPts=snaps.map((s,i)=>`${xP(i)},${yP(s.total_invested)}`).join(" ");
        const fillPts=`${xP(0)},${yP(0)} ${curPts} ${xP(snaps.length-1)},${yP(0)}`;
        const latestSnap=snaps[snaps.length-1];
        const totalGain=latestSnap.total_current-latestSnap.total_invested;
        const totalPct=latestSnap.total_invested>0?((totalGain/latestSnap.total_invested)*100).toFixed(1):"0";
        const monthGrowth=snaps.length>=2?latestSnap.total_current-snaps[snaps.length-2].total_current:0;
        const step=snaps.length>12?4:snaps.length>6?3:2;
        const showLabel=(i)=>i===0||i===snaps.length-1||(i%step===0);
        return(
        <div className="card" style={{marginTop:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".8rem",flexWrap:"wrap",gap:".5rem"}}>
            <div className="ctitle" style={{margin:0}}>📈 Wealth Progression</div>
            <div style={{display:"flex",gap:".6rem",alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:".65rem",color:"var(--text-dim)"}}>{snaps.length} months</span>
              <span style={{fontSize:".68rem",color:totalGain>=0?"#4caf9a":"#e07c5a"}}>{totalGain>=0?"+":""}{fmtCr(totalGain)} ({totalPct}%)</span>
              {/* Benchmark period selector */}
              <select className="fi fs" style={{width:68,marginBottom:0,fontSize:".65rem",padding:".2rem .4rem"}}
                value={bmPeriod} onChange={e=>{setBmPeriod(e.target.value);api(`/api/benchmark?period=${e.target.value}`).then(d=>setBenchmark(d)).catch(()=>{});}}>
                {["1Y","3Y","5Y","ALL"].map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:"1rem",marginBottom:".8rem",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:"rgba(76,175,154,.06)",border:"1px solid rgba(76,175,154,.15)"}}>
              <div style={{fontSize:".62rem",color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:".05em"}}>Current Value</div>
              <div style={{fontSize:".9rem",fontWeight:600,color:"#4caf9a",fontFamily:"'DM Mono',monospace"}}>{fmtCr(latestSnap.total_current)}</div>
            </div>
            <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.15)"}}>
              <div style={{fontSize:".62rem",color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:".05em"}}>Total Invested</div>
              <div style={{fontSize:".9rem",fontWeight:600,color:"#c9a84c",fontFamily:"'DM Mono',monospace"}}>{fmtCr(latestSnap.total_invested)}</div>
            </div>
            <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:monthGrowth>=0?"rgba(76,175,154,.06)":"rgba(224,124,90,.06)",border:`1px solid ${monthGrowth>=0?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)"}`}}>
              <div style={{fontSize:".62rem",color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:".05em"}}>Month Change</div>
              <div style={{fontSize:".9rem",fontWeight:600,color:monthGrowth>=0?"#4caf9a":"#e07c5a",fontFamily:"'DM Mono',monospace"}}>{monthGrowth>=0?"+":""}{fmtCr(monthGrowth)}</div>
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block"}}>
            {[0,0.25,0.5,0.75,1].map(f=>{const y=pad.t+iH*(1-f);const val=maxV*f;return<g key={f}><line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="#D1E8E0" strokeWidth={0.5}/><text x={pad.l-6} y={y+3} fill="#7FA898" fontSize={8} textAnchor="end" fontFamily="DM Mono,monospace">{val>=10000000?(val/10000000).toFixed(1)+"Cr":val>=100000?(val/100000).toFixed(0)+"L":Math.round(val).toLocaleString("en-IN")}</text></g>;})}
            <polygon points={fillPts} fill="rgba(76,175,154,.08)"/>
            <polyline points={invPts} fill="none" stroke="#c9a84c" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}/>
            <polyline points={curPts} fill="none" stroke="#4caf9a" strokeWidth={2}/>
            {snaps.map((s,i)=>(<g key={i}><circle cx={xP(i)} cy={yP(s.total_current)} r={snaps.length>15?2:3} fill="#4caf9a"/>{showLabel(i)&&(<text x={xP(i)} y={H-pad.b+14} fill="#7FA898" fontSize={7.5} textAnchor={i===0?"start":i===snaps.length-1?"end":"middle"} fontFamily="DM Mono,monospace">{(()=>{const[y,m]=s.snapshot_month.split("-");return["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]+"'"+y.slice(2);})()}</text>)}{s.source==="cas_import"&&<circle cx={xP(i)} cy={yP(s.total_current)-8} r={2} fill="#a084ca" opacity={0.7}/>}</g>))}
            <g transform={`translate(${pad.l},${H-6})`}><line x1={0} y1={0} x2={14} y2={0} stroke="#4caf9a" strokeWidth={2}/><text x={18} y={3} fill="#7FA898" fontSize={7}>Current</text><line x1={60} y1={0} x2={74} y2={0} stroke="#c9a84c" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}/><text x={78} y={3} fill="#7FA898" fontSize={7}>Invested</text><circle cx={125} cy={0} r={2} fill="#a084ca" opacity={0.7}/><text x={130} y={3} fill="#7FA898" fontSize={7}>CAS import</text>
              {benchmark?.nifty50?.length&&<><line x1={165} y1={0} x2={179} y2={0} stroke="#f4a261" strokeWidth={1.5} strokeDasharray="2,2"/><text x={183} y={3} fill="#7FA898" fontSize={7}>Nifty 50</text></>}
              {benchmark?.sp500?.length&&<><line x1={228} y1={0} x2={242} y2={0} stroke="#5a9ce0" strokeWidth={1.5} strokeDasharray="2,2"/><text x={246} y={3} fill="#7FA898" fontSize={7}>S&P 500</text></>}
            </g>
            {/* Benchmark overlay — normalized % return mapped to portfolio scale */}
            {(()=>{
              if(!benchmark?.nifty50?.length||snaps.length<2) return null;
              // Map benchmark dates to snapshot months
              const snapMonths=snaps.map(s=>s.snapshot_month);
              const bmBase=snaps[0].total_current;
              const renderBmLine=(series,color)=>{
                const pts=snapMonths.map((mo,i)=>{
                  const bmPt=series.find(p=>p.date===mo)||series.reduce((best,p)=>(!best||Math.abs(p.date.localeCompare(mo))<Math.abs(best.date.localeCompare(mo)))?p:best,null);
                  if(!bmPt) return null;
                  const scaledVal=bmBase*(1+bmPt.pct/100);
                  return `${xP(i)},${yP(scaledVal)}`;
                }).filter(Boolean);
                if(pts.length<2) return null;
                return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.6}/>;
              };
              return<>{renderBmLine(benchmark.nifty50,"#f4a261")}{renderBmLine(benchmark.sp500,"#5a9ce0")}</>;
            })()}
          </svg>
          <details style={{marginTop:".6rem"}}>
            <summary style={{fontSize:".68rem",color:"var(--text-dim)",cursor:"pointer",userSelect:"none"}}>View monthly data ({snaps.length} snapshots)</summary>
            <div style={{overflowX:"auto",marginTop:".4rem"}}>
              <table className="ht" style={{fontSize:".7rem"}}><thead><tr><th>Month</th><th className="r">Invested</th><th className="r">Current</th><th className="r">Gain</th><th className="r">Return</th><th>Source</th></tr></thead>
              <tbody>{[...snaps].reverse().map(s=>{const gain=s.total_current-s.total_invested;const pct=s.total_invested>0?((gain/s.total_invested)*100).toFixed(1):"0";const[y,m]=s.snapshot_month.split("-");const mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1];return<tr key={s.snapshot_month}><td style={{whiteSpace:"nowrap"}}>{mon} {y}</td><td className="r mono">{fmtCr(s.total_invested)}</td><td className="r mono">{fmtCr(s.total_current)}</td><td className={`r mono ${gain>=0?"gain":"loss"}`}>{gain>=0?"+":""}{fmtCr(gain)}</td><td className={`r ${gain>=0?"gain":"loss"}`}>{pct}%</td><td style={{fontSize:".62rem",color:"var(--text-muted)"}}>{s.source==="cas_import"?"📥 CAS":s.source==="price_refresh"?"🔄 Refresh":"📝 Manual"}{s.cas_statement_date?` (${s.cas_statement_date})`:""}</td></tr>;})}</tbody></table>
            </div>
          </details>
        </div>);
      })()}
    </>
  );
}
