// AdvisorTab.jsx — lines 4580–4685 of App.jsx

const FALLBACK_QUESTIONS = [
  "What is my total portfolio value today?",
  "Which holding has the best XIRR?",
  "How much have I invested in mutual funds?",
  "Which holdings are at a loss?",
  "How far am I from my retirement goal?",
  "What percentage of my portfolio is in equity?",
  "Which is my largest single holding?",
  "How should I rebalance my portfolio?",
];

export default function AdvisorTab({
  aiMessages,
  setAiMessages,
  aiInput,
  setAiInput,
  aiLoading,
  askAI,              // (portfolioContext, aiBottomRef, overrideInput?) => void
  clearConversation,  // clears messages + localStorage snapshot
  portfolioContext,
  aiBottomRef,
  suggestedQuestions, // dynamic questions built from live portfolio state
}) {
  const questions  = suggestedQuestions?.length ? suggestedQuestions : FALLBACK_QUESTIONS;
  // Show "restored" hint when the oldest message is >1 min old (i.e. from a prior session)
  const isRestored = aiMessages.length > 0 && aiMessages[0]?.ts
    && (Date.now() - new Date(aiMessages[0].ts).getTime()) > 60_000;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 280px)",minHeight:500}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
        <div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--text)"}}>✦ Advisor</div>
          <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:".2rem"}}>
            Ask anything about your holdings, returns, goals, or allocation
            {isRestored&&<span style={{marginLeft:6,color:"rgba(201,168,76,.55)",fontSize:".64rem"}}>· restored from last session</span>}
          </div>
        </div>
        {aiMessages.length>0&&(
          <button className="btn-sm" onClick={()=>clearConversation ? clearConversation() : setAiMessages([])}>
            Clear chat
          </button>
        )}
      </div>

      {/* Suggested questions — shown when chat is empty */}
      {aiMessages.length===0&&(
        <div style={{marginBottom:"1.2rem"}}>
          <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:".65rem"}}>Suggested questions</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:".5rem"}}>
            {questions.map(q=>(
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
              background: m.role==="user"?"rgba(201,168,76,.14)":"var(--bg-muted)",
              border: m.role==="user"?"1px solid rgba(201,168,76,.3)":"1px solid var(--border)",
              fontSize:".82rem",
              lineHeight:1.65,
              color: m.role==="user"?"#ffffff":"var(--text)",
              whiteSpace:"pre-wrap",
              fontFamily:"'DM Sans',sans-serif",
            }}>
              {/* Tool call indicators — shown for assistant messages */}
              {m.role==="assistant" && m.toolCalls?.length>0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:".35rem",marginBottom: m.content?".55rem":0}}>
                  {m.toolCalls.map(tc=>(
                    <span key={tc.id} style={{
                      display:"inline-flex",alignItems:"center",gap:".3rem",
                      padding:"2px 8px",borderRadius:20,fontSize:".65rem",
                      background: tc.status==="running"?"rgba(201,168,76,.12)":tc.status==="error"?"rgba(224,124,90,.12)":"rgba(76,175,154,.10)",
                      border: `1px solid ${tc.status==="running"?"rgba(201,168,76,.3)":tc.status==="error"?"rgba(224,124,90,.3)":"rgba(76,175,154,.3)"}`,
                      color: tc.status==="running"?"#c9a84c":tc.status==="error"?"#e07c5a":"#4caf9a",
                      transition:"all .3s",
                    }}>
                      {tc.status==="running"
                        ? <span style={{animation:"spin .8s linear infinite",display:"inline-block"}}>⟳</span>
                        : tc.status==="done" ? "✓" : "✕"}
                      {tc.label}
                    </span>
                  ))}
                </div>
              )}
              {/* Show dots only when streaming, no tool calls yet, and content is still empty */}
              {m.streaming && !m.content && !m.toolCalls?.length ? (
                <span style={{display:"inline-flex",gap:".3rem",alignItems:"center"}}>
                  {[0,1,2].map(j=>(
                    <span key={j} style={{width:6,height:6,borderRadius:"50%",background:"rgba(201,168,76,.5)",display:"inline-block",animation:`bounce 1.2s ${j*0.2}s infinite`}}/>
                  ))}
                </span>
              ) : (
                <>
                  {m.content}
                  {m.streaming&&<span style={{display:"inline-block",width:"2px",height:"1em",background:"#c9a84c",marginLeft:"2px",verticalAlign:"text-bottom",animation:"blink .9s step-end infinite"}}/>}
                </>
              )}
            </div>
          </div>
        ))}
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
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}} @keyframes blink{0%,100%{opacity:1}50%{opacity:0}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
