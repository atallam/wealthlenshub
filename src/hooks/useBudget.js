import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useToast } from '../components/shared/Toast.jsx';

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    // Attach any extra fields (code, incorrect, header_row, etc.) onto the thrown
    // Error so callers can branch on them (e.g. PDF_PASSWORD_REQUIRED) instead of
    // just showing the message — a plain `new Error(e.error)` used to drop these.
    throw Object.assign(new Error(e.error || res.statusText), e);
  }
  return res.json();
}

// Last-used Region/Bank/Type for the import form, remembered across sessions so
// a repeat import (the common case — same person, same card, every month) doesn't
// require re-selecting Region → Bank from scratch every time.
const LAST_IMPORT_KEY = "wlh_budget_last_import";
function loadLastImportDefaults() {
  const blank = { region: "", bank_key: "", statement_type: "BANK", notes: "", custom_label: "", member_id: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_IMPORT_KEY) || "null");
    if (saved && typeof saved === "object") return { ...blank, region: saved.region || "", bank_key: saved.bank_key || "", statement_type: saved.statement_type || "BANK" };
  } catch { /* ignore corrupt/old value */ }
  return blank;
}
function saveLastImportDefaults(form) {
  try { localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify({ region: form.region, bank_key: form.bank_key, statement_type: form.statement_type })); } catch { /* ignore quota/private-mode errors */ }
}

// Lines 1052–1095 (budget state) + inline budget functions defined within the tab render (lines 3761–4355)
// NOTE: loadBudget, loadTxns, and upload handlers are defined inline inside the budget tab JSX in App.jsx.
// They are extracted here as standalone async functions and exposed so the budget tab can call them.
export function useBudget(user) {
  const toast = useToast();
  // ── Budget state ── Lines 1052–1068
  const [budgetStatements,  setBudgetStatements]  = useState([]);
  const [budgetTxns,        setBudgetTxns]        = useState([]);
  const [budgetCategories,  setBudgetCategories]  = useState([]);
  const [budgetAnalytics,   setBudgetAnalytics]   = useState(null);
  const [budgetSelStmt,     setBudgetSelStmt]     = useState("all");
  const [budgetSelMonth,    setBudgetSelMonth]    = useState("");
  const [budgetSelCat,      setBudgetSelCat]      = useState("All");
  const [budgetSearch,      setBudgetSearch]      = useState("");
  const [budgetView,        setBudgetView]        = useState("overview"); // overview | transactions | categories | import
  const [budgetUploading,   setBudgetUploading]   = useState(false);
  const [budgetUploadForm,  setBudgetUploadForm]  = useState(loadLastImportDefaults);
  const [budgetBanks,       setBudgetBanks]       = useState([]); // [{key,region,label}] — drives the Bank dropdown; sourced from BANK_REGISTRY on the server
  const [budgetUploadFile,  setBudgetUploadFile]  = useState(null);
  const [budgetUploadMsg,   setBudgetUploadMsg]   = useState("");
  // Structured status kind alongside the message text — drives BudgetTab's status
  // box styling directly instead of sniffing string prefixes ("✓"/"📄"/"⚠"), which
  // was brittle and mixed presentation logic into the message content itself.
  const [budgetUploadMsgKind, setBudgetUploadMsgKind] = useState(""); // "" | "info" | "success" | "debug" | "error"
  const [budgetPdfPasswordNeeded, setBudgetPdfPasswordNeeded] = useState(false); // true once the server reports the PDF is encrypted
  const [budgetPdfPassword,       setBudgetPdfPassword]       = useState("");
  // Bumped on every wrong-password retry so the password <input>'s `key` changes,
  // forcing a remount (and therefore its `autoFocus` to refire) — a plain autoFocus
  // prop only fires once on first mount, so a second wrong attempt wouldn't refocus.
  const [budgetPwAttempt, setBudgetPwAttempt] = useState(0);
  const [budgetEditCat,     setBudgetEditCat]     = useState(null);
  const [budgetNewCat,      setBudgetNewCat]      = useState({ name: "", color: "#c9a84c", icon: "📁", monthly_limit: 0, keywords: "" });
  const [selectedTxnIds,    setSelectedTxnIds]    = useState(new Set());
  const [bulkCatTarget,     setBulkCatTarget]     = useState("");

  // ── Plaid state ── Lines 1070–1074
  const [plaidStatus,   setPlaidStatus]   = useState(null);
  const [plaidLoading,  setPlaidLoading]  = useState(false);
  const [plaidMsg,      setPlaidMsg]      = useState("");
  const [plaidSyncing,  setPlaidSyncing]  = useState("");

  // ── Load functions ── Lines 3761–3783 (defined inline in budget tab JSX in App.jsx)
  async function loadBanks() {
    try { setBudgetBanks(await api("/api/budget/banks")); } catch (e) { console.error(e); }
  }

  async function loadBudget(selMonth) {
    try {
      const [stmts, cats, analytics] = await Promise.all([
        api("/api/budget/statements"),
        api("/api/budget/categories"),
        api(`/api/budget/analytics${selMonth ? `?month=${selMonth}` : ""}`),
      ]);
      setBudgetStatements(stmts || []);
      setBudgetCategories(cats || []);
      setBudgetAnalytics(analytics || null);
    } catch (e) { console.error(e); }
  }

  async function loadTxns(selStmt, selCat, selMonth, search) {
    try {
      const params = new URLSearchParams();
      if (selStmt !== "all") params.set("statement_id", selStmt);
      if (selCat !== "All") params.set("category", selCat);
      if (selMonth) params.set("month", selMonth);
      if (search) params.set("search", search);
      const txns = await api(`/api/budget/transactions?${params}`);
      setBudgetTxns(txns || []);
    } catch (e) { console.error(e); }
  }

  // ── Upload handler ── Lines 4280–4355 (inline in JSX in App.jsx)
  async function uploadBudgetStatement(file, uploadForm, pdfPassword) {
    if (!file || !uploadForm.region) return;
    const bankKey = uploadForm.bank_key || (uploadForm.region === "AUTO" ? "auto" : "");
    if (!bankKey) { setBudgetUploadMsg("⚠ Please select a bank"); setBudgetUploadMsgKind("error"); return; }
    setBudgetUploading(true); setBudgetUploadMsg(""); setBudgetUploadMsgKind("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bank_key", bankKey);
      fd.append("source", uploadForm.custom_label || uploadForm.bank_key || "Auto");
      fd.append("statement_type", uploadForm.statement_type);
      fd.append("notes", uploadForm.notes || "");
      if (uploadForm.member_id) fd.append("member_id", uploadForm.member_id); // omitted = let the server auto-detect
      if (pdfPassword) fd.append("pdf_password", pdfPassword);
      const data = await api("/api/budget/upload", { method: "POST", body: fd });
      if (data.ok) {
        const dupNote = data.skipped_duplicates > 0 ? ` · ${data.skipped_duplicates} duplicate${data.skipped_duplicates > 1 ? "s" : ""} skipped` : "";
        const memberNote = data.member_auto_detected ? " · assigned automatically"
          : data.needs_member_assignment ? " · couldn't tell who this belongs to — assign it below"
          : "";
        setBudgetUploadMsg(`✓ Imported ${data.txn_count} transactions (${data.period_start} to ${data.period_end})${dupNote}${memberNote}`);
        setBudgetUploadMsgKind("success");
        setBudgetUploadFile(null);
        // Remember Region/Bank/Type for next time — the fields that stay the same
        // on a repeat import — but not the one-off fields (notes/label/member).
        saveLastImportDefaults(uploadForm);
        setBudgetUploadForm(p => ({ region: p.region, bank_key: p.bank_key, statement_type: p.statement_type, notes: "", custom_label: "", member_id: "" }));
        setBudgetPdfPasswordNeeded(false); setBudgetPdfPassword("");
        await loadBudget(budgetSelMonth); // already re-fetches statements, categories, and analytics
      } else { setBudgetUploadMsg("⚠ " + data.error); setBudgetUploadMsgKind("error"); }
    } catch (e) {
      if (e.code === "PDF_PASSWORD_REQUIRED") {
        setBudgetPdfPasswordNeeded(true);
        if (e.incorrect) setBudgetPwAttempt(n => n + 1); // forces the password field to remount + refocus
        setBudgetUploadMsg(e.incorrect ? "⚠ Incorrect password — try again." : "🔒 This PDF is password-protected. Enter the password below and try again.");
        setBudgetUploadMsgKind(e.incorrect ? "error" : "info");
      } else {
        setBudgetUploadMsg("⚠ " + e.message);
        setBudgetUploadMsgKind("error");
      }
    }
    setBudgetUploading(false);
  }

  // Dry-run diagnostic for CSV/XLSX/PDF statements — parses (using the exact same
  // code path as a real upload, including PDF password handling) but writes
  // nothing, and reports which row was read as the column header, which bank/
  // columns matched, and a sample of the parsed rows. This is the self-serve tool
  // for "why won't this statement import" — point it at any bank's export without
  // needing to hand-inspect the file. Replaces the old PDF-only debug endpoint,
  // which duplicated this logic and didn't share the same parsing path (so it
  // could pass/fail differently than a real import for the same file).
  async function debugImportFile(file, uploadForm, pdfPassword) {
    if (!file) return;
    setBudgetUploadMsg("Checking file..."); setBudgetUploadMsgKind("info");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bank_key", uploadForm.bank_key || (uploadForm.region === "AUTO" ? "auto" : ""));
      fd.append("statement_type", uploadForm.statement_type);
      fd.append("dry_run", "true");
      if (pdfPassword) fd.append("pdf_password", pdfPassword);
      const data = await api("/api/budget/upload", { method: "POST", body: fd });
      const headerPreview = data.header_row ? data.header_row.filter(Boolean).join(" | ") : "(no header row detected — or not applicable to PDFs)";
      let msg = `🔍 Bank matched: ${data.detected_bank || "none"} · Region: ${data.region || "?"}\n` +
        `Header row used (row ${data.header_row_index ?? "?"}): ${headerPreview}\n` +
        `Rows parsed: ${data.rows_parsed ?? 0}\n`;
      if (data.ok) {
        msg = `✓ Would import ${data.would_import_count} transaction${data.would_import_count === 1 ? "" : "s"}` +
          (data.would_skip_duplicate_count ? ` (${data.would_skip_duplicate_count} already imported)` : "") +
          ` — nothing was saved, this is a preview.\n` + msg;
        if (data.sample_transactions?.length) {
          msg += `Sample: ` + data.sample_transactions.slice(0, 3).map(t => `${t.date} ${t.type} ₹${t.amount} (${t.category})`).join(" · ") + "\n";
        }
      } else {
        msg = `⚠ ${data.error}\n` + msg +
          `Skipped: ${data.skipped_no_date || 0} bad dates, ${data.skipped_no_amt || 0} zero amounts, ${data.skipped_no_desc || 0} empty descriptions\n`;
      }
      if (data.sample_raw_rows?.length) {
        msg += `First parsed row: ${JSON.stringify(data.sample_raw_rows[0])}`;
      }
      setBudgetUploadMsg(msg);
      setBudgetUploadMsgKind("debug");
    } catch (e) {
      if (e.code === "PDF_PASSWORD_REQUIRED") {
        setBudgetPdfPasswordNeeded(true);
        if (e.incorrect) setBudgetPwAttempt(n => n + 1);
        setBudgetUploadMsg(e.incorrect ? "⚠ Incorrect password — try again." : "🔒 This PDF is password-protected. Enter the password below and try again.");
        setBudgetUploadMsgKind(e.incorrect ? "error" : "info");
      } else {
        setBudgetUploadMsg("⚠ Debug: " + e.message);
        setBudgetUploadMsgKind("error");
      }
    }
  }

  // Re-run keyword auto-categorisation over already-imported transactions — the
  // fix for "everything is stuck in Other" when categories didn't exist yet at
  // import time (e.g. the default-category seed never ran), or after editing a
  // category's keywords. Only touches "Other" transactions by default so manual
  // recategorisations are never clobbered.
  const [budgetRecatRunning, setBudgetRecatRunning] = useState(false);
  const [budgetRecatMsg,     setBudgetRecatMsg]     = useState("");
  async function recategoriseAllTxns(onlyOther = true) {
    setBudgetRecatRunning(true); setBudgetRecatMsg("");
    try {
      const data = await api("/api/budget/recategorise-all", { method: "POST", body: JSON.stringify({ only_other: onlyOther }) });
      if (data.ok) {
        setBudgetRecatMsg(data.updated > 0
          ? `✓ Recategorised ${data.updated} of ${data.scanned} transaction${data.scanned === 1 ? "" : "s"} scanned.`
          : `No changes — scanned ${data.scanned} transaction${data.scanned === 1 ? "" : "s"}, all already matched their best category.`);
        await loadBudget(budgetSelMonth);
      } else {
        setBudgetRecatMsg("⚠ " + (data.error || "Failed to recategorise."));
      }
    } catch (e) {
      setBudgetRecatMsg("⚠ " + e.message);
    }
    setBudgetRecatRunning(false);
  }

  // ── Bulk categorize ── Lines 4068–4073 (inline in JSX)
  async function bulkCategorize(ids, category) {
    if (!category) return;
    await api("/api/budget/recategorise", { method: "POST", body: JSON.stringify({ ids: [...ids], category }) });
    setSelectedTxnIds(new Set());
    setBulkCatTarget("");
  }

  // ── Single transaction categorize ── Lines 4100–4108 (inline in JSX)
  async function categorizeTxn(txnId, category) {
    await api(`/api/budget/transactions/${txnId}`, { method: "PATCH", body: JSON.stringify({ category }) });
    setBudgetTxns(p => p.map(x => x.id === txnId ? { ...x, category } : x));
  }

  // ── Category CRUD ── Lines 4175–4182 (inline in JSX)
  async function saveBudgetCategory(form, isNew) {
    if (isNew) {
      await api("/api/budget/categories", { method: "POST", body: JSON.stringify(form) });
      setBudgetNewCat({ name: "", color: "#c9a84c", icon: "📁", monthly_limit: 0, keywords: "" });
    } else {
      await api(`/api/budget/categories/${form.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: form.name, color: form.color, icon: form.icon, monthly_limit: form.monthly_limit, keywords: form.keywords }),
      });
    }
    setBudgetEditCat(null);
    await loadBudget(budgetSelMonth);
  }

  async function deleteBudgetCategory(cat) {
    const ok = await toast.confirm(`Delete "${cat.name}"?`, { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/api/budget/categories/${cat.id}`, { method: "DELETE" });
    await loadBudget(budgetSelMonth);
  }

  async function assignStatementMember(statementId, memberId) {
    try {
      await api(`/api/budget/statements/${statementId}/member`, { method: "PATCH", body: JSON.stringify({ member_id: memberId || null }) });
      setBudgetStatements(p => p.map(s => s.id === statementId ? { ...s, member_id: memberId || null } : s));
    } catch (e) { console.error(e); }
  }

  async function deleteBudgetStatement(stmt) {
    const ok = await toast.confirm(`Delete "${stmt.source}" statement and all its transactions?`, { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/api/budget/statements/${stmt.id}`, { method: "DELETE" });
    const stmts = await api("/api/budget/statements");
    setBudgetStatements(stmts || []);
  }

  return {
    // Budget state
    budgetStatements, setBudgetStatements,
    budgetTxns,       setBudgetTxns,
    budgetCategories, setBudgetCategories,
    budgetAnalytics,  setBudgetAnalytics,
    budgetSelStmt,    setBudgetSelStmt,
    budgetSelMonth,   setBudgetSelMonth,
    budgetSelCat,     setBudgetSelCat,
    budgetSearch,     setBudgetSearch,
    budgetView,       setBudgetView,
    budgetUploading,  setBudgetUploading,
    budgetUploadForm, setBudgetUploadForm,
    budgetUploadFile, setBudgetUploadFile,
    budgetUploadMsg,  setBudgetUploadMsg,
    budgetUploadMsgKind, setBudgetUploadMsgKind,
    budgetPdfPasswordNeeded, setBudgetPdfPasswordNeeded,
    budgetPdfPassword,       setBudgetPdfPassword,
    budgetPwAttempt,
    budgetEditCat,    setBudgetEditCat,
    budgetNewCat,     setBudgetNewCat,
    selectedTxnIds,   setSelectedTxnIds,
    bulkCatTarget,    setBulkCatTarget,
    budgetBanks,
    budgetRecatRunning, budgetRecatMsg,
    recategoriseAllTxns,
    // Plaid state
    plaidStatus,  setPlaidStatus,
    plaidLoading, setPlaidLoading,
    plaidMsg,     setPlaidMsg,
    plaidSyncing, setPlaidSyncing,
    // Handlers
    loadBanks,
    loadBudget,
    loadTxns,
    uploadBudgetStatement,
    debugImportFile,
    bulkCategorize,
    categorizeTxn,
      saveBudgetCategory,
    deleteBudgetCategory,
    deleteBudgetStatement,
    assignStatementMember,
  };
}
