/**
 * MaskContext.jsx — Privacy toggle: hide all monetary values app-wide.
 *
 * Usage:
 *   - Wrap <App /> (or root) with <MaskProvider>
 *   - Call useMask() in any component to get { masked, toggleMask }
 *   - The toggle button in the header calls toggleMask()
 *
 * How it works:
 *   - React state `masked` drives re-renders across the component tree
 *   - setMasked() from utils.js syncs the module-level flag so every
 *     format function (fmtINR, fmtCr, etc.) returns '••••' on next call
 *   - State is session-only — resets to unmasked on page reload
 */

import { createContext, useContext, useState, useCallback } from 'react';
import { setMasked } from '../utils.js';

const MaskContext = createContext({ masked: false, toggleMask: () => {} });

export function MaskProvider({ children }) {
  const [masked, setMaskedState] = useState(false);

  const toggleMask = useCallback(() => {
    setMaskedState(prev => {
      const next = !prev;
      setMasked(next);      // sync utils.js module flag → all fmt* functions check this
      return next;
    });
  }, []);

  return (
    <MaskContext.Provider value={{ masked, toggleMask }}>
      {children}
    </MaskContext.Provider>
  );
}

export function useMask() {
  return useContext(MaskContext);
}
