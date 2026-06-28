/* ══════════════════════════════════════════════
   OVERLAY / FG / MA — shared layout helpers
   Extracted from App.jsx lines 6743–6745
══════════════════════════════════════════════ */

/**
 * Overlay — modal backdrop + container
 * Props: onClose, children, narrow (380px), wide (700px), default 540px
 */
export function Overlay({onClose,children,narrow,wide}){
  return(
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:narrow?380:wide?700:540}}>
        {children}
      </div>
    </div>
  );
}

/**
 * FG — form field group wrapper (label + input)
 * Props: label, children
 */
export function FG({label,children}){
  return(
    <div className="fg">
      <label className="flbl">{label}</label>
      {children}
    </div>
  );
}

/**
 * MA — modal actions row (right-aligned flex)
 * Props: children
 */
export function MA({children}){
  return(
    <div className="ma">{children}</div>
  );
}
