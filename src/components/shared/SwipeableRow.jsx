/**
 * SwipeableRow — Touch swipe-to-reveal actions for mobile list rows.
 *
 * Swipe LEFT  → reveals action buttons (Edit, Delete)
 * Swipe RIGHT → snaps back to closed
 *
 * Usage:
 *   <SwipeableRow
 *     onEdit={() => ...}
 *     onDelete={() => ...}
 *     editLabel="Edit"
 *     deleteLabel="Delete"
 *   >
 *     <YourRowContent />
 *   </SwipeableRow>
 */

import { useRef, useState } from "react";

const SWIPE_THRESHOLD  = 40;   // px — minimum drag to register as a swipe
const ACTION_WIDTH     = 130;  // px — how far the row slides to reveal buttons

export default function SwipeableRow({
  children,
  onEdit,
  onDelete,
  editLabel   = "Edit",
  deleteLabel = "Delete",
  disabled    = false,
}) {
  const [offset, setOffset]   = useState(0);   // current translate-x (0 = closed)
  const [open,   setOpen]     = useState(false);
  const startX  = useRef(null);
  const startOff = useRef(0);

  function onTouchStart(e) {
    if (disabled) return;
    startX.current   = e.touches[0].clientX;
    startOff.current = offset;
  }

  function onTouchMove(e) {
    if (startX.current === null || disabled) return;
    const dx  = e.touches[0].clientX - startX.current;
    const raw = startOff.current + dx;
    // Clamp: right wall = 0, left wall = -ACTION_WIDTH
    setOffset(Math.max(-ACTION_WIDTH, Math.min(0, raw)));
  }

  function onTouchEnd() {
    if (startX.current === null) return;
    startX.current = null;
    if (offset < -SWIPE_THRESHOLD) {
      setOffset(-ACTION_WIDTH); setOpen(true);
    } else {
      setOffset(0); setOpen(false);
    }
  }

  function close() { setOffset(0); setOpen(false); }

  const wrapStyle = {
    position: "relative",
    overflow: "hidden",
    touchAction: "pan-y",   // allow vertical scroll; we handle horizontal
  };

  const rowStyle = {
    transform: `translateX(${offset}px)`,
    transition: startX.current ? "none" : "transform .2s ease",
    willChange: "transform",
    position: "relative",
    zIndex: 1,
    background: "var(--bg-card)",
  };

  const actionsStyle = {
    position: "absolute",
    right: 0, top: 0, bottom: 0,
    width: ACTION_WIDTH,
    display: "flex",
    zIndex: 0,
  };

  const btnBase = {
    flex: 1,
    border: "none",
    cursor: "pointer",
    fontSize: ".78rem",
    fontWeight: 700,
    color: "#fff",
    fontFamily: "'DM Sans',sans-serif",
    letterSpacing: ".02em",
  };

  return (
    <div style={wrapStyle}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Slide-in action buttons */}
      <div style={actionsStyle}>
        {onEdit && (
          <button
            style={{ ...btnBase, background: "#4caf9a" }}
            onClick={() => { close(); onEdit(); }}
          >{editLabel}</button>
        )}
        {onDelete && (
          <button
            style={{ ...btnBase, background: "#e07c5a" }}
            onClick={() => { close(); onDelete(); }}
          >{deleteLabel}</button>
        )}
      </div>

      {/* The actual row content */}
      <div style={rowStyle}>
        {children}
      </div>
    </div>
  );
}
