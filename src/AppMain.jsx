import { HoldingsTab, GoalsTab, StrategyTab, MembersTab, FamilyBudgetTab, CalendarTab, NewsTab, AdvisorTab } from './appTabs.jsx';
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';
import LoadingSkeleton from './components/shared/LoadingSkeleton.jsx';
import { Overlay } from './components/shared/Overlay.jsx';
import OverviewTab from './features/overview/OverviewTab.jsx';
import { api } from './lib/api.js';

// The tab router: renders the active tab (lazy-loaded, each in its own ErrorBoundary).
// Extracted from App.jsx; App owns all state and passes what the tabs need as props.
export default function AppMain({ user, tab, setTab, selMember, setSelMember, memberAction, setMemberAction, setGoalForm, setEditGoalId, setAlertForm, setTxnHolding, setTxnForm, setArtifactHolding, targetAlloc, setTargetAlloc, rebalMember, setRebalMember, rebalCash, setRebalCash, nwMember, setNwMember, bmPeriod, setBmPeriod, calMonth, setCalMonth, aiBottomRef, portfolio, ai, expandedHolding, setExpandedHolding, showQuietAlerts, setShowQuietAlerts, filterType, setFilterType, sortCol, setSortCol, sortDir, setSortDir, toggleSort, holdings, setHoldings, members, goals, alerts, loaded, visH, buildPortfolioContext, buildSuggestedQuestions, openMemberModal, editH, sharedPortfolioProps }) {
  return (
<main className="main">

        {/* Loading skeleton shown while portfolio data fetches after auth */}
        {!loaded && <LoadingSkeleton />}

        {loaded && tab === 'overview' && (
          <ErrorBoundary tab="Overview">
            <OverviewTab
              {...sharedPortfolioProps}
              selMember={selMember}
              bmPeriod={bmPeriod} setBmPeriod={setBmPeriod}
              setBenchmark={portfolio.setBenchmark}
              nwMember={nwMember} setNwMember={setNwMember}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'holdings' && (
          <ErrorBoundary tab="Holdings">
            <HoldingsTab
              {...sharedPortfolioProps}
              visH={visH}
              filterType={filterType} setFilterType={setFilterType}
              sortCol={sortCol}       setSortCol={setSortCol}
              sortDir={sortDir}       setSortDir={setSortDir}
              expandedHolding={expandedHolding} setExpandedHolding={setExpandedHolding}
              toggleSort={toggleSort}
              editH={editH}
              setTxnForm={setTxnForm}
              setTxnHolding={setTxnHolding}
              setArtifactHolding={setArtifactHolding}
              setHoldings={setHoldings}
              alerts={alerts}
              setAlerts={portfolio.setAlerts}
              staleThresholds={{
                FD:          portfolio.profile?.settings?.stale_fd_days          ?? 90,
                PPF:         portfolio.profile?.settings?.stale_ppf_days         ?? 90,
                EPF:         portfolio.profile?.settings?.stale_epf_days         ?? 90,
                REAL_ESTATE: portfolio.profile?.settings?.stale_real_estate_days ?? 180,
                CASH:        portfolio.profile?.settings?.stale_cash_days        ?? 14,
                INSURANCE:   portfolio.profile?.settings?.stale_insurance_days   ?? 365,
                OTHER:       portfolio.profile?.settings?.stale_other_days       ?? 60,
              }}
              minDisplayDays={portfolio.profile?.settings?.stale_min_display_days ?? 14}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'goals' && (
          <ErrorBoundary tab="Goals">
            <GoalsTab
              {...sharedPortfolioProps}
              setGoals={portfolio.setGoals}
              setGoalForm={setGoalForm}
              setEditGoalId={setEditGoalId}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'strategy' && (
          <ErrorBoundary tab="Strategy">
            <StrategyTab
              {...sharedPortfolioProps}
              targetAlloc={targetAlloc} setTargetAlloc={setTargetAlloc}
              rebalMember={rebalMember} setRebalMember={setRebalMember}
              rebalCash={rebalCash}     setRebalCash={setRebalCash}
              showQuietAlerts={showQuietAlerts} setShowQuietAlerts={setShowQuietAlerts}
              setAlertForm={setAlertForm}
              setAlerts={portfolio.setAlerts}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'members' && (
          <ErrorBoundary tab="Members">
            <MembersTab
              {...sharedPortfolioProps}
              openMemberModal={openMemberModal}
              setMemberAction={setMemberAction}
              memberAction={memberAction}
              deleteMember={(id, reassignTo) => portfolio.deleteMember(id, reassignTo, holdings)}
              mergeMembers={portfolio.mergeMembers}
              onViewHoldings={(memberId) => { setSelMember(memberId); setTab('holdings'); }}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'familybudget' && (
          <ErrorBoundary tab="Family Budget">
            <FamilyBudgetTab
              user={user}
              members={members}
              Overlay={Overlay}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'calendar' && (
          <ErrorBoundary tab="Calendar">
            <CalendarTab
              holdings={holdings} goals={goals}
              calMonth={calMonth} setCalMonth={setCalMonth}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'news' && (
          <ErrorBoundary tab="News">
            <NewsTab holdings={holdings} api={api} />
          </ErrorBoundary>
        )}

        {loaded && tab === 'advisor' && (
          <ErrorBoundary tab="Advisor">
            <AdvisorTab
              aiMessages={ai.aiMessages}
              setAiMessages={ai.setAiMessages}
              aiInput={ai.aiInput}
              setAiInput={ai.setAiInput}
              aiLoading={ai.aiLoading}
              askAI={(_, __, overrideInput) => ai.askAI(buildPortfolioContext(), aiBottomRef, overrideInput)}
              clearConversation={ai.clearConversation}
              aiBottomRef={aiBottomRef}
              suggestedQuestions={buildSuggestedQuestions()}
            />
          </ErrorBoundary>
        )}

      </main>
  );
}
