// HoldingsTab.jsx — lines 2866–3205 of App.jsx

import { useState } from "react";
import ConcallPanel from "./ConcallPanel.jsx";

const CONCALL_TYPES = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF"]);

export default function HoldingsTab({
  // Data
  visH,
  allMembers,
  demoMode,
  // Caches
  valINRCache,
  invINRCache,
  valNativeCache,
  invNativeCache,
  // Filter / sort state (shared across tabs via parent)
  filterType,
  setFilterType,
  sortCol,
  setSortCol,
  sortDir,
  setSortDir,
  expandedHolding,
  setExpandedHolding,
  // Actions (functions defined in parent, touch shared state)
  toggleSort,
  editH,
  deleteHolding,
  setTxnForm,
  setTxnHolding,
  setArtifactHolding,
  setModal,
  setShowImportHub,
  loadDemoData,
  // Formatting helpers
  fmt,
  fmtCr,
  fmtCrINR,
  fmtCrNative,
  fmtNative,
  fmtPct,
  ago,
  // Asset type map + USD helpers
  AT,
  isUSDHolding,
  // Transaction form blank
  BT,
}) {
  const [concallHolding, setConcallHolding] = useState(null);

  return (
    <div className="card">
      {/* ── Data Freshness Banner ── */}
      {(()=>{
        const srcDates = {};
        for (const h of visH) {
          if (!h.source_date) continue;
          const src = h.source === "cas" ? (h.brokerage_name || "CAS") : (h.source || "manual");
          const mem = allMembers.find(m => m.id === h.member_id);
          const memName = mem?.name || "Unassigned";
          const key = `${src}|${memName}`;
          if (!srcDates[key] || h.source_date > srcDates[key].date) {
            srcDates[key] = { date: h.source_date, src, member: memName };
          }
        }
        const entries = Object.values(srcDates);
        if (entries.length === 0) return null;
        const allSame = entries.every(e => e.date === entries[0].date);
        return (
          <div style={{background:"linear-gradient(135deg,rgba(76,175,154,.08),rgba(160,132,202,.06))",border:"1px solid rgba(76,175,154,.18)",borderRadius:8,padding:".55rem .85rem",marginBottom:".65rem",display:"flex",alignItems:"center",gap:".65rem"}}>
            <div style={{fontSize:"1.15rem",lineHeight:1}}>📅</div>
            <div style={{flex:1}}>
              {allSame ? (
                <div style={{fontSize:".75rem",color:"#4caf9a",fontWeight:500}}>
                  Data as on {new Date(entries[0].date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                  <span style={{color:"var(--text-muted)",fontWeight:400,marginLeft:".5rem"}}>{entries.length} source{entries.length>1?"s":""}</span>
                </div>
              ) : (
                <div style={{display:"flex",flexWrap:"wrap",gap:".25rem .8rem"}}>
                  {entries.map((e,i) => (
                    <div key={i} style={{fontSize:".72rem"}}>
                      <span style={{color:"var(--text-dim)"}}>{e.member}:</span>{" "}
                      <span style={{color:"#4caf9a",fontWeight:500}}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span>
                      <span style={{color:"var(--text-muted)",marginLeft:".3rem",fontSize:".62rem"}}>{e.src}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:".6rem",color:"var(--text-muted)",marginTop:".15rem"}}>NAVs & prices reflect the CAS statement date, not live market</div>
            </div>
          </div>
        );
      })()}
      <div className="tbar">
        <div className={`fchip${filterType==="ALL"?" act":""}`} onClick={()=>setFilterType("ALL")}>All</div>
        {Object.entries(AT).map(([k,v])=>(<div key={k} className={`fchip${filterType===k?" act":""}`} onClick={()=>setFilterType(k)}>{v.icon} {v.label}</div>))}
      </div>
      {visH.length===0?<div className="empty">{demoMode?"No holdings match the current filter":"No holdings yet"} — <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setModal("add")}>add to portfolio</span>{!demoMode&&setShowImportHub&&<>{" or "}<span style={{color:"#5ea9a0",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setShowImportHub(true)}>import from a broker</span></>}{!demoMode&&<>{" or "}<span style={{color:"#a084ca",cursor:"pointer",textDecoration:"underline"}} onClick={loadDemoData}>try sample data</span></>}</div>:(<>
        <div className="ht-desktop"><div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",margin:"0 -0.9rem",padding:"0 0.9rem"}}>
          <table className="ht">
            <thead><tr>
              {[
                {key:"name",    label:"Asset",       align:""},
                {key:"ticker",  label:"Ticker",      align:""},
                {key:"type",    label:"Type",        align:""},
                {key:"member",  label:"Member",      align:""},
                {key:"brokerage",label:"Source",     align:""},
                {key:"units",   label:"Units",       align:"r", tip:"Net units held after all buys minus sells"},
                {key:"avg",     label:"Avg Price",   align:"r", tip:"Weighted average purchase price across all buy transactions"},
                {key:"price",   label:"Cur. Price",  align:"r", tip:"Latest market price — live-fetched or manually entered"},
                {key:"current", label:"Value",       align:"r", tip:"Current market value = units × current price"},
                {key:"gain",    label:"P&L",         align:"r", tip:"Profit & Loss = current value minus total invested (unrealized)"},
              ].map(c=>(
                <th key={c.key} className={c.align} title={c.title||undefined}
                  onClick={()=>toggleSort(c.key)}
                  style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}>
                  {c.label}
                  {c.tip&&<span title={c.tip} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:13,height:13,borderRadius:"50%",border:"1px solid var(--border)",fontSize:"8px",color:"var(--text-muted)",marginLeft:3,cursor:"help",verticalAlign:"middle",fontStyle:"normal",fontWeight:400}}>?</span>}
                  {sortCol===c.key
                    ? <span style={{marginLeft:3,fontSize:".55rem",opacity:.7}}>{sortDir==="asc"?"▲":"▼"}</span>
                    : <span style={{marginLeft:3,fontSize:".55rem",opacity:.25}}>⇅</span>}
                </th>
              ))}
              <th/>
            </tr></thead>
            <tbody>
              {(()=>{
                // Group holdings into 3 categories — CASH split by currency
                const US_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
                const IN_TYPES = new Set(["IN_STOCK","IN_ETF","MF"]);
                const isUSCash = h => h.type === "CASH" && isUSDHolding(h);
                const isINCash = h => h.type === "CASH" && !isUSDHolding(h);
                const groups = [
                  { key: "us", label: "US Assets", icon: "$", color: "#5a9ce0", items: visH.filter(h => US_TYPES.has(h.type) || isUSCash(h)) },
                  { key: "in", label: "Indian Assets", icon: "₹", color: "#e07c5a", items: visH.filter(h => IN_TYPES.has(h.type) || isINCash(h)) },
                  { key: "other", label: "Other Assets", icon: "📦", color: "#c9a84c", items: visH.filter(h => !US_TYPES.has(h.type) && !IN_TYPES.has(h.type) && h.type !== "CASH") },
                ].filter(g => g.items.length > 0);

                // Total column count: 10 data columns + 1 action = 11
                const COL_COUNT = 11;

                return groups.map((grp, gi) => {
                  const isUSGrp = grp.key === "us";
                  // US groups stay in $; Indian/Other groups use ₹ (INR-converted)
                  const grpCur = isUSGrp
                    ? grp.items.reduce((s, h) => s + (valNativeCache.get(h.id)||0), 0)
                    : grp.items.reduce((s, h) => s + (valINRCache.get(h.id)||0), 0);
                  const grpInv = isUSGrp
                    ? grp.items.reduce((s, h) => { const v=invNativeCache.get(h.id); return v==null?s:s+v; }, 0)
                    : grp.items.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null?s:s+v; }, 0);
                  const grpCurINR = isUSGrp ? grp.items.reduce((s, h) => s + (valINRCache.get(h.id)||0), 0) : grpCur;
                  const grpG = grpCur - grpInv;
                  const grpP = grpInv > 0 ? (grpG / grpInv) * 100 : 0;
                  const fmtGrpCr = n => isUSGrp ? fmtCrNative(n, {currency:"USD"}) : fmtCr(n);
                  return [
                    // Spacer row between groups (skip for first)
                    gi > 0 && <tr key={`spc_${grp.key}`}><td colSpan={11} style={{padding:0,height:"18px",background:"transparent",border:"none"}}/></tr>,
                    // Section header row
                    <tr key={`hdr_${grp.key}`} style={{background:`${grp.color}0D`}}>
                      <td colSpan={8} style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span style={{fontSize:".78rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>
                          {grp.icon} {grp.label}
                        </span>
                        <span style={{fontSize:".62rem",color:"var(--text-muted)",marginLeft:10}}>{grp.items.length} holding{grp.items.length!==1?"s":""}</span>
                      </td>
                      <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:".76rem",color:grp.color,fontWeight:600}}>{fmtGrpCr(grpCur)}</span>
                        {isUSGrp
                          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"rgba(201,168,76,.75)",fontWeight:600}}>≈ {fmtCrINR(grpCurINR)}</div>
                          : null}
                      </td>
                      <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span className={`mono${grpG>=0?" gain":" loss"}`} style={{fontSize:".72rem",fontWeight:600}}>{grpG>=0?"+":""}{fmtGrpCr(grpG)} ({fmtPct(grpP)})</span>
                      </td>
                      <td style={{borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}/>
                    </tr>,
                    // Holdings rows within this group
                    ...grp.items.map(h => {
                  const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id),hasInv=inv!=null&&inv>0,g=hasInv?cur-inv:null,p=hasInv?(g/inv)*100:null;
                  const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                  const a = h.type==="CASH" ? {..._a, label: isUSDHolding(h)?"Cash USD":"Cash INR", icon: isUSDHolding(h)?"💵":"₹"} : _a;
                  const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                  const isLive=!!h.price_fetched_at;
                  const units   = h.net_units ?? h.units ?? null;
                  const avgCost = h.avg_cost  ?? h.purchase_price ?? h.purchase_nav ?? null;
                  const isUS    = isUSDHolding(h);
                  const nativeSym = isUS ? "$" : "₹";
                  const fmtH = n => fmtNative(n, h);  // native formatter for this holding

                  const avgDisplay = avgCost
                    ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                        {nativeSym}{h.type==="MF"?Number(avgCost).toFixed(4):Number(avgCost).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—</span>;

                  const rawPrice = h.type==="MF" ? (h.current_nav||h.purchase_nav||null) : (h.current_price||h.purchase_price||null);
                  const curPriceDisplay = rawPrice
                    ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                        {nativeSym}{h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—</span>;

                  const brokerLabel = h.brokerage_name && h.brokerage_name !== "Unknown" ? h.brokerage_name : null;
                  const src = h.source || "manual";
                  const srcLabel = src === "snaptrade" ? "SnapTrade" : src === "csv" || src === "import" ? "CSV" : src === "cas" ? "CAS" : "Manual";

                  return [
                    <tr key={h.id}>
                      <td>
                        <div className="hn">{h.name}</div>
                        <div className="hm">{mn}</div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          const matLabel=new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"});
                          return<div style={{marginTop:3,display:"inline-flex",alignItems:"center",gap:4,
                            fontSize:".58rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                            background:mc+"22",color:mc,border:`1px solid ${mc}44`}}>
                            🏦 {matLabel} · {dLeft<=0?"Matured":`${dLeft}d`}
                            {h.interest_rate?<span style={{opacity:.8}}> · {h.interest_rate}%</span>:null}
                          </div>;
                        })()}
                      </td>
                      <td>
                        {(h.ticker||h.scheme_code)
                          ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".73rem",color:"#c9a84c",background:"rgba(201,168,76,.08)",padding:"2px 7px",borderRadius:3,border:"1px solid rgba(201,168,76,.2)"}}>
                              {h.ticker||`SC:${h.scheme_code}`}
                            </span>
                          : <span style={{fontSize:".7rem",color:"var(--text-muted)"}}>—</span>
                        }
                      </td>
                      <td><span className="tbadge2" style={{background:a.color+"22",color:a.color}}>{a.icon} {a.label}</span></td>
                      <td className="dim">
                        {mn}
                      </td>
                      <td>
                        {brokerLabel
                          ? <div><span style={{fontSize:".62rem",background:"rgba(167,139,250,.08)",color:"rgba(167,139,250,.7)",padding:"2px 6px",borderRadius:3,border:"1px solid rgba(167,139,250,.15)"}}>{brokerLabel}</span>
                              <div style={{fontSize:".55rem",color:"var(--text-muted)",marginTop:2}}>{srcLabel}</div></div>
                          : <span style={{fontSize:".62rem",color:"var(--text-muted)"}}>{srcLabel}</span>
                        }
                      </td>
                      <td className="r">
                        {units!=null
                          ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>{Number(units).toLocaleString("en-IN",{maximumFractionDigits:4})}</span>
                          : <span style={{color:"var(--text-muted)"}}>—</span>}
                      </td>
                      <td className="r">{avgDisplay}</td>
                      <td className="r">
                        <div>{curPriceDisplay}</div>
                        {isLive&&<div style={{fontSize:".52rem",color:"#4caf9a",marginTop:1}}>● {ago(h.price_fetched_at)}</div>}
                      </td>
                      <td className="r">
                        <div style={{fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:".78rem"}}>{fmtCrNative(cur, h)}</div>
                      </td>
                      <td className="r">
                        {g===null
                          ? <div style={{fontSize:".7rem",color:"var(--text-muted)"}}>— <span style={{fontSize:".6rem"}}>no cost basis</span></div>
                          : <>
                            <div className={`mono${g>=0?" gain":" loss"}`} style={{fontSize:".78rem"}}>{g>=0?"+":""}{fmtNative(Math.abs(g), h)}</div>
                            <div className={`mono${p>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(p)}</div>
                          </>
                        }
                      </td>
                      <td>
                        <div style={{display:"flex",gap:3}}>
                          {CONCALL_TYPES.has(h.type) && (
                            <button className="delbtn" title="Earnings call analysis" aria-label="Concall analysis"
                              onClick={()=>setConcallHolding(concallHolding?.id===h.id?null:h)}
                              style={{color:concallHolding?.id===h.id?"#a084ca":"var(--text-muted)",fontWeight:concallHolding?.id===h.id?700:400}}>
                              ✦
                            </button>
                          )}
                          <button className="delbtn" title="View transactions" aria-label="View transactions" onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}} style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)"}}>
                            📋{(h.transaction_count??h.transactions?.length??0)>0?` ${(h.transaction_count??h.transactions?.length??0)}`:""}
                          </button>
                          <button className="delbtn" title="Attach documents" aria-label="Attach documents" onClick={()=>setArtifactHolding(h)} style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)"}}>
                            📎{(h.artifacts||[]).length>0?` ${(h.artifacts||[]).length}`:""}
                          </button>
                          {(!h.source||h.source==="manual")&&<button className="delbtn" title="Modify holding" aria-label="Modify holding" style={{color:"rgba(90,156,224,.5)"}} onClick={()=>editH(h)}>✎</button>}
                          {(!h.source||h.source==="manual")&&<button className="delbtn" title="Delete holding" aria-label="Delete holding" onClick={()=>deleteHolding(h.id)}>✕</button>}
                        </div>
                      </td>
                    </tr>,
                    concallHolding?.id===h.id && (
                      <tr key={`concall_${h.id}`}>
                        <td colSpan={11} style={{padding:"0 .65rem .65rem",background:"rgba(160,132,202,.02)"}}>
                          <ConcallPanel holding={h} onClose={()=>setConcallHolding(null)} />
                        </td>
                      </tr>
                    ),
                  ];
                    })
                  ];
                });
              })()}
            </tbody>
            {/* Totals footer row */}
            {visH.length>0&&(()=>{
              const totI=visH.reduce((s,h)=>{ const v=invINRCache.get(h.id); return v==null?s:s+v; },0);
              const totC=visH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              const totG=totC-totI;
              const totP=totI>0?(totG/totI)*100:0;
              return(
              <tfoot>
                <tr style={{borderTop:"2px solid rgba(201,168,76,.2)"}}>
                  <td colSpan={8} style={{padding:".75rem .65rem",fontSize:".7rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-dim)",fontWeight:600}}>Total · {visH.length} holding{visH.length!==1?"s":""}</td>
                  <td className="r" style={{padding:".75rem .65rem"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#c9a84c",fontSize:".88rem"}}>{fmtCr(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"rgba(201,168,76,.8)",marginTop:1,fontWeight:600}}>≈ {fmtCrINR(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".62rem",color:"var(--text-muted)",marginTop:1}}>inv. {fmtCr(totI)}</div>
                  </td>
                  <td className="r" style={{padding:".75rem .65rem"}}>
                    <div className={`mono${totG>=0?" gain":" loss"}`} style={{fontWeight:600,fontSize:".83rem"}}>{totG>=0?"+":""}{fmtCr(totG)}</div>
                    <div className={`mono${totP>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(totP)}</div>
                  </td>
                  <td style={{padding:".75rem .65rem"}}/>
                </tr>
              </tfoot>);
            })()}
          </table>
        </div></div>{/* end ht-desktop */}
        {/* ── Mobile holding cards ── */}
        <div className="m-holdings-list">
          {(()=>{
            const US_T=new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
            const IN_T=new Set(["IN_STOCK","IN_ETF","MF"]);
            const isUSCash=h=>h.type==="CASH"&&isUSDHolding(h);
            const isINCash=h=>h.type==="CASH"&&!isUSDHolding(h);
            const groups=[
              {key:"us",label:"US Assets",icon:"$",color:"#5a9ce0",items:visH.filter(h=>US_T.has(h.type)||isUSCash(h))},
              {key:"in",label:"Indian Assets",icon:"₹",color:"#e07c5a",items:visH.filter(h=>IN_T.has(h.type)||isINCash(h))},
              {key:"other",label:"Other Assets",icon:"📦",color:"#c9a84c",items:visH.filter(h=>!US_T.has(h.type)&&!IN_T.has(h.type)&&h.type!=="CASH")},
            ].filter(g=>g.items.length>0);
            return groups.map((grp,gi)=>{
              const isUSGrp=grp.key==="us";
              const grpCur=isUSGrp
                ?grp.items.reduce((s,h)=>s+(valNativeCache.get(h.id)||0),0)
                :grp.items.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              const grpInv=isUSGrp
                ?grp.items.reduce((s,h)=>{ const v=invNativeCache.get(h.id); return v==null?s:s+v; },0)
                :grp.items.reduce((s,h)=>{ const v=invINRCache.get(h.id); return v==null?s:s+v; },0);
              const grpG=grpCur-grpInv;
              const grpP=grpInv>0?(grpG/grpInv)*100:0;
              const fmtGrpCr=n=>isUSGrp?fmtCrNative(n,{currency:"USD"}):fmtCr(n);
              return(<div key={grp.key} style={gi>0?{marginTop:"1rem"}:{}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:".6rem .5rem",marginBottom:".35rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`,background:`${grp.color}0D`,borderRadius:"4px 4px 0 0"}}>
                  <span style={{fontSize:".76rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>{grp.icon} {grp.label} <span style={{color:"var(--text-muted)",fontWeight:400}}>{grp.items.length}</span></span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:grp.color,fontWeight:600}}>{fmtGrpCr(grpCur)} <span className={grpG>=0?"gain":"loss"} style={{fontSize:".62rem"}}>{grpG>=0?"+":""}{fmtPct(grpP)}</span></span>
                </div>
                {grp.items.map(h=>{
                  const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id),hasInv=inv!=null&&inv>0,g=hasInv?cur-inv:null,p=hasInv?(g/inv)*100:null;
                  const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                  const a=h.type==="CASH"?{..._a,label:isUSDHolding(h)?"Cash USD":"Cash INR",icon:isUSDHolding(h)?"💵":"₹"}:_a;
                  const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                  const units=h.net_units??h.units??null;
                  const isUS=isUSDHolding(h);
                  const nativeSym=isUS?"$":"₹";
                  const isExp=expandedHolding===h.id;
                  const rawPrice=h.type==="MF"?(h.current_nav||h.purchase_nav||null):(h.current_price||h.purchase_price||null);
                  return(<div key={h.id} className="m-hc" onClick={()=>setExpandedHolding(isExp?null:h.id)}>
                    <div className="m-hc-top">
                      <div style={{flex:1,minWidth:0}}>
                        <div className="m-hc-name">{h.name}</div>
                        <div className="m-hc-ticker">
                          {h.ticker||h.scheme_code||""}{mn&&<span style={{opacity:.5}}> · {mn}</span>}
                        </div>
                      </div>
                      <span className="tbadge2" style={{background:a.color+"22",color:a.color,flexShrink:0,marginLeft:8}}>{a.icon} {a.label}</span>
                    </div>
                    <div className="m-hc-grid">
                      <div className="m-hc-cell">
                        <span className="m-hc-lbl">Current Value</span>
                        <span className="m-hc-val" style={{fontWeight:600,color:"#c9a84c"}}>{fmtCrNative(cur,h)}</span>
                      </div>
                      <div className="m-hc-cell" style={{textAlign:"right"}}>
                        <span className="m-hc-lbl">P&L</span>
                        {g===null
                          ? <span className="m-hc-val" style={{color:"var(--text-muted)",fontSize:".7rem"}}>— no cost basis</span>
                          : <span className={`m-hc-val ${g>=0?"gain":"loss"}`} style={{fontWeight:600}}>
                              {g>=0?"+":""}{fmtNative(Math.abs(g),h)} ({fmtPct(p)})
                            </span>
                        }
                      </div>
                      {isExp&&<>
                        <div className="m-hc-cell">
                          <span className="m-hc-lbl">Units</span>
                          <span className="m-hc-val">{units!=null?Number(units).toLocaleString(undefined,{maximumFractionDigits:4}):"—"}</span>
                        </div>
                        <div className="m-hc-cell" style={{textAlign:"right"}}>
                          <span className="m-hc-lbl">Invested</span>
                          <span className="m-hc-val">{inv==null?"— (CAS import)":fmtCrNative(inv,h)}</span>
                        </div>
                        <div className="m-hc-cell">
                          <span className="m-hc-lbl">Cur. Price</span>
                          <span className="m-hc-val">{rawPrice?`${nativeSym}${h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}`:"—"}</span>
                        </div>
                        <div className="m-hc-cell" style={{textAlign:"right"}}>
                          <span className="m-hc-lbl">Source</span>
                          <span className="m-hc-val" style={{fontSize:".68rem"}}>{h.source==="snaptrade"?"SnapTrade":h.source==="csv"||h.source==="import"?"CSV":h.source==="cas"?"CAS":"Manual"}</span>
                        </div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          return<div className="m-hc-cell" style={{gridColumn:"1/-1"}}>
                            <span className="m-hc-lbl">Maturity</span>
                            <span className="m-hc-val" style={{color:mc,fontWeight:600}}>
                              {new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                              {" "}· {dLeft<=0?"Matured":`${dLeft}d remaining`}
                              {h.interest_rate?` · ${h.interest_rate}% p.a.`:""}
                            </span>
                          </div>;
                        })()}
                      </>}
                    </div>
                    {!isExp&&<div style={{textAlign:"center",marginTop:".4rem",fontSize:".56rem",color:"var(--text-muted)",letterSpacing:".08em",textTransform:"uppercase"}}>tap for details</div>}
                    {isExp&&<div className="m-hc-actions" onClick={e=>e.stopPropagation()}>
                      <button title="Transactions" aria-label="Transactions" onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}} style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)"}}>📋{(h.transaction_count??h.transactions?.length??0)>0?` ${(h.transaction_count??h.transactions?.length??0)}`:""}</button>
                      <button title="Documents" aria-label="Documents" onClick={()=>setArtifactHolding(h)} style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)"}}>📎{(h.artifacts||[]).length>0?` ${(h.artifacts||[]).length}`:""}</button>
                      {(!h.source||h.source==="manual")&&<button title="Edit" aria-label="Edit" onClick={()=>editH(h)} style={{color:"rgba(90,156,224,.5)"}}>✎</button>}
                      {(!h.source||h.source==="manual")&&<button title="Delete" aria-label="Delete" onClick={()=>deleteHolding(h.id)} style={{color:"rgba(224,124,90,.4)"}}>✕</button>}
                    </div>}
                  </div>);
                })}
              </div>);
            });
          })()}
          {/* Mobile totals */}
          {visH.length>0&&(()=>{
            const totI=visH.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
            const totC=visH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            const totG=totC-totI;const totP=totI>0?(totG/totI)*100:0;
            return(<div className="m-hc-totals">
              <div><div className="m-hc-lbl">{visH.length} holding{visH.length!==1?"s":""} · Invested</div><div className="m-hc-val" style={{color:"var(--text-dim)",marginTop:".15rem"}}>{fmtCr(totI)}</div></div>
              <div style={{textAlign:"right"}}><div className="m-hc-lbl">Current · P&L</div><div className="m-hc-val" style={{color:"#c9a84c",marginTop:".15rem"}}>{fmtCr(totC)}</div><div className={`m-hc-val ${totG>=0?"gain":"loss"}`} style={{fontWeight:600,fontSize:".75rem"}}>{totG>=0?"+":""}{fmtCr(totG)} ({fmtPct(totP)})</div></div>
            </div>);
          })()}
        </div>
      </>)}
      <div style={{marginTop:"1rem",padding:".75rem 1rem",background:"var(--bg-muted)",borderRadius:8,fontSize:".72rem",color:"var(--text-dim)",lineHeight:1.6}}>
        <strong style={{color:"var(--text)"}}>Live prices:</strong> Add NSE ticker (e.g. <code style={{color:"#c9a84c"}}>RELIANCE</code>) or AMFI scheme code (e.g. <code style={{color:"#c9a84c"}}>119551</code>) when adding a holding, then click <strong style={{color:"var(--text)"}}>⟳ Live Prices</strong> to auto-fetch. 📎 button attaches contract notes, statements, or receipts to any holding.
      </div>
    </div>
  );
}
