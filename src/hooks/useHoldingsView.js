import { useState } from "react";

/**
 * useHoldingsView — filter + sort state for the Holdings table.
 * Extracted from App.jsx.
 */
export function useHoldingsView() {
  const [filterType, setFilterType] = useState("ALL");
  const [sortCol, setSortCol]       = useState(null);
  const [sortDir, setSortDir]       = useState("asc");

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  return { filterType, setFilterType, sortCol, setSortCol, sortDir, setSortDir, toggleSort };
}
