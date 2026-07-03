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

// Lines 1076–1097 (CAS state) + lines 1460–1712 (CAS upload/import/retry/reset + helper functions)
export function useCASImport(user, onSuccess) {
  // ── CAS Downloader state ── Lines 1076–1097
  const [casModal,         setCasModal]         = useState(false);
  const [casStep,          setCasStep]          = useState("intro");  // "intro" | "upload" | "matching" | "importing" | "done"
  const [casHoldings,      setCasHoldings]      = useState([]);
  const [casHolderNames,   setCasHolderNames]   = useState([]);
  const [casHolderPans,    setCasHolderPans]    = useState([]);
  const [casHolderMap,     setCasHolderMap]     = useState({});
  const [casWarnings,      setCasWarnings]      = useState([]);
  const [casFormat,        setCasFormat]        = useState("");
  const [casUploading,     setCasUploading]     = useState(false);
  const [casResult,        setCasResult]        = useState(null);
  const [casDupAction,     setCasDupAction]     = useState({});       // per-holding: "update" | "skip"
  const [casPendingFile,   setCasPendingFile]   = useState(null);
  const [casPanInput,      setCasPanInput]      = useState("");
  const [casQuickMemberName, setCasQuickMemberName] = useState("");
  const [casSavePan,       setCasSavePan]       = useState(false);
  const [casStatementDate, setCasStatementDate] = useState(null);
  const [casPeriodStart,   setCasPeriodStart]   = useState(null);
  const [casPeriodEnd,     setCasPeriodEnd]     = useState(null);
  const [casDepository,    setCasDepository]    = useState("");

  // ── Fuzzy name match helper (inline copy) ── Lines 1460–1476
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

  // ── CAS holder → member matching ── Lines 1478–1495
  function matchCASHolderToMember(holderName, holderPans, members) {
    const match = fuzzyMemberMatch(holderName, members);
    if (match) return match;
    return null;
  }

  function autoMapCASHolders(holderNames, holderPans, members, serverMap = {}) {
    const map = {};
    const memberIds = new Set(members.map(m => m.id));
    for (const name of holderNames) {
      // Server matched this holder's PAN against stored (encrypted) member PANs — most reliable.
      if (serverMap[name] && memberIds.has(serverMap[name])) { map[name] = serverMap[name]; continue; }
      const match = matchCASHolderToMember(name, holderPans, members);
      if (match) map[name] = match.id;
    }
    return map;
  }

  // ── CAS Downloader: upload + parse CAS PDF ── Lines 1497–1577
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

      // The server unlocks password-protected CAS PDFs with the stored PAN
      // server-side, so we no longer fetch the plaintext PAN to the browser.
      // If the PDF still can't be opened, the server responds password_required
      // and the user is prompted to type their PAN below.
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
          ? ["Incorrect password — check your PAN (uppercase, 10 chars)"]
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
      const warnings = data.warnings || [];
      const format = data.format || "";

      setCasHoldings(holdings);
      setCasHolderNames(holderNames);
      setCasHolderPans(holderPans);
      setCasWarnings(warnings);
      setCasFormat(format);
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

  // ── CAS Downloader: execute import ── Lines 1579–1630
  async function executeCASImport(members, onPriceRefresh) {
    setCasStep("importing");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const enriched = casHoldings.map(h => ({
        ...h,
        _dupAction: h._duplicate ? (casDupAction[h.name] || "update") : undefined,
      }));

      const singleMember = casHolderNames.length <= 1 && members.length > 0
        ? (casHolderMap[casHolderNames[0]] || members[0]?.id)
        : members[0]?.id;

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
        setTimeout(() => {
          onPriceRefresh().catch(() => {});
        }, 1500);
      }
    } catch (e) {
      setCasWarnings([`Import failed: ${e.message}`]);
      setCasStep("matching");
    }
  }

  // ── CAS Downloader: retry with user-entered PAN ── Lines 1632–1690
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
        setCasWarnings(["Incorrect password — check your PAN is correct (uppercase, e.g. ABCDE1234F)"]);
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

  // ── CAS V2 (casparser): upload + parse CAS PDF ───────────────────────────────
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
          ? ["Smart Parser: Incorrect password — check your PAN (uppercase, 10 chars)"]
          : ["This CAS PD