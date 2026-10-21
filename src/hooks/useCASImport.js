import { useState, useRef } from 'react';
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

// ── Pure helpers shared by the single-file flow and the multi-statement queue ──
// src = { holdings, holderNames, holderMap, depository, hash, statementDate, periodStart, periodEnd }

/** Member a single-holder statement resolves to (never guesses when several members exist). */
function singleMemberFor(src, members) {
  const names = src.holderNames || [];
  const map = src.holderMap || {};
  return names.length <= 1 && members.length > 0
    ? (map[names[0]] || map["__default__"] || (members.length === 1 ? members[0]?.id : undefined))
    : undefined;
}

/** True while some holder in this statement still has no family member assigned. */
export function queueItemNeedsMember(src, members) {
  if (!src) return false;
  const names = src.holderNames || [];
  const map = src.holderMap || {};
  const owning = new Set((src.holdings || []).map(h => h._holder_name).filter(Boolean));
  const multi = names.length > 1 && members.length > 1;
  return multi
    ? names.some(n => owning.has(n) && !map[n])
    : (names.length <= 1 && members.length > 1 && !(map[names[0]] || map["__default__"]));
}

/** Request body for /api/holdings/import[/preview]. */
export function buildCasImportBody(src, members, dupActions = {}, retireLegacy = true) {
  const dup_actions = {};
  for (const [k, v] of Object.entries(dupActions)) if (k.includes("|")) dup_actions[k] = v;
  const map = src.holderMap || {};
  return {
    holdings: src.holdings,
    member_id: singleMemberFor(src, members) || "",
    account_map: Object.keys(map).length > 0 ? map : undefined,
    depository: src.depository,
    statement_hash: src.hash,
    cas_statement_date: src.statementDate,
    cas_period_start: src.periodStart,
    cas_period_end: src.periodEnd,
    dup_actions,
    retire_legacy: retireLegacy,
  };
}

/** Same member resolution the server uses (account_map[holder] → single member). */
function rowMemberId(src, row, members) {
  return (src.holderMap && row._holder_name && src.holderMap[row._holder_name]) || singleMemberFor(src, members) || row.member_id || null;
}

const isinOf = (h) => String(h.isin || h.ticker || h.scheme_code || "").trim().toUpperCase();
const RTA = new Set(["CAMS", "KFINTECH"]);

/**
 * Newest statement wins for a mutual fund listed in statements from different
 * depositories (the same folio shown by an RTA CAS and a depository CAS).
 * Ties prefer the RTA statement (it can carry the transaction ledger).
 * Returns Map<itemId, { "member|isin": "skip" }>. Stocks are left alone — the same
 * stock in two demat accounts is legitimate.
 */
export function planQueueOverlaps(items, members) {
  const skips = new Map(items.map(i => [i.id, {}]));
  const byKey = new Map();
  for (const it of items) {
    for (const row of it.src.holdings || []) {
      if (row.type !== "MF") continue;
      const mid = rowMemberId(it.src, row, members);
      const isin = isinOf(row);
      if (!mid || !isin) continue;
      const k = `${mid}|${isin}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ id: it.id, dep: it.src.depository, date: it.src.statementDate || "" });
    }
  }
  for (const [k, entries] of byKey) {
    if (new Set(entries.map(e => e.dep)).size < 2) continue;
    const winner = [...entries].sort((a, b) =>
      b.date.localeCompare(a.date) || (RTA.has(b.dep) ? 1 : 0) - (RTA.has(a.dep) ? 1 : 0))[0];
    for (const e of entries) if (e.dep !== winner.dep) skips.get(e.id)[k] = "skip";
  }
  return skips;
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
  const [casStatementHash, setCasStatementHash] = useState("");
  // Diff preview (Phase 2): what this statement would change vs. what is stored.
  const [casPreview,       setCasPreview]       = useState(null);
  const [casPreviewing,    setCasPreviewing]    = useState(false);
  const [casRetireLegacy,  setCasRetireLegacy]  = useState(true);
  const previewSeq = useRef(0);
  // Multi-statement queue: several CAS files (NSDL + CDSL, one or more months) in one go.
  const [casQueue,        setCasQueue]        = useState([]);
  const [casQueueRunning, setCasQueueRunning] = useState(false);
  const [casQueueDone,    setCasQueueDone]    = useState(false);

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

  // OLD parser (lib/parsers.js / /api/import/detect) — kept for reference.
  // casparser (handleCASUploadV2) is now the only active upload path.
  // async function handleCASUpload(file, members) {
  //   setCasUploading(true); setCasWarnings([]); setCasHoldings([]);
  //   setCasHolderNames([]); setCasHolderPans([]); setCasStep("uploading");
  //   try {
  //     const { data: { session } } = await supabase.auth.getSession();
  //     const token = session?.access_token || "";
  //     const fd = new FormData();
  //     fd.append("file", file);
  //     const res = await fetch("/api/import/detect", { method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: fd });
  //     const data = await res.json();
  //     if (data.error === "password_required" || data.error === "password_incorrect") {
  //       setCasWarnings(data.error === "password_incorrect" ? ["Incorrect PAN"] : ["PDF is password-protected"]);
  //       setCasStep("password"); setCasUploading(false); setCasPendingFile(file); return;
  //     }
  //     if (data.error) { setCasWarnings([data.error]); setCasStep("intro"); setCasUploading(false); return; }
  //     setCasHoldings(data.holdings || []); setCasHolderNames(data.holder_names || []);
  //     setCasHolderPans(data.holder_pans || []); setCasWarnings(data.warnings || []);
  //     setCasFormat(data.format || ""); setCasStatementDate(data.statement_date || null);
  //     setCasPeriodStart(data.period_start || null); setCasPeriodEnd(data.period_end || null);
  //     setCasDepository(data.depository || "");
  //     setCasHolderMap(autoMapCASHolders(data.holder_names || [], data.holder_pans || [], members, data.holder_member_map || {}));
  //     setCasStep("matching");
  //   } catch (e) { setCasWarnings([`Upload failed: ${e.message}`]); setCasStep("intro"); }
  //   setCasUploading(false);
  // }

  function importBody(members) {
    // dup_actions: "<member>|<isin>" → "skip" | "update" (cross-source overlaps only)
    return buildCasImportBody({
      holdings: casHoldings, holderNames: casHolderNames, holderMap: casHolderMap,
      depository: casDepository, hash: casStatementHash, statementDate: casStatementDate,
      periodStart: casPeriodStart, periodEnd: casPeriodEnd,
    }, members, casDupAction, casRetireLegacy);
  }

  /** Diff-only call; safe to re-run whenever the member mapping changes. */
  async function previewCASImport(members) {
    if (!casHoldings.length || !casDepository) return;
    const seq = ++previewSeq.current;
    setCasPreviewing(true);
    try {
      const data = await api("/api/holdings/import/preview", { method: "POST", body: JSON.stringify(importBody(members)) });
      if (seq === previewSeq.current) setCasPreview(data);
    } catch (e) {
      if (seq === previewSeq.current) setCasPreview({ error: e.message });
    }
    if (seq === previewSeq.current) setCasPreviewing(false);
  }

  async function executeCASImport(members, onPriceRefresh) {
    setCasStep("importing");
    try {
      const result = await api("/api/holdings/import", { method: "POST", body: JSON.stringify(importBody(members)) });
      setCasResult(result);
      setCasStep("done");
      if (onSuccess) onSuccess(result);
      if (onPriceRefresh && ((result.inserted_count || 0) + (result.updated_count || 0) > 0)) {
        setTimeout(() => { onPriceRefresh().catch(() => {}); }, 1500);
      }
    } catch (e) {
      // The server applies the statement in ONE transaction: a failure here means nothing changed.
      setCasWarnings([`Import failed — no changes were made: ${e.message}`]);
      setCasStep("matching");
    }
  }

  // OLD password retry (paired with handleCASUpload above) — kept for reference.
  // async function retryCASWithPassword(members) {
  //   if (!casPendingFile || !casPanInput.trim()) return;
  //   const pan = casPanInput.trim().toUpperCase();
  //   setCasStep("uploading"); setCasWarnings([]); setCasUploading(true);
  //   if (casSavePan) api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
  //   try {
  //     const { data: { session } } = await supabase.auth.getSession();
  //     const token = session?.access_token || "";
  //     const fd = new FormData(); fd.append("file", casPendingFile); fd.append("password", pan);
  //     const res = await fetch("/api/import/detect", { method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: fd });
  //     const data = await res.json();
  //     if (data.error === "password_incorrect") { setCasWarnings(["Incorrect PAN"]); setCasStep("password"); setCasUploading(false); return; }
  //     if (data.error) { setCasWarnings([data.error]); setCasStep("password"); setCasUploading(false); return; }
  //     setCasHoldings(data.holdings || []); setCasHolderNames(data.holder_names || []);
  //     setCasHolderPans(data.holder_pans || []); setCasWarnings(data.warnings || []);
  //     setCasFormat(data.format || "");
  //     setCasHolderMap(autoMapCASHolders(data.holder_names || [], data.holder_pans || [], members, data.holder_member_map || {}));
  //     setCasStep("matching"); setCasPendingFile(null);
  //   } catch (e) { setCasWarnings([`Upload failed: ${e.message}`]); setCasStep("password"); }
  //   setCasUploading(false);
  // }

  // casparser Smart Parser — now the only active upload path
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
      setCasStatementHash(data.statement_hash || "");
      setCasPreview(null); setCasDupAction({});
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
      setCasStatementDate(data.statement_date || null);
      setCasPeriodStart(data.period_start    || null);
      setCasPeriodEnd(data.period_end        || null);
      setCasDepository(data.depository       || "");
      setCasStatementHash(data.statement_hash || "");
      setCasPreview(null); setCasDupAction({});
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

  // ── Multi-statement queue ────────────────────────────────────────────────────
  const patchQueueItem = (id, patch) =>
    setCasQueue(q => q.map(i => (i.id === id ? { ...i, ...patch } : i)));

  /** Diff-only preview of one queued statement against what is stored. */
  async function previewQueueItem(id, src, members) {
    if (queueItemNeedsMember(src, members)) { patchQueueItem(id, { preview: null }); return; }
    try {
      const pv = await api("/api/holdings/import/preview", { method: "POST", body: JSON.stringify(buildCasImportBody(src, members)) });
      patchQueueItem(id, { preview: pv });
    } catch (e) { patchQueueItem(id, { preview: { error: e.message } }); }
  }

  async function parseQueueItem(id, file, pan, members) {
    patchQueueItem(id, { status: "parsing", error: "" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("file", file);
      if (pan) fd.append("password", pan);
      const res = await fetch("/api/import/detect-casparser", {
        method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}` }, body: fd,
      });
      const data = await res.json();
      if (data.error === "password_required" || data.error === "password_incorrect") {
        patchQueueItem(id, { status: "password", error: data.error === "password_incorrect" ? "Incorrect PAN — check and retry" : "" });
        return;
      }
      if (data.error) { patchQueueItem(id, { status: "error", error: data.error }); return; }
      if (!data.statement_date) { patchQueueItem(id, { status: "error", error: "Could not read the statement date from this PDF" }); return; }
      if (!(data.holdings || []).length) { patchQueueItem(id, { status: "error", error: "No holdings could be parsed from this statement" }); return; }
      const src = {
        holdings: data.holdings, holderNames: data.holder_names || [], holderPans: data.holder_pans || [],
        holderMap: autoMapCASHolders(data.holder_names || [], data.holder_pans || [], members, data.holder_member_map || {}),
        depository: data.depository || "", hash: data.statement_hash || "", statementDate: data.statement_date,
        periodStart: data.period_start || null, periodEnd: data.period_end || null,
      };
      let dupOf = null;
      setCasQueue(q => {
        dupOf = src.hash && q.find(i => i.id !== id && i.status !== "error" && i.src?.hash === src.hash);
        return q.map(i => (i.id === id
          ? { ...i, ...(dupOf ? { status: "error", error: `Same file as ${dupOf.name}` } : { status: "ready", error: "", src, format: data.format || "", warnings: data.warnings || [] }) }
          : i));
      });
      if (!dupOf) await previewQueueItem(id, src, members);
    } catch (e) {
      patchQueueItem(id, { status: "error", error: `Upload failed: ${e.message}` });
    }
  }

  /** Entry point for any number of PDFs. One file keeps the classic single-statement review. */
  async function handleCASFiles(files, members) {
    const list = Array.from(files || []).filter(f => /\.pdf$/i.test(f.name));
    if (!list.length) { setCasWarnings(["Please choose CAS statements in PDF format"]); return; }
    if (list.length === 1 && casQueue.length === 0) { handleCASUploadV2(list[0], members); return; }
    const stamp = Date.now();
    const items = list.map((file, n) => ({
      id: `q${stamp}_${n}`, name: file.name, file, status: "parsing", error: "", src: null, format: "", warnings: [], pan: "", preview: null, result: null,
    }));
    setCasWarnings([]); setCasQueueDone(false);
    setCasQueue(q => [...q, ...items]);
    setCasStep("queue");
    for (const it of items) await parseQueueItem(it.id, it.file, "", members);   // sequential: one Python parse at a time
  }

  const setQueuePan = (id, pan) => patchQueueItem(id, { pan: pan.toUpperCase() });
  const retryQueueItem = (id, members) => {
    const it = casQueue.find(i => i.id === id);
    if (it && it.pan.length === 10) parseQueueItem(id, it.file, it.pan, members);
  };
  function setQueueHolder(id, holder, memberId, members) {
    const it = casQueue.find(i => i.id === id);
    if (!it?.src) return;
    const src = { ...it.src, holderMap: { ...it.src.holderMap, [holder]: memberId || null } };
    patchQueueItem(id, { src });
    previewQueueItem(id, src, members);
  }
  function removeQueueItem(id) {
    setCasQueue(q => {
      const next = q.filter(i => i.id !== id);
      if (next.length === 0) setCasStep("intro");
      return next;
    });
  }

  /** "Keep newest only": retire the older copies of funds that this statement also lists. */
  async function retireOlderCopies(itemId) {
    const it = casQueue.find(i => i.id === itemId);
    const ids = (it?.result?.doubles || []).flatMap(d => d.older.map(o => o.id));
    if (!ids.length) return;
    patchQueueItem(itemId, { retiring: true, retireError: "" });
    try {
      const r = await api("/api/holdings/import/retire-overlaps", { method: "POST", body: JSON.stringify({ ids, statement_date: it.src?.statementDate || null }) });
      patchQueueItem(itemId, { retiring: false, result: { ...it.result, doubles: [], possible_double: 0, retired_older: (r.deleted || 0) + (r.exited || 0) } });
      if (onSuccess) onSuccess({});
    } catch (e) {
      patchQueueItem(itemId, { retiring: false, retireError: e.message });
    }
  }

  /**
   * Apply every ready statement, oldest first, one atomic server call per statement.
   * Rules: the newest statement wins per account (the server never lets an older
   * file overwrite newer numbers); a mutual fund listed by two depositories is kept
   * from the newest statement; one failing file doesn't stop the others.
   */
  async function runCASQueue(members, onPriceRefresh) {
    const ready = casQueue.filter(i => i.status === "ready" && i.src && !queueItemNeedsMember(i.src, members));
    if (!ready.length) return;
    const order = [...ready].sort((a, b) =>
      (a.src.statementDate || "").localeCompare(b.src.statementDate || "") || a.name.localeCompare(b.name));
    const plan = planQueueOverlaps(order, members);
    setCasQueueRunning(true);
    let changed = 0;
    for (const it of order) {
      patchQueueItem(it.id, { status: "importing" });
      try {
        const dup = { ...(plan.get(it.id) || {}) };
        // Fresh look at what is stored now (earlier files in this batch are already in).
        let pv = null;
        try { pv = await api("/api/holdings/import/preview", { method: "POST", body: JSON.stringify(buildCasImportBody(it.src, members, dup)) }); } catch { /* import still works without it */ }
        let possibleDouble = 0;
        const doubles = [];   // MFs whose OLDER copy in another depository is still active
        for (const o of pv?.overlaps || []) {
          if (o.type !== "MF") continue;
          const k = `${o.member_id}|${o.isin}`;
          if (dup[k] === "skip") continue;
          if (o.with.some(w => w.source_date && w.source_date >= it.src.statementDate)) dup[k] = "skip";
          else {
            possibleDouble++;
            const mine = (pv.rows || []).find(r => r.member_id === o.member_id && r.isin === o.isin);
            doubles.push({
              isin: o.isin, name: o.name, units: mine?.units ?? null,
              older: o.with.map(w => ({ id: w.id, depository: w.depository, units: w.units, source_date: w.source_date })),
            });
          }
        }
        const result = await api("/api/holdings/import", { method: "POST", body: JSON.stringify(buildCasImportBody(it.src, members, dup)) });
        changed += (result.inserted_count || 0) + (result.updated_count || 0);
        patchQueueItem(it.id, { status: "done", result: { ...result, possible_double: possibleDouble, doubles, skipped_overlap: Object.values(dup).filter(v => v === "skip").length } });
      } catch (e) {
        patchQueueItem(it.id, { status: "failed", error: e.message });
      }
    }
    setCasQueueRunning(false);
    setCasQueueDone(true);
    if (onSuccess) onSuccess({});
    if (onPriceRefresh && changed > 0) setTimeout(() => { onPriceRefresh().catch(() => {}); }, 1500);
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
    setCasStatementHash("");
    setCasPreview(null);
    setCasPreviewing(false);
    setCasRetireLegacy(true);
    setCasQueue([]);
    setCasQueueRunning(false);
    setCasQueueDone(false);
    previewSeq.current++;
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
    casStatementHash,
    casPreview, casPreviewing, previewCASImport,
    casRetireLegacy, setCasRetireLegacy,
    // handleCASUpload,       // old parser — commented out
    // retryCASWithPassword,  // old parser — commented out
    executeCASImport,
    resetCASDownloader,
    autoMapCASHolders,
    handleCASUploadV2,
    retryCASWithPasswordV2,
    // multi-statement queue
    casQueue, casQueueRunning, casQueueDone,
    handleCASFiles, setQueuePan, retryQueueItem, setQueueHolder, removeQueueItem, runCASQueue, retireOlderCopies,
  };
}
