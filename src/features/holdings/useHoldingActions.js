import { useState } from "react";
import { BT } from "../../constants.js";

/**
 * useHoldingActions — per-holding action state for the Holdings tab: which
 * holding (if any) has its Transaction panel or Artifact panel open, plus the
 * Transaction form fields. Extracted from App.jsx (P3-5). Presence of
 * `txnHolding` / `artifactHolding` is itself the "is this panel open" signal
 * (no separate modal-visibility flag needed for these two).
 */
export function useHoldingActions() {
  const [txnHolding, setTxnHolding] = useState(null);
  const [txnForm, setTxnForm] = useState(BT);
  const [artifactHolding, setArtifactHolding] = useState(null);

  return {
    txnHolding, setTxnHolding,
    txnForm, setTxnForm,
    artifactHolding, setArtifactHolding,
  };
}
