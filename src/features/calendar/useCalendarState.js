import { useState } from "react";

/**
 * useCalendarState — Calendar tab's selected month ("YYYY-MM"), defaulting to
 * the current month. Extracted from App.jsx (P3-5).
 */
export function useCalendarState() {
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  return { calMonth, setCalMonth };
}
