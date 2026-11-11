import { daysSinceUpdate } from "./holdingsParts.jsx";

export default function StaleHoldingsBanner({ ST, setFilterType, setShowStaleOnly, showStaleOnly, staleH }) {
  return (
    staleH.length > 0 && (
          <div style={{
            background: "linear-gradient(135deg,rgba(192,148,50,.1),rgba(224,124,90,.07))",
            border: "1px solid rgba(192,148,50,.3)",
            borderRadius: 8,
            padding: ".55rem .85rem",
            marginBottom: ".65rem",
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
            flexWrap: "wrap",
          }}>
            <div style={{fontSize:"1.1rem",lineHeight:1}}>⚠️</div>
            <div style={{flex:1,minWidth:0}}>
              <div>
                <span style={{fontSize:".78rem",color:"#c9a84c",fontWeight:600}}>
                  {staleH.length} holding{staleH.length > 1 ? "s" : ""} need a balance refresh
                </span>
                <span style={{fontSize:".7rem",color:"var(--text-muted)",marginLeft:".5rem"}}>
                  — no live feed
                </span>
              </div>
              <div style={{fontSize:".7rem",marginTop:".2rem",display:"flex",flexWrap:"wrap",gap:".1rem .65rem"}}>
                {staleH.slice(0,4).map(h => {
                  const days = daysSinceUpdate(h);
                  const color = days >= ST[h.type] ? "#F85149" : "#F0883E";
                  return (
                    <span key={h.id}>
                      <span style={{color:"var(--text)"}}>{h.name}</span>
                      {" "}<span style={{color, fontWeight:600}}>{days}d ago</span>
                    </span>
                  );
                })}
                {staleH.length > 4 && <span style={{color:"var(--text-muted)"}}>+{staleH.length - 4} more</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:".4rem",flexShrink:0}}>
              <button
                onClick={() => {
                  setShowStaleOnly(s => {
                    // if turning off, also reset the parent type filter to ALL
                    if (s) setFilterType("ALL");
                    return !s;
                  });
                }}
                style={{
                  padding: ".25rem .65rem",
                  background: showStaleOnly ? "#c9a84c" : "rgba(192,148,50,.15)",
                  border: "1px solid rgba(192,148,50,.4)",
                  color: showStaleOnly ? "#111" : "#c9a84c",
                  borderRadius: 5,
                  fontSize: ".7rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                {showStaleOnly ? "Show all" : `View ${staleH.length} stale`}
              </button>
            </div>
          </div>
      )
  );
}
