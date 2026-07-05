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

// Lines 1052–1095 (budget state) + inline budget functions defined within the tab render (lines 3761–4355)
// NOTE: loadBudget, loadTxns, and upload handlers are defined inline inside the budget tab JSX in App.jsx.
// They are extracted here as standalone async functions and exposed so the budget tab can call them.
export function useBudget(user) {
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
  const [budgetUploadForm,  setBudgetUploadForm]  = useState({ region: "", bank_key: "", statement_type: "BANK", notes: "", custom_label: "" });
  const [budgetUploadFile,  setBudgetUploadFile]  = useState(null);
  const [budgetUploadMsg,   setBudgetUploadMsg]   = useState("");
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
  async function uploadBudgetStatement(file, uploadForm) {
    if (!file || !uploadForm.region) return;
    const bankKey = uploadForm.bank_key || (uploadForm.region === "AUTO" ? "auto" : "");
    if (!bankKey) { setBudgetUploadMsg("⚠ Please select a bank"); return; }
    setBudgetUploading(true); setBudgetUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bank_key", bankKey);
      fd.append("source", uploadForm.custom_label || uploadForm.bank_key || "Auto");
      fd.append("statement_type", uploadForm.statement_type);
      fd.append("notes", uploadForm.notes || "");
      const data = await api("/api/budget/upload", { method: "POST", body: fd });
      if (data.ok) {
        setBudgetUploadMsg(`✓ Imported ${data.txn_count} transactions (${data.period_start} to ${data.period_end})`);
        setBudgetUploadFile(null);
        setBudgetUploadForm({ region: "", bank_key: "", statement_type: "BANK", notes: "", custom_label: "" });
        await loadBudget(budgetSelMonth); // already re-fetches statements, categories, and analytics
      } else { setBudgetUploadMsg("⚠ " + data.error); }
    } catch (e) { setBudgetUploadMsg("⚠ " + e.message); }
    setBudgetUploading(false);
  }

  async function debugImportPDF(file) {
    setBudgetUploadMsg("Analyzing + importing PDF...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("import", "true");
      const data = await api("/api/budget/debug-pdf", { method: "POST", body: fd });
      let msg = `📄 ${data.pages} pages, ${data.totalLines} lines, ${data.totalChars} chars\n` +
        `US parser: ${data.usRowsParsed} rows | IN parser: ${data.inRowsParsed} rows\n`;
      if (data.imported > 0) {
        msg = `✓ Imported ${data.imported} transactions via debug endpoint\n` + msg;
        await loadBudget(budgetSelMonth); // already re-fetches statements
      } else {
        msg += `Import: ${data.imported} (${data.importError || "no rows to import"})\n`;
      }
      msg += `Sections: ${data.sectionHeaders?.join(" | ") || "none"}\n` +
        `Date lines: ${data.dateLines?.slice(0, 5).join(" | ") || "none"}\n` +
        `--- First 15 lines ---\n${data.first80Lines?.slice(0, 15).join("\n")}`;
      setBudgetUploadMsg(msg);
    } catch (e) { setBudgetUploadMsg("⚠ Debug: " + e.message); }
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
    if (!confirm(`Delete "${cat.name}"?`)) return;
    await api(`/api/budget/categories/${cat.id}`, { method: "DELETE" });
    await loadBudget(budgetSelMonth);
  }

  async function deleteBudgetStatement(stmt) {
    if (!confirm(`Delete "${stmt.source}" statement and all its transactions?`)) return;
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
    budgetEditCat,    setBudgetEditCat,
    budgetNewCat,     setBudgetNewCat,
    selectedTxnIds,   setSelectedTxnIds,
    bulkCatTarget,    setBulkCatTarget,
    // Plaid state
    plaidStatus,  setPlaidStatus,
    plaidLoading, setPlaidLoading,
    plaidMsg,     setPlaidMsg,
    plaidSyncing, setPlaidSyncing,
    // Handlers
    loadBudget,
    loadTxns,
    uploadBudgetStatement,
    debugImportPDF,
    bulkCategorize,
    categorizeTxn,
    saveBudgetCategory,
    deleteBudgetCategory,
    deleteBudgetStatement,
  };
}
