import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api.js";

/**
 * useGmailStatus — Gmail auto-import connection status, shown in the Settings
 * panel. Extracted from App.jsx (P3-5). Auto-refetches whenever the Settings
 * panel is open — pass its `showSettings` boolean in.
 */
export function useGmailStatus(showSettings) {
  const [gmailStatus, setGmailStatus] = useState(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailChecking, setGmailChecking] = useState(false);

  const fetchGmailStatus = useCallback(async () => {
    try { setGmailStatus(await api('/api/gmail/status')); } catch {}
  }, []);

  // Fetch Gmail status whenever Settings panel opens
  useEffect(() => {
    if (showSettings) fetchGmailStatus();
  }, [showSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    gmailStatus, setGmailStatus,
    gmailLoading, setGmailLoading,
    gmailChecking, setGmailChecking,
    fetchGmailStatus,
  };
}
