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

// Lines 1076-1097 (CAS state) + lines 1460-1712 (CAS upload/import/retry/reset + helper functions)
export function useCASImport(user, onSuccess) {
  // CAS Downloader state
  const [casModal,         setCasModal]         = useState(false);
  const [casStep,          setCasStep]          = useState("intro");
  const [casHoldings,      setCasHoldings]      = useState([]);
  const [casHolderNames,   setCasHolderNames]   = useState([]);
  const [casHolderPans,    setCasHolderPans]    = useState([]);
  const [casHolderMap,     setCasHolderMap]     = useState({});
  const [casWarnings,      setCasWarnings]      = useState([]);
  const [casFormat,        setCasFormat]        = useState("");
  const [casUploading,     setCasUploading]     = useState(false);
  const [casResult,        setCasResult]        = useState(null);
  const [casDupAction,     setCasDupAction]     = useState({});
  const [casPendingFile,   setCasPendingFile]   = useState(null);
  const [casPanInput,      setCasPanInput]      = useState("");
  const [casQuickMemberName, setCasQuickMemberName] = useState("");
  const [casSavePan,       setCasSavePan]       = useState(false);
  const [casStatementDate, setCasStatementDate] = useState(null);
  const [casPeriodStart,   setCasPeriodStart]   = useState(null);
  const [casPeriodEnd,     setCasPeriodEnd]     = useState(null);
  const [casDepository,    setCasDepository]    = useState("");

  function fuzzyMemberMatch(name, members) {
    if (!name || name.length < 2) return null;
    const lower = name.toLowerCase().trim();
    const compact = lower.replace(/\s+/g, "");   // "T V Rao" → "tvrao"
    for (const m of members) {
      const ml = m.name.toLowerCase().trim();
      const compactMl = ml.replace(/\s+/g, "");
      if (ml === lower) return m;
      if (compactMl === compact) return m;        // "tvrao" === "tvrao"
      if (ml.includes(lower) || lower.includes(ml)) return m;
      // Compact-form substring: "tvrao" inside "tvraopillai" etc.
      if (compact.length > 3 && (compactMl.includes(compact) || compact.includes(compactMl))) return m;
      const words = lower.split(/\s+/);
      const mWords = ml.split(/\s+/);
      const overlap = words.filter(w => w.length > 2 && mWords.some(mw => mw.includes(w) || w.includes(mw)));
      // Require at least 2 overlapping words, OR full coverage of the shorter name.
      // A single shared word like "rao" is too loose — e.g. "TV RAO" must not match "Avinash Rao".
      const minRequired = Math.min(words.length, mWords.length) >= 2 ? 2 : 1;
      if (overlap.length >= minRequired && (overlap.length >= words.length * 0.7 || overlap.length >= mWords.length * 0.7)) return m;
    }
    return null;
  }

  function matchCASHolderToMember(holderName, holderPans, members) {
    const match = fuzzyMemberMatch(holderName, members);
    if (match) return match;
    return null;
  }

  function autoMapCASHolders(holderNames, holderPans, members, serverMap = {}) {
    const map = {};
    const memberIds = new Set(members.map(m => m.id));
    for (const name of holderNames) {
      if (serverMap[name] && memberIds.has(serverMap[name])) { map[name] = serverMap[name]; continue; }
      const match = matchCASHolderToMember(name, holderPans, members);
      if (match) map[name] = match.id;
    }
    return map;
  }

  async function handleCASUpload(file, members) {
    setCasUploading(true);
    setCasWarnings([]);
    setCasHoldings([]);
    setCasHolderNames([]);
    setCasHolderPans([]);
    setCasStep("uploading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/detect", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error === "password_required" || data.error === "password_incorrect") {
        setCasWarnings(data.error === "password_incorrect"
          ? ["Incorrect password - check your PAN (uppercase, 10 chars)"]
          : ["This CAS PDF is password-protected. Enter your PAN to unlock."]);
        setCasStep("password");
        setCasUploading(false);
        setCasPendingFile(file);
        return;
      }
      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("intro");
        setCasUploading(false);
        return;
      }
      const holdings = data.holdings || [];
      const holderNames = data.holder_names || [];
      const holderPans = data.holder_pans || [];
      setCasHoldings(holdings);
      setCasHolderNames(holderNames);
      setCasHolderPans(holderPans);
      setCasWarnings(data.warnings || []);
      setCasFormat(data.format || "");
      setCasStatementDate(data.statement_date || null);
      setCasPeriodStart(data.period_start || null);
      setCasPeriodEnd(data.period_end || null);
      setCasDepository(data.depository || "");
      const autoMap = autoMapCASHolders(holderNames, holderPans, members, data.holder_member_map || {});
      setCasHolderMap(autoMap);
      setCasStep("matching");
    } catch (e) {
      setCasWarnings([`Upload failed: ${e.message}`]);
      setCasStep("intro");
    }
    setCasUploading(false);
  }

  async function executeCASImport(members, onPriceRefresh) {
    setCasStep("importing");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const enriched = casHoldings.map(h => ({
        ...h,
        _dupAction: h._duplicate ? (casDupAction[h.name] || "update") : undefined,
      }));
      // Resolve the member for single-holder CAS.
      // Priority: (1) server/fuzzy-matched map entry for the holder name,
      //           (2) user manually picked from dropdown (stored under "__default__"),
      //           (3) first member only when there is exactly ONE member (unambiguous).
      // Never silently fall back to members[0] when there are multiple members — that
      // caused TVRAO's CAS to be imported under Avinash.
      const singleMember = casHolderNames.length <= 1 && members.length > 0
        ? (casHolderMap[casHolderNames[0]] || casHolderMap["__default__"] || (members.length === 1 ? members[0]?.id : undefined))
        : undefined;   // multi-holder: always use account_map on the server side
      const res = await fetch("/api/holdings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          holdings: enriched,
          member_id: singleMember || "",
          account_map: Object.keys(casHolderMap).length > 0 ? casHolderMap : undefined,
          cas_statement_date: casStatementDate,
          cas_period_start: casPeriodStart,
          cas_period_end: casPeriodEnd,
        }),
      });
      const result = await res.json();
      setCasResult(result);
      setCasStep("done");
      if (onSuccess) onSuccess(result);
      if (onPriceRefresh && ((result.inserted_count || 0) + (result.updated_count || 0) > 0)) {
        setTimeout(() => { onPriceRefresh().catch(() => {}); }, 1500);
      }
    } catch (e) {
      setCasWarnings([`Import failed: ${e.message}`]);
      setCasStep("matching");
    }
  }

  async function retryCASWithPassword(members) {
    if (!casPendingFile || !casPanInput.trim()) return;
    const pan = casPanInput.trim().toUpperCase();
    setCasStep("uploading");
    setCasWarnings([]);
    setCasUploading(true);
    if (casSavePan) {
      api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", casPendingFile);
      fd.append("password", pan);
      const res = await fetch("/api/import/detect", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error === "password_incorrect") {
        setCasWarnings(["Incorrect password - check your PAN is correct (uppercase, e.g. ABCDE1234F)"]);
        setCasStep("password");
        setCasUploading(false);
        return;
      }
      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("password");
        setCasUploading(false);
        return;
      }
      const holdings = data.holdings || [];
      setCasHoldings(holdings);
      setCasHolderNames(data.holder_names || []);
      setCasHolderPans(data.holder_pans || []);
      setCasWarnings(data.warnings || []);
      setCasFormat(data.format || "");
      const autoMap = autoMapCASHolders(data.holder_names || [], data.holder_pans || [], members, data.holder_member_map || {});
      setCasHolderMap(autoMap);
      setCasStep("matching");
      setCasPendingFile(null);
    } catch (e) {
      setCasWarnings([`Upload failed: ${e.message}`]);
      setCasStep("password");
    }
    setCasUploading(false);
  }

  // V2 (casparser Smart Parser)
  async function handleCASUploadV2(file, members) {
    setCasUploading(true);
    setCasWarnings([]);
    setCasHoldings([]);
    setCasHolderNames([]);
    setCasHolderPans([]);
    setCasStep("uploading");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/detect-casparser", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error === "password_required" || data.error === "password_incorrect") {
        setCasWarnings(data.error === "password_incorrect"
          ? ["Smart Parser: Incorrect password - check your PAN (uppercase, 10 chars)"]
          : ["This CAS PDF is password-protected. Enter your PAN to unlock."]);
        setCasStep("password_v2");
        setCasUploading(false);
        setCasPendingFile(file);
        return;
      }
      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("intro");
        setCasUploading(false);
        return;
      }
      const holdings    = data.holdings     || [];
      const holderNames = data.holder_names || [];
      const holderPans  = data.holder_pans  || [];
      setCasHoldings(holdings);
      setCasHolderNames(holderNames);
      setCasHolderPans(holderPans);
      setCasWarnings(data.warnings   || []);
      setCasFormat(data.format       || "");
      setCasStatementDate(data.statement_date || null);
      setCasPeriodStart(data.period_start    || null);
      setCasPeriodEnd(data.period_end        || null);
      setCasDepository(data.depository       || "");
      const autoMap = autoMapCASHolders(holderNames, holderPans, members, data.holder_member_map || {});
      setCasHolderMap(autoMap);
      setCasStep("matching");
    } catch (e) {
      setCasWarnings([`Smart Parser upload failed: ${e.message}`]);
      setCasStep("intro");
    }
    setCasUploading(false);
  }

  async function retryCASWithPasswordV2(members) {
    if (!casPendingFile || !casPanInput.trim()) return;
    const pan = casPanInput.trim().toUpperCase();
    setCasStep("uploading");
    setCasWarnings([]);
    setCasUploading(true);
    if (casSavePan) {
      api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", casPendingFile);
      fd.append("password", pan);
      const res = await fetch("/api/import/detect-casparser", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.error === "password_incorrect") {
        setCasWarnings(["Smart Parser: Incorrect password - check your PAN (uppercase, e.g. ABCDE1234F)"]);
        setCasStep("password_v2");
        setCasUploading(false);
        return;
      }
      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("password_v2");
        setCasUploading(false);
        return;
      }
      setCasHoldings(data.holdings || []);
      setCasHolderNames(data.holder_names || []);
      setCasHolderPans(data.holder_pans   || []);
      setCasWarnings(data.warnings        || []);
      setCasFormat(data.format            || "");
      const autoMap = autoMapCASHolders(data.holder_names || [], data.holder_pans || [], members, data.holder_member_map || {});
      setCasHolderMap(autoMap);
      setCasStep("matching");
      setCasPendingFile(null);
    } catch (e) {
      setCasWarnings([`Smart Parser upload failed: ${e.message}`]);
      setCasStep("password_v2");
    }
    setCasUploading(false);
  }

  function resetCASDownloader() {
    setCasModal(false);
    setCasStep("intro");
    setCasHoldings([]);
    setCasHolderNames([]);
    setCasHolderPans([]);
    setCasHolderMap({});
    setCasWarnings([]);
    setCasFormat("");
    setCasResult(null);
    setCasDupAction({});
    setCasUploading(false);
    setCasPendingFile(null);
    setCasPanInput("");
    setCasSavePan(false);
    setCasQuickMemberName("");
    setCasStatementDate(null);
    setCasPeriodStart(null);
    setCasPeriodEnd(null);
    setCasDepository("");
  }

  return {
    casModal, setCasModal,
    casStep, setCasStep,
    casHoldings, setCasHoldings,
    casHolderNames, setCasHolderNames,
    casHolderPans, setCasHolderPans,
    casHolderMap, setCasHolderMap,
    casWarnings, setCasWarnings,
    casFormat, setCasFormat,
    casUploading,
    casResult, setCasResult,
    casDupAction, setCasDupAction,
    casPendingFile,
    casPanInput, setCasPanInput,
    casQuickMemberName, setCasQuickMemberName,
    casSavePan, setCasSavePan,
    casStatementDate,
    casPeriodStart,
    casPeriodEnd,
    casDepository,
    handleCASUpload,
    executeCASImport,
    retryCASWithPassword,
    resetCASDownloader,
    autoMapCASHolders,
    handleCASUploadV2,
    retryCASWithPasswordV2,
  };
}
