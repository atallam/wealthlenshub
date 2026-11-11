// FamilyBudgetTab.jsx — Unified Family Budget tracker (Phases 1-5)
// Features:
//   Phase 1 — Unified tab with 5 sub-views + person selector
//   Phase 2 — Per-member analytics, member comparison panel
//   Phase 3 — 3-step import wizard with preview before save
//   Phase 4 — Merchant rollup, recurring detection, burn rate, trend badges, Budget vs Actual
//   Phase 5 — AI Spending Coach, Wants/Needs tagging

import { useFamilyBudget } from '../../hooks/useFamilyBudget.js';
import { useEffect } from 'react';
import { GOLD, SectionCard } from './budgetShared.jsx';
import { OverviewTab } from './BudgetOverview.jsx';
import { ImportWizard } from './ImportWizard.jsx';
import { TransactionList } from './TransactionList.jsx';
import { CategoriesManager } from './CategoriesManager.jsx';
import { GoalsPanel } from './GoalsPanel.jsx';

// ── Main FamilyBudgetTab ──────────────────────────────────────────
export default function FamilyBudgetTab({ members = [] }) {
  const fb = useFamilyBudget();
  const { fbView: view, setFbView, fbMember: memberFilter, setFbMember, fbMonth: month, setFbMonth, fbPeriod: period, setFbPeriod,
    loadAnalytics, loadMerchants, loadRecurring, loadTransactions, loadCategories, loadCategoryLimits, loadGoals, loadBanks, loadStatements,
    fbTxnCat, fbTxnSearch } = fb;

  // Initial load on mount
  useEffect(() => {
    loadCategories();
    loadGoals();
    loadBanks();
    loadStatements();
  }, [loadCategories, loadGoals, loadBanks, loadStatements]);

  // Reload analytics + merchants + recurring when person/period/month changes
  useEffect(() => {
    loadAnalytics(period, month, memberFilter);
    loadMerchants(period, month, memberFilter);
    loadRecurring(memberFilter);
  }, [memberFilter, period, month, loadAnalytics, loadMerchants, loadRecurring]);

  // Per-member category limit overrides only depend on who's selected, not
  // the period/month — reload separately so switching periods doesn't
  // re-fetch them needlessly.
  useEffect(() => {
    loadCategoryLimits(memberFilter);
  }, [memberFilter, loadCategoryLimits]);

  // Reload transactions when filters change
  useEffect(() => {
    if (view === 'transactions') {
      loadTransactions(period, month, memberFilter, fbTxnCat, fbTxnSearch);
    }
  }, [view, memberFilter, period, month, fbTxnCat, fbTxnSearch, loadTransactions]);

  const SUB_TABS = [
    { key: 'overview',      label: '📊 Overview' },
    { key: 'import',        label: '📥 Import' },
    { key: 'transactions',  label: '📋 Transactions' },
    { key: 'categories',    label: '📂 Categories' },
    { key: 'goals',         label: '🎯 Goals' },
  ];

  // Period quick-picks
  const PERIODS = [
    { key: 'month',   label: 'This Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year',    label: 'Year' },
    { key: 'alltime', label: 'All Time' },
  ];

  // Month picker: last 24 months
  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return { val, label };
  });

  return (
    <div style={{ padding: '1rem', maxWidth: 960, margin: '0 auto' }}>
      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          💰 Family Budget
        </div>

        {/* Person selector */}
        <select className="fi" value={memberFilter || ''} onChange={e => setFbMember(e.target.value || null)}
          style={{ minWidth: 130, fontWeight: memberFilter ? 600 : 400, color: memberFilter ? GOLD : 'var(--text)' }}>
          <option value="">👨‍👩‍👧 All Family</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.avatar || '👤'} {m.name}</option>)}
        </select>

        {/* Period selector */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setFbPeriod(p.key)}
              style={{ padding: '.3rem .65rem', border: 'none', background: period === p.key ? GOLD : 'transparent', color: period === p.key ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontSize: '.7rem', fontWeight: period === p.key ? 700 : 400 }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Month picker — only when period=month */}
        {period === 'month' && (
          <select className="fi" value={month} onChange={e => setFbMonth(e.target.value)} style={{ minWidth: 120 }}>
            {monthOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        )}
      </div>

      {/* ── Sub-tab nav ── */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setFbView(t.key)}
            style={{ padding: '.5rem 1rem', border: 'none', borderBottom: `2px solid ${view === t.key ? GOLD : 'transparent'}`, background: 'transparent', color: view === t.key ? GOLD : 'var(--text-muted)', cursor: 'pointer', fontSize: '.78rem', fontWeight: view === t.key ? 700 : 400, whiteSpace: 'nowrap', transition: 'color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sub-tab content ── */}
      {view === 'overview' && <OverviewTab fb={fb} members={members} selectedMember={memberFilter} />}
      {view === 'import' && <ImportWizard fb={fb} members={members} />}
      {view === 'transactions' && (
        <SectionCard title="Transactions">
          <TransactionList fb={fb} members={members} />
        </SectionCard>
      )}
      {view === 'categories' && <CategoriesManager fb={fb} members={members} selectedMember={memberFilter} />}
      {view === 'goals' && <GoalsPanel fb={fb} />}
    </div>
  );
}
