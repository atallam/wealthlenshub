import { useState } from 'react';
import { supabase } from '../supabase.js';

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

// Lines 1031–1039 (importState initial value) + lines 2033–2168 (handleImportFile, submitCASPassword, executeImport, resetImport)
export function useImport(user, onSuccess) {
  const [importState, setImportState] = useState({
    mode: null, step: "upload", format: "", holdings: [], transactions: [],
    warnings: [], progress: 0, result: null, dragOver: false,
    assignMember: "", accounts: [], accountMap: {},
    pendingFile: null, needsPassword: false, casPan: "", casDob: "", casRemember: false,
    casStatementDate: null,  // populated from CAS detect response; sent to /api/holdings/import
    dupAction: {},       // { holdingIndex: "skip"|"update" } per-holding duplicate decisions
    dupBulk: "ask",      // "ask" | "update_all" | "skip_all" | "pick"
    dupConfirmed: false,  // true once user confirms duplicate handling
  });

  // ── Smart Import (auto-detect holdings vs transactions) ── Lines 2033–2096
  // NOTE: fuzzyMemberMatch is called here — it requires the members list.
  // Pass members as a parameter so the hook stays self-contained.
  async function handleImportFile(file, password, members) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "txt", "pdf"].includes(ext)) {
      setImportState(s => ({ ...s, warnings: ["Unsupported file type. Use CSV, XLSX, or PDF."] }));
      return;
    }
    setImportState(s => ({ ...s, step: "preview", warnings: [], format: "Detecting…", mode: null, needsPassword: false }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/import/detect", {
        method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      // Handle password-protected PDF
      if (data.needs_password || data.error === "password_required" || data.error === "password_incorrect") {
        if (data.error === "password_incorrect") {
          setImportState(s => ({
            ...s, step: "cas_password", needsPassword: true,
            pendingFile: s.pendingFile || file,
            warnings: ["Incorrect PAN. Password is your PAN in uppercase."],
          }));
          return;
        }
        let savedPan = "", savedDob = "";
        try {
          const creds = await api("/api/profile/cas-credentials");
          if (creds.has_credentials) { savedPan = creds.pan_for_cas_unlock || ""; savedDob = creds.dob || ""; }
        } catch {}
        setImportState(s => ({
          ...s, step: "cas_password", needsPassword: true, pendingFile: file,
          casPan: savedPan, casDob: savedDob, format: "", warnings: [],
        }));
        return;
      }
      if (data.error) throw new Error(data.error);
      const detectedType = data.detected_type || "holdings";
      if (detectedType === "transactions") {
        setImportState(s => ({
          ...s, step: "preview", mode: "transactions", format: data.format || "Unknown",
          transactions: data.transactions || [], warnings: data.warnings || [],
        }));
      } else {
        // Auto-map accounts to members via fuzzy matching
        const accts = data.accounts || [];
        const autoMap = {};
        if (members) {
          for (const acct of accts) {
            const match = fuzzyMemberMatch(acct, members);
            if (match) autoMap[acct] = match.id;
          }
        }
        const autoWarnings = [...(data.warnings || [])];
        const mappedAccts = Object.entries(autoMap);
        if (mappedAccts.length > 0 && members) {
          autoWarnings.push(`Auto-matched: ${mappedAccts.map(([a, id]) => `"${a}" → ${members.find(m => m.id === id)?.name}`).join(", ")}`);
        }
        setImportState(s => ({
          ...s, step: "preview", mode: "holdings", format: data.format || "Unknown",
          holdings: data.holdings || [], warnings: autoWarnings,
          accounts: accts, accountMap: autoMap,
          casStatementDate: data.statement_date || null,
        }));
      }
    } catch (e) {
      setImportState(s => ({ ...s, step: "upload", warnings: [`Error: ${e.message}`] }));
    }
  }

  // Fuzzy member match helper (inline copy — avoids tight coupling to App.jsx)
  function fuzzyMemberMatch(name, members) {
    if (!name || name.length < 2) return null;
    const lower = name.toLowerCase().trim();
    for (const m of members) {
      const ml = m.name.toLowerCase().trim();
      if (ml === lower) return m;
      if (ml.includes(lower) || lower.includes(ml)) return m;
      const words = lower.split(/\s+/);
      const mWords = ml.split(/\s+/);
      const overlap = words.filter(w => w.length > 2 && mWords.some(mw => mw.includes(w) || w.includes(mw)));
      if (overlap.length > 0 && (overlap.length >= words.length * 0.5 || overlap.length >= mWords.length * 0.5)) return m;
    }
    return null;
  }

  // ── Submit CAS Password ── Lines 2097–2110
  async function submitCASPassword() {
    const { pendingFile, casPan, casRemember } = importState;
    if (!pendingFile || !casPan) return;
    const pan = casPan.toUpperCase().trim();
    const password = pan;
    if (casRemember) {
      api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
    }
    handleImportFile(pendingFile, password);
  }

  // ── Execute Import ── Lines 2111–2157
  async function executeImport(members) {
    const { mode, holdings: impHoldings, transactions: impTxns, assignMember, accountMap, format, casStatementDate } = importState;
    setImportState(s => ({ ...s, step: "importing", progress: 0 }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      let result;
      if (mode === "transactions") {
        const res = await fetch("/api/transactions/import", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ transactions: impTxns }),
        });
        result = await res.json();
      } else {
        const fmtLower = (format || "").toLowerCase();
        const isCAS = fmtLower.includes("cas");
        const isPDF = fmtLower.includes("pdf");
        const derivedSource = isCAS ? "cas" : isPDF ? "pdf" : "csv";
        const derivedBrokerage = (format || "CSV Import").replace(/\s*\(.*\)\s*$/, "").trim();
        const enriched = impHoldings.map(h => ({
          ...h,
          source: h.source || derivedSource,
          brokerage_name: h.brokerage_name || derivedBrokerage,
          _dupAction: h._duplicate ? (h._dupAction || "update") : undefined,
        }));
        const res = await fetch("/api/holdings/import", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            holdings: enriched,
            member_id: assignMember || (members && members[0]?.id) || "",
            account_map: Object.keys(accountMap).length > 0 ? accountMap : undefined,
            ...(isCAS && casStatementDate ? { cas_statement_date: casStatementDate } : {}),
          }),
        });
        result = await res.json();
      }
      setImportState(s => ({ ...s, step: "done", progress: 100, result }));
      if (onSuccess) onSuccess();
    } catch (e) {
      setImportState(s => ({ ...s, step: "upload", warnings: [`Import failed: ${e.message}`] }));
    }
  }

  // ── Reset Import ── Lines 2158–2164
  function resetImport() {
    setImportState({
      mode: null, step: "upload", format: "", holdings: [], transactions: [],
      warnings: [], progress: 0, result: null, dragOver: false, assignMember: "",
      accounts: [], accountMap: {}, dupAction: {}, dupBulk: "ask", dupConfirmed: false,
      pendingFile: null, needsPassword: false, casPan: "", casDob: "", casRemember: false,
      casStatementDate: null,
    });
  }

  return {
    importState,
    setImportState,
    handleImportFile,
    submitCASPassword,
    executeImport,
    resetImport,
  };
}
