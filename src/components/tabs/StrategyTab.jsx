// StrategyTab.jsx — lines 3355–3673 of App.jsx

export default function StrategyTab({
  // Alert data
  alerts,
  setAlerts,
  trigAlerts,
  // Portfolio data
  allHoldings,
  allCur,
  totPct,
  members,
  valINRCache,
  // Rebalance controls
  targetAlloc,
  setTargetAlloc,
  rebalMember,
  setRebalMember,
  rebalCash,
  setRebalCash,
  // UI state
  showQuietAlerts,
  setShowQuietAlerts,
  // Modal triggers (alert edit lives in parent modal)
  setAlertForm,
  setModal,
  // Formatting
  fmt,
  fmtCr,
  fmtPct,
  // Constants
  AT,
  BA,
  // Sub-components
  FmtInput,
}) {
  const quietAlerts = alerts.filter(a=>a.active && !trigAlerts.find(t=>t.id===a.id));
  const inactiveAlerts = alerts.filter(a=>!a.active);

  // ── Rebalance computation ──
  const rHoldings = rebalMember==="all" ? allHoldings : allHoldings.filter(h=>h.member_id===rebalMember);
  const rTotal    = rHoldings.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
  const cash      = +rebalCash||0;
  const totalWithCash = rTotal + cash;
  const curAlloc = {};
  for(const h of rHoldings){ curAlloc[h.type] = (curAlloc[h.type]||0) + (valINRCache.get(h.id)||0); }
  const tSum = Object.values(targetAlloc).reduce((s,v)=>s+(+v||0),0);
  const normTarget = {};
  for(const [k,v] of Object.entries(targetAlloc)){ normTarget[k] = tSum>0 ? (+v||0)/tSum*100 : 0; }
  const trades = Object.keys(AT).map(type=>{
    const cur = curAlloc[type]||0;
    const curPct = rTotal>0?(cur/rTotal)*100:0;
    const tgtPct = normTarget[type]||0;
    const tgtAmt = totalWithCash * (tgtPct/100);
    const delta  = tgtAmt - cur;
    return { type, cur, curPct, tgtPct, tgtAmt, delta };
  }).filter(r=>r.tgtPct>0||r.cur>0);
  const totalBuy  = trades.filter(t=>t.delta>500).reduce((s,t)=>s+t.delta,0);
  const totalSell = trades.filter(t=>t.delta<-500).reduce((s,t)=>s+Math.abs(t.delta),0);
  const activeTypes = new Set(trades.map(t=>t.type));
  const maxPct = Math.max(...trades.map(x=>Math.max(x.curPct,x.tgtPct)),1);

  return (
    <>
      {/* ═══ SECTION 1: TRIGGERED ALERTS ═══ */}
      {trigAlerts.length>0&&(
        <div style={{marginBottom:"1.2rem",padding:"1rem",borderRadius:8,background:"rgba(224,124,90,.06)",border:"1px solid rgba(224,124,90,.25)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".7rem"}}>
            <div style={{fontSize:".72rem",letterSpacing:".1em",textTransform:"uppercase",color:"#e07c5a",fontWeight:600}}>⚠ {trigAlerts.length} Alert{trigAlerts.length>1?"s":""} Triggered</div>
          </div>
          {trigAlerts.map(a=>{
            const rule = alerts.find(r=>r.id===a.id);
            const curVal = (()=>{
              if(!rule) return null;
              if(rule.type==="RETURN_TARGET") return totPct;
              const v = allHoldings.filter(h=>h.type===rule.assetType).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              return allCur>0?(v/allCur)*100:0;
            })();
            return(
            <div key={a.id} style={{display:"flex",alignItems:"center",gap:".8rem",padding:".7rem .85rem",background:"rgba(224,124,90,.08)",borderRadius:6,marginBottom:".4rem",border:"1px solid rgba(224,124,90,.18)"}}>
              <div style={{fontSize:"1.1rem"}}>⚠️</div>
              <div style={{flex:1}}>
                <div style={{fontSize:".82rem",color:"#e07c5a",fontWeight:500}}>{a.label}</div>
                <div style={{fontSize:".68rem",color:"rgba(224,124,90,.6)",marginTop:2}}>
                  {rule?.type==="RETURN_TARGET"
                    ? `Portfolio return ${curVal!==null?curVal.toFixed(1)+"% ":""}is below ${rule.threshold}% target`
                    : `${rule?.type==="CONCENTRATION"?"Below":"Above"} ${rule?.threshold}% threshold${curVal!==null?" — currently "+curVal.toFixed(1)+"%":""}`}
                </div>
              </div>
              <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                style={{background:"none",border:"1px solid rgba(224,124,90,.3)",borderRadius:4,padding:"3px 10px",fontSize:".65rem",cursor:"pointer",color:"rgba(224,124,90,.7)"}}>Snooze</button>
            </div>);
          })}
        </div>
      )}

      {/* ═══ SECTION 2: ALERT RULES ═══ */}
      <div style={{marginBottom:"1.2rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".7rem"}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"#ffffff"}}>Alert Rules</div>
          <button className="btn-sm" onClick={()=>{setAlertForm(BA);setModal("alert");}}>+ New Alert</button>
        </div>

        {alerts.length===0?(
          <div className="card" style={{padding:"1.2rem",textAlign:"center"}}>
            <div style={{fontSize:".78rem",color:"rgba(255,255,255,.45)",marginBottom:".4rem"}}>No alert rules configured</div>
            <div style={{fontSize:".65rem",color:"rgba(255,255,255,.3)"}}>Create alerts to monitor allocation drift, concentration risk, or return targets</div>
          </div>
        ):(
          <div className="card">
            {/* Active triggered alerts (already shown above, just list rule inline) */}
            {alerts.filter(a=>a.active && trigAlerts.find(t=>t.id===a.id)).map(a=>(
              <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".55rem .7rem",borderRadius:5,marginBottom:".35rem",background:"rgba(224,124,90,.04)",border:"1px solid rgba(224,124,90,.15)"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:"#e07c5a",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:".78rem",color:"#e07c5a"}}>{a.label}</div>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under-weight below ":"Over-weight above "}{a.threshold}%{a.type==="RETURN_TARGET"?" return target":""}</div>
                </div>
                <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                  style={{background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"#4caf9a"}}>ON</button>
                <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
              </div>
            ))}

            {/* Active non-triggered alerts */}
            {quietAlerts.map(a=>(
              <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".55rem .7rem",borderRadius:5,marginBottom:".35rem",background:"rgba(76,175,154,.03)",border:"1px solid rgba(76,175,154,.1)"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:"#4caf9a",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:".78rem",color:"rgba(255,255,255,.75)"}}>{a.label}</div>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under-weight below ":"Over-weight above "}{a.threshold}%{a.type==="RETURN_TARGET"?" return target":""}</div>
                </div>
                <span style={{fontSize:".6rem",color:"rgba(76,175,154,.6)",padding:"2px 6px",borderRadius:3,background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.15)"}}>✓ Passing</span>
                <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                  style={{background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"#4caf9a"}}>ON</button>
                <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
              </div>
            ))}

            {/* Inactive/disabled alerts — collapsible */}
            {inactiveAlerts.length>0&&(
              <>
                <div onClick={()=>setShowQuietAlerts(p=>!p)}
                  style={{display:"flex",alignItems:"center",gap:".5rem",padding:".45rem .7rem",marginTop:".3rem",cursor:"pointer",borderRadius:5,background:"rgba(255,255,255,.02)"}}>
                  <span style={{fontSize:".6rem",color:"rgba(255,255,255,.3)",transform:showQuietAlerts?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}>▶</span>
                  <span style={{fontSize:".68rem",color:"rgba(255,255,255,.35)"}}>{inactiveAlerts.length} paused rule{inactiveAlerts.length>1?"s":""}</span>
                </div>
                {showQuietAlerts&&inactiveAlerts.map(a=>(
                  <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".45rem .7rem",borderRadius:5,marginBottom:".2rem",opacity:.55}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:"rgba(255,255,255,.18)",flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:".75rem",color:"rgba(255,255,255,.5)"}}>{a.label}</div>
                      <div style={{fontSize:".6rem",color:"rgba(255,255,255,.25)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under ":"Over "}{a.threshold}%</div>
                    </div>
                    <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                      style={{background:"none",border:"1px solid rgba(255,255,255,.08)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"rgba(255,255,255,.3)"}}>OFF</button>
                    <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ DIVIDER ═══ */}
      <div style={{height:1,background:"rgba(255,255,255,.06)",margin:"0.5rem 0 1.2rem"}}/>

      {/* ═══ SECTION 3: ASSET ALLOCATION & REBALANCE ═══ */}
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"#ffffff",marginBottom:".8rem"}}>Asset Allocation</div>

      {/* Member selector + Cash — compact top bar */}
      <div style={{display:"flex",gap:"1rem",alignItems:"flex-end",marginBottom:"1rem",flexWrap:"wrap"}}>
        <div>
          <label className="flbl">Member</label>
          <div style={{display:"flex",gap:".35rem",marginTop:".3rem"}}>
            {["all",...members.map(m=>m.id)].map(id=>(
              <div key={id} onClick={()=>setRebalMember(id)}
                style={{padding:".28rem .6rem",borderRadius:4,cursor:"pointer",fontSize:".72rem",
                  background:rebalMember===id?"rgba(201,168,76,.16)":"rgba(255,255,255,.04)",
                  border:`1px solid ${rebalMember===id?"rgba(201,168,76,.4)":"rgba(255,255,255,.1)"}`,
                  color:rebalMember===id?"#c9a84c":"rgba(255,255,255,.55)"}}>
                {id==="all"?"All":members.find(m=>m.id===id)?.name}
              </div>
            ))}
          </div>
        </div>
        <div style={{flex:"0 0 180px"}}>
          <label className="flbl">Fresh Cash to Deploy</label>
          <FmtInput value={rebalCash} placeholder="e.g. 50000"
            onChange={e=>setRebalCash(e.target.value)} style={{marginTop:".3rem"}}/>
        </div>
        <div style={{flex:1,textAlign:"right"}}>
          <div style={{fontSize:".62rem",color:"rgba(255,255,255,.45)",letterSpacing:".08em",textTransform:"uppercase"}}>Portfolio</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1.15rem",color:"#ffffff"}}>{fmtCr(rTotal)}</div>
          {cash>0&&<div style={{fontSize:".65rem",color:"rgba(201,168,76,.6)"}}>+ {fmtCr(cash)} cash</div>}
        </div>
      </div>

      {/* Quick Strategy Presets */}
      <div style={{display:"flex",gap:".4rem",marginBottom:"1rem",flexWrap:"wrap"}}>
        <span style={{fontSize:".62rem",color:"rgba(255,255,255,.4)",alignSelf:"center",marginRight:".2rem"}}>STRATEGY:</span>
        {[
          {name:"Conservative",desc:"Low risk, FD/PPF heavy",alloc:{IN_STOCK:15,MF:20,IN_ETF:5,US_STOCK:0,US_ETF:0,US_BOND:5,CRYPTO:0,FD:25,PPF:15,EPF:15,REAL_ESTATE:0}},
          {name:"Balanced",desc:"Mix of equity & debt",alloc:{IN_STOCK:25,MF:25,IN_ETF:5,US_STOCK:8,US_ETF:5,US_BOND:0,CRYPTO:2,FD:10,PPF:10,EPF:10,REAL_ESTATE:0}},
          {name:"Aggressive",desc:"Equity & crypto heavy",alloc:{IN_STOCK:30,MF:25,IN_ETF:5,US_STOCK:15,US_ETF:5,US_BOND:0,CRYPTO:5,FD:5,PPF:5,EPF:5,REAL_ESTATE:0}},
          {name:"Global",desc:"Cross-border diversified",alloc:{IN_STOCK:20,MF:15,IN_ETF:5,US_STOCK:20,US_ETF:15,US_BOND:0,CRYPTO:5,FD:5,PPF:5,EPF:5,REAL_ESTATE:5}},
        ].map(p=>(
          <div key={p.name} onClick={()=>setTargetAlloc(p.alloc)}
            title={p.desc}
            style={{padding:".3rem .65rem",borderRadius:4,cursor:"pointer",fontSize:".7rem",
              background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",
              color:"rgba(255,255,255,.65)",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(201,168,76,.1)";e.currentTarget.style.borderColor="rgba(201,168,76,.3)";e.currentTarget.style.color="#c9a84c";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.04)";e.currentTarget.style.borderColor="rgba(255,255,255,.08)";e.currentTarget.style.color="rgba(255,255,255,.65)";}}>
            {p.name}
          </div>
        ))}
      </div>

      {/* Allocation + Drift + Action table */}
      <div className="card" style={{marginBottom:"1rem"}}>
        {rTotal===0?<div className="empty">Add holdings to see your allocation plan</div>:(
          <>
          <table className="ht" style={{fontSize:".78rem"}}>
            <thead><tr>
              <th>Asset Class</th>
              <th className="r" style={{width:80}}>Target %</th>
              <th className="r">Current %</th>
              <th style={{width:"22%"}}>Drift</th>
              <th className="r">Action</th>
            </tr></thead>
            <tbody>
              {trades.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).map(t=>{
                const a=AT[t.type]||{icon:"?",label:t.type,color:"#999"};
                const isFlat=Math.abs(t.delta)<500;
                const isOver=t.curPct>t.tgtPct+1;
                const isUnder=t.curPct<t.tgtPct-1;
                const driftPct = t.curPct - t.tgtPct;
                const absDelta = Math.abs(t.delta);
                const monthlySIP = absDelta > 5000 ? Math.round(absDelta / 12) : 0;
                return(
                <tr key={t.type}>
                  <td>
                    <span style={{color:a.color}}>{a.icon}</span> {a.label}
                    <div style={{fontSize:".62rem",color:"rgba(255,255,255,.4)",marginTop:1}}>{fmtCr(t.cur)}</div>
                  </td>
                  <td className="r">
                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:".2rem"}}>
                      <input type="number" min="0" max="100" step="1"
                        value={targetAlloc[t.type]||0}
                        onChange={e=>setTargetAlloc(p=>({...p,[t.type]:+e.target.value}))}
                        style={{width:44,textAlign:"right",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",
                          borderRadius:3,padding:".18rem .35rem",color:"#c9a84c",fontFamily:"'DM Mono',monospace",fontSize:".78rem"}}/>
                      <span style={{fontSize:".68rem",color:"rgba(255,255,255,.4)"}}>%</span>
                    </div>
                  </td>
                  <td className="r mono" style={{color:"rgba(255,255,255,.6)",fontSize:".75rem"}}>{t.curPct.toFixed(1)}%</td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
                      <div style={{flex:1,height:6,background:"rgba(255,255,255,.05)",borderRadius:3,overflow:"visible",position:"relative"}}>
                        <div style={{position:"absolute",left:`${Math.min(t.tgtPct/maxPct*100,100)}%`,top:-1,width:2,height:8,
                          background:"rgba(201,168,76,.7)",borderRadius:1,transform:"translateX(-50%)",zIndex:2}}/>
                        <div style={{height:"100%",width:`${Math.min(t.curPct/maxPct*100,100)}%`,
                          background:isOver?`${a.color}cc`:isUnder?`${a.color}55`:`${a.color}88`,
                          borderRadius:3,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:".6rem",fontFamily:"'DM Mono',monospace",minWidth:40,textAlign:"right",
                        color:isFlat?"rgba(255,255,255,.35)":isOver?"#e07c5a":"#4caf9a"}}>
                        {isFlat?"—":`${driftPct>0?"+":""}${driftPct.toFixed(1)}%`}
                      </span>
                    </div>
                  </td>
                  <td className="r">
                    {isFlat?(
                      <span style={{color:"rgba(76,175,154,.6)",fontSize:".68rem"}}>✓ Aligned</span>
                    ):t.delta>0?(
                      <div>
                        <span style={{
                          background:"rgba(76,175,154,.12)",color:"#4caf9a",
                          border:"1px solid rgba(76,175,154,.3)",
                          borderRadius:4,padding:"3px 8px",fontSize:".7rem",fontFamily:"'DM Mono',monospace",
                          fontWeight:600,whiteSpace:"nowrap"
                        }}>
                          ▲ Invest {fmtCr(absDelta)}
                        </span>
                        {monthlySIP>0&&<div style={{fontSize:".58rem",color:"rgba(76,175,154,.5)",marginTop:3}}>
                          {absDelta>50000?`SIP ~${fmtCr(monthlySIP)}/mo × 12`:"lump sum"}
                        </div>}
                      </div>
                    ):(
                      <div>
                        <span style={{
                          background:"rgba(224,124,90,.12)",color:"#e07c5a",
                          border:"1px solid rgba(224,124,90,.3)",
                          borderRadius:4,padding:"3px 8px",fontSize:".7rem",fontFamily:"'DM Mono',monospace",
                          fontWeight:600,whiteSpace:"nowrap"
                        }}>
                          ▼ Trim {fmtCr(absDelta)}
                        </span>
                        <div style={{fontSize:".58rem",color:"rgba(224,124,90,.45)",marginTop:3}}>
                          {absDelta>100000?"redeem or pause SIPs":"pause new investments"}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>);
              })}
            </tbody>
          </table>

          {/* Total % + summary footer */}
          <div style={{marginTop:".75rem",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".5rem"}}>
            <div style={{padding:".4rem .7rem",borderRadius:4,fontSize:".7rem",
              background:Math.abs(tSum-100)<0.5?"rgba(76,175,154,.08)":"rgba(224,124,90,.08)",
              border:`1px solid ${Math.abs(tSum-100)<0.5?"rgba(76,175,154,.2)":"rgba(224,124,90,.2)"}`,
              color:Math.abs(tSum-100)<0.5?"#4caf9a":"#e07c5a"}}>
              Target total: {tSum.toFixed(0)}% {Math.abs(tSum-100)<0.5?"✓":"— adjust to 100%"}
            </div>
            <div style={{display:"flex",gap:"1rem",fontSize:".72rem"}}>
              {totalBuy>0&&<span style={{color:"#4caf9a"}}>Invest {fmtCr(totalBuy)}</span>}
              {totalSell>0&&<span style={{color:"#e07c5a"}}>Trim {fmtCr(totalSell)}</span>}
            </div>
          </div>

          <div style={{marginTop:".6rem",fontSize:".65rem",color:"rgba(255,255,255,.35)",lineHeight:1.5}}>
            ℹ️ "Trim" = redeem units or redirect future SIPs to other asset classes. Selling may have tax implications — consult your CA.
            {cash>0&&<span style={{color:"rgba(201,168,76,.5)"}}> Fresh cash of {fmtCr(cash)} is factored into Invest amounts.</span>}
          </div>

          {/* Legend */}
          <div style={{marginTop:".5rem",display:"flex",gap:".8rem",fontSize:".6rem",color:"rgba(255,255,255,.35)"}}>
            <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:2,background:"rgba(201,168,76,.7)"}}/> Target</div>
            <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:6,background:"rgba(76,175,154,.5)",borderRadius:1}}/> Under</div>
            <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:6,background:"rgba(224,124,90,.5)",borderRadius:1}}/> Over</div>
          </div>
          </>
        )}
      </div>

      {/* Show all asset types (collapsed) */}
      {Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0).length>0&&(
        <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",cursor:"pointer",textAlign:"center",padding:".4rem",
          border:"1px dashed rgba(255,255,255,.1)",borderRadius:6}}
          onClick={()=>{
            const missing = Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0);
            if(missing.length) setTargetAlloc(p=>{const n={...p};missing.forEach(t=>n[t]=0);return n;});
          }}>
          + Show all asset types ({Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0).length} hidden)
        </div>
      )}
    </>
  );
}
