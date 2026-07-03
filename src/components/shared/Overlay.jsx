/* ══════════════════════════════════════════════
   OVERLAY / FG / MA — shared layout helpers
   Extracted from App.jsx lines 6743–6745
══════════════════════════════════════════════ */

import { useEffect, useRef } from "react";

/**
 * Overlay — accessible modal backdrop + container.
 * Props: onClose, children, narrow (380px), wide (700px), default 540px,
 *        label (aria-label for the dialog).
 *
 * Accessibility (P4-1): role="dialog" + aria-modal, Esc to close, focus is
 * trapped inside the modal while open and returned to the previously focused
 * element on close. One fix here covers every modal that uses Overlay.
 */
export function Overlay({ onClose, children, narrow, wide, label = "Dialog" }) {
  const modRef = useRef(null);
  const prevFocus = useRef(null);
  // Keep a ref so the keydown handler always has the latest onClose
  // without re-running the effect (which would re-focus the first input).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const node = modRef.current;

    // Move focus into the modal (first focusable, else the container itself).
    // Runs ONLY on mount — never again — so typing in any field won't reset focus.
    const focusables = () =>
      node?.querySelectorAll(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
      ) || [];
    const first = focusables()[0];
    (first || node)?.focus?.();

    function onKeyDown(e) {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      prevFocus.current?.focus?.();   // restore focus to the trigger
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — onClose is accessed via ref above

  return (
    <div className="ovl" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="mod"
        style={{ maxWidth: narrow ? 380 : wide ? 700 : 540 }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={modRef}
      >
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
