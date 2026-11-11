import { useState } from "react";
import { BF } from "../../constants.js";

/**
 * useHoldingForm — Holdings tab "Add/Edit Holding" form state.
 * Extracted from App.jsx (P3-5). The Add/Edit Holding modal markup is
 * HoldingFormModal.jsx and the helpers that populate this state (editH, renewFD,
 * handleImportSelect) are in hooks/useAppActions.js — this hook only owns the
 * two underlying useStates.
 */
export function useHoldingForm() {
  const [form, setForm] = useState(BF);
  const [editHolding, setEditHolding] = useState(null);

  return { form, setForm, editHolding, setEditHolding };
}
