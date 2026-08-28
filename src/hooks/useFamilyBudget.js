// useFamilyBudget.js — state and API layer for FamilyBudgetTab (Phases 1-5)
// Mirrors the pattern of useBudget.js but adds member filtering, merchant rollup,
// recurring detection, and per-person analytics.

import { useState, useCallback } from 'react';
import { supabase } from '../supabase.js';

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  const isForm = opts.body instanceof FormData;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw Object.assign(new Error(e.error || res.statusText), e);
  }
  return res.json();
}

// Persist last-used import settings per person
const IMPORT_KEY = 'wlh_fb_import';
function loadImportDefaults() {
  try {
    const s = JSON.parse(localStorage.getItem(IMPORT_KEY) || 'null');
    if (s) return { region: s.region || '', bank_key: s.bank_key || '', statement_type: s.statement_type || 'BANK', member_id: s.member_id || '', notes: '', custom_label: '' };
  } catch { /* ignore */ }
  return { region: '', bank_key: '', statement_type: 'BANK', member_id: '', notes: '', custom_label: '' };
}
function saveImportDefaults(form) {
  try { localStorage.setItem(IMPORT_KEY, JSON.stringify({ region: form.region, bank_key: form.bank_key, statement_type: form.statement_type, member_id: form.member_id })); } catch { /* ignore */ }
}

export function useFamilyBudget(user) {
  // ── Active sub-tab ────────────────────────────────────────────
  const [fbView, setFbView] = useState('overview'); // overview|import|transactions|categories|goals

  // ── Person selector (null = "All family") ────────────────────
  const [fbMember, setFbMember] = useState(null);

  // ── Period selector ───────────────────────────────────────────
  const [fbMonth, setFbMonth] = useState(() => {
    const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [fbPeriod, setFbPeriod] = useState('month'); // month|quarter|year|alltime

  // ── Analytics ─────────────────────────────────────────────────
  const [fbAnalytics,   setFbAnalytics]   = useState(null);
  const [fbAnalLoading, setFbAnalLoading] = useState(false);

  // ── Merchants ─────────────────────────────────────────────────
  const [fbMerchants,   setFbMerchants]   = useState([]);
  const [fbMerchLoading,setFbMerchLoading]= useState(false);

  // ── Recurring ─────────────────────────────────────────────────
  const [fbRecurring,   setFbRecurring]   = useState([]);
  const [fbRecLoading,  setFbRecLoading]  = useState(false);

  // ── Transactions ──────────────────────────────────────────────
  const [fbTxns,        setFbTxns]        = useState([]);
  const [fbTxnsLoading, setFbTxnsLoading] = useState(false);
  const [fbTxnCat,      setFbTxnCat]      = useState('All');
  const [fbTxnSearch,   setFbTxnSearch]   = useState('');
  const [fbSelTxnIds,   setFbSelTxnIds]   = useState(new Set());
  const [fbBulkCat,     setFbBulkCat]     = useState('');

  // ── Categories ────────────────────────────────────────────────
  const [fbCategories,  setFbCategories]  = useState([]);
  const [fbCatLoading,  setFbCatLoading]  = useState(false);
  const [fbEditCat,     setFbEditCat]     = useState(null);
  const [fbNewCat,      setFbNewCat]      = useState({ name: '', color: '#c9a84c', icon: '📁', monthly_limit: 0, keywords: '', is_essential: false });

  // ── Goals ─────────────────────────────────────────────────────
  const [fbGoals,       setFbGoals]       = useState([]);
  const [fbGoalLoading, setFbGoalLoading] = useState(false);
  const [fbEditGoal,    setFbEditGoal]    = useState(null);
  const [fbNewGoal,     setFbNewGoal]     = useState({ name: '', target: '', saved: '', due_date: '', note: '', color: '#4caf9a', icon: '🎯' });

  // ── Statements list ───────────────────────────────────────────
  const [fbStatements,  setFbStatements]  = useState([]);

  // ── Banks registry ────────────────────────────────────────────
  const [fbBanks,       setFbBanks]       = useState([]);

  // ── Import wizard ─────────────────────────────────────────────
  const [fbImportStep,  setFbImportStep]  = useState(1); // 1=person, 2=bank, 3=upload
  const [fbUploadForm,  setFbUploadForm]  = useState(loadImportDefaults);
  const [fbUploadFile,  setFbUploadFile]  = useState(null);
  const [fbUploading,   setFbUploading]   = useState(false);
  const [fbUploadMsg,   setFbUploadMsg]   = useState('');
  const [fbUploadKind,  setFbUploadKind]  = useState(''); // ''|info|success|error|debug
  const [fbPdfPwNeeded, setFbPdfPwNeeded] = useState(false);
  const [fbPdfPw,       setFbPdfPw]       = useState('');
  const [fbPwAttempt,   setFbPwAttempt]   = useState(0);

  // ── AI coach ──────────────────────────────────────────────────
  const [fbAiQuery,     setFbAiQuery]     = useState('');
  const [fbAiResponse,  setFbAiResponse]  = useState('');
  const [fbAiLoading,   setFbAiLoading]   = useState(false);

  // ─────────────────────────────────────────────────────────────
  // Load functions
  // ─────────────────────────────────────────────────────────────

  // Derive from/to from period + fbMonth
  function periodRange(period, month) {
    const now = new Date();
    if (period === 'alltime') return { from: '2020-01-01', to: now.toISOString().slice(0, 10) };
    if (period === 'year') {
      const y = month ? month.slice(0, 4) : now.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (period === 'quarter') {
      const y = month ? Number(month.slice(0, 4)) : now.getFullYear();
      const m = month ? Number(month.slice(5, 7)) : now.getMonth() + 1;
      const q = Math.ceil(m / 3);
      const qStart = (q - 1) * 3 + 1;
      return { from: `${y}-${String(qStart).padStart(2,'0')}-01`, to: `${y}-${String(qStart + 2).padStart(2,'0')}-31` };
    }
    // month (default)
    return { month };
  }

  const loadAnalytics = useCallback(async (period, month, memberId) => {
    setFbAnalLoading(true);
    try {
      const range = periodRange(period, month);
      const params = new URLSearchParams();
      if (memberId) params.set('member_id', memberId);
      if (range.month) params.set('month', range.month);
      else { params.set('from', range.from); params.set('to', range.to); }
      const data = await api(`/api/budget/family-analytics?${params}`);
      setFbAnalytics(data);
    } catch (e) { console.error('familyAnalytics', e); }
    setFbAnalLoading(false);
  }, []);

  const loadMerchants = useCallback(async (period, month, memberId) => {
    setFbMerchLoading(true);
    try {
      const range = periodRange(period, month);
      const params = new URLSearchParams();
      if (memberId) params.set('member_id', memberId);
      if (range.month) params.set('month', range.month);
      else { params.set('from', range.from); params.set('to', range.to); }
      const data = await api(`/api/budget/merchants?${params}`);
      setFbMerchants(data || []);
    } catch (e) { console.error('merchants', e); }
    setFbMerchLoading(false);
  }, []);

  const loadRecurring = useCallback(async (memberId) => {
    setFbRecLoading(true);
    try {
      const params = new URLSearchParams();
      if (memberId) params.set('member_id', memberId);
      const data = await api(`/api/budget/recurring?${params}`);
      setFbRecurring(data || []);
    } catch (e) { console.error('recurring', e); }
    setFbRecLoading(false);
  }, []);

  const loadTransactions = useCallback(async (period, month, memberId, category, search) => {
    setFbTxnsLoading(true);
    try {
      const params = new URLSearchParams();
      if (memberId) params.set('member_id', memberId);
      const range = periodRange(period, month);
      if (range.month) params.set('month', range.month);
      else { params.set('from', range.from); params.set('to', range.to); }
      if (category && category !== 'All') params.set('category', category);
      if (search) params.set('search', search);
      params.set('limit', '500');
      const data = await api(`/api/budget/family-transactions?${params}`);
      setFbTxns(data || []);
    } catch (e) { console.error('familyTxns', e); }
    setFbTxnsLoading(false);
  }, []);

  const loadCategories = useCallback(async () => {
    setFbCatLoading(true);
    try { setFbCategories(await api('/api/budget/categories')); } catch (e) { console.error(e); }
    setFbCatLoading(false);
  }, []);

  const loadGoals = useCallback(async () => {
    setFbGoalLoading(true);
    try { setFbGoals(await api('/api/budget/goals')); } catch (e) { console.error(e); }
    setFbGoalLoading(false);
  }, []);

  const loadBanks = useCallback(async () => {
    try { setFbBanks(await api('/api/budget/banks')); } catch (e) { console.error(e); }
  }, []);

  const loadStatements = useCallback(async () => {
    try { setFbStatements(await api('/api/budget/statements')); } catch (e) { console.error(e); }
  }, []);

  // ── Upload ────────────────────────────────────────────────────
  async function uploadStatement(file, form, pdfPw) {
    if (!file) return;
    const bankKey = form.bank_key || (form.region === 'AUTO' ? 'auto' : '');
    if (!bankKey) { setFbUploadMsg('Please select a bank / region'); setFbUploadKind('error'); return; }
    setFbUploading(true); setFbUploadMsg(''); setFbUploadKind('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bank_key', bankKey);
      fd.append('source', form.custom_label || form.bank_key || 'Auto');
      fd.append('statement_type', form.statement_type);
      fd.append('notes', form.notes || '');
      if (form.member_id) fd.append('member_id', form.member_id);
      if (pdfPw) fd.append('pdf_password', pdfPw);
      const data = await api('/api/budget/upload', { method: 'POST', body: fd });
      if (data.ok) {
        const dups = data.skipped_duplicates > 0 ? ` · ${data.skipped_duplicates} duplicates skipped` : '';
        setFbUploadMsg(`✓ Imported ${data.txn_count} transactions (${data.period_start} → ${data.period_end})${dups}`);
        setFbUploadKind('success');
        setFbUploadFile(null);
        setFbPdfPwNeeded(false); setFbPdfPw('');
        saveImportDefaults(form);
        setFbUploadForm(p => ({ region: p.region, bank_key: p.bank_key, statement_type: p.statement_type, member_id: p.member_id, notes: '', custom_label: '' }));
        await Promise.all([loadStatements(), loadAnalytics(fbPeriod, fbMonth, fbMember)]);
      } else { setFbUploadMsg('⚠ ' + data.error); setFbUploadKind('error'); }
    } catch (e) {
      if (e.code === 'PDF_PASSWORD_REQUIRED') {
        setFbPdfPwNeeded(true);
        if (e.incorrect) setFbPwAttempt(n => n + 1);
        setFbUploadMsg(e.incorrect ? '⚠ Incorrect password — try again.' : '🔒 PDF is password-protected. Enter the password below.');
        setFbUploadKind(e.incorrect ? 'error' : 'info');
      } else { setFbUploadMsg('⚠ ' + e.message); setFbUploadKind('error'); }
    }
    setFbUploading(false);
  }

  // ── Dry-run / preview import ──────────────────────────────────
  async function previewImport(file, form, pdfPw) {
    if (!file) return;
    setFbUploadMsg('Previewing file…'); setFbUploadKind('info');
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('bank_key', form.bank_key || 'auto');
      fd.append('statement_type', form.statement_type); fd.append('dry_run', 'true');
      if (pdfPw) fd.append('pdf_password', pdfPw);
      const data = await api('/api/budget/upload', { method: 'POST', body: fd });
      if (data.ok) {
        const dups = data.would_skip_duplicate_count ? ` · ${data.would_skip_duplicate_count} already imported` : '';
        setFbUploadMsg(`📄 Preview: ${data.would_import_count} transactions to import${dups} — nothing saved yet.\nBank: ${data.detected_bank || form.bank_key} · Rows parsed: ${data.rows_parsed ?? 0}`);
      } else {
        setFbUploadMsg(`⚠ ${data.error}\nRows parsed: ${data.rows_parsed ?? 0}`);
      }
      setFbUploadKind('debug');
    } catch (e) {
      if (e.code === 'PDF_PASSWORD_REQUIRED') {
        setFbPdfPwNeeded(true);
        if (e.incorrect) setFbPwAttempt(n => n + 1);
        setFbUploadMsg(e.incorrect ? '⚠ Wrong password.' : '🔒 Password-protected PDF.');
        setFbUploadKind(e.incorrect ? 'error' : 'info');
      } else { setFbUploadMsg('⚠ ' + e.message); setFbUploadKind('error'); }
    }
  }

  // ── Category CRUD ─────────────────────────────────────────────
  async function saveCategory(form, isNew) {
    if (isNew) {
      await api('/api/budget/categories', { method: 'POST', body: JSON.stringify(form) });
      setFbNewCat({ name: '', color: '#c9a84c', icon: '📁', monthly_limit: 0, keywords: '', is_essential: false });
    } else {
      await api(`/api/budget/categories/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
    }
    setFbEditCat(null);
    await loadCategories();
  }
  async function deleteCategory(cat, confirmFn) {
    const ok = await confirmFn(`Delete category "${cat.name}"?`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await api(`/api/budget/categories/${cat.id}`, { method: 'DELETE' });
    await loadCategories();
  }

  // ── Transaction categorize ────────────────────────────────────
  async function categorizeTxn(txnId, category) {
    await api(`/api/budget/transactions/${txnId}`, { method: 'PATCH', body: JSON.stringify({ category }) });
    setFbTxns(p => p.map(x => x.id === txnId ? { ...x, category } : x));
  }
  async function bulkCategorize(ids, category) {
    if (!category || !ids.size) return;
    await api('/api/budget/recategorise', { method: 'POST', body: JSON.stringify({ ids: [...ids], category }) });
    setFbTxns(p => p.map(x => ids.has(x.id) ? { ...x, category } : x));
    setFbSelTxnIds(new Set()); setFbBulkCat('');
  }

  // ── Goal CRUD ─────────────────────────────────────────────────
  async function saveGoal(form, isNew) {
    if (isNew) {
      await api('/api/budget/goals', { method: 'POST', body: JSON.stringify(form) });
      setFbNewGoal({ name: '', target: '', saved: '', due_date: '', note: '', color: '#4caf9a', icon: '🎯' });
    } else {
      await api(`/api/budget/goals/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
    }
    setFbEditGoal(null);
    await loadGoals();
  }
  async function deleteGoal(goal, confirmFn) {
    const ok = await confirmFn(`Delete goal "${goal.name}"?`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await api(`/api/budget/goals/${goal.id}`, { method: 'DELETE' });
    await loadGoals();
  }

  // ── AI Spending Coach ─────────────────────────────────────────
  async function askAiCoach(question, analyticsContext) {
    if (!question.trim()) return;
    setFbAiLoading(true); setFbAiResponse('');
    try {
      const context = analyticsContext
        ? `The user's spending summary: total spent ₹${Math.round(analyticsContext.totalDebit).toLocaleString('en-IN')}, total income ₹${Math.round(analyticsContext.totalCredit).toLocaleString('en-IN')}, savings rate ${Math.round(analyticsContext.savingsRate)}%. Top categories: ${Object.entries(analyticsContext.byCategory || {}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}: ₹${Math.round(v).toLocaleString('en-IN')}`).join(', ')}.`
        : '';
      const payload = {
        messages: [{ role: 'user', content: `${context}\n\nUser question: ${question}` }],
        system: 'You are a personal finance coach. Analyze spending patterns and give specific, actionable advice to reduce spending and improve savings. Be concise, warm, and data-driven.',
      };
      const data = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify(payload) });
      setFbAiResponse(data?.content?.[0]?.text || data?.message || 'No response');
    } catch (e) { setFbAiResponse('⚠ ' + e.message); }
    setFbAiLoading(false);
  }

  return {
    // Navigation
    fbView, setFbView,
    fbMember, setFbMember,
    fbMonth, setFbMonth,
    fbPeriod, setFbPeriod,
    // Analytics
    fbAnalytics, fbAnalLoading,
    loadAnalytics,
    // Merchants
    fbMerchants, fbMerchLoading,
    loadMerchants,
    // Recurring
    fbRecurring, fbRecLoading,
    loadRecurring,
    // Transactions
    fbTxns, fbTxnsLoading,
    fbTxnCat, setFbTxnCat,
    fbTxnSearch, setFbTxnSearch,
    fbSelTxnIds, setFbSelTxnIds,
    fbBulkCat, setFbBulkCat,
    loadTransactions,
    categorizeTxn, bulkCategorize,
    // Categories
    fbCategories, fbCatLoading,
    fbEditCat, setFbEditCat,
    fbNewCat, setFbNewCat,
    loadCategories, saveCategory, deleteCategory,
    // Goals
    fbGoals, fbGoalLoading,
    fbEditGoal, setFbEditGoal,
    fbNewGoal, setFbNewGoal,
    loadGoals, saveGoal, deleteGoal,
    // Statements
    fbStatements, loadStatements,
    // Banks
    fbBanks, loadBanks,
    // Import wizard
    fbImportStep, setFbImportStep,
    fbUploadForm, setFbUploadForm,
    fbUploadFile, setFbUploadFile,
    fbUploading,
    fbUploadMsg, setFbUploadMsg,
    fbUploadKind, setFbUploadKind,
    fbPdfPwNeeded, setFbPdfPwNeeded,
    fbPdfPw, setFbPdfPw,
    fbPwAttempt,
    uploadStatement, previewImport,
    saveImportDefaults,
    // AI Coach
    fbAiQuery, setFbAiQuery,
    fbAiResponse, setFbAiResponse,
    fbAiLoading,
    askAiCoach,
  };
}
