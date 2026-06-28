// GoalsTab.jsx — lines 3206–3354 of App.jsx
// NOTE: setGoals is passed as prop because priority-reorder mutations happen inline
// via arrow functions that call setGoals directly. The goal edit/delete modal (setModal,
// setGoalForm, setEditGoalId) also lives in parent since they're shared modal state.

export default function GoalsTab({
  // Data
  goals,
  members,
  allHoldings,
  // Caches
  valINRCache,
  // Actions (touch parent-level shared state)
  setGoals,
  setGoalForm,
  setEditGoalId,
  setModal,
  // Formatting
  fmt,
  fmtCr,
  fmtPct,
  // Constants
  AT,
  BG,
}) {
  const sortedGoals=[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99));

  function goalCur(g){
    const lt=g.linkedTypes||[];
    const lm=g.linkedMembers||["all"];
    const memberH = lm.includes("all")||lm.length===0 ? allHoldings : allHoldings.filter(h=>lm.includes(h.member_id));
    if(lt.length>0){
      const typeSet=new Set(lt);
      return memberH.filter(h=>typeSet.has(h.type)).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
    }
    return memberH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
  }

  function goalStatus(g, cur) {
    const prog = g.targetAmount > 0 ? cur / g.targetAmount : 0;
    if (prog >= 1) return { label: "Achieved", color: "#1d9e75" };
    const msLeft = Math.max(0, new Date(g.targetDate) - new Date());
    const yLeft = msLeft / (864e5 * 365.25);
    if (yLeft <= 0) return { label: "Overdue", color: "#e07c5a" };
    const monthly = g.monthlyContribution || 0;
    const projectedSIP = monthly * yLeft * 12;
    const r = 0.10;
    const projGrowth = cur * Math.pow(1 + r, yLeft) + (monthly > 0 ? projectedSIP * (1 + r * yLeft / 2) : 0);
    if (projGrowth >= g.targetAmount * 0.95) return { label: "On track", color: "#1d9e75" };
    if (projGrowth >= g.targetAmount * 0.7) return { label: "Needs attention", color: "#d4a017" };
    return { label: "Behind", color: "#e07c5a" };
  }

  // Detect asset types allocated to multiple goals
  const typeGoalMap = {};
  goals.forEach(g=>(g.linkedTypes||[]).forEach(t=>{
    if(!typeGoalMap[t]) typeGoalMap[t]=[];
    typeGoalMap[t].push(g.name);
  }));
  const doubleAllocated = Object.entries(typeGoalMap).filter(([,gs])=>gs.length>1);

  return (
    <>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem",flexWrap:"wrap",gap:".7rem"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)"}}>Financial Goals</div>
        <div style={{display:"flex",gap:".5rem"}}>
          {goals.length>0&&<button className="btn-o" onClick={()=>setModal("goalplan")}>✦ Fulfillment Plan</button>}
          <button className="btn-sm" onClick={()=>{setGoalForm({...BG,priority:goals.length+1});setEditGoalId(null);setModal("goal");}}>+ New Goal</button>
        </div>
      </div>

      {/* Goal summary bar */}
      {goals.length>0&&(()=>{
        const statuses=sortedGoals.map(g=>goalStatus(g,goalCur(g)));
        const onTrack=statuses.filter(s=>s.label==="On track"||s.label==="Achieved").length;
        const behind=statuses.filter(s=>s.label==="Behind"||s.label==="Overdue").length;
        const needsAttn=statuses.filter(s=>s.label==="Needs attention").length;
        const totalTarget=goals.reduce((s,g)=>s+g.targetAmount,0);
        const totalFunded=sortedGoals.reduce((s,g)=>s+goalCur(g),0);
        const pct=totalTarget>0?(totalFunded/totalTarget*100).toFixed(0):0;
        return(
        <div style={{marginBottom:"1rem",padding:".55rem .85rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:8,display:"flex",gap:"1.5rem",flexWrap:"wrap",fontSize:".72rem",color:"var(--text-dim)",alignItems:"center"}}>
          <span>{goals.length} goal{goals.length!==1?"s":""}</span>
          {onTrack>0&&<span style={{color:"#1d9e75"}}>{onTrack} on track</span>}
          {needsAttn>0&&<span style={{color:"#d4a017"}}>{needsAttn} needs attention</span>}
          {behind>0&&<span style={{color:"#e07c5a"}}>{behind} behind</span>}
          <span style={{marginLeft:"auto"}}>Target: <span style={{color:"var(--text)",fontFamily:"'DM Mono',monospace"}}>{fmtCr(totalTarget)}</span></span>
          <span>Funded: <span style={{color:"#c9a84c",fontFamily:"'DM Mono',monospace"}}>{pct}%</span></span>
        </div>);
      })()}

      {goals.length===0&&<div className="card empty">Set your first financial milestone</div>}

      {doubleAllocated.length>0&&(
        <div style={{marginBottom:"1rem",padding:".55rem .85rem",background:"rgba(224,124,90,.06)",border:"1px solid rgba(224,124,90,.2)",borderRadius:8,fontSize:".72rem",color:"#e07c5a",lineHeight:1.6}}>
          ⚠ Double-counted: {doubleAllocated.map(([t,gs])=>`${AT[t]?.icon||""} ${AT[t]?.label||t} → ${gs.join(" & ")}`).join(" · ")}
          <span style={{color:"var(--text-muted)",marginLeft:6}}>Same asset type in multiple goals inflates total funded %</span>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:"1rem"}}>
        {sortedGoals.map((g,idx)=>{
          const cur=goalCur(g);
          const prog=Math.min((cur/g.targetAmount)*100,100);
          const rem=Math.max(0,g.targetAmount-cur);
          const yLeft=((Math.max(0,new Date(g.targetDate)-new Date()))/(864e5*365.25)).toFixed(1);
          const lm=g.linkedMembers||["all"];
          const memberNames=lm.includes("all")?"All members":lm.map(id=>members.find(m=>m.id===id)?.name||"?").join(", ");
          const monthly=g.monthlyContribution||0;
          const st=goalStatus(g,cur);
          return(
          <div key={g.id} className="card" style={{borderTop:`3px solid ${g.color}`,position:"relative"}}>
            {/* Priority badge + status pill */}
            <div style={{display:"flex",alignItems:"center",gap:".35rem",marginBottom:".55rem"}}>
              <div style={{background:`${g.color}22`,border:`1px solid ${g.color}55`,borderRadius:3,padding:"1px 7px",fontSize:".6rem",letterSpacing:".08em",color:g.color,fontWeight:600}}>P{g.priority||idx+1}</div>
              <div style={{background:st.color+"18",border:`1px solid ${st.color}44`,borderRadius:10,padding:"1px 8px",fontSize:".58rem",color:st.color,fontWeight:500}}>{st.label}</div>
              <span style={{fontSize:".62rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginLeft:".15rem"}}>{g.category}</span>
            </div>
            {/* Controls — top right */}
            <div style={{position:"absolute",top:8,right:8,display:"flex",gap:".2rem"}}>
              <button className="delbtn" title="Move up in priority" onClick={()=>setGoals(p=>{const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===0)return p;const np=[...s];[np[i-1],np[i]]=[np[i],np[i-1]];return np.map((x,j)=>({...x,priority:j+1}));})}>↑</button>
              <button className="delbtn" title="Move down in priority" onClick={()=>setGoals(p=>{const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===s.length-1)return p;const np=[...s];[np[i],np[i+1]]=[np[i+1],np[i]];return np.map((x,j)=>({...x,priority:j+1}));})}>↓</button>
              <button className="delbtn" title="Edit goal" style={{color:"rgba(90,156,224,.5)"}} onClick={()=>{setGoalForm({name:g.name,targetAmount:g.targetAmount,targetDate:g.targetDate,linkedMembers:g.linkedMembers||["all"],linkedTypes:g.linkedTypes||[],category:g.category,color:g.color,notes:g.notes||"",priority:g.priority||idx+1,monthlyContribution:g.monthlyContribution||""});setEditGoalId(g.id);setModal("goal");}}>✎</button>
              <button className="delbtn" title="Delete goal" onClick={()=>setGoals(p=>p.filter(x=>x.id!==g.id))}>✕</button>
            </div>

            {/* Goal name */}
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",color:"var(--text)",marginBottom:".2rem"}}>{g.name}</div>
            {g.notes&&<div style={{fontSize:".72rem",color:"var(--text-muted)",marginBottom:".6rem"}}>{g.notes}</div>}

            {/* Funded by: members + asset types */}
            <div style={{marginBottom:".5rem",fontSize:".62rem",color:"var(--text-muted)",letterSpacing:".04em",textTransform:"uppercase",fontWeight:500}}>Funded by</div>
            <div style={{marginBottom:".65rem",display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              <span style={{fontSize:".65rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:12,padding:"2px 9px",color:"var(--text-dim)"}}>
                👤 {memberNames}
              </span>
              {(g.linkedTypes||[]).length>0?g.linkedTypes.map(t=>{
                const a=AT[t]||{icon:"📦",color:"#888",label:t};
                const isDouble=typeGoalMap[t]?.length>1;
                return(
                <span key={t} style={{fontSize:".6rem",background:a.color+"15",border:`1px solid ${a.color}${isDouble?"88":"44"}`,
                  borderRadius:4,padding:"2px 7px",color:a.color,fontWeight:500}}>
                  {a.icon} {a.label}{isDouble&&<span style={{color:"#e07c5a",marginLeft:3}} title={`Also in: ${typeGoalMap[t].filter(n=>n!==g.name).join(", ")}`}>⚠</span>}
                </span>);
              }):(
                <span style={{fontSize:".6rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 7px",color:"var(--text-muted)",display:"flex",alignItems:"center",gap:".25rem"}}>
                  <span style={{fontSize:".7rem",opacity:.6}}>ℹ</span> Entire portfolio
                </span>
              )}
            </div>

            {/* Progress */}
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:".45rem"}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"1.05rem",color:g.color}}>{fmtCr(cur)}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:".82rem",color:"var(--text-muted)"}}>of {fmtCr(g.targetAmount)}</span>
            </div>
            <div className="gbbg"><div className="gbfill" style={{width:`${prog}%`,background:g.color}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:".55rem",fontSize:".7rem"}}>
              <span style={{color:"var(--text-muted)"}}>Remaining <span style={{color:"var(--text)",fontFamily:"'DM Mono',monospace"}}>{fmtCr(rem)}</span></span>
              <span style={{color:"var(--text-muted)"}}>{yLeft}y · {prog.toFixed(0)}%</span>
            </div>

            {/* Monthly contribution if set */}
            {monthly>0&&(
              <div style={{marginTop:".65rem",padding:".4rem .7rem",background:"var(--bg-muted)",borderRadius:5,fontSize:".68rem",color:"var(--text-muted)"}}>
                Monthly SIP: <span style={{fontFamily:"'DM Mono',monospace",color:"var(--text)"}}>₹{monthly.toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>);
        })}
      </div>
    </>
  );
}
