import { useMemo } from 'react';
import { BudgetVsActual, BurnRateBanner, MemberComparison, MerchantRollup, RecurringPanel } from './BudgetPanels.jsx';
import { GOLD, GREEN, KpiCard, PURPLE, RED, SectionCard, fmtAmt } from './budgetShared.jsx';
import { CashflowChart, HealthRing, SpendingDonut } from './BudgetCharts.jsx';

// ── Overview ──────────────────────────────────────────────────────
export function OverviewTab({ fb, selectedMember }) {
  const { fbAnalytics: anal, fbAnalLoading: loading, fbMerchants: merchants, fbMerchLoading, fbRecurring: recurring, fbRecLoading, fbCategories: rawCategories, fbCatLimits } = fb;
  // Budget Health + Budget vs Actual should compare spend against the
  // selected member's own limit overrides (migrations/0032), not the shared
  // family limit, once a specific member is selected. "All" is untouched.
  const categories = useMemo(() => {
    if (!selectedMember) return rawCategories;
    return rawCategories.map(c => {
      const override = fbCatLimits[c.id];
      return override ? { ...c, monthly_limit: override.monthly_limit } : c;
    });
  }, [rawCategories, fbCatLimits, selectedMember]);
  if (loading && !anal) return <div style={{ color: 'var(--text-muted)', padding: '3rem', textAlign: 'center' }}>Loading analytics…</div>;
  const byCategory = anal?.byCategory || {};
  const totalDebit = anal?.totalDebit || 0;
  const totalCredit = anal?.totalCredit || 0;
  const savingsRate = anal?.savingsRate || 0;
  const memberBreakdown = anal?.memberBreakdown || [];

  return (
    <div>
      {/* Burn rate banner */}
      {anal && <BurnRateBanner totalDebit={totalDebit} qFrom={anal.qFrom} qTo={anal.qTo} />}
      {anal && <div style={{ marginBottom: '1rem' }} />}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <KpiCard icon="💸" label="Total Spent" value={fmtAmt(totalDebit, true)} color={RED} sub={`${Object.keys(byCategory).length} categories`} />
        <KpiCard icon="💰" label="Total Income" value={fmtAmt(totalCredit, true)} color={GREEN} />
        <KpiCard icon="📈" label="Savings Rate" value={`${savingsRate.toFixed(1)}%`} color={savingsRate > 20 ? GREEN : savingsRate > 0 ? GOLD : RED} sub={savingsRate > 20 ? 'Great!' : savingsRate > 0 ? 'Room to grow' : 'Spending > income'} />
        <KpiCard icon="🔄" label="Recurring" value={fmtAmt(fb.fbRecurring.reduce((s, r) => s + r.typicalAmount, 0), true)} color={PURPLE} sub={`${fb.fbRecurring.length} detected`} />
      </div>

      {/* Health ring + member comparison side by side */}
      {(categories.some(c => c.monthly_limit > 0) || memberBreakdown.length > 0) && (
        <SectionCard title="Budget Health">
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <HealthRing categories={categories} byCategory={byCategory} />
            </div>
            {memberBreakdown.length > 1 && (
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '.6rem' }}>Family Comparison</div>
                <MemberComparison breakdown={memberBreakdown} />
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Spending donut + Budget vs Actual */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <SectionCard title="Spending by Category">
          <SpendingDonut byCategory={byCategory} categories={categories} total={totalDebit} />
        </SectionCard>
        <SectionCard title="Budget vs Actual">
          <BudgetVsActual categories={categories} byCategory={byCategory} />
        </SectionCard>
      </div>

      {/* Cash flow chart */}
      <SectionCard title="12-Month Cash Flow">
        <CashflowChart cashflow={anal?.cashflow || {}} />
      </SectionCard>

      {/* Merchants + Recurring side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
        <SectionCard title="Top Merchants" badge={`${merchants.length}`}>
          <MerchantRollup merchants={merchants} loading={fbMerchLoading} />
        </SectionCard>
        <SectionCard title="Recurring Charges" badge={`${recurring.length}`}>
          <RecurringPanel recurring={recurring} loading={fbRecLoading} />
        </SectionCard>
      </div>
    </div>
  );
}
