import { useState } from "react";

/**
 * useOverviewState — Overview tab filters: which member's net worth to show,
 * and the benchmark comparison period. Extracted from App.jsx (P3-5).
 */
export function useOverviewState() {
  const [nwMember, setNwMember] = useState('all');
  const [bmPeriod, setBmPeriod] = useState('1Y');

  return { nwMember, setNwMember, bmPeriod, setBmPeriod };
}
