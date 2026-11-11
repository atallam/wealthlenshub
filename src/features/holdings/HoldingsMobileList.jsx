import { ClipboardList, Paperclip } from "lucide-react";
import SwipeableRow from "../../components/shared/SwipeableRow.jsx";
import { daysSinceUpdate } from "./holdingsParts.jsx";

export default function HoldingsMobileList({ AT, BT, ST, ago, allMembers, deleteHolding, demoMode, displayH, editH, expandedHolding, fmtCr, fmtCrNative, fmtNative, fmtPct, invINRCache, invNativeCache, isUSDHolding, minDisplayDays, setArtifactHolding, setCostBasisHolding, setExpandedHolding, setTxnForm, setTxnHolding, valINRCache, valNativeCache }) {
  return (
    <div className="m-holdings-list">
          {(()=>{
            const US_T=new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
            const IN_T=new Set(["IN_STOCK","IN_ETF","MF"]);
            const isUSCash=h=>h.type==="CASH"&&isUSDHolding(h);
            const isINCash=h=>h.type==="CASH"&&!isUSDHolding(h);
            // More granular mobile groups so each asset type is clearly identifiable
            const groups=[
              {key:"us",    label:"US Assets",       icon:"$",  color:"#5a9ce0", items:displayH.filter(h=>US_T.has(h.type)||isUSCash(h))},
              {key:"in_st", label:"Indian Stocks & ETFs", icon:"📈",color:"#e07c5a", items:displayH.filter(h=>h.type==="IN_STOCK"||h.type==="IN_ETF")},
              {key:"mf",    label:"Mutual Funds",    icon:"📊", color:"#a084ca", items:displayH.filter(h=>h.type==="MF")},
              {key:"fd",    label:"Fixed Deposits & Debt",icon:"🏦",color:"#c9a84c", items:displayH.filter(h=>["FD","CD","IN_BOND","PPF","EPF"].includes(h.type)||isINCash(h))},
              {key:"ins",   label:"Insurance",       icon:"🛡️", color:"#e07b8c", items:displayH.filter(h=>h.type==="INSURANCE")},
              {key:"re",    label:"Real Estate & Others",icon:"🏠",color:"#7cb87c", items:displayH.filter(h=>["REAL_ESTATE","GOLD","OTHER"].includes(h.type)||(!US_T.has(h.type)&&h.type!=="IN_STOCK"&&h.type!=="IN_ETF"&&h.type!=="MF"&&!["FD","CD","IN_BOND","PPF","EPF"].includes(h.type)&&!isINCash(h)&&!isUSCash(h)&&h.type!=="INSURANCE"))},
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
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:grp.color,fontWeight:600}}>{fmtGrpCr(grpCur)} <span className={grpG>=0?"gain":"loss"} style={{fontSize:".65rem"}}>{grpG>=0?"+":""}{fmtPct(grpP)}</span></span>
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
                  return(<SwipeableRow key={h.id}
                      onEdit={(!h.source||h.source==="manual")?()=>editH(h):null}
                      onDelete={(!h.source||h.source==="manual")?()=>deleteHolding(h.id):null}
                    ><div className="m-hc" onClick={()=>setExpandedHolding(isExp?null:h.id)}>
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
                          <span className="m-hc-val">{inv==null?"— (CAS import)":<>{h.cost_basis==="approx"&&<span title="Approximate cost basis" style={{color:"#c9a84c"}}>≈ </span>}{fmtCrNative(inv,h)}</>}</span>
                          {(h.cost_basis==="unknown"||h.cost_basis==="approx")&&!demoMode&&(h.type==="IN_STOCK"||h.type==="IN_ETF"||h.type==="IN_BOND"||h.type==="US_STOCK"||h.type==="US_ETF")&&(
                            <button onClick={()=>setCostBasisHolding(h)} style={{marginTop:3,padding:"1px 6px",fontSize:".62rem",fontWeight:600,borderRadius:4,cursor:"pointer",background:"rgba(201,168,76,.15)",color:"#c9a84c",border:"1px solid rgba(201,168,76,.4)"}}>
                              {h.cost_basis==="unknown"?"Set cost":"Edit"}
                            </button>
                          )}
                        </div>
                        <div className="m-hc-cell">
                          <span className="m-hc-lbl">Cur. Price</span>
                          <span className="m-hc-val">{rawPrice?`${nativeSym}${h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}`:"—"}</span>
                          {h.price_fetched_at && (
                            <span style={{fontSize:".65rem",color:"#4caf9a",marginTop:2,display:"flex",alignItems:"center",gap:3}}>
                              <span style={{width:5,height:5,borderRadius:"50%",background:"#4caf9a",display:"inline-block"}}/>
                              {ago(h.price_fetched_at)}
                            </span>
                          )}
                        </div>
                        <div className="m-hc-cell" style={{textAlign:"right"}}>
                          <span className="m-hc-lbl">Source</span>
                          <span className="m-hc-val" style={{fontSize:".68rem"}}>{h.source==="snaptrade"?"SnapTrade":h.source==="csv"||h.source==="import"?"CSV":h.source==="cas"?"CAS":"Manual"}</span>
                        
                          {ST[h.type] && (()=>{
                            const days = daysSinceUpdate(h);
                            if (days < minDisplayDays) return null;
                            const thresh = ST[h.type];
                            const color = days >= thresh ? "#F85149" : "#F0883E";
                            return (
                              <span
                                onClick={e=>{e.stopPropagation();if(!h.source||h.source==="manual")editH(h);}}
                                style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:3,
                                  fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:20,
                                  background:`${color}18`,color,border:`1px solid ${color}33`,cursor:"pointer"}}>
                                <span style={{width:5,height:5,borderRadius:"50%",background:color,display:"inline-block"}}/>
                                {days}d ago · tap to update
                              </span>
                            );
                          })()}
                        </div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          return<div className="m-hc-cell" style={{gridColumn:"1/-1"}}>
                            <span className="m-hc-lbl">Maturity {h.currency&&h.currency!=="INR"&&<span style={{marginLeft:4,fontSize:".65rem",fontWeight:700,padding:"1px 5px",borderRadius:3,background:"rgba(90,156,224,.15)",color:"#5a9ce0",border:"1px solid rgba(90,156,224,.3)"}}>{h.currency}</span>}</span>
                            <span className="m-hc-val" style={{color:mc,fontWeight:600}}>
                              {new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                              {" "}· {dLeft<=0?"Matured":`${dLeft}d remaining`}
                              {h.interest_rate?` · ${h.interest_rate}% p.a.`:""}
                            </span>
                          </div>;
                        })()}
                      </>}
                    </div>
                    {!isExp&&<div style={{textAlign:"center",marginTop:".4rem",fontSize:".65rem",color:"var(--text-muted)",letterSpacing:".08em",textTransform:"uppercase"}}>tap for details</div>}
                    {isExp&&<div className="m-hc-actions" onClick={e=>e.stopPropagation()}>
                      <button title="Transactions" aria-label="Transactions"
                        onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}}
                        style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)",gap:".3rem",fontSize:".72rem"}}>
                        <ClipboardList size={16} strokeWidth={1.8}/>
                        {(h.transaction_count??h.transactions?.length??0)>0&&<span>{h.transaction_count??h.transactions?.length}</span>}
                      </button>
                      <button title="Documents" aria-label="Documents"
                        onClick={()=>setArtifactHolding(h)}
                        style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)",gap:".3rem",fontSize:".72rem"}}>
                        <Paperclip size={16} strokeWidth={1.8}/>
                        {(h.artifacts||[]).length>0&&<span>{h.artifacts.length}</span>}
                      </button>
                    </div>}
                  </div></SwipeableRow>);
                })}
              </div>);
            });
          })()}
          {/* Mobile totals */}
          {displayH.length>0&&(()=>{
            const totI=displayH.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
            const totC=displayH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            const totG=totC-totI;const totP=totI>0?(totG/totI)*100:0;
            return(<div className="m-hc-totals">
              <div><div className="m-hc-lbl">{displayH.length} holding{displayH.length!==1?"s":""} · Invested</div><div className="m-hc-val" style={{color:"var(--text-dim)",marginTop:".15rem"}}>{fmtCr(totI)}</div></div>
              <div style={{textAlign:"right"}}><div className="m-hc-lbl">Current · P&L</div><div className="m-hc-val" style={{color:"#c9a84c",marginTop:".15rem"}}>{fmtCr(totC)}</div><div className={`m-hc-val ${totG>=0?"gain":"loss"}`} style={{fontWeight:600,fontSize:".75rem"}}>{totG>=0?"+":""}{fmtCr(totG)} ({fmtPct(totP)})</div></div>
            </div>);
          })()}
        </div>
  );
}
