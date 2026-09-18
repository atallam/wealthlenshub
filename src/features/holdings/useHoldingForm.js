import { useState } from "react";
import { BF } from "../../constants.js";

/**
 * useHoldingForm — Holdings tab "Add/Edit Holding" form state.
 * Extracted from App.jsx (P3-5). The big Add/Edit Holding modal markup, and
 * the helper functions that populate this state (editH, renewFD,
 * handleImportSelect), all stay in App.jsx for now — this hook only owns the
 * two underlying useStates.
 */
export function useHoldingForm() {
  const [form, setForm] = useState(BF);
  const [editHolding, setEditHolding] = useState(null);

  return { form, setForm, editHolding, setEditHolding };
}
