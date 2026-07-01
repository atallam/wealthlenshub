import { useState, useEffect } from 'react';
import { supabase } from '../../supabase.js';
import MFTransactionForm from './MFTransactionForm.jsx';
import { FG } from './Overlay.jsx';

/* ══════════════════════════════════════════════
   TRANSACTION PANEL (per holding)
   Extracted from App.jsx lines 452–727
══════════════════════════════════════════════ */
const USD_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);

export default function TransactionPanel({ holding, onAddTxn, onReload, onDeleteTxn, txnForm, setTxnForm, onClose, onFetchFx, fxRate, fxLoading }) {
  // Lazy-fetch fresh transactions on panel open so we never show stale inline data
  const [freshTxns, setFreshTxns] = useState(null); // null = loading, [] = empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        const res = await fetch(`/api/holdings/${holding.id}/transactions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setFreshTxns(data);
      } catch {
        // Fall back to inline transactions on network error
        if (!cancelled) setFreshTxns(holding.transactions || []);
      }
    })();
    return () => { cancelled = true; };
  }, [holding.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use fresh fetched data; fall back to inline while loading
  const txns = (freshTxns ?? holding.transactions ?? []).slice().sort((a,b)=>new Date(a.txn_date)-new Date(b.txn_date));
  const buys  = txns.filter(t=>t.txn_type==="BUY");
  const sells = txns.filter(t=>t.txn_type==="SELL");
  const netUnits = buys.reduce((s,t)=>s+Number(t.units),0) - sells.reduce((s,t)=>s+Number(t.units),0);
  const avgCost  = buys.length>0 ? buys.reduce((s,t)=>s+Number(t.units)*Number(t.price),0)/buys.reduce((s,t)=>s+Number(t.units),0) : 0;
  const isUS   = USD_TYPES.has(holding.type);
  const isMF   = holding.type==="MF";
  const priceLabel = isMF ? "NAV" : isUS ? "Price $" : "Price ₹";

  // Use live USD/INR fallback
  let _liveUsdInr = 94.5;
  const fx = +(holding.usd_inr_rate||fxRate||_liveUsdInr);

  // SIP state
  const [sipMode,       setSipMode]       = useState(false);
  const [sipAmount,     setSipAmount]     = useState("");
  const [sipDay,        setSipDay]        = useState("5");
  const [sipStartMonth, setSipStartMonth] = useState(() => { const d=new Date(); d.setMonth(d.getMonth()-11); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [sipEndMonth,   setSipEndMonth]   = useState(() => { const d=new Date(); const next=new Date(d.getFullYear(), d.getMonth()+3, 1); return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`; });
  const [sipPreview,    setSipPreview]    = useState([]);
  const [sipFetching,   setSipFetching]   = useState(false);
  const [sipImporting,  setSipImporting]  = useState(false);
  const [sipError,      setSipError]      = useState("");

  async function fetchSipNavs(){
    if(!sipAmount||!sipDay||!sipStartMonth||!sipEndMonth){ setSipError("Fill in all fields"); return; }
    setSipError(""); setSipFetching(true); setSipPreview([]);
    const [sy,sm] = sipStartMonth.split("-").map(Number);
    const [ey,em] = sipEndMonth.split("-").map(Number);
    const months = [];
    let y=sy, m=sm;
    while(y<ey||(y===ey&&m<=em)){
      months.push({year:y, month:m, sip_date:+sipDay});
      m++; if(m>12){m=1;y++;}
      if(months.length>120) break;
    }
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      const res = await fetch("/api/mf/sip-navs",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({scheme_code:holding.scheme_code, months})});
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      const preview = data.results.map(r=>({
        ...r,
        units: r.nav ? (+sipAmount/r.nav) : null,
        amount: +sipAmount,
      }));
      setSipPreview(preview);
    }catch(e){ setSipError(e.message); }
    setSipFetching(false);
  }

  async function importSip(){
    const valid = sipPreview.filter(r=>r.nav&&r.txn_date&&r.units);
    if(!valid.length){ setSipError("No valid transactions to import"); return; }
    setSipImporting(true);
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      for(const r of valid){
        await fetch("/api/transactions",{method:"POST",
          headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
          body:JSON.stringify({
            holding_id: holding.id,
            txn_type:   "BUY",
            units:      +r.units.toFixed(4),
            price:      +r.nav.toFixed(4),
            txn_date:   r.txn_date,
            notes:      `SIP ₹${r.amount.toLocaleString("en-IN")}${r.is_future?" (scheduled)":r.is_estimated?" (est. NAV)":""}`,
          })});
      }
      await onReload(holding.id);
      // Refresh local transaction list
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const res = await fetch(`/api/holdings/${holding.id}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setFreshTxns(await res.json());
      setSipMode(false); setSipPreview([]);
    }catch(e){ setSipError(e.message); }
    setSipImporting(false);
  }

  const validRows    = sipPreview.filter(r=>r.nav&&r.units);
  const futureRows   = sipPreview.filter(r=>r.is_future);
  const pastRows     = sipPreview.filter(r=>!r.is_future&&r.nav);
  const totalInvested= validRows.reduce((s,r)=>s+r.amount,0);
  const totalUnits   = validRows.reduce((s,r)=>s+(r.units||0),0);
  const avgNav       = totalUnits>0 ? totalInvested/totalUnits : 0;

  return (
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:660}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>📋 Transactions</div>
            <div style={{fontSize:".73rem",color:"var(--text-dim)"}}>{holding.name} {isUS&&<span style={{fontSize:".65rem",color:"#5a9ce0",marginLeft:4}}>{holding.type==="CRYPTO"?"₿":"$"} USD input</span>}</div>
          </div>
          <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
            {isMF&&holding.scheme_code&&(
              <button onClick={()=>{setSipMode(p=>!p);setSipPreview([]);setSipError("");}}
                style={{background:sipMode?"rgba(160,132,202,.2)":"rgba(160,132,202,.1)",border:`1px solid rgba(160,132,202,${sipMode?".5":".25"})`,color:"#a084ca",borderRadius:5,padding:".28rem .65rem",cursor:"pointer",fontSize:".68rem",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>
                {sipMode?"✕ Cancel SIP":"📅 Add SIP History"}
              </button>
            )}
            <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── SIP BULK ENTRY MODE ── */}
        {sipMode&&(
          <div style={{background:"rgba(160,132,202,.06)",border:"1px solid rgba(160,132,202,.2)",borderRadius:10,padding:"1.1rem",marginBottom:"1.2rem"}}>
            <div style={{fontSize:".7rem",letterSpacing:".1em",textTransform:"uppercase",color:"#a084ca",marginBottom:".9rem",fontWeight:600}}>📅 SIP Bulk Import</div>

            <div className="frow" style={{marginBottom:".7rem"}}>
              <FG label="Monthly SIP ₹">
                <input type="number" className="fi" placeholder="e.g. 10000" value={sipAmount} onChange={e=>setSipAmount(e.target.value)}/>
              </FG>
              <FG label="SIP Date (day of month)">
                <select className="fi fs" value={sipDay} onChange={e=>setSipDay(e.target.value)}>
                  {Array.from({length:31},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}{d===1?"st":d===2?"nd":d===3?"rd":"th"}</option>)}
                </select>
              </FG>
            </div>
            <div className="frow" style={{marginBottom:".9rem"}}>
              <FG label="Start Month">
                <input type="month" className="fi" value={sipStartMonth} onChange={e=>setSipStartMonth(e.target.value)}/>
              </FG>
              <FG label="End Month (can be future)">
                <input type="month" className="fi" value={sipEndMonth} onChange={e=>setSipEndMonth(e.target.value)}/>
              </FG>
            </div>

            {sipError&&<div style={{fontSize:".75rem",color:"#e07c5a",marginBottom:".7rem"}}>⚠ {sipError}</div>}

            <button onClick={fetchSipNavs} disabled={sipFetching||!sipAmount}
              style={{width:"100%",background:"rgba(160,132,202,.15)",border:"1px solid rgba(160,132,202,.35)",color:"#a084ca",borderRadius:6,padding:".55rem",cursor:"pointer",fontSize:".8rem",fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:sipPreview.length?".9rem":"0"}}>
              {sipFetching?"⟳ Fetching NAVs from MFAPI…":"🔍 Fetch NAVs & Preview"}
            </button>

            {sipPreview.length>0&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(80px,1fr))",gap:".5rem",marginBottom:".85rem"}}>
                  {[
                    {label:"Months",     val:sipPreview.length},
                    {label:"Past SIPs",  val:pastRows.length},
                    {label:"Future SIPs",val:futureRows.length, note:"estimated NAV"},
                    {label:"Avg NAV",    val:`₹${avgNav.toFixed(4)}`},
                  ].map(s=>(
                    <div key={s.label} style={{background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:7,padding:".55rem .7rem",textAlign:"center"}}>
                      <div style={{fontSize:".58rem",letterSpacing:".07em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".2rem"}}>{s.label}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:".82rem",color:s.label==="Future SIPs"?"#5a9ce0":"#c9a84c"}}>{s.val}</div>
                      {s.note&&<div style={{fontSize:".58rem",color:"var(--text-muted)",marginTop:".1rem"}}>{s.note}</div>}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".5rem"}}>
                  <div style={{fontSize:".72rem",color:"var(--text-dim)"}}>
                    Total invested: <span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>₹{totalInvested.toLocaleString("en-IN")}</span>
                    <span style={{marginLeft:".75rem"}}>Total units: <span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{totalUnits.toFixed(4)}</span></span>
                  </div>
                </div>

                <div style={{maxHeight:220,overflowY:"auto",overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:".85rem",border:"1px solid var(--border)",borderRadius:7}}>
                  <table className="ht" style={{fontSize:".72rem",minWidth:480}}>
                    <thead style={{position:"sticky",top:0,background:"var(--bg-muted)",zIndex:1}}>
                      <tr>
                        <th>Month</th><th>Txn Date</th><th className="r">NAV ₹</th>
                        <th className="r">Units</th><th className="r">Amount</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sipPreview.map((r,i)=>(
                        <tr key={i} style={{opacity:r.nav?1:.5}}>
                          <td className="mono">{String(r.month).padStart(2,'0')}/{r.year}</td>
                          <td className="mono dim">{r.txn_date||"—"}</td>
                          <td className="r mono">{r.nav?`₹${r.nav.toFixed(4)}`:"—"}</td>
                          <td className="r mono">{r.units?r.units.toFixed(4):"—"}</td>
                          <td className="r mono dim">₹{r.amount.toLocaleString("en-IN")}</td>
                          <td>
                            {r.is_future
                              ? <span style={{fontSize:".62rem",color:"#5a9ce0",background:"rgba(90,156,224,.12)",padding:"1px 6px",borderRadius:3}}>Scheduled</span>
                              : r.is_estimated
                                ? <span style={{fontSize:".62rem",color:"#c9a84c",background:"rgba(201,168,76,.1)",padding:"1px 6px",borderRadius:3}}>Est. NAV</span>
                                : r.nav
                                  ? <span style={{fontSize:".62rem",color:"#4caf9a",background:"rgba(76,175,154,.1)",padding:"1px 6px",borderRadius:3}}>✓ Exact</span>
                                  : <span style={{fontSize:".62rem",color:"#e07c5a"}}>No NAV</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {futureRows.length>0&&(
                  <div style={{fontSize:".7rem",color:"rgba(90,156,224,.7)",marginBottom:".7rem",padding:".5rem .7rem",background:"rgba(90,156,224,.06)",borderRadius:6,border:"1px solid rgba(90,156,224,.15)"}}>
                    ℹ {futureRows.length} future SIP{futureRows.length>1?"s":""} will use today's NAV as a placeholder and be marked as scheduled. Update them after each actual investment.
                  </div>
                )}

                <button onClick={importSip} disabled={sipImporting||validRows.length===0}
                  style={{width:"100%",background:"rgba(76,175,154,.15)",border:"1px solid rgba(76,175,154,.35)",color:"#4caf9a",borderRadius:6,padding:".6rem",cursor:"pointer",fontSize:".82rem",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
                  {sipImporting?`⟳ Importing ${validRows.length} transactions…`:`⇩ Import ${validRows.length} SIP Transactions`}
                </button>
              </>
            )}
          </div>
        )}

        {/* Summary bar */}
        {!sipMode&&freshTxns!==null&&txns.length>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:".6rem",marginBottom:"1.2rem"}}>
            {[
              {label:"Net Units", val:netUnits.toFixed(4)},
              {label:"Avg Cost (INR)", val:`₹${avgCost.toLocaleString("en-IN",{maximumFractionDigits:2})}`},
              {label:"Transactions", val:txns.length},
            ].map(s=>(
              <div key={s.label} style={{background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:8,padding:".7rem .9rem",textAlign:"center"}}>
                <div style={{fontSize:".62rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".3rem"}}>{s.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:".95rem",color:"#c9a84c"}}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Transaction list */}
        {!sipMode&&freshTxns===null&&(
          <div style={{textAlign:"center",padding:"1.5rem",color:"var(--text-muted)",fontSize:".78rem"}}>Loading transactions…</div>
        )}
        {!sipMode&&freshTxns!==null&&(txns.length===0
          ? <div className="empty" style={{padding:"1.5rem"}}>No transactions yet — add one below or use 📅 Add SIP History</div>
          : <div style={{maxHeight:220,overflowY:"auto",overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:"1.2rem"}}>
              <table className="ht" style={{fontSize:".75rem",minWidth:420}}>
                <thead><tr>
                  <th>Date</th><th>Type</th><th className="r">Units</th>
                  <th className="r">{isUS?"Price $":"Price ₹"}</th>
                  {isUS&&<th className="r">Price ₹</th>}
                  <th className="r">Total ₹</th>
                  <th>Notes</th><th/>
                </tr></thead>
                <tbody>
                  {txns.map(t=>(
                    <tr key={t.id}>
                      <td className="mono dim">{t.txn_date}</td>
                      <td><span style={{fontSize:".65rem",padding:"2px 7px",borderRadius:3,fontWeight:600,background:t.txn_type==="BUY"?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)",color:t.txn_type==="BUY"?"#4caf9a":"#e07c5a"}}>{t.txn_type}</span></td>
                      <td className="r mono">{Number(t.units).toFixed(4)}</td>
                      {isUS
                        ? <><td className="r mono dim">${t.price_usd!=null?Number(t.price_usd).toFixed(2):(Number(t.price)/fx).toFixed(2)}</td><td className="r mono dim">₹{Number(t.price).toLocaleString("en-IN",{maximumFractionDigits:0})}</td></>
                        : <td className="r mono dim">₹{Number(t.price).toLocaleString("en-IN",{maximumFractionDigits:2})}</td>
                      }
                      <td className="r mono" style={{color:"var(--text)"}}>₹{(Number(t.units)*Number(t.price)).toLocaleString("en-IN",{maximumFractionDigits:0})}</td>
                      <td className="dim" style={{maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.notes||"—"}</td>
                      <td><button className="delbtn" onClick={()=>onDeleteTxn(t.id, holding.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}

        {/* Add single transaction form */}
        {!sipMode&&(
        <MFTransactionForm
          holding={holding} isMF={isMF} isUS={isUS} fx={fx}
          txnForm={txnForm} setTxnForm={setTxnForm}
          onAddTxn={onAddTxn} onClose={onClose}
          onFetchFx={onFetchFx} fxLoading={fxLoading}
        />
        )}
      </div>
    </div>
  );
}
