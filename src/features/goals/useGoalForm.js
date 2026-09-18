import { useState } from "react";
import { BG } from "../../constants.js";

/**
 * useGoalForm — Goals tab "Add/Edit Goal" form state.
 * Extracted from App.jsx (P3-5). Modal *visibility* stays in useUiState's shared
 * `modal` state (GoalFormModal is one of several modals gated on it) — this hook
 * only owns the form fields and which goal (if any) is being edited.
 */
export function useGoalForm() {
  const [goalForm, setGoalForm] = useState(BG);
  const [editGoalId, setEditGoalId] = useState(null);

  return { goalForm, setGoalForm, editGoalId, setEditGoalId };
}
