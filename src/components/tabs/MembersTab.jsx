// MembersTab.jsx — lines 3674–3757 of App.jsx
// NOTE: memberAction state (delete/merge confirmation dialog) is kept in parent
// because deleteMember and mergeMembers are async functions with API calls defined there.

export default function MembersTab({
  // Data
  mSum,
  allHoldings,
  holdings,
  members,
  valINRCache,
  // Actions
  openMemberModal,
  setMemberAction,
  deleteMember,
  mergeMembers,
  // memberAction state (the inline modal inside this tab)
  memberAction,
  // Formatting
  fmt,
  fmtPct,
  // Constants
  AT,
  // Sub-components
  Overlay,
  FG,
  MA,
}) {
  return (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)"}}>Family Members</div><button className="btn-sm" onClick={()=>openMemberModal(null)}>+ Add Member</button></div>
      {mSum.length===0&&(<div className="empty">No members yet. Add a family member to start tracking individual portfolios.</div>)}
      {mSum.map(m=>{const hs=allHoldings.filter(h=>h.member_id===m.id);const byT=Object.keys(AT).map(t=>({t,v:hs.filter(h=>h.type===t).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0)})).filter(x=>x.v>0);const holdingCount=hs.length;return(<div key={m.id} className="card" style={{marginBottom:"1rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:".82rem",marginBottom:".95rem"}}>
          <div className="av" style={{width:42,height:42,fontSize:"1rem"}}>{m.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",color:"var(--text)"}}>{m.name}</div>
            <div style={{fontSize:".68rem",color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:".08em"}}>
              {m.relation}{holdingCount>0?` · ${holdingCount} holding${holdingCount>1?"s":""}`:""}{m.email?<span style={{textTransform:"none",letterSpacing:"normal",marginLeft:6,fontSize:".6rem",color:"rgba(76,175,154,.6)"}}>● Linked: {m.email}</span>:""}
            </div>
          </div>
          <div style={{display:"flex",gap:".35rem",alignItems:"center"}}>
            <button className="delbtn" title="Edit member" onClick={()=>openMemberModal(m.id)}
              style={{color:"var(--text-muted)",fontSize:".78rem"}}>✏️</button>
            <button className="delbtn" title="Delete member" onClick={()=>setMemberAction({type:"delete",memberId:m.id,reassignTo:""})}
              style={{color:"rgba(224,124,90,.5)",fontSize:".78rem"}}>🗑️</button>
            {members.length>1&&holdingCount>0&&(
              <button className="delbtn" title="Merge into another member" onClick={()=>setMemberAction({type:"merge",memberId:m.id,reassignTo:""})}
                style={{color:"rgba(160,132,202,.6)",fontSize:".78rem"}}>🔗</button>
            )}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1rem",color:"#c9a84c"}}>{fmt(m.cur)}</div>
            <div className={m.gain>=0?"gain":"loss"} style={{fontSize:".73rem"}}>{fmtPct(m.pct)}</div>
          </div>
        </div>
        {byT.length>0&&(<div style={{display:"flex",gap:".45rem",flexWrap:"wrap"}}>{byT.map(({t,v})=>{const a=AT[t];return(<div key={t} style={{background:a.color+"18",border:`1px solid ${a.color}44`,borderRadius:5,padding:".38rem .7rem",fontSize:".73rem",color:a.color}}>{a.icon} {a.label}: {fmt(v)}</div>);})}</div>)}
      </div>);})}

      {/* ── Delete / Merge Confirmation Modal ── */}
      {memberAction&&(()=>{
        const m = members.find(x=>x.id===memberAction.memberId);
        if (!m) return null;
        const holdingCount = holdings.filter(h=>h.member_id===m.id).length;
        const otherMembers = members.filter(x=>x.id!==m.id);
        const isDelete = memberAction.type==="delete";
        const title = isDelete ? `Delete "${m.name}"` : `Merge "${m.name}"`;
        const desc = isDelete
          ? holdingCount>0
            ? `This member has ${holdingCount} holding${holdingCount>1?"s":""}. Choose a member to reassign them to, or leave empty to unassign.`
            : "No holdings are assigned to this member."
          : `Move all ${holdingCount} holding${holdingCount>1?"s":""} from "${m.name}" to another member, then remove "${m.name}".`;

        return(
          <Overlay onClose={()=>setMemberAction(null)} narrow>
            <div className="modtitle">{isDelete?"🗑️":"🔗"} {title}</div>
            <div style={{fontSize:".8rem",color:"var(--text-dim)",marginBottom:"1rem",lineHeight:1.6}}>{desc}</div>
            {(holdingCount>0||!isDelete)&&otherMembers.length>0&&(
              <FG label={isDelete?"Reassign holdings to":"Merge into"}>
                <select className="fi fs" value={memberAction.reassignTo} onChange={e=>setMemberAction(p=>({...p,reassignTo:e.target.value}))}>
                  {isDelete&&<option value="">— Leave unassigned —</option>}
                  {!isDelete&&<option value="">Select a member…</option>}
                  {otherMembers.map(o=><option key={o.id} value={o.id}>{o.name}{o.relation?` (${o.relation})`:""} — {holdings.filter(h=>h.member_id===o.id).length} holdings</option>)}
                </select>
              </FG>
            )}
            {holdingCount>0&&memberAction.reassignTo&&(
              <div style={{background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.25)",borderRadius:8,padding:".6rem .8rem",marginBottom:".8rem",fontSize:".73rem",color:"#4caf9a"}}>
                ✓ {holdingCount} holding{holdingCount>1?"s":""} will be moved to <strong>{otherMembers.find(o=>o.id===memberAction.reassignTo)?.name}</strong>
              </div>
            )}
            <MA>
              <button className="btnc" onClick={()=>setMemberAction(null)}>Cancel</button>
              <button className="btns" disabled={!isDelete&&!memberAction.reassignTo}
                style={isDelete?{background:"rgba(224,124,90,.14)",borderColor:"rgba(224,124,90,.5)",color:"#e07c5a"}:{}}
                onClick={async()=>{
                  if(isDelete){
                    await deleteMember(m.id, memberAction.reassignTo||null);
                  } else {
                    await mergeMembers(m.id, memberAction.reassignTo);
                  }
                  setMemberAction(null);
                }}>
                {isDelete?"Delete Member":"Merge Members"}
              </button>
            </MA>
          </Overlay>
        );
      })()}
    </>
  );
}
