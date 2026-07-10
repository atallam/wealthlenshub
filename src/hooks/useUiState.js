import { useState } from "react";

/**
 * useUiState — cross-tab UI toggles (modals, sheets, dropdowns, expanded rows).
 * Extracted from App.jsx. Pure view state, no data.
 */
export function useUiState() {
  const [modal, setModal]                   = useState(null);
  const [fdScanOpen, setFdScanOpen]         = useState(false);
  const [showSettings, setShowSettings]     = useState(false);
  const [showImportHub, setShowImportHub]   = useState(false);
  const [showSnapTrade, setShowSnapTrade]   = useState(false);
  const [moreSheetOpen, setMoreSheetOpen]   = useState(false);
  const [expandedHolding, setExpandedHolding] = useState(null);
  const [showQuietAlerts, setShowQuietAlerts] = useState(false);

  return {
    modal, setModal, fdScanOpen, setFdScanOpen, showSettings, setShowSettings,
    showImportHub, setShowImportHub, showSnapTrade, setShowSnapTrade,
    moreSheetOpen, setMoreSheetOpen,
    expandedHolding, setExpandedHolding, showQuietAlerts, setShowQuietAlerts,
  };
}
