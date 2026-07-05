import { useState } from 'react';
import { supabase } from '../../supabase.js';
import { FG, MA } from './Overlay.jsx';

/* ══════════════════════════════════════════════
   MF TRANSACTION FORM
   Extracted from App.jsx lines 729–869
══════════════════════════════════════════════ */
export default function MFTransactionForm({ holding, isMF, isUS, fx, txnForm, setTxnForm, onAddTxn, onClose, onFetchFx, fxLoading }) {
  const [mfAmount,   setMfAmount]   = useState("");
  const [navFetched, setNavFetched] = useState(null);
  const [navLoading, setNavLoading] = useState(false);
  const [navError,   setNavError]   = useState("");

  async function fetchNavForDate(){
    if(!txnForm.txn_date||!holding.scheme_code){ setNavError("Select a date first"); return; }
    setNavLoading(true); setNavError(""); setNavFetched(null);
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      const d = new Date(txnForm.txn_date);
      const res = await fetch("/api/mf/sip-navs",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({scheme_code:holding.scheme_code,months:[{year:d.getFullYear(),month:d.getMonth()+1,sip_date:d.getDate()}]})});
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      const r = data.results?.[0];
      if(!r?.nav) throw new Error("NAV not found for this date");
      setNavFetched({nav:r.nav,date:r.nav_date,estimated:r.is_estimated,future:r.is_future});
      const nav4 = r.nav.toFixed(4);
      if(mfAmount){
        const units = (+mfAmount/r.nav).toFixed(4);
        setTxnForm(p=>({...p,price:nav4,units}));
      } else {
        setTxnForm(p=>({...p,price:nav4}));
      }
    }catch(e){ setNavError(e.message); }
    setNavLoading(false);
  }

  function handleAmountChange(val){
    setMfAmount(val);
    if(val&&navFetched?.nav){
      setTxnForm(p=>({...p,units:(+val/navFetched.nav).toFixed(4)}));
    } else {
      setTxnForm(p=>({...p,units:""}));
    }
  }

  // Cash event flags
  const isDividend = txnForm.txn_type === "DIVIDEND";
  const isBonus    = txnForm.txn_type === "BONUS";
  const isRights   = txnForm.txn_type === "RIGHTS";
  const isSWP      = txnForm.txn_type === "SWP";
  const isCashEvent = isDividend || isBonus || isRights || isSWP;

  const canSubmit = txnForm.txn_date && (
    isDividend ? (txnForm.amount && Number(txnForm.amount) > 0)
    : isBonus   ? (txnForm.units && Number(txnForm.units) > 0)
    : (txnForm.units && txnForm.price)
  );

  return (
    <div style={{background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:9,padding:"1rem"}}>
      <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".8rem"}}>Add Transaction</div>
      <div className="frow">
        <FG label="Type">
          <select className="fi fs" value={txnForm.txn_type} onChange={e=>setTxnForm(p=>({...p,txn_type:e.target.value,units:"",price:"",price_usd:"",amount:""}))}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
            <option disabled>──────────</option>
            <option value="DIVIDEND">DIVIDEND — cash received</option>
            <option value="BONUS">BONUS — free units</option>
            <option value="RIGHTS">RIGHTS — issue exercised</option>
            {isMF&&<option value="SWP">SWP — systematic withdrawal</option>}
          </select>
        </FG>

        {/* ── CASH EVENT fields ── */}
        {isDividend&&(<>
          <FG label={isUS?"Total Cash Received $":"Total Cash Received ₹"}>
            <input type="number" className="fi" placeholder="e.g. 2500" value={txnForm.amount||""} onChange={e=>setTxnForm(p=>({...p,amount:e.target.value}))}/>
          </FG>
          <FG label="Shares Held at Ex-date (optional)">
            <input type="number" className="fi" placeholder="e.g. 100" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/>
          </FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>)}
        {isBonus&&(<>
          <FG label="Bonus Units Received">
            <input type="number" className="fi" placeholder="e.g. 50" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value,price:"0"}))}/>
          </FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>)}
        {(isRights||isSWP)&&(<>
          <FG label="Units">
            <input type="number" className="fi" placeholder="e.g. 25" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/>
          </FG>
          <FG label={isSWP?"NAV ₹ per unit":"Exercise Price ₹ per unit"}>
            <input type="number" className="fi" placeholder="per unit" value={txnForm.price} onChange={e=>setTxnForm(p=>({...p,price:e.target.value}))}/>
          </FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>)}

        {/* ── NORMAL BUY/SELL fields ── */}
        {!isCashEvent&&(isMF?(<>
          <FG label="Amount Invested ₹">
            <input type="number" className="fi" placeholder="e.g. 5000" value={mfAmount} onChange={e=>handleAmountChange(e.target.value)}/>
          </FG>
          <FG label="Date">
            <input type="date" className="fi" value={txnForm.txn_date} onChange={e=>{
              setNavFetched(null); setNavError("");
              setTxnForm(p=>({...p,txn_date:e.target.value,price:"",units:""}));
              setMfAmount(prev=>prev);
            }}/>
          </FG>
        </>):isUS?(<>
          <FG label="Units"><input type="number" className="fi" placeholder="e.g. 5" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/></FG>
          <FG label="Price $ per unit">
            <input type="number" className="fi" placeholder="e.g. 189.50" value={txnForm.price_usd||""} onChange={e=>{const usd=e.target.value;setTxnForm(p=>({...p,price_usd:usd,price:usd?(+usd*fx).toFixed(2):""}));}}/>
          </FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>):(<>
          <FG label="Units"><input type="number" className="fi" placeholder="e.g. 100" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/></FG>
          <FG label="Price ₹ per unit"><input type="number" className="fi" placeholder="per unit" value={txnForm.price} onChange={e=>setTxnForm(p=>({...p,price:e.target.value}))}/></FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>))}
      </div>

      {/* Cash event hint */}
      {isCashEvent&&(
        <div style={{fontSize:".72rem",color:"var(--text-muted)",marginBottom:".7rem",padding:".45rem .7rem",background:"rgba(201,168,76,.05)",border:"1px solid rgba(201,168,76,.15)",borderRadius:6}}>
          {isDividend&&"💰 Dividend — record total cash received. Units held is optional context."}
          {isBonus&&"🎁 Bonus — new units added to your holding at ₹0 cost. No cash involved."}
          {isRights&&"📋 Rights — units taken up at the exercise price per share."}
          {isSWP&&"📅 SWP — periodic redemption from mutual fund at the applicable NAV."}
        </div>
      )}

      {/* MF: NAV info bar */}
      {isMF&&!isCashEvent&&(
        <div style={{marginBottom:".8rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".65rem",padding:".55rem .8rem",
            background:navFetched?"rgba(76,175,154,.06)":"var(--text-muted)",
            border:navFetched?"1px solid rgba(76,175,154,.25)":"1px solid var(--border)",borderRadius:7}}>
            <div style={{flex:1}}>
              {navFetched?(<div style={{display:"flex",gap:"1.2rem",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".18rem"}}>NAV {navFetched.estimated?"(Est.)":navFetched.future?"(Today)":"(Exact)"}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#c9a84c"}}>₹{Number(navFetched.nav).toFixed(4)}</div>
                </div>
                {mfAmount&&txnForm.units&&(<>
                  <div>
                    <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".18rem"}}>Units Allotted</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"var(--text)"}}>{Number(txnForm.units).toFixed(4)}</div>
                  </div>
                  <div>
                    <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".18rem"}}>Total</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"var(--text)"}}>₹{(+mfAmount).toLocaleString("en-IN")}</div>
                  </div>
                </>)}
                {navFetched.estimated&&<div style={{fontSize:".65rem",color:"rgba(201,168,76,.55)",width:"100%",marginTop:".2rem"}}>Nearest available NAV used</div>}
              </div>):(
                <div style={{fontSize:".75rem",color:"var(--text-muted)"}}>
                  {txnForm.txn_date?"Click Fetch NAV to get the NAV for this date":"Select a date, then fetch NAV"}
                </div>
              )}
              {navError&&<div style={{fontSize:".72rem",color:"#e07c5a",marginTop:".25rem"}}>⚠ {navError}</div>}
            </div>
            <button onClick={fetchNavForDate} disabled={navLoading||!txnForm.txn_date}
              style={{background:"rgba(201,168,76,.13)",border:"1px solid rgba(201,168,76,.32)",color:"#c9a84c",
                borderRadius:5,padding:".35rem .8rem",cursor:"pointer",fontSize:".72rem",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0,opacity:(!txnForm.txn_date||navLoading)?.5:1}}>
              {navLoading?"⧐ Fetching…":"⟳ Fetch NAV"}
            </button>
          </div>
        </div>
      )}

      {/* US FX bar */}
      {isUS&&!isCashEvent&&(
        <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".7rem",padding:".5rem .8rem",background:"rgba(90,156,224,.06)",border:"1px solid rgba(90,156,224,.18)",borderRadius:6}}>
          <div style={{flex:1,fontSize:".75rem"}}>
            <span style={{color:"var(--text-muted)"}}>1 USD = </span>
            <span style={{fontFamily:"'DM Mono',monospace",color:"#5a9ce0"}}>₹{fx.toFixed(2)}</span>
            {txnForm.price_usd&&<span style={{marginLeft:".75rem",color:"var(--text-muted)"}}>→ ₹<span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{(+txnForm.price_usd*fx).toLocaleString("en-IN",{maximumFractionDigits:0})}</span> per unit</span>}
          </div>
          <button onClick={onFetchFx} disabled={fxLoading} style={{background:"rgba(90,156,224,.15)",border:"1px solid rgba(90,156,224,.3)",color:"#5a9ce0",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:".65rem",fontFamily:"'DM Sans',sans-serif"}}>
            {fxLoading?"…":"⟳ Rate"}
          </button>
        </div>
      )}

      <FG label="Notes (optional)"><input className="fi" placeholder="e.g. SIP, bonus units, tax harvesting" value={txnForm.notes} onChange={e=>setTxnForm(p=>({...p,notes:e.target.value}))}/></FG>
      <MA>
        <button className="btnc" onClick={onClose}>Close</button>
        <button className="btns" onClick={()=>onAddTxn()} disabled={!canSubmit}>+ Add Transaction</button>
      </MA>
    </div>
  );
}
