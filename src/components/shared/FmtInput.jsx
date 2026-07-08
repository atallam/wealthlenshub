/* ══════════════════════════════════════════════
   FMT INPUT — INR number input with live comma-formatted preview
   Extracted from App.jsx lines 967–982
══════════════════════════════════════════════ */
export default function FmtInput({value, onChange, placeholder, className, style}){
  const num = value !== "" && !isNaN(+value) ? +value : null;
  const display = num !== null ? "₹"+num.toLocaleString("en-IN",{maximumFractionDigits:2}) : "";
  return(
    <div style={{position:"relative",paddingBottom:display?"1.1rem":0}}>
      <input type="number" className={className||"fi"} placeholder={placeholder} value={value}
        onChange={onChange} style={style}/>
      {display&&<div style={{position:"absolute",bottom:0,left:0,fontSize:".65rem",color:"rgba(201,168,76,.65)",fontFamily:"'DM Mono',monospace",pointerEvents:"none",letterSpacing:".02em"}}>
        {display}
      </div>}
    </div>
  );
}
