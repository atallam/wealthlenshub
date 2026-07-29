// useBudget2.js — state + data fetching for the Budget 2 tab
// Borrows from Ledgerly: period selector, goals, recurring detection

import { useState, useCallback } from 'react';
import { api } from '../lib/api.js';

// ── Period helper ─────────────────────────────────────────────────
export function periodToDateRange(period) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const y = now.getFullYear(), m = now.getMonth();

  switch (period) {
    case 'this-month': {
      const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      return { from, to: today };
    }
    case 'last-month': {
      const d = new Date(y, m, 0); // last day of prev month
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const to   = d.toISOString().slice(0, 10);
      return { from, to };
    }
    case 'last-3-months': {
      const from = new Date(now - 90 * 86400_000).toISOString().slice(0, 10);
      return { from, to: today };
    }
    case 'last-6-months': {
      const from = new Date(now - 180 * 86400_000).toISOString().slice(0, 10);
      return { from, to: today };
    }
    case 'this-year': {
      const from = `${y}-01-01`;
      return { from, to: today };
    }
    case 'all-time':
    default:
      return { from: 'alltime', to: undefined }; // sentinel for "no date filter"
  }
}

export const PERIODS = [
  { key: 'all-time',      label: 'All time' },
  { key: 'this-month',    label: 'This month' },
  { key: 'last-month',    label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
  { key: 'last-6-months', label: 'Last 6 months' },
  { key: 'this-year',     label: 'This year' },
];

// ── Recurring detection (client-side) ────────────────────────────
function normalizeMerchant(desc) {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+\d{6,}\s*/g, ' ')   // strip long ref numbers
    .replace(/#\s*\d+/g, '')          // strip trailing #123
    .replace(/\s+/g, ' ')
    .trim();
}

const CADENCE_WINDOWS = [
  { name: 'weekly',     min: 5,   max: 9   },
  { name: 'biweekly',  min: 12,  max: 17  },
  { name: 'monthly',   min: 24,  max: 40  },
  { name: 'quarterly', min: 75,  max: 110 },
  { name: 'annual',    min: 330, max: 400 },
];

const SUBSCRIPTION_HINTS = ['netflix','spotify','hulu','disney','youtube','icloud','dropbox','adobe','microsoft','amazon prime','patreon','membership','gym','openai','chatgpt','canva','notion','zoom','slack','github','hotstar','zee5','sonyliv','jiocinema','prime video','apple'];
const RECURRING_HINTS    = ['mortgage','rent','loan','insurance','utility','electric','water','internet','phone','mobile','daycare','tuition','lease','emi','hoa','property tax','broadband','jio','airtel','electricity'];

function toMonthlyEquivalent(amount, cadence) {
  if (cadence === 'weekly')    return amount * 52 / 12;
  if (cadence === 'biweekly') return amount * 26 / 12;
  if (cadence === 'quarterly') return amount / 3;
  if (cadence === 'annual')    return amount / 12;
  return amount; // monthly
}

export function detectRecurring(transactions, ignoredKeys = []) {
  // Group DEBIT transactions by normalized merchant
  const groups = {};
  for (const t of transactions) {
    if (t.txn_type !== 'DEBIT') continue;
    const key = normalizeMerchant(t.description || t.search_text || '');
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ date: t.txn_date, amount: t.amount, merchant: t.description || t.search_text });
  }

  const results = [];
  for (const [key, entries] of Object.entries(groups)) {
    if (ignoredKeys.includes(key)) continue;
    // Need at least 2 unique dates
    const uniqueDates = [...new Set(entries.map(e => e.date))].sort();
    if (uniqueDates.length < 2) continue;

    // Calculate intervals between consecutive dates
    const intervals = [];
    for (let i = 1; i < uniqueDates.length; i++) {
      const diff = (new Date(uniqueDates[i]) - new Date(uniqueDates[i-1])) / 86400_000;
      intervals.push(diff);
    }
    const avgInterval = intervals.reduce((s, x) => s + x, 0) / intervals.length;

    // Find matching cadence
    const cadence = CADENCE_WINDOWS.find(c => avgInterval >= c.min && avgInterval <= c.max);
    if (!cadence) continue;

    // Amount variation check
    const amounts = entries.map(e => e.amount);
    const avgAmount = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    const maxDeviation = Math.max(...amounts.map(a => Math.abs(a - avgAmount) / avgAmount));

    const isSubscriptionHint = SUBSCRIPTION_HINTS.some(h => key.includes(h));
    const isRecurringHint    = RECURRING_HINTS.some(h => key.includes(h));
    const variationLimit = isSubscriptionHint ? 0.20 : 0.35;
    if (maxDeviation > variationLimit) continue;

    // Stricter: no hint → need ≥3 occurrences with tiny variation
    if (!isSubscriptionHint && !isRecurringHint && uniqueDates.length < 3 && maxDeviation > 0.03) continue;

    // Confidence
    const intervalJitter = Math.max(...intervals.map(i => Math.abs(i - avgInterval)));
    const highConf = uniqueDates.length >= 3 && maxDeviation <= 0.12 && intervalJitter <= 5;
    const confidence = highConf ? 'High' : 'Likely';

    // Next occurrence
    const lastDate = new Date(uniqueDates[uniqueDates.length - 1]);
    const nextDate = new Date(lastDate.getTime() + avgInterval * 86400_000);

    results.push({
      key,
      merchant: entries[entries.length - 1].merchant,
      cadence: cadence.name,
      occurrences: uniqueDates.length,
      avgAmount,
      monthlyEquivalent: toMonthlyEquivalent(avgAmount, cadence.name),
      confidence,
      nextDate: nextDate.toISOString().slice(0, 10),
      isSubscription: isSubscriptionHint,
      isRecurring: isRecurringHint || (!isSubscriptionHint),
    });
  }

  return results.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

// ── Hook ─────────────────────────────────────────────────────────
export function useBudget2(user) {
  const [period,      setPeriod]      = useState('all-time');
  const [analytics2,  setAnalytics2]  = useState(null);
  const [categories2, setCategories2] = useState([]);
  const [goals,       setGoals]       = useState([]);
  const [recurring,   setRecurring]   = useState([]);
  const [ignoredKeys, setIgnoredKeys] = useState([]);
  const [allTxns,     setAllTxns]     = useState([]);   // for recurring detection
  const [loading,     setLoading]     = useState(false);
  const [goalForm,    setGoalForm]    = useState(null); // null | 'new' | goal object
  const [newGoal,     setNewGoal]     = useState({ name: '', target: '', saved: '', due_date: '', note: '', color: '#c9a84c', icon: '🎯' });
  const [b2View,      setB2View]      = useState('dashboard'); // dashboard | goals | recurring

  const loadAnalytics = useCallback(async (p = period) => {
    if (!user) return;
    setLoading(true);
    try {
      const { from, to } = periodToDateRange(p);
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to',   to);
      const [ana, cats, goalsData] = await Promise.all([
        api(`/api/budget/analytics?${params}`),
        api('/api/budget/categories'),
        api('/api/budget/goals').catch(() => []),
      ]);
      setAnalytics2(ana);
      setCategories2(cats || []);
      setGoals(goalsData || []);
    } catch (e) {
      console.error('Budget2 analytics error:', e);
    } finally {
      setLoading(false);
    }
  }, [user, period]);

  const loadRecurring = useCallback(async () => {
    if (!user) return;
    try {
      // Fetch last 12 months of transactions for pattern detection
      const from = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
      const txns = await api(`/api/budget/transactions?from=${from}&limit=2000`);
      setAllTxns(txns || []);
      setRecurring(detectRecurring(txns || [], ignoredKeys));
    } catch (e) {
      console.error('Recurring detection error:', e);
    }
  }, [user, ignoredKeys]);

  function ignorePattern(key) {
    const updated = [...ignoredKeys, key];
    setIgnoredKeys(updated);
    setRecurring(r => r.filter(p => p.key !== key));
  }

  async function saveGoal(form, isNew) {
    if (isNew) {
      const created = await api('/api/budget/goals', { method: 'POST', body: JSON.stringify(form) });
      setGoals(g => [...g, created]);
    } else {
      const updated = await api(`/api/budget/goals/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
      setGoals(g => g.map(x => x.id === form.id ? updated : x));
    }
  }

  async function deleteGoal(id) {
    await api(`/api/budget/goals/${id}`, { method: 'DELETE' });
    setGoals(g => g.filter(x => x.id !== id));
  }

  return {
    period, setPeriod,
    analytics2, setAnalytics2,
    categories2, setCategories2,
    goals, setGoals,
    recurring, setRecurring,
    ignoredKeys, setIgnoredKeys,
    allTxns,
    loading,
    goalForm, setGoalForm,
    newGoal, setNewGoal,
    b2View, setB2View,
    loadAnalytics,
    loadRecurring,
    ignorePattern,
    saveGoal,
    deleteGoal,
  };
}
