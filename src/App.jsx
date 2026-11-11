import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  LayoutDashboard, BarChart2, Target, Compass,
  Users, CalendarDays, MessageSquare,
  X,
  AlertTriangle,
  Newspaper, TrendingUp,
} from 'lucide-react';
import { supabase, signOut } from './supabase.js';
import { api } from './lib/api.js';
import SnapTradeImport from './SnapTradeImport.jsx';
import NotificationCentre from './components/NotificationCentre.jsx';
// KiteImport and BreezeImport decommissioned — integrations removed
import SetuAAImport from './SetuAAImport.jsx';

// ── Extracted modules ─────────────────────────────────────────────
import {
  fmt, fmtCr, fmtINR, fmtUSD, fmtPct,
  fmtCrINR, fmtCrUSD, fmtNative, fmtCrNative, ago, fmtSize,
  getVal, getInv, getValINR, getInvINR, getInvINRHist,
  getXIRR, isUSDHolding, getLiveUsdInr, setPpfRate, setEpfRate,
} from './utils.js';
import { AT, BF, BT, BG, BA, SEED } from './constants.js';
import './styles.css';

// ── Hooks ────────────────────────────────────────────────────────
import { usePortfolio } from './hooks/usePortfolio.js';
import { useImport } from './hooks/useImport.js';
import { useCASImport } from './hooks/useCASImport.js';
import { useAI } from './hooks/useAI.js';
import { useBrokerSearch } from './hooks/useBrokerSearch.js';
import { useUiState } from './hooks/useUiState.js';
import { useHoldingsView } from './hooks/useHoldingsView.js';
import { useAuth } from './hooks/useAuth.js';

// ── Tab components ───────────────────────────────────────────────
import OverviewTab from './features/overview/OverviewTab.jsx';
import { useOverviewState } from './features/overview/useOverviewState.js';
import { useHoldingActions } from './features/holdings/useHoldingActions.js';
import { useHoldingForm } from './features/holdings/useHoldingForm.js';
import HoldingFormModal from './features/holdings/HoldingFormModal.jsx';
import GoalFormModal from './features/goals/GoalFormModal.jsx';
import { useGoalForm } from './features/goals/useGoalForm.js';
import { useAlertForm } from './features/strategy/useAlertForm.js';
import AlertFormModal from './features/strategy/AlertFormModal.jsx';
import { useRebalanceState } from './features/strategy/useRebalanceState.js';
import { useMemberForm } from './features/members/useMemberForm.js';
import MemberFormModal from './features/members/MemberFormModal.jsx';
import { useCalendarState } from './features/calendar/useCalendarState.js';

// ── Shared components ────────────────────────────────────────────
import AppHeader from './components/shared/AppHeader.jsx';
import MobileNav from './components/shared/MobileNav.jsx';
import LoginScreen from './components/shared/LoginScreen.jsx';
import LoadingSkeleton from './components/shared/LoadingSkeleton.jsx';
import LiabilitiesPanel from './components/shared/LiabilitiesPanel.jsx';
import HoldingsPicker from './components/shared/HoldingsPicker.jsx';
import { Overlay, FG, MA } from './components/shared/Overlay.jsx';
import DonutChart from './components/shared/DonutChart.jsx';
import FmtInput from './components/shared/FmtInput.jsx';
import FDScanSheet from './components/shared/FDScanSheet.jsx';

// ── Modals ───────────────────────────────────────────────────────
import SettingsModal from './components/modals/SettingsModal.jsx';

// ── Context ──────────────────────────────────────────────────────
import { AppShellProvider } from './contexts/AppShellContext.jsx';
import { useMask } from './contexts/MaskContext.jsx';

// ── Error boundary ───────────────────────────────────────────────
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';

// ── PWA install prompt ───────────────────────────────────────────
import InstallPrompt from './components/shared/InstallPrompt.jsx';
import NotificationBell from './components/shared/NotificationBell.jsx';
import { usePushNotifications } from './hooks/usePushNotifications.js';
import ExportPanel from './components/shared/ExportPanel.jsx';
import { useToast } from './components/shared/Toast.jsx';
import { PRELOAD, TABS, BOTTOM_NAV_TABS, MORE_SHEET_TABS } from './appTabs.jsx';
import { usePortfolioDerived } from './hooks/usePortfolioDerived.js';
import { useAppActions } from './hooks/useAppActions.js';
import { advisorPortfolioContext, advisorSuggestedQuestions } from './features/advisor/advisorContext.js';
import AppMain from './AppMain.jsx';
import AppModals from './AppModals.jsx';

export default function App() {
  const toast = useToast();
  const { masked, toggleMask } = useMask();
  const [theme, setTheme] = useState(() => localStorage.getItem('wl-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('wl-theme', theme);
  }, [theme]);

  // ── Auth (src/hooks/useAuth.js) ──────────────────────────────────
  const { user, authLoading, authErr } = useAuth();

  // ── Cross-tab UI state ────────────────────────────────────────
  // tab/selMember stay owned here (P3-5) but are also exposed via
  // AppShellProvider below, reachable from any nested component via
  // useAppShell() without new prop drilling.
  const [tab,              setTab]              = useState('overview');
  const [selMember,        setSelMember]        = useState('all');
  // Modal/sheet/dropdown UI toggles now live in useUiState().

  // ── Holding / member form state ───────────────────────────────
  // Add/Edit Holding form state now lives in useHoldingForm() (P3-5).
  const { form, setForm, editHolding, setEditHolding } = useHoldingForm();
  // Add/Edit Member form state now lives in useMemberForm() (P3-5).
  const {
    newMember, setNewMember, editingMemberId, setEditingMemberId,
    memberAction, setMemberAction,
  } = useMemberForm();
  // Goals "Add/Edit" form state now lives in useGoalForm() (P3-5).
  const { goalForm, setGoalForm, editGoalId, setEditGoalId } = useGoalForm();
  // Strategy tab "Add Alert" form state now lives in useAlertForm() (P3-5).
  const { alertForm, setAlertForm } = useAlertForm();

  // ── Broker search state now lives in useBrokerSearch() (see below) ──

  // ── Misc state ────────────────────────────────────────────────
  // Holdings tab per-holding action state (Transaction/Artifact panels)
  // now lives in useHoldingActions() (P3-5).
  const {
    txnHolding, setTxnHolding, txnForm, setTxnForm,
    artifactHolding, setArtifactHolding,
  } = useHoldingActions();
  // Strategy tab rebalancing inputs now live in useRebalanceState() (P3-5).
  const {
    targetAlloc, setTargetAlloc, rebalMember, setRebalMember, rebalCash, setRebalCash,
  } = useRebalanceState();
  // Overview tab filters now live in useOverviewState() (P3-5).
  const { nwMember, setNwMember, bmPeriod, setBmPeriod } = useOverviewState();
  // Calendar tab's selected month now lives in useCalendarState() (P3-5).
  const { calMonth, setCalMonth } = useCalendarState();

  // ── Refs ──────────────────────────────────────────────────────
  const importFileRef    = useRef();
  const txnSaving        = useRef(false);
  const aiBottomRef      = useRef();

  // ── Hooks ─────────────────────────────────────────────────────
  const portfolio  = usePortfolio(user);
  const importHook = useImport(user, () => portfolio.reloadHoldings());
  const casImport  = useCASImport(user, () => portfolio.reloadHoldings());
  const ai         = useAI();
  const brokerSearch = useBrokerSearch();
  const {
    mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfNav,
    stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockInfo, etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfInfo,
    usSearch, setUsSearch, usResults, setUsResults, usSearching, usdInrRate, usdInrLoading, handleMfSearch, handleStockSearch, handleEtfSearch, handleUsSearch, fetchUsdInr,
  } = brokerSearch;
  const ui = useUiState();
  const {
    modal, setModal, fdScanOpen, setFdScanOpen, showSettings, setShowSettings,
    showImportHub, setShowImportHub, showSnapTrade, setShowSnapTrade, showSetuAA, setShowSetuAA,
    moreSheetOpen, setMoreSheetOpen,
    expandedHolding, setExpandedHolding, showQuietAlerts, setShowQuietAlerts,
  } = ui;
  const { filterType, setFilterType, sortCol, setSortCol, sortDir, setSortDir, toggleSort } = useHoldingsView();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showTradebook,   setShowTradebook]   = useState(false);
  const [showAuditLog,   setShowAuditLog]   = useState(false);

  // Reset sheet/expanded on tab change
  useEffect(() => {
    setMoreSheetOpen(false);
    setExpandedHolding(null);
  }, [tab, setMoreSheetOpen, setExpandedHolding]);

  const { supported: pushSupported, subscribed: pushSubscribed, loading: pushLoading, toggle: togglePush } = usePushNotifications();

  // ── Destructure hook state ────────────────────────────────────
  const {
    holdings, setHoldings, members, goals, alerts, liabilities, setLiabilities, loaded,
    syncSt, priceRefreshing, lastPriceRefresh, wealthSnapshots, benchmark, demoMode,
  } = portfolio;

  // Once the portfolio is on screen, quietly fetch the other tabs' code when the browser is idle.
  useEffect(() => {
    if (!loaded) return;
    const run = () => PRELOAD.forEach((T) => T.preload().catch(() => {}));   // a failed prefetch just retries on click
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(run, { timeout: 4000 }); return () => cancelIdleCallback(id); }
    const t = setTimeout(run, 2000);
    return () => clearTimeout(t);
  }, [loaded]);

  const { allHoldings, allMembers, visH, valINRCache, invINRCache, valNativeCache, invNativeCache, xirrCache, allCur, allInv, totCur, totInv, totGain, totPct, nriMetrics, byType, mSum, trigAlerts } = usePortfolioDerived({ selMember, filterType, holdings, members, alerts });

  // ── buildPortfolioContext (stays in App — depends on all memoized caches) ──
  function buildPortfolioContext() {
    return advisorPortfolioContext({ goals, allHoldings, allMembers, valINRCache, invINRCache, xirrCache, allCur, allInv, totPct, byType, trigAlerts });
  }

  // "💬 Ask the Advisor" bridge — ConcallPanel (and any future deeply-nested
  // panel) dispatches this event instead of needing onAskAdvisor prop-drilled
  // through HoldingsTab/holding-row components down to it. We own both
  // `tab`/`setTab` and the `ai` hook here, so this is the natural place to
  // switch tabs, pre-fill the question, and kick off the Advisor call.
  // Refs always point at this render's buildPortfolioContext/ai, so the listener
  // (registered once) never builds the advisor context from stale goals/alerts.
  const askAdvisorRef = useRef(null);
  askAdvisorRef.current = { ai, buildPortfolioContext };
  useEffect(() => {
    function handleAskAdvisor(e) {
      const question = e.detail?.question;
      if (!question) return;
      setTab('advisor');
      setTimeout(() => {
        const { ai: latestAi, buildPortfolioContext: build } = askAdvisorRef.current;
        latestAi.askAI(build(), aiBottomRef, question);
      }, 60);
    }
    window.addEventListener('wl:ask-advisor', handleAskAdvisor);
    return () => window.removeEventListener('wl:ask-advisor', handleAskAdvisor);
  }, [setTab]);

  // ── buildSuggestedQuestions — portfolio-state-aware advisor prompts ──────────
  function buildSuggestedQuestions() {
    return advisorSuggestedQuestions({ goals, allHoldings, allMembers, valINRCache, invINRCache, allCur, byType, trigAlerts });
  }

  // ── Shared helpers ────────────────────────────────────────────
  const { openMemberModal, editH, renewFD, handleImportSelect } = useAppActions({ setForm, setEditHolding, setNewMember, setEditingMemberId, casImport, setModal, setShowSnapTrade, setShowSetuAA, setShowTradebook, members });

  // ── Auth guards ───────────────────────────────────────────────
  if (authLoading) return <div className="splash">Loading…</div>;
  if (!user)       return <LoginScreen error={authErr} />;

  // ── Props bundle shared across most tabs ──────────────────────
  const sharedPortfolioProps = {
    holdings, allHoldings, allMembers, members, goals, alerts, liabilities, setLiabilities,
    loaded, demoMode, wealthSnapshots, benchmark, lastPriceRefresh,
    valINRCache, invINRCache, valNativeCache, invNativeCache, xirrCache,
    totCur, totInv, totGain, totPct, allCur, allInv, byType, mSum, trigAlerts,
    nriMetrics,
    fmt, fmtCr, fmtINR, fmtUSD, fmtCrINR, fmtCrUSD, fmtNative, fmtCrNative, fmtPct, ago, fmtSize,
    AT, BF, BT, BG, BA,
    DonutChart, Overlay, FG, MA, FmtInput,
    isUSDHolding, api,
    setModal, setShowSettings, setShowImportHub,
    exitDemoMode:  portfolio.exitDemoMode,
    loadDemoData:  () => portfolio.loadDemoData(SEED),
    refreshPrices: portfolio.refreshPrices,
    resetSnapshotHistory: portfolio.resetSnapshotHistory,
    deleteHolding: portfolio.deleteHolding,
    resolveFD:     portfolio.resolveFD,
    renewFD,
  };

  // ══════════════════════════════════════════════════════════════
  // AppShellProvider (P3-5, step 2): makes tab/selMember reachable via
  // useAppShell() for any nested component, without new prop drilling.
  // State ownership stays right here.
  return (
    <AppShellProvider value={{ tab, setTab, selMember, setSelMember }}>
    <div className="app">

      {/* ── Header / member bar / tab nav ───────────────────────
          Extracted to components/shared/AppHeader.jsx (P3-5, step 3).
          tab/selMember are read via useAppShell() inside it; everything else
          is passed as props. */}
      <AppHeader
        TABS={TABS}
        demoMode={demoMode} syncSt={syncSt}
        trigAlerts={trigAlerts} alerts={alerts} AT={AT}
        refreshPrices={portfolio.refreshPrices} priceRefreshing={priceRefreshing} lastPriceRefresh={lastPriceRefresh} ago={ago}
        setShowImportHub={setShowImportHub} api={api} masked={masked} toggleMask={toggleMask} setShowSettings={setShowSettings} signOut={signOut}
        allMembers={allMembers}
        NotificationBell={NotificationBell} ExportPanel={ExportPanel} NotificationCentre={NotificationCentre}
      />

      {/* ── MAIN CONTENT ───────────────────────────────────────── */}
      <AppMain {...{ user, tab, setTab, selMember, setSelMember, memberAction, setMemberAction, setGoalForm, setEditGoalId, setAlertForm, setTxnHolding, setTxnForm, setArtifactHolding, targetAlloc, setTargetAlloc, rebalMember, setRebalMember, rebalCash, setRebalCash, nwMember, setNwMember, bmPeriod, setBmPeriod, calMonth, setCalMonth, aiBottomRef, portfolio, ai, expandedHolding, setExpandedHolding, showQuietAlerts, setShowQuietAlerts, filterType, setFilterType, sortCol, setSortCol, sortDir, setSortDir, toggleSort, holdings, setHoldings, members, goals, alerts, loaded, visH, buildPortfolioContext, buildSuggestedQuestions, openMemberModal, editH, sharedPortfolioProps }} />

      {/* ── Mobile FAB / bottom nav / more sheet ────────────────
          Extracted to components/shared/MobileNav.jsx (P3-5, step 3).
          tab/setTab are read via useAppShell() inside it. */}
      <MobileNav
        BOTTOM_NAV_TABS={BOTTOM_NAV_TABS} MORE_SHEET_TABS={MORE_SHEET_TABS}
        setModal={setModal}
        moreSheetOpen={moreSheetOpen} setMoreSheetOpen={setMoreSheetOpen}
        setShowImportHub={setShowImportHub} masked={masked} toggleMask={toggleMask} setShowSettings={setShowSettings}
        confirmSignOut={confirmSignOut} setConfirmSignOut={setConfirmSignOut} signOut={signOut}
      />

      {/* ══════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════ */}

      <AppModals {...{ toast, theme, setTheme, user, setSelMember, form, setForm, editHolding, setEditHolding, newMember, setNewMember, editingMemberId, setEditingMemberId, goalForm, setGoalForm, editGoalId, setEditGoalId, alertForm, setAlertForm, txnHolding, setTxnHolding, txnForm, setTxnForm, artifactHolding, setArtifactHolding, importFileRef, txnSaving, portfolio, importHook, casImport, mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfNav, stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockInfo, etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfInfo, usSearch, setUsSearch, usResults, setUsResults, usSearching, usdInrRate, usdInrLoading, handleMfSearch, handleStockSearch, handleEtfSearch, handleUsSearch, fetchUsdInr, modal, setModal, fdScanOpen, setFdScanOpen, showSettings, setShowSettings, showImportHub, setShowImportHub, showSnapTrade, setShowSnapTrade, showSetuAA, setShowSetuAA, confirmSignOut, setConfirmSignOut, showTradebook, setShowTradebook, showAuditLog, setShowAuditLog, pushSupported, pushSubscribed, pushLoading, togglePush, setHoldings, members, goals, allHoldings, valINRCache, allCur, allInv, handleImportSelect }} />

      {/* ── PWA install prompt ───────────────────────────────────── */}
      <InstallPrompt />

    </div>
    </AppShellProvider>
  );
}
