import { useState } from "react";
import { BA } from "../../constants.js";

/**
 * useAlertForm — Strategy tab "Add Alert" form state.
 * Extracted from App.jsx (P3-5). Modal visibility stays in useUiState's shared
 * `modal` state; the modal markup is AlertFormModal.jsx (rendered by AppModals.jsx)
 * — this hook only owns the form fields.
 */
export function useAlertForm() {
  const [alertForm, setAlertForm] = useState(BA);

  return { alertForm, setAlertForm };
}
