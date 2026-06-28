import { useState, useEffect } from 'react';
import { supabase } from '../../supabase.js';

/* ══════════════════════════════════════════════
   GOAL PLAN MODAL — AI-generated goal fulfillment plan
   Extracted from App.jsx lines 6189–6344
══════════════════════════════════════════════ */

// Helpers used inline — import from shared utils if extracted
const fmtUSD = n => "$" + Math.abs(n).toLocaleString("en-US", {maximumFractionDigits:0});
const fmtCrUSD = n => { const a=Math.abs(n); return a>=1e6?`$${(a/1e6).toFixed(2)}M`:a>=1e3?`$${(a/1e3).toFixed(1)}K`:fmtUSD(a); };
// Portfolio totals displayed in USD (convert INR totals)
let _liveUsdInr = 94.5;
const fmtCr = n => fmtCrUSD(n / _liveUsdInr);

// AT must be imported from constants or passed as prop
// import { AT } from '../../constants.js';

/**
 * GoalPlanModal
 * Props:
 *   open       — boolean
 *   onClose    — () => void
 *   goals      — goal array
 *   members    — member array
 *   holdings   — holdings array
 *   allCur     — total current value (INR)
 *   allInv     — total invested value (INR)
 *   AT         — asset type map
 *   getValINR  — (holding) => number
 */
export default function GoalPlanModal({open,onClose,goals,members,holdings,allCur,allInv,AT,getValINR}){
  const [loading,setLoading] = useState(false);
  const [plan,setPlan]       = useState("");
  const [error,setError]     = useState("");

  function goalCurVal(g){
    const lt=g.linkedTypes||[];
    const lm=g.linkedMembers||["all"];
    const memberH = lm.includes("all")||lm.length===0 ? holdings : holdings.filter(h=>lm.includes(h.member_id));
    if(lt.length>0){
      const typeSet=new Set(lt);
      return memberH.filter(h=>typeSet.has(h.type)).reduce((s,h)=>s+getValINR(h),0);
    }
    return memberH.reduce((s,h)=>s+getValINR(h),0);
  }

  useEffect(()=>{
    if(!open) return;
    setPlan(""); setError("");
    generate();
  },[open]);

  async function generate(){
    setLoading(true);
    const sorted=[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99));
    const goalDetails=sorted.map((g,i)=>{
      const cur=goalCurVal(g);
      const pct=g.targetAmount>0?(cur/g.targetAmount*100).toFixed(1):0;
      const rem=Math.max(0,g.targetAmount-cur);
      const yLeft=((Math.max(0,new Date(g.targetDate)-new Date()))/(864e5*365.25)).toFixed(1);
      const lm=g.linkedMembers||["all"];
      const mNames=lm.includes("all")?"all family members":lm.map(id=>members.find(m=>m.id===id)?.name||"?").join(", ");
      const lh=g.linkedTypes||[];
      const linkedDetail=lh.length>0?` | Asset types: ${lh.map(t=>AT[t]?.label||t).join(", ")}`:"";
      return `${i+1}. ${g.name} [Priority ${g.priority||i+1}] — Category: ${g.category} | Target: ${fmtCr(g.targetAmount)} by ${g.targetDate} | Current: ${fmtCr(cur)} (${pct}%) | Remaining: ${fmtCr(rem)} | Time left: ${yLeft}y | Linked to: ${mNames}${g.monthlyContribution>0?` | Monthly SIP: ₹${(+g.monthlyContribution).toLocaleString("en-IN")}`:""}${linkedDetail}`;
    }).join("\n");

    const memberBreakdown=members.map(m=>{
      const mCur=holdings.reduce((s,h)=>h.member_id===m.id?s+getValINR(h):s,0);
      const mInv=holdings.reduce((s,h)=>h.member_id===m.id?s+h.purchase_value||0:s,0);
      return `  ${m.name} (${m.relation}): ${fmtCr(mCur)}`;
    }).join("\n");

    const prompt=`You are a wealth advisor for an Indian family. Analyse their financial goals and provide a clear, prioritised fulfillment plan.

FAMILY PORTFOLIO SUMMARY:
- Total portfolio value: ${fmtCr(allCur)}
- Total invested: ${fmtCr(allInv)}
- Total gain: ${fmtCr(allCur-allInv)} (${allInv>0?((allCur-allInv)/allInv*100).toFixed(1):0}% return)

MEMBER PORTFOLIOS:
${memberBreakdown}

GOALS (sorted by priority):
${goalDetails}

Please provide:
1. A brief assessment of each goal's feasibility given current portfolio and time horizon
2. A recommended monthly SIP allocation strategy across goals (if multiple goals compete for funds)
3. Specific action items for the top 3 priority goals
4. Any goals that are at risk of not being met and what corrective action to take
5. A summary recommendation on goal prioritisation

Keep the response practical, specific to the numbers, and formatted clearly with headings. Use Indian number formatting (Lakhs/Crores).`;

    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      const res=await fetch("/api/ai/chat",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({model:"claude-opus-4-5",max_tokens:2000,
          system:"You are a concise, practical Indian family wealth advisor. Format with clear sections. Be specific with numbers.",
          messages:[{role:"user",content:prompt}]})});
      const data=await res.json();
      const text=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      setPlan(text||"No response received");
    }catch(e){ setError(e.message); }
    setLoading(false);
  }

  if(!open) return null;

  const sorted=[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99));

  return(
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:700}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>✦ Goal Fulfillment Plan</div>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.5)"}}>AI-powered analysis of your {goals.length} goal{goals.length!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",gap:".4rem"}}>
            <button onClick={generate} disabled={loading}
              style={{background:"rgba(160,132,202,.12)",border:"1px solid rgba(160,132,202,.3)",color:"#a084ca",borderRadius:5,padding:".28rem .65rem",cursor:"pointer",fontSize:".68rem",fontFamily:"'DM Sans',sans-serif"}}>
              {loading?"…":"⟳ Refresh"}
            </button>
            <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Goal priority summary */}
        <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:"1rem"}}>
          {sorted.map((g,i)=>(
            <div key={g.id} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".28rem .65rem",
              background:`${g.color}14`,border:`1px solid ${g.color}44`,borderRadius:12,fontSize:".68rem",color:g.color}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:g.color}}/>
              P{g.priority||i+1} {g.name}
            </div>
          ))}
        </div>

        {/* Quick summary table */}
        <div style={{marginBottom:"1rem",overflowX:"auto",border:"1px solid rgba(255,255,255,.06)",borderRadius:6}}>
          <table style={{width:"100%",fontSize:".7rem",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,.1)"}}>
              {["Goal","Status","Funded","Gap","Monthly Needed"].map(h=><th key={h} style={{padding:".4rem .55rem",textAlign:"left",color:"rgba(255,255,255,.4)",fontWeight:500,fontSize:".6rem",letterSpacing:".06em",textTransform:"uppercase"}}>{h}</th>)}
            </tr></thead>
            <tbody>{sorted.map((g,i)=>{
              const cur=goalCurVal(g);
              const rem=Math.max(0,g.targetAmount-cur);
              const yLeft=Math.max(0.1,((new Date(g.targetDate)-new Date())/(864e5*365.25)));
              const monthlyNeeded=rem/(yLeft*12);
              const pct=g.targetAmount>0?(cur/g.targetAmount*100):0;
              const status=pct>=100?"Achieved":yLeft<=0?"Overdue":pct>=40?"On track":"Behind";
              const stColor=status==="Achieved"?"#1d9e75":status==="On track"?"#1d9e75":status==="Overdue"?"#e07c5a":"#e07c5a";
              return <tr key={g.id} style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <td style={{padding:".4rem .55rem",color:g.color,fontWeight:500}}>{g.name}</td>
                <td style={{padding:".4rem .55rem"}}><span style={{color:stColor,fontSize:".62rem",background:stColor+"15",border:`1px solid ${stColor}33`,borderRadius:8,padding:"1px 7px"}}>{status}</span></td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>{pct.toFixed(0)}%</td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>{fmtCr(rem)}</td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>₹{Math.round(monthlyNeeded).toLocaleString("en-IN")}/mo</td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        {/* Plan content */}
        <div style={{background:"rgba(160,132,202,.04)",border:"1px solid rgba(160,132,202,.14)",borderRadius:8,
          padding:"1rem 1.2rem",maxHeight:440,overflowY:"auto",minHeight:180,
          display:"flex",alignItems:loading&&!plan?"center":"flex-start",justifyContent:loading&&!plan?"center":"flex-start"}}>
          {loading&&!plan&&(
            <div style={{textAlign:"center"}}>
              <div style={{width:28,height:28,border:"2px solid rgba(160,132,202,.2)",borderTopColor:"#a084ca",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto .75rem"}}/>
              <div style={{fontSize:".78rem",color:"rgba(255,255,255,.45)"}}>Analysing your goals…</div>
            </div>
          )}
          {error&&<div style={{color:"#e07c5a",fontSize:".8rem"}}>⚠ {error}</div>}
          {plan&&(
            <div style={{fontSize:".8rem",lineHeight:1.75,color:"rgba(255,255,255,.85)",whiteSpace:"pre-wrap",width:"100%"}}>
              {plan}
            </div>
          )}
        </div>

        <div style={{marginTop:".75rem",textAlign:"right"}}>
          <button className="btnc" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
