import { Bell, ClipboardList, Paperclip, Pencil, X as XIcon } from "lucide-react";
import ConcallPanel from "./ConcallPanel.jsx";
import { CONCALL_TYPES, HoldingAlertPanel, daysSinceUpdate } from "./holdingsParts.jsx";

export default function HoldingsDesktopTable({ AT, BT, ST, ago, alertHolding, alerts, allMembers, concallHolding, deleteHolding, demoMode, displayH, editH, fmtCr, fmtCrINR, fmtCrNative, fmtNative, fmtPct, invINRCache, invNativeCache, isUSDHolding, minDisplayDays, setAlertHolding, setAlerts, setArtifactHolding, setConcallHolding, setCostBasisHolding, setTxnForm, setTxnHolding, sortCol, sortDir, toggleSort, valINRCache, valNativeCache }) {
  return (
    <div className="ht-desktop"><div className="ht-scroll-outer">
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
                  {c.tip&&<span title={c.tip} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:13,height:13,borderRadius:"50%",border:"1px solid var(--border)",fontSize:"10px",color:"var(--text-muted)",marginLeft:3,cursor:"help",verticalAlign:"middle",fontStyle:"normal",fontWeight:400}}>?</span>}
                  {sortCol===c.key
                    ? <span style={{marginLeft:3,fontSize:".72rem",opacity:.7}}>{sortDir==="asc"?"▲":"▼"}</span>
                    : <span style={{marginLeft:3,fontSize:".72rem",opacity:.25}}>⇅</span>}
                </th>
              ))}
              <th style={{width:"130px",minWidth:"130px"}}/>
            </tr></thead>
            <tbody>
              {(()=>{
                // Group holdings into 3 categories — CASH split by currency
                const US_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
                const IN_TYPES = new Set(["IN_STOCK","IN_ETF","MF"]);
                const isUSCash = h => h.type === "CASH" && isUSDHolding(h);
                const isINCash = h => h.type === "CASH" && !isUSDHolding(h);
                const groups = [
                  { key: "us", label: "US Assets", icon: "$", color: "#5a9ce0", items: displayH.filter(h => US_TYPES.has(h.type) || isUSCash(h)) },
                  { key: "in", label: "Indian Assets", icon: "₹", color: "#e07c5a", items: displayH.filter(h => IN_TYPES.has(h.type) || isINCash(h)) },
                  { key: "other", label: "Other Assets", icon: "📦", color: "#c9a84c", items: displayH.filter(h => !US_TYPES.has(h.type) && !IN_TYPES.has(h.type) && h.type !== "CASH") },
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
                        <span style={{fontSize:".65rem",color:"var(--text-muted)",marginLeft:10}}>{grp.items.length} holding{grp.items.length!==1?"s":""}</span>
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
  // native formatter for this holding

                  const cbUnknown = h.cost_basis==="unknown";
                  const cbApprox  = h.cost_basis==="approx";
                  const canSetCost = (cbUnknown||cbApprox) && (h.type==="IN_STOCK"||h.type==="IN_ETF"||h.type==="IN_BOND"||h.type==="US_STOCK"||h.type==="US_ETF") && !demoMode;
                  const costBtn = canSetCost
                    ? <button title={cbUnknown?"Purchase cost is unknown (depository statement) — set your average buy price":"Cost is approximate — click to revise"}
                        onClick={()=>setCostBasisHolding(h)}
                        style={{marginTop:2,padding:"1px 6px",fontSize:".62rem",fontWeight:600,borderRadius:4,cursor:"pointer",
                          background:cbUnknown?"rgba(201,168,76,.15)":"transparent",color:cbUnknown?"#c9a84c":"var(--text-muted)",
                          border:`1px solid ${cbUnknown?"rgba(201,168,76,.4)":"var(--border)"}`,fontFamily:"'DM Sans',sans-serif"}}>
                        {cbUnknown?"Set cost":"Edit"}
                      </button>
                    : null;
                  const avgDisplay = avgCost
                    ? <span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                          {cbApprox&&<span title="Approximate cost basis (estimated or user-entered)" style={{color:"#c9a84c",marginRight:2}}>≈</span>}
                          {nativeSym}{h.type==="MF"?Number(avgCost).toFixed(4):Number(avgCost).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                        </span>
                        {costBtn&&<div>{costBtn}</div>}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—{costBtn&&<div>{costBtn}</div>}</span>;

                  const rawPrice = h.type==="MF" ? (h.current_nav||h.purchase_nav||null) : (h.current_price||h.purchase_price||null);
                  const curPriceDisplay = rawPrice
                    ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                        {nativeSym}{h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—</span>;

                  const brokerLabel = h.brokerage_name && h.brokerage_name !== "Unknown" ? h.brokerage_name : null;
                  const src = h.source || "manual";
                  const srcLabel = src === "snaptrade" ? "SnapTrade" : src === "csv" || src === "import" ? "CSV" : src === "cas" ? "CAS" : "Manual";

                  const _staleDays = ST[h.type] ? daysSinceUpdate(h) : 0;
                  const _rowBg = _staleDays >= (ST[h.type]||9999)
                    ? "rgba(248,81,73,0.04)"
                    : _staleDays >= 30 && ST[h.type]
                      ? "rgba(240,136,62,0.04)"
                      : undefined;
                  return [
                    <tr key={h.id} style={_rowBg ? {background:_rowBg} : undefined}>
                      <td>
                        <div className="hn">{h.name}</div>
                        <div className="hm">{mn}</div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          const matLabel=new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"});
                          return<div style={{marginTop:3,display:"inline-flex",alignItems:"center",gap:4,
                            fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                            background:mc+"22",color:mc,border:`1px solid ${mc}44`}}>
                            🏦 {matLabel} · {dLeft<=0?"Matured":`${dLeft}d`}
                            {h.interest_rate?<span style={{opacity:.8}}> · {h.interest_rate}%</span>:null}
                          </div>;
                        })()}
                        {h.type==="FD"&&h.currency&&h.currency!=="INR"&&(
                          <span style={{marginLeft:4,fontSize:".65rem",fontWeight:700,padding:"2px 6px",borderRadius:4,
                            background:"rgba(90,156,224,.15)",color:"#5a9ce0",border:"1px solid rgba(90,156,224,.3)"}}>
                            {h.currency}
                          </span>
                        )}
                        {h.type==="INSURANCE"&&(()=>{
                          const POLICY_ICON={TERM:"🛡️",ENDOWMENT:"💰",ULIP:"📈",WHOLE_LIFE:"🔄",HEALTH:"🏥",VEHICLE:"🚗"};
                          const pIcon=POLICY_ICON[h.policy_type]||"🛡️";
                          const dLeft=h.maturity_date?Math.ceil((new Date(h.maturity_date)-Date.now())/864e5):null;
                          const mc=dLeft===null?"#e07b8c":dLeft>180?"#4caf9a":dLeft>60?"#f0a050":"#e07c5a";
                          const matLabel=h.maturity_date?new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"}):null;
                          const freqLabel={ANNUAL:"yr",SEMI:"6mo",QUARTERLY:"qtr",MONTHLY:"mo"}[h.premium_frequency||"ANNUAL"];
                          return<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
                            <span style={{fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                              background:"rgba(224,123,140,.15)",color:"#e07b8c",border:"1px solid rgba(224,123,140,.3)"}}>
                              {pIcon} {(h.policy_type||"TERM").replace("_"," ")}
                            </span>
                            {h.sum_assured>0&&<span style={{fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                              background:"rgba(76,175,154,.1)",color:"#4caf9a",border:"1px solid rgba(76,175,154,.25)"}}>
                              Cover ₹{(h.sum_assured/100000).toFixed(0)}L
                            </span>}
                            {h.premium>0&&<span style={{fontSize:".65rem",padding:"2px 6px",borderRadius:4,
                              background:"var(--bg-muted)",color:"var(--text-muted)",border:"1px solid var(--border)"}}>
                              ₹{Math.round(h.premium/1000)}K/{freqLabel}
                            </span>}
                            {matLabel&&<span style={{fontSize:".65rem",padding:"2px 6px",borderRadius:4,
                              background:mc+"22",color:mc,border:`1px solid ${mc}44`}}>
                              {dLeft<=0?"Expired":dLeft===null?"":dLeft>365?`${Math.round(dLeft/365)}yr`:`${dLeft}d`} · {matLabel}
                            </span>}
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
                          ? <div><span style={{fontSize:".65rem",background:"rgba(167,139,250,.08)",color:"rgba(167,139,250,.7)",padding:"2px 6px",borderRadius:3,border:"1px solid rgba(167,139,250,.15)"}}>{brokerLabel}</span>
                              <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:2}}>{srcLabel}</div></div>
                          : <span style={{fontSize:".65rem",color:"var(--text-muted)"}}>{srcLabel}</span>
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
                        {isLive&&<div style={{fontSize:".65rem",color:"#4caf9a",marginTop:1}}>● {ago(h.price_fetched_at)}</div>}
                        {!isLive && ST[h.type] && (()=>{
                          const days = daysSinceUpdate(h);
                          if (days < minDisplayDays) return null;
                          const thresh = ST[h.type];
                          const isCrit = days >= thresh;
                          const color = isCrit ? "#F85149" : "#F0883E";
                          const updated = (h.updated_at||h.created_at)
                            ? new Date(h.updated_at||h.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"})
                            : "—";
                          return (
                            <div
                              title={`Last updated: ${updated} — click to update balance`}
                              onClick={e=>{e.stopPropagation();if(!h.source||h.source==="manual")editH(h);}}
                              style={{marginTop:3,display:"inline-flex",alignItems:"center",gap:3,
                                fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:20,
                                background:`${color}18`,color,border:`1px solid ${color}33`,
                                cursor:"pointer",userSelect:"none"}}>
                              <span style={{width:5,height:5,borderRadius:"50%",background:color,display:"inline-block"}}/>
                              {days}d ago
                            </div>
                          );
                        })()}
                      </td>
                      <td className="r">
                        <div style={{fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:".78rem"}}>{fmtCrNative(cur, h)}</div>
                      </td>
                      <td className="r">
                        {g===null
                          ? <div style={{fontSize:".7rem",color:"var(--text-muted)"}}>— no cost basis</div>
                          : <>
                            <div className={`mono${g>=0?" gain":" loss"}`} style={{fontSize:".78rem"}}>{g>=0?"+":""}{fmtNative(Math.abs(g), h)}</div>
                            <div className={`mono${p>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(p)}</div>
                          </>
                        }
                      </td>
                      <td style={{width:"130px",minWidth:"130px"}}>
                        <div style={{display:"flex",gap:3,alignItems:"center",justifyContent:"flex-end",width:"100%"}}>
                          {/* Concall — always reserve space, hide when not applicable */}
                          <button className="delbtn" title="Earnings call analysis" aria-label="Concall analysis"
                            onClick={()=>CONCALL_TYPES.has(h.type)&&setConcallHolding(concallHolding?.id===h.id?null:h)}
                            style={{
                              visibility: CONCALL_TYPES.has(h.type) ? "visible" : "hidden",
                              color: concallHolding?.id===h.id ? "#a084ca" : "var(--text-muted)",
                              fontWeight: concallHolding?.id===h.id ? 700 : 400,
                            }}>
                            ✦
                          </button>
                          {/* Holding Alerts */}
                          {(() => {
                            const hAlerts = (alerts||[]).filter(a => (a.type==="HOLDING_PRICE"||a.type==="HOLDING_RETURN") && a.holdingId===h.id);
                            return (
                              <button className="delbtn" title="Price / return alerts" aria-label="Holding alerts"
                                onClick={()=>setAlertHolding(alertHolding?.id===h.id?null:h)}
                                style={{color: hAlerts.length>0?"#c9a84c":alertHolding?.id===h.id?"#c9a84c":"var(--text-muted)"}}>
                                <Bell size={13} strokeWidth={1.8}/>
                                {hAlerts.length>0&&<span style={{fontSize:".65rem",marginLeft:1}}>{hAlerts.length}</span>}
                              </button>
                            );
                          })()}
                          {/* Transactions */}
                          <button className="delbtn" title="View transactions" aria-label="View transactions"
                            onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}}
                            style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)",gap:".25rem",fontSize:".72rem"}}>
                            <ClipboardList size={13} strokeWidth={1.8}/>
                            {(h.transaction_count??h.transactions?.length??0)>0&&<span>{h.transaction_count??h.transactions?.length}</span>}
                          </button>
                          {/* Documents */}
                          <button className="delbtn" title="Attach documents" aria-label="Attach documents"
                            onClick={()=>setArtifactHolding(h)}
                            style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)",gap:".25rem",fontSize:".72rem"}}>
                            <Paperclip size={13} strokeWidth={1.8}/>
                            {(h.artifacts||[]).length>0&&<span>{h.artifacts.length}</span>}
                          </button>
                          {/* Edit — always reserve space */}
                          <button className="delbtn" title="Modify holding" aria-label="Modify holding"
                            onClick={()=>editH(h)}
                            style={{
                              visibility: (!h.source||h.source==="manual") ? "visible" : "hidden",
                              color: "rgba(90,156,224,.65)",
                            }}><Pencil size={13} strokeWidth={1.8}/></button>
                          {/* Delete — always reserve space */}
                          <button className="delbtn" title="Delete holding" aria-label="Delete holding"
                            onClick={()=>deleteHolding(h.id)}
                            style={{visibility: (!h.source||h.source==="manual") ? "visible" : "hidden", color:"var(--loss)"}}>
                            <XIcon size={13} strokeWidth={2}/>
                          </button>
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
                    alertHolding?.id===h.id && (
                      <tr key={`alert_${h.id}`}>
                        <td colSpan={11} style={{padding:"0 .65rem .65rem",background:"rgba(201,168,76,.02)"}}>
                          <HoldingAlertPanel holding={h} alerts={alerts} setAlerts={setAlerts} onClose={()=>setAlertHolding(null)} />
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
            {displayH.length>0&&(()=>{
              const totI=displayH.reduce((s,h)=>{ const v=invINRCache.get(h.id); return v==null?s:s+v; },0);
              const totC=displayH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              const totG=totC-totI;
              const totP=totI>0?(totG/totI)*100:0;
              return(
              <tfoot>
                <tr style={{borderTop:"2px solid rgba(201,168,76,.2)"}}>
                  <td colSpan={8} style={{padding:".75rem .65rem",fontSize:".7rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-dim)",fontWeight:600}}>Total · {displayH.length} holding{displayH.length!==1?"s":""}</td>
                  <td className="r" style={{padding:".75rem .65rem"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#c9a84c",fontSize:".88rem"}}>{fmtCr(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"rgba(201,168,76,.8)",marginTop:1,fontWeight:600}}>≈ {fmtCrINR(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".65rem",color:"var(--text-muted)",marginTop:1}}>inv. {fmtCr(totI)}</div>
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
        </div></div>
  );
}
