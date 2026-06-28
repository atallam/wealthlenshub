import { Overlay } from '../shared/Overlay.jsx';

/* ══════════════════════════════════════════════
   IMPORT MODAL — multi-step CSV/PDF import wizard
   Extracted from App.jsx lines 6371–6742
══════════════════════════════════════════════ */

/**
 * ImportModal
 * Props:
 *   importState    — { mode, step, format, holdings, transactions, warnings, result,
 *                      dragOver, assignMember, accounts, accountMap,
 *                      needsPassword, casPan, casDob, casRemember }
 *   setImportState — state setter
 *   members        — member array
 *   AT             — asset type map { [type]: { label, color, icon } }
 *   handleImportFile  — (file) => void
 *   executeImport     — () => void
 *   resetImport       — () => void
 *   importFileRef     — React ref for hidden file input
 *   onClose           — () => void
 *   fmt               — (n) => string  (USD formatter)
 *   submitCASPassword — () => void
 */
export default function ImportModal({ importState, setImportState, members, AT, handleImportFile, executeImport, resetImport, importFileRef, onClose, fmt, submitCASPassword }) {
  const { mode, step, format, holdings, transactions, warnings, result, dragOver, assignMember, accounts, accountMap, needsPassword, casPan, casDob, casRemember } = importState;
  const items = mode === "transactions" ? transactions : holdings;
  const dupCount = holdings.filter(h => h._duplicate).length;
  const importCount = mode === "transactions" ? transactions.length : holdings.length;

  const US_FORMATS = [
    { name: "Schwab", color: "#00a3e0" }, { name: "Fidelity", color: "#4a8c2a" },
    { name: "Robinhood", color: "#00c805" }, { name: "Vanguard", color: "#c22e2e" },
    { name: "IBKR", color: "#d81b3c" }, { name: "E*TRADE", color: "#6633cc" },
    { name: "Merrill", color: "#0060a9" }, { name: "J.P. Morgan", color: "#1a3c6e" },
    { name: "Webull", color: "#f5a623" }, { name: "SoFi", color: "#00bcd4" },
    { name: "Wealthfront", color: "#522da8" }, { name: "Betterment", color: "#1d8ae0" },
    { name: "Firstrade", color: "#003d79" }, { name: "Ally", color: "#650360" },
    { name: "Public", color: "#000000" }, { name: "Tastytrade", color: "#b71c1c" },
    { name: "Coinbase", color: "#0052ff" },
  ];
  const IN_FORMATS = [
    { name: "Zerodha", color: "#e5483e" }, { name: "Groww", color: "#00d09c" },
    { name: "ICICI Direct", color: "#f58220" }, { name: "HDFC Sec", color: "#004b8d" },
    { name: "Upstox", color: "#6b3fa0" }, { name: "Angel One", color: "#1d4aa7" },
    { name: "Kuvera / MF", color: "#2e7d32" },
  ];
  const OTHER_FORMATS = [
    { name: "NSDL/CDSL CAS", color: "#e07c5a" }, { name: "PDF", color: "#e05555" }, { name: "Excel", color: "#217346" }, { name: "Generic CSV", color: "#888" },
  ];

  return (
    <Overlay onClose={onClose} wide>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
        <div className="modtitle" style={{margin:0}}>
          {step==="done"?"✓ Import Complete":step==="importing"?"Importing…":step==="dup_review"?"⚠ Review Duplicates":step==="cas_password"?"🔒 Unlock CAS PDF":step==="preview"?(mode==="transactions"?"Import Transactions":"Import Portfolio"):"Import Portfolio or Transactions"}
        </div>
      </div>

      {step==="upload"&&(<>
        <div style={{border:`2px dashed ${dragOver?"#c9a84c":"rgba(255,255,255,.22)"}`,borderRadius:12,
          padding:"2.5rem 1.5rem",textAlign:"center",cursor:"pointer",
          background:dragOver?"rgba(201,168,76,.06)":"rgba(255,255,255,.02)",transition:"all .25s",marginBottom:"1.2rem"}}
          onClick={()=>importFileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setImportState(s=>({...s,dragOver:true}));}}
          onDragLeave={()=>setImportState(s=>({...s,dragOver:false}))}
          onDrop={e=>{e.preventDefault();setImportState(s=>({...s,dragOver:false}));const f=e.dataTransfer.files[0];if(f)handleImportFile(f);}}>
          <div style={{fontSize:"2.2rem",marginBottom:".6rem"}}>📂</div>
          <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)",fontWeight:500}}>
            Drag & drop your broker export here
          </div>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.45)",marginTop:".4rem"}}>
            Holdings or tradebook — auto-detected · CSV, XLSX, PDF
          </div>
          <button className="btns" style={{marginTop:"1rem",fontSize:".75rem"}}>Browse Files</button>
        </div>
        <div style={{fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"#c9a84c",marginBottom:".6rem",fontWeight:600}}>Auto-detected formats</div>
        <div style={{marginBottom:".8rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",letterSpacing:".06em",textTransform:"uppercase",minWidth:"1.8rem"}}>US</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {US_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",letterSpacing:".06em",textTransform:"uppercase",minWidth:"1.8rem"}}>IN</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {IN_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",minWidth:"1.8rem"}}></span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {OTHER_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        {warnings.length>0&&(
          <div style={{background:"rgba(224,124,90,.1)",border:"1px solid rgba(224,124,90,.25)",borderRadius:8,padding:".7rem .9rem",marginTop:".6rem"}}>
            {warnings.map((w,i)=>(<div key={i} style={{fontSize:".73rem",color:"#e07c5a",marginBottom:i<warnings.length-1?".3rem":0}}>⚠ {w}</div>))}
          </div>
        )}
      </>)}

      {/* ── CAS Password Step ── */}
      {step==="cas_password"&&(
        <div style={{maxWidth:400,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:"1.2rem"}}>
            <div style={{fontSize:"2rem",marginBottom:".5rem"}}>🔐</div>
            <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)",marginBottom:".3rem"}}>This PDF is password-protected</div>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.5)"}}>NSDL/CDSL CAS password is your PAN number</div>
          </div>
          <div style={{marginBottom:".8rem"}}>
            <label style={{fontSize:".68rem",color:"rgba(255,255,255,.6)",letterSpacing:".05em",textTransform:"uppercase",display:"block",marginBottom:".3rem"}}>PAN Number</label>
            <input className="fi" value={casPan} onChange={e=>setImportState(s=>({...s,casPan:e.target.value.toUpperCase()}))}
              placeholder="ABCDE1234F" maxLength={10} style={{fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:".1em"}}/>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:".5rem",fontSize:".73rem",color:"rgba(255,255,255,.6)",marginBottom:"1.2rem",cursor:"pointer"}}>
            <input type="checkbox" checked={casRemember} onChange={e=>setImportState(s=>({...s,casRemember:e.target.checked}))}
              style={{accentColor:"#c9a84c"}}/>
            Remember for future imports (encrypted)
          </label>
          {warnings.length>0&&(
            <div style={{background:"rgba(224,124,90,.1)",border:"1px solid rgba(224,124,90,.25)",borderRadius:8,padding:".55rem .75rem",marginBottom:".8rem"}}>
              {warnings.map((w,i)=>(<div key={i} style={{fontSize:".73rem",color:"#e07c5a"}}>⚠ {w}</div>))}
            </div>
          )}
          <div style={{display:"flex",gap:".7rem"}}>
            <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"upload",needsPassword:false,pendingFile:null}))}>Cancel</button>
            <button className="btns" disabled={!casPan||casPan.length!==10} onClick={submitCASPassword}>
              Unlock & Import
            </button>
          </div>
        </div>
      )}

      {step==="preview"&&(<>
        <div style={{display:"flex",alignItems:"center",gap:".7rem",marginBottom:".8rem",flexWrap:"wrap"}}>
          <span style={{fontSize:".72rem",padding:".25rem .65rem",borderRadius:5,
            background:"rgba(201,168,76,.12)",color:"#c9a84c",fontWeight:600,border:"1px solid rgba(201,168,76,.2)"}}>
            {format}
          </span>
          <span style={{fontSize:".68rem",padding:".22rem .55rem",borderRadius:5,
            background:mode==="transactions"?"rgba(160,132,202,.12)":"rgba(76,175,154,.12)",
            color:mode==="transactions"?"#a084ca":"#4caf9a",fontWeight:600,
            border:`1px solid ${mode==="transactions"?"rgba(160,132,202,.25)":"rgba(76,175,154,.25)"}`}}>
            {mode==="transactions"?"📋 Transactions":"📊 Holdings"}
          </span>
          <span style={{fontSize:".75rem",color:"rgba(255,255,255,.7)"}}>
            {items.length} {mode==="transactions"?"transaction":"holding"}{items.length!==1?"s":""} found
          </span>
          {dupCount>0&&<span style={{fontSize:".72rem",color:"#e0a85a",background:"rgba(224,168,90,.1)",padding:".18rem .5rem",borderRadius:4,border:"1px solid rgba(224,168,90,.2)"}}>⚠ {dupCount} already in portfolio</span>}
        </div>
        {mode==="holdings"&&members.length>0&&(
          <div style={{marginBottom:".8rem"}}>
            {accounts.length>0&&members.length>1?(
              <div>
                <div style={{fontSize:".65rem",letterSpacing:".06em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".4rem"}}>Map accounts to family members</div>
                {accounts.map(acct=>{
                  const autoMatched = accountMap[acct] && members.find(m=>m.id===accountMap[acct]);
                  return(
                  <div key={acct} style={{display:"flex",gap:".6rem",alignItems:"center",marginBottom:".35rem"}}>
                    <span style={{fontSize:".72rem",color:"rgba(255,255,255,.7)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acct}</span>
                    <span style={{fontSize:".65rem",color:"rgba(255,255,255,.4)"}}>→</span>
                    <select className="fi fs" style={{padding:".22rem .5rem",fontSize:".7rem",width:"auto",minWidth:120,
                      borderColor: autoMatched ? "rgba(76,175,154,.4)" : undefined}}
                      value={accountMap[acct]||""} onChange={e=>setImportState(s=>({...s,accountMap:{...s.accountMap,[acct]:e.target.value}}))}>
                      <option value="">Auto (first member)</option>
                      {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    {autoMatched&&<span style={{fontSize:".6rem",color:"#4caf9a"}}>✓ matched</span>}
                  </div>
                );})}
              </div>
            ):(
              <div style={{display:"flex",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
                <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".73rem",color:"rgba(255,255,255,.7)"}}>
                  Assign to:
                  <select className="fi fs" style={{padding:".25rem .5rem",fontSize:".72rem",width:"auto"}}
                    value={assignMember||members[0]?.id||""} onChange={e=>setImportState(s=>({...s,assignMember:e.target.value}))}>
                    {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                {members.length===1&&<span style={{fontSize:".62rem",color:"rgba(76,175,154,.6)"}}>✓ auto-selected</span>}
              </div>
            )}
          </div>
        )}
        {warnings.length>0&&(
          <div style={{background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.15)",borderRadius:8,padding:".55rem .75rem",marginBottom:".7rem"}}>
            {warnings.map((w,i)=>(<div key={i} style={{fontSize:".7rem",color:"#c9a84c"}}>⚠ {w}</div>))}
          </div>
        )}
        <div style={{overflowX:"auto",maxHeight:340,overflowY:"auto",borderRadius:8,border:"1px solid rgba(255,255,255,.06)"}}>
          {mode==="transactions"?(
            <table className="ht" style={{fontSize:".72rem"}}><thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th className="r">Units</th><th className="r">Price</th></tr></thead>
            <tbody>{transactions.slice(0,200).map((t,i)=>(
              <tr key={i}><td className="mono dim">{t.txn_date}</td><td>{t._symbol}</td>
              <td><span style={{fontSize:".65rem",padding:".15rem .4rem",borderRadius:3,
                background:t.txn_type==="BUY"?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)",
                color:t.txn_type==="BUY"?"#4caf9a":"#e07c5a"}}>{t.txn_type}</span></td>
              <td className="r mono">{t.units}</td><td className="r mono dim">{fmt(t.price)}</td></tr>
            ))}</tbody></table>
          ):(
            <table className="ht" style={{fontSize:".72rem"}}><thead><tr><th style={{width:30}}></th><th>Name</th><th>Type</th><th>Ticker/Code</th><th className="r">Units</th><th className="r">Avg Cost</th><th className="r">Invested</th></tr></thead>
            <tbody>{holdings.map((h,i)=>{
              const inv=h.purchase_value||(h.units*(h.purchase_price||h.purchase_nav||0));
              return(<tr key={i}>
                <td>{h._duplicate
                  ?<span title="Existing — will update" style={{fontSize:".65rem",padding:".12rem .35rem",borderRadius:3,background:"rgba(90,156,224,.12)",color:"#5a9ce0"}}>↻</span>
                  :<span title="New holding" style={{fontSize:".65rem",padding:".12rem .35rem",borderRadius:3,background:"rgba(76,175,154,.12)",color:"#4caf9a"}}>+</span>}</td>
                <td style={{fontWeight:500}}>{h.name}</td>
                <td><span className="tbadge2" style={{background:(AT[h.type]?.color||"#888")+"22",color:AT[h.type]?.color||"#888"}}>{AT[h.type]?.icon||"📦"} {AT[h.type]?.label||h.type}</span></td>
                <td className="mono dim">{h.ticker||h.scheme_code||"—"}</td>
                <td className="r mono">{h.units||"—"}</td>
                <td className="r mono dim">{fmt(h.purchase_price||h.purchase_nav||0)}</td>
                <td className="r mono">{fmt(inv)}</td>
              </tr>);
            })}</tbody></table>
          )}
        </div>
        {items.length>200&&<div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",textAlign:"center",marginTop:".4rem"}}>Showing first 200 of {items.length} rows</div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"1rem",gap:".6rem"}}>
          <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"upload",holdings:[],transactions:[],warnings:[]}))}>← Back</button>
          <div style={{display:"flex",gap:".5rem"}}>
            <button className="btnc" onClick={onClose}>Cancel</button>
            <button className="btns" onClick={()=>{
              if(mode==="holdings"&&dupCount>0){
                setImportState(s=>({...s,step:"dup_review"}));
              } else {
                executeImport();
              }
            }} disabled={importCount===0}>
              {mode==="holdings"&&dupCount>0
                ?`Review ${dupCount} Duplicate${dupCount>1?"s":""} →`
                :`Import ${importCount} ${mode==="transactions"?"Transaction":"Holding"}${importCount!==1?"s":""}`}
            </button>
          </div>
        </div>
      </>)}

      {step==="dup_review"&&(<>
        <div style={{marginBottom:"1rem"}}>
          <div style={{fontSize:".85rem",fontWeight:600,color:"#e0a85a",marginBottom:".4rem"}}>
            ⚠ {dupCount} holding{dupCount>1?"s":""} already exist{dupCount===1?"s":""} in your portfolio
          </div>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.55)",lineHeight:1.5}}>
            This file contains holdings that match existing entries. Choose what to do with each duplicate, or use the bulk actions below.
          </div>
        </div>

        {/* Bulk actions */}
        <div style={{display:"flex",gap:".5rem",marginBottom:".8rem",flexWrap:"wrap"}}>
          <button className="btnc" style={{fontSize:".68rem",padding:".28rem .65rem"}} onClick={()=>{
            setImportState(s=>({...s,holdings:s.holdings.map(h=>h._duplicate?{...h,_dupAction:"update"}:h)}));
          }}>↻ Update All Duplicates</button>
          <button className="btnc" style={{fontSize:".68rem",padding:".28rem .65rem"}} onClick={()=>{
            setImportState(s=>({...s,holdings:s.holdings.map(h=>h._duplicate?{...h,_dupAction:"skip"}:h)}));
          }}>⊘ Skip All Duplicates</button>
        </div>

        {/* Per-holding duplicate review */}
        <div style={{maxHeight:380,overflowY:"auto",borderRadius:8,border:"1px solid rgba(255,255,255,.06)"}}>
          {holdings.filter(h=>h._duplicate).map((h,i)=>{
            const action = h._dupAction || "update";
            const ex = h._existing || {};
            const newInv = h.purchase_value||(h.units*(h.purchase_price||h.purchase_nav||0));
            const exInv = ex.purchase_value||(ex.units*(ex.purchase_price||0));
            const unitsChanged = ex.units && h.units && Math.abs(ex.units-h.units)>0.001;
            const priceChanged = ex.purchase_price && h.purchase_price && Math.abs(ex.purchase_price-h.purchase_price)>0.01;
            return(
            <div key={i} style={{padding:".75rem .85rem",borderBottom:"1px solid rgba(255,255,255,.05)",
              background:action==="skip"?"rgba(255,255,255,.015)":"rgba(90,156,224,.03)",
              opacity:action==="skip"?.55:1,transition:"all .2s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:".6rem",marginBottom:".45rem"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:".78rem",fontWeight:600,color:"#fff"}}>{h.name}</div>
                  <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)",marginTop:".15rem"}}>
                    {h.ticker||h.scheme_code||"—"} · <span className="tbadge2" style={{background:(AT[h.type]?.color||"#888")+"22",color:AT[h.type]?.color||"#888",fontSize:".6rem",padding:".1rem .35rem"}}>{AT[h.type]?.icon||"📦"} {AT[h.type]?.label||h.type}</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:".3rem",flexShrink:0}}>
                  <button onClick={()=>setImportState(s=>({...s,holdings:s.holdings.map((hh)=>hh===h?{...hh,_dupAction:"update"}:hh)}))}
                    style={{fontSize:".65rem",padding:".22rem .5rem",borderRadius:4,cursor:"pointer",border:"1px solid",transition:"all .15s",fontFamily:"'DM Sans',sans-serif",
                      background:action==="update"?"rgba(90,156,224,.15)":"transparent",
                      borderColor:action==="update"?"rgba(90,156,224,.45)":"rgba(255,255,255,.15)",
                      color:action==="update"?"#5a9ce0":"rgba(255,255,255,.5)"}}>
                    ↻ Update
                  </button>
                  <button onClick={()=>setImportState(s=>({...s,holdings:s.holdings.map((hh)=>hh===h?{...hh,_dupAction:"skip"}:hh)}))}
                    style={{fontSize:".65rem",padding:".22rem .5rem",borderRadius:4,cursor:"pointer",border:"1px solid",transition:"all .15s",fontFamily:"'DM Sans',sans-serif",
                      background:action==="skip"?"rgba(224,124,90,.12)":"transparent",
                      borderColor:action==="skip"?"rgba(224,124,90,.35)":"rgba(255,255,255,.15)",
                      color:action==="skip"?"#e07c5a":"rgba(255,255,255,.5)"}}>
                    ⊘ Skip
                  </button>
                </div>
              </div>
              {action!=="skip"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:".4rem",fontSize:".67rem",marginTop:".3rem"}}>
                  <div style={{background:"rgba(255,255,255,.03)",borderRadius:6,padding:".4rem .6rem",border:"1px solid rgba(255,255,255,.06)"}}>
                    <div style={{fontSize:".58rem",letterSpacing:".06em",textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:".25rem"}}>Current (in portfolio)</div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Units: <span className="mono">{ex.units!=null?fmt(ex.units,2):"—"}</span></div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Avg Cost: <span className="mono">{ex.purchase_price?fmt(ex.purchase_price):"—"}</span></div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Invested: <span className="mono">{exInv?fmt(exInv):"—"}</span></div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",color:"rgba(255,255,255,.25)",fontSize:"1.1rem"}}>→</div>
                  <div style={{background:"rgba(90,156,224,.05)",borderRadius:6,padding:".4rem .6rem",border:"1px solid rgba(90,156,224,.12)"}}>
                    <div style={{fontSize:".58rem",letterSpacing:".06em",textTransform:"uppercase",color:"#5a9ce0",marginBottom:".25rem"}}>New (from file)</div>
                    <div style={{color:"#fff"}}>Units: <span className="mono" style={{color:unitsChanged?"#c9a84c":"#fff"}}>{fmt(h.units||0,2)}</span>{unitsChanged&&<span style={{fontSize:".58rem",color:"#c9a84c",marginLeft:".3rem"}}>changed</span>}</div>
                    <div style={{color:"#fff"}}>Avg Cost: <span className="mono" style={{color:priceChanged?"#c9a84c":"#fff"}}>{fmt(h.purchase_price||h.purchase_nav||0)}</span>{priceChanged&&<span style={{fontSize:".58rem",color:"#c9a84c",marginLeft:".3rem"}}>changed</span>}</div>
                    <div style={{color:"#fff"}}>Invested: <span className="mono">{fmt(newInv)}</span></div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>

        {holdings.filter(h=>!h._duplicate).length>0&&(
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.55)",marginTop:".6rem"}}>
            + {holdings.filter(h=>!h._duplicate).length} new holding{holdings.filter(h=>!h._duplicate).length>1?"s":""} will be added
          </div>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"1rem",gap:".6rem"}}>
          <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"preview"}))}>← Back to Preview</button>
          <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
            {holdings.filter(h=>h._duplicate&&(h._dupAction||"update")==="skip").length>0&&(
              <span style={{fontSize:".67rem",color:"#e07c5a"}}>
                {holdings.filter(h=>h._duplicate&&h._dupAction==="skip").length} will be skipped
              </span>
            )}
            <button className="btns" onClick={executeImport}>
              Confirm & Import {holdings.filter(h=>!h._duplicate||(h._dupAction||"update")!=="skip").length} Holding{holdings.filter(h=>!h._duplicate||(h._dupAction||"update")!=="skip").length!==1?"s":""}
            </button>
          </div>
        </div>
      </>)}

      {step==="importing"&&(
        <div style={{textAlign:"center",padding:"2.5rem 1rem"}}>
          <div style={{width:40,height:40,margin:"0 auto 1rem",border:"3px solid rgba(201,168,76,.2)",borderTopColor:"#c9a84c",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)"}}>Importing {items.length} {mode==="transactions"?"transactions":"holdings"}…</div>
          <div style={{fontSize:".7rem",color:"rgba(255,255,255,.4)",marginTop:".4rem"}}>Creating entries and first transactions</div>
        </div>
      )}

      {step==="done"&&result&&(
        <div style={{padding:".5rem 0"}}>
          <div style={{background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.2)",borderRadius:10,padding:"1rem 1.2rem",marginBottom:".8rem"}}>
            <div style={{fontSize:"1.1rem",fontWeight:600,color:"#4caf9a",marginBottom:".3rem"}}>
              ✓ {(result.inserted_count||0)+(result.updated_count||0)+(result.imported_count||0)} processed
            </div>
            {result.inserted_count>0&&<div style={{fontSize:".75rem",color:"rgba(255,255,255,.7)"}}>+ {result.inserted_count} new holding{result.inserted_count>1?"s":""} added</div>}
            {result.updated_count>0&&<div style={{fontSize:".75rem",color:"#5a9ce0"}}>↻ {result.updated_count} existing holding{result.updated_count>1?"s":""} updated</div>}
            {result.skipped_count>0&&<div style={{fontSize:".75rem",color:"rgba(255,255,255,.45)"}}>⊘ {result.skipped_count} duplicate{result.skipped_count>1?"s":""} skipped (kept existing)</div>}
            {result.unmatched_count>0&&(<div style={{fontSize:".75rem",color:"#e07c5a",marginTop:".3rem"}}>
              ⚠ {result.unmatched_count} transaction{result.unmatched_count>1?"s":""} not matched to holdings:
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)",marginTop:".2rem"}}>{result.unmatched?.join(", ")}</div>
            </div>)}
            {result.error_count>0&&<div style={{fontSize:".75rem",color:"#e07c5a",marginTop:".3rem"}}>{result.error_count} error{result.error_count>1?"s":""}</div>}
          </div>
          {result.errors?.length>0&&(
            <div style={{background:"rgba(224,124,90,.08)",borderRadius:8,padding:".6rem .8rem",marginBottom:".7rem"}}>
              {result.errors.map((e,i)=>(<div key={i} style={{fontSize:".7rem",color:"#e07c5a"}}>• {e}</div>))}
            </div>
          )}
          <div style={{display:"flex",justifyContent:"flex-end",gap:".5rem"}}>
            <button className="btnc" onClick={resetImport}>Import More</button>
            <button className="btns" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Overlay>
  );
}
