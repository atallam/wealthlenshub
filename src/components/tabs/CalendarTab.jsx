// CalendarTab.jsx — lines 4366–4579 of App.jsx

export default function CalendarTab({
  // Holdings data (only own holdings, not shared — SIPs are personal)
  holdings,
  goals,
  // Calendar navigation state
  calMonth,
  setCalMonth,
}) {
  const now = new Date();
  const [calY, calMo] = calMonth.split("-").map(Number);
  const firstDay = new Date(calY, calMo-1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calY, calMo, 0).getDate();

  // ── Gather all calendar events from holdings + goals ──
  const events = {}; // "YYYY-MM-DD" -> [{type,label,color,icon}]
  const addEvent = (date, ev) => {
    if(!date) return;
    const d = date.slice(0,10);
    if(!events[d]) events[d] = [];
    events[d].push(ev);
  };

  // FD maturity + Insurance events
  for(const h of holdings){
    if(h.type==="FD"&&h.maturity_date){
      const dLeft=Math.ceil((new Date(h.maturity_date)-now)/864e5);
      const fdColor=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
      const fdLabel=`${h.name}${h.interest_rate?` · ${h.interest_rate}%`:""}`;
      addEvent(h.maturity_date,{type:"FD Maturity",label:fdLabel,color:fdColor,icon:"🏦"});
    }
    // Insurance: policy maturity + recurring premium due dates
    if(h.type==="INSURANCE"&&h.start_date){
      if(h.maturity_date) addEvent(h.maturity_date,{type:"Policy Maturity",label:h.name,color:"#e07b8c",icon:"🛡️"});
      const freqMap={ANNUAL:12,HALF:6,QUARTERLY:3,MONTHLY:1};
      const monthInterval=freqMap[h.ticker||"ANNUAL"]||12;
      const startDt=new Date(h.start_date);
      const startAbsMo=startDt.getFullYear()*12+startDt.getMonth();
      const viewAbsMo=calY*12+(calMo-1);
      const diff=viewAbsMo-startAbsMo;
      if(diff>0&&diff%monthInterval===0){
        const premDay=Math.min(startDt.getDate(),new Date(calY,calMo,0).getDate());
        const d=`${calY}-${String(calMo).padStart(2,"0")}-${String(premDay).padStart(2,"0")}`;
        const premAmt=+h.interest_rate||0;
        const premLabel=`${h.name.length>22?h.name.slice(0,22)+"...":h.name}${premAmt?` (₹${Math.round(premAmt/1000)}K)`:""}`;
        addEvent(d,{type:"Premium Due",label:premLabel,color:"#e07b8c",icon:"🛡️"});
      }
    }
    // Detect truly active SIPs with strict checks
    if(h.type==="MF"&&h.transactions?.length>=3){
      const buyTxns=[...h.transactions]
        .filter(t=>t.txn_type==="BUY")
        .sort((a,b)=>b.txn_date.localeCompare(a.txn_date));
      if(buyTxns.length>=3){
        const lastMo=buyTxns[0].txn_date.slice(0,7);
        const nowMo=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
        const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
        const prevMo=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}`;
        if(lastMo===nowMo||lastMo===prevMo){
          const cutoff=new Date(now.getFullYear(),now.getMonth()-6,1).toISOString().slice(0,7);
          const activeMos=new Set(buyTxns.filter(t=>t.txn_date.slice(0,7)>=cutoff).map(t=>t.txn_date.slice(0,7)));
          if(activeMos.size>=3){
            const freq={};
            buyTxns.slice(0,6).forEach(t=>{const d=+t.txn_date.slice(8,10);freq[d]=(freq[d]||0)+1;});
            const sipDay=+Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0];
            const viewedMo=`${calY}-${String(calMo).padStart(2,"0")}`;
            if(viewedMo>=nowMo){
              const daysInCalMo=new Date(calY,calMo,0).getDate();
              const day=Math.min(sipDay,daysInCalMo);
              const ds=`${calY}-${String(calMo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const avgAmt=buyTxns.slice(0,3).reduce((s,t)=>s+(+t.units)*(+t.price),0)/3;
              const lbl=`${h.name.length>22?h.name.slice(0,22)+"...":h.name} (₹${Math.round(avgAmt/1000)}K)`;
              addEvent(ds,{type:"SIP Due",label:lbl,color:"#4caf9a",icon:"📈"});
            }
          }
        }
      }
    }
  }

  // Goal target dates
  for(const g of goals){
    if(g.targetDate) addEvent(g.targetDate,{type:"Goal Target",label:g.name,color:g.color||"#c9a84c",icon:"🎯"});
  }

  // Indian financial calendar — fixed annual events
  const finCalendar = [
    {mo:3,d:31,label:"FY End — File ITR / Last date for 80C investments",color:"#e07c5a",icon:"📋",type:"Tax"},
    {mo:7,d:31,label:"ITR Filing Deadline (non-audit)",color:"#e07c5a",icon:"📋",type:"Tax"},
    {mo:9,d:15,label:"Advance Tax Q2 (45%)",color:"#e07c5a",icon:"📋",type:"Tax"},
    {mo:12,d:15,label:"Advance Tax Q3 (75%)",color:"#e07c5a",icon:"📋",type:"Tax"},
    {mo:3,d:15,label:"Advance Tax Q4 (100%)",color:"#e07c5a",icon:"📋",type:"Tax"},
    {mo:4,d:5,label:"PPF — Deposit before 5th for full month interest",color:"#a084ca",icon:"💰",type:"PPF"},
    {mo:3,d:31,label:"PPF Annual Contribution Deadline",color:"#a084ca",icon:"💰",type:"PPF"},
    {mo:3,d:31,label:"ELSS / 80C — Last date for tax-saving investments",color:"#5a9ce0",icon:"🛡️",type:"80C"},
  ];
  for(const e of finCalendar){
    if(e.mo===calMo){
      const d=`${calY}-${String(e.mo).padStart(2,"0")}-${String(e.d).padStart(2,"0")}`;
      addEvent(d,{type:e.type,label:e.label,color:e.color,icon:e.icon});
    }
  }

  // Today
  const todayStr=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const isToday = (y,m,d) => `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` === todayStr;
  const cellDate = (d) => `${calY}-${String(calMo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  // ── Upcoming events list (next 60 days) ──
  const upcoming = [];
  const inRange = (d) => { const dt=new Date(d); return dt>=now && dt<=new Date(Date.now()+60*864e5); };
  for(const [d,evs] of Object.entries(events)){
    if(inRange(d)) evs.forEach(e=>upcoming.push({date:d,...e}));
  }
  upcoming.sort((a,b)=>a.date.localeCompare(b.date));

  const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthName=new Date(calY,calMo-1,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const prevMo=()=>{let m=calMo-1,y=calY;if(m<1){m=12;y--;}setCalMonth(`${y}-${String(m).padStart(2,"0")}`);};
  const nextMo=()=>{let m=calMo+1,y=calY;if(m>12){m=1;y++;}setCalMonth(`${y}-${String(m).padStart(2,"0")}`);};

  return (
    <>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:"1rem",alignItems:"start"}}>

        {/* Calendar grid */}
        <div className="card" style={{padding:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
            <button onClick={prevMo} style={{background:"var(--bg-muted)",border:"1px solid var(--border)",color:"var(--text-dim)",borderRadius:5,padding:".25rem .6rem",cursor:"pointer",fontSize:".85rem"}}>‹</button>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)"}}>{monthName}</div>
            <button onClick={nextMo} style={{background:"var(--bg-muted)",border:"1px solid var(--border)",color:"var(--text-dim)",borderRadius:5,padding:".25rem .6rem",cursor:"pointer",fontSize:".85rem"}}>›</button>
          </div>

          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
            {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:".63rem",color:"var(--text-muted)",letterSpacing:".05em",padding:".3rem 0"}}>{d}</div>)}
          </div>

          {/* Calendar cells */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {Array.from({length:firstDay},(_,i)=><div key={"e"+i}/>)}
            {Array.from({length:daysInMonth},(_,i)=>{
              const day=i+1;
              const key=cellDate(day);
              const dayEvents=events[key]||[];
              const today=isToday(calY,calMo,day);
              return(
              <div key={day} style={{
                minHeight:56,padding:".3rem .28rem",borderRadius:5,position:"relative",
                background:today?"rgba(201,168,76,.12)":"var(--bg-muted)",
                border:today?"1px solid rgba(201,168,76,.3)":"1px solid var(--border)",
              }}>
                <div style={{fontSize:".72rem",color:today?"#c9a84c":"var(--text-dim)",fontWeight:today?600:400,marginBottom:".2rem"}}>{day}</div>
                {dayEvents.slice(0,2).map((e,idx)=>(
                  <div key={idx} style={{fontSize:".55rem",lineHeight:1.3,padding:"1px 3px",borderRadius:2,marginBottom:1,
                    background:`${e.color}22`,color:e.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                    title={e.label}>
                    {e.icon} {e.label.slice(0,14)}{e.label.length>14?"…":""}
                  </div>
                ))}
                {dayEvents.length>2&&<div style={{fontSize:".52rem",color:"var(--text-muted)"}}>+{dayEvents.length-2} more</div>}
              </div>);
            })}
          </div>
        </div>

        {/* Upcoming events panel */}
        <div>
          <div className="card" style={{marginBottom:"1rem"}}>
            <div className="ctitle">Upcoming (60 days)</div>
            {upcoming.length===0?<div className="empty" style={{padding:".75rem 0"}}>Nothing due soon</div>:(
              upcoming.map((e,i)=>{
                const dt=new Date(e.date);
                const daysLeft=Math.ceil((dt-now)/864e5);
                return(
                <div key={i} style={{display:"flex",gap:".6rem",padding:".6rem 0",borderBottom:"1px solid var(--border)"}}>
                  <div style={{fontSize:"1.1rem",flexShrink:0}}>{e.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".75rem",color:"var(--text)",lineHeight:1.4,marginBottom:".15rem"}}>{e.label}</div>
                    <div style={{fontSize:".65rem",color:"var(--text-muted)"}}>{e.type}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".7rem",color:e.color}}>{daysLeft===0?"Today":daysLeft===1?"Tomorrow":`${daysLeft}d`}</div>
                    <div style={{fontSize:".62rem",color:"var(--text-muted)"}}>{dt.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                  </div>
                </div>);
              })
            )}
          </div>

          {/* Legend */}
          <div className="card">
            <div className="ctitle">Event Types</div>
            {[
              {icon:"📈",label:"SIP Dues",color:"#4caf9a"},
              {icon:"🏦",label:"FD Maturity",color:"#f0a050"},
              {icon:"🎯",label:"Goal Targets",color:"#c9a84c"},
              {icon:"📋",label:"Tax Deadlines",color:"#e07c5a"},
              {icon:"💰",label:"PPF Dates",color:"#a084ca"},
              {icon:"🛡️",label:"80C Deadlines",color:"#5a9ce0"},
              {icon:"🛡️",label:"Insurance Premium",color:"#e07b8c"},
            ].map(l=>(
              <div key={l.label} style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".35rem"}}>
                <div style={{fontSize:".85rem"}}>{l.icon}</div>
                <div style={{fontSize:".73rem",color:"var(--text-dim)"}}>{l.label}</div>
                <div style={{width:8,height:8,borderRadius:"50%