/* ══════════════════════════════════════════════
   DONUT CHART — pure SVG donut chart
   Extracted from App.jsx lines 6345–6370
══════════════════════════════════════════════ */

// AT asset type map must be passed in or imported from a shared constants file.
// Import it from your constants module:
// import { AT } from '../../constants.js';
// OR pass it as a prop. Here we accept it as a prop for portability.

/**
 * DonutChart
 * Props:
 *   data  — array of { t: assetType, v: value, pct: percentage }
 *   total — total portfolio value (INR)
 *   AT    — asset type map { [type]: { label, color, icon } }
 */
export default function DonutChart({data, total, AT}){
  const S=180,cx=90,cy=90,r=72,ir=44;
  let angle=-90;
  const slices=data.map(d=>{const sweep=(d.v/total)*360,startA=angle;angle+=sweep;return{...d,startA,endA:angle};});
  const pt=(a,rad)=>({x:cx+rad*Math.cos(a*Math.PI/180),y:cy+rad*Math.sin(a*Math.PI/180)});
  const arc=(sa,ea,or,ir2)=>{
    if(Math.abs(ea-sa)>=359.99)ea=sa+359.99;
    const s=pt(sa,or),e=pt(ea,or),si=pt(sa,ir2),ei=pt(ea,ir2),l=ea-sa>180?1:0;
    return`M${s.x},${s.y}A${or},${or},0,${l},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir2},${ir2},0,${l},0,${si.x},${si.y}Z`;
  };
  const fmtV=v=>v>=1e7?`₹${(v/1e7).toFixed(2)}Cr`:v>=1e5?`₹${(v/1e5).toFixed(2)}L`:`₹${Math.round(v).toLocaleString("en-IN")}`;
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"2.5rem",flexWrap:"wrap",padding:".5rem 0"}}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
        {slices.map(s=><path key={s.t} d={arc(s.startA,s.endA,r,ir)} fill={AT[s.t].color} opacity={0.85}/>)}
        <text x={cx} y={cy-6} textAnchor="middle" fill="#0F3D38" fontSize="11" fontFamily="JetBrains Mono,DM Mono,monospace" fontWeight="700">{total>=1e7?(total/1e7).toFixed(1)+"Cr":total>=1e5?(total/1e5).toFixed(1)+"L":"₹"+Math.round(total)}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill="#5E8A80" fontSize="8.5" fontFamily="Quicksand,system-ui,sans-serif" fontWeight="700" letterSpacing="0.08em">TOTAL</text>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:".6rem"}}>
        {slices.map(s=>(
          <div key={s.t} style={{display:"flex",alignItems:"center",gap:".55rem"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:AT[s.t].color,flexShrink:0}}/>
            <span style={{color:"#1B5E57",fontSize:".76rem",minWidth:94,fontFamily:"'Quicksand',system-ui,sans-serif",fontWeight:600}}>{AT[s.t].label}</span>
            <span style={{fontFamily:"'JetBrains Mono','DM Mono',monospace",fontSize:".73rem",color:"#0F3D38",minWidth:72,textAlign:"right",fontWeight:700}}>{fmtV(s.v)}</span>
            <span style={{fontFamily:"'JetBrains Mono','DM Mono',monospace",fontSize:".7rem",color:"#5E8A80",minWidth:40,textAlign:"right"}}>{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
