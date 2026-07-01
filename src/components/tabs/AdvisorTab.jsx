// AdvisorTab.jsx — lines 4580–4685 of App.jsx

export default function AdvisorTab({
  aiMessages,
  setAiMessages,
  aiInput,
  setAiInput,
  aiLoading,
  askAI,         // (portfolioContext, aiBottomRef, overrideInput?) => void
  portfolioContext,
  aiBottomRef,
}) {
  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 280px)",minHeight:500}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
        <div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)"}}>✦ Advisor</div>
          <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:".2rem"}}>Ask anything about your holdings, returns, goals, or allocation</div>
        </div>
        {aiMessages.length>0&&<button className="btn-sm" onClick={()=>setAiMessages([])}>Clear chat</button>}
      </div>

      {/* Suggested questions — shown when chat is empty */}
      {aiMessages.length===0&&(
        <div style={{marginBottom:"1.2rem"}}>
          <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".65rem"}}>Suggested questions</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:".5rem"}}>
            {[
              "What is my total portfolio value today?",
              "Which holding has the best XIRR?",
              "How much have I invested in mutual funds?",
              "What is Priya's total portfolio worth?",
              "Which holdings are at a loss?",
              "How far am I from my retirement goal?",
              "What percentage of my portfolio is in equity?",
              "Which is my largest single holding?",
            ].map(q=>(
              <button key={q} onClick={()=>{ askAI(portfolioContext, aiBottomRef, q); }}
                style={{background:"var(--bg-muted)",border:"1px solid var(--border)",color:"var(--text-dim)",padding:".38rem .8rem",borderRadius:20,cursor:"pointer",fontSize:".74rem",fontFamily:"'DM Sans',sans-serif",transition:"all .2s",textAlign:"left"}}
                onMouseEnter={e=>{e.target.style.background="rgba(201,168,76,.1)";e.target.style.color="#c9a84c";e.target.style.borderColor="rgba(201,168,76,.3)";}}
                onMouseLeave={e=>{e.target.style.background="var(--bg-muted)";e.target.style.color="var(--text-dim)";e.target.style.borderColor="var(--border)";}}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:".85rem",paddingRight:".25rem",marginBottom:"1rem"}}>
        {aiMessages.map((m,i)=>(
          <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
            {/* Role label */}
            <div style={{fontSize:".62rem",color:"var(--text-muted)",marginBottom:".3rem",letterSpacing:".06em",textTransform:"uppercase"}}>
              {m.role==="user"?"You":"✦ Advisor"}
            </div>
            {/* Bubble */}
            <div style={{
              maxWidth:"80%",
              padding:".75rem 1rem",
              borderRadius: m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",
              background: m.role==="user"?"rgba(201,168,76,.14)":"var(--text-muted)",
              border: m.role==="user"?"1px solid rgba(201,168,76,.3)":"1px solid var(--border)",
              fontSize:".82rem",
              lineHeight:1.65,
              color: m.role==="user"?"#ffffff":"var(--text)",
              whiteSpace:"pre-wrap",
              fontFamily:"'DM Sans',sans-serif",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {/* Typing indicator */}
        {aiLoading&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
            <div style={{fontSize:".62rem",color:"var(--text-muted)",marginBottom:".3rem",letterSpacing:".06em",textTransform:"uppercase"}}>✦ Advisor</div>
            <div style={{padding:".75rem 1rem",borderRadius:"12px 12px 12px 2px",background:"var(--bg-muted)",border:"1px solid var(--border)",display:"flex",gap:".35rem",alignItems:"center"}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:6,height:6,borderRadius:"50%",background:"rgba(201,168,76,.5)",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>
              ))}
            </div>
          </div>
        )}
        <div ref={aiBottomRef}/>
      </div>

      {/* Input bar */}
      <div style={{display:"flex",gap:".6rem",alignItems:"flex-end"}}>
        <textarea
          className="fi"
          rows={2}
          placeholder="Ask anything about your portfolio… e.g. 'Which MF has the best return?' or 'How much has Arjun invested?'"
          value={aiInput}
          onChange={e=>setAiInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askAI(portfolioContext, aiBottomRef);}}}
          style={{flex:1,resize:"none",lineHeight:1.5,fontSize:".82rem",padding:".65rem .9rem"}}
        />
        <button className="btns" onClick={()=>askAI(portfolioContext, aiBottomRef)} disabled={!aiInput.trim()||aiLoading}
          style={{padding:".65rem 1.2rem",whiteSpace:"nowrap",alignSelf:"stretch"}}>
          {aiLoading?"…":"Send ↵"}
        </button>
      </div>
      <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".4rem",textAlign:"center"}}>
        Press Enter to send · Shift+Enter for new line · Conversation context is maintained across messages
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
    </div>
  );
}
