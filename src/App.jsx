import { useState, useEffect, useRef, useMemo } from 'react';
import {
  LayoutDashboard, BarChart2, Target, Compass,
  Users, Wallet, CalendarDays, MessageSquare,
  X,
  AlertTriangle, Receipt, Bookmark, PieChart,
  Newspaper, TrendingUp,
} from 'lucide-react';
import { supabase, signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword, signOut } from './supabase.js';
import { api } from './lib/api.js';
import SnapTradeImport from './SnapTradeImport.jsx';
import NotificationCentre from './components/notifications/NotificationCentre.jsx';
// KiteImport and BreezeImport decommissioned — integrations removed
import SetuAAImport from './SetuAAImport.jsx';

// ── Extracted modules ─────────────────────────────────────────────
import {
  fmt, fmtCr, fmtINR, fmtUSD, fmtPct,
  fmtCrINR, fmtCrUSD, fmtNative, fmtCrNative, fmtSec, fmtCrSec,
  uid, ago, fmtSize,
  getVal, getInv, getValINR, getInvINR, getInvINRHist,
  xirr, getXIRR, isUSDHolding, toINR, toUSD, fxFor,
  calcFD, calcAccr, setLiveUsdInr, getLiveUsdInr, setPpfRate, setEpfRate,
} from './utils.js';
import { AT, BF, BT, BG, BA, SEED } from './constants.js';
import './styles.css';

// ── Hooks ────────────────────────────────────────────────────────
import { usePortfolio } from './hooks/usePortfolio.js';
import { useBudget } from './hooks/useBudget.js';
import { useBudget2 } from './hooks/useBudget2.js';
import { useImport } from './hooks/useImport.js';
import { useCASImport } from './hooks/useCASImport.js';
import { useAI } from './hooks/useAI.js';
import { useBrokerSearch } from './hooks/useBrokerSearch.js';
import { useUiState } from './hooks/useUiState.js';
import { useGmailStatus } from './hooks/useGmailStatus.js';
import { useHoldingsView } from './hooks/useHoldingsView.js';
import { useAuth } from './hooks/useAuth.js';

// ── Tab components ───────────────────────────────────────────────
import OverviewTab from './features/overview/OverviewTab.jsx';
import { useOverviewState } from './features/overview/useOverviewState.js';
import HoldingsTab from './features/holdings/HoldingsTab.jsx';
import { useHoldingActions } from './features/holdings/useHoldingActions.js';
import { useHoldingForm } from './features/holdings/useHoldingForm.js';
import HoldingFormModal from './features/holdings/HoldingFormModal.jsx';
import GoalsTab from './features/goals/GoalsTab.jsx';
import GoalFormModal from './features/goals/GoalFormModal.jsx';
import { useGoalForm } from './features/goals/useGoalForm.js';
import StrategyTab from './features/strategy/StrategyTab.jsx';
import { useAlertForm } from './features/strategy/useAlertForm.js';
import AlertFormModal from './features/strategy/AlertFormModal.jsx';
import { useRebalanceState } from './features/strategy/useRebalanceState.js';
import MembersTab from './features/members/MembersTab.jsx';
import { useMemberForm } from './features/members/useMemberForm.js';
import MemberFormModal from './features/members/MemberFormModal.jsx';
import BudgetTab from './features/budget/BudgetTab.jsx';
import Budget2Tab from './features/budget/Budget2Tab.jsx';
import FamilyBudgetTab from './features/budget/FamilyBudgetTab.jsx';
import CalendarTab from './features/calendar/CalendarTab.jsx';
import { useCalendarState } from './features/calendar/useCalendarState.js';
import AdvisorTab from './features/advisor/AdvisorTab.jsx';
import TaxTab from './features/tax/TaxTab.jsx';
import WatchlistTab from './features/watchlist/WatchlistTab.jsx';
import NewsTab      from './features/news/NewsTab.jsx';
import AuditLogPanel from './features/audit/AuditLogPanel.jsx';

// ── Shared components ────────────────────────────────────────────
import AppHeader from './components/shared/AppHeader.jsx';
import MobileNav from './components/shared/MobileNav.jsx';
import LoginScreen from './components/shared/LoginScreen.jsx';
import LoadingSkeleton from './components/shared/LoadingSkeleton.jsx';
import LiabilitiesPanel from './components/shared/LiabilitiesPanel.jsx';
import HoldingsPicker from './components/shared/HoldingsPicker.jsx';
import TransactionPanel from './components/shared/TransactionPanel.jsx';
import ArtifactPanel from './components/shared/ArtifactPanel.jsx';
import { Overlay, FG, MA } from './components/shared/Overlay.jsx';
import CASImportModal from './components/modals/CASImportModal.jsx';
import DonutChart from './components/shared/DonutChart.jsx';
import FmtInput from './components/shared/FmtInput.jsx';
import FDScanSheet from './components/shared/FDScanSheet.jsx';

// ── Modals ───────────────────────────────────────────────────────
import GoalPlanModal from './components/modals/GoalPlanModal.jsx';
import ImportModal from './components/modals/ImportModal.jsx';
import ImportHub from './components/modals/ImportHub.jsx';
import SettingsModal from './components/modals/SettingsModal.jsx';

// ── Context ──────────────────────────────────────────────────────
import { PortfolioProvider } from './contexts/PortfolioContext.jsx';
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

// ── API helper imported from lib/api.js (see top imports) ────────

const TABS = [
  { key: 'overview',  label: 'Overview',  Icon: LayoutDashboard },
  { key: 'holdings',  label: 'Holdings',  Icon: BarChart2 },
  { key: 'goals',     label: 'Goals',     Icon: Target },
  { key: 'strategy',  label: 'Strategy',  Icon: Compass },
  { key: 'members',   label: 'Family',    Icon: Users },
  // { key: 'budget',    label: 'Budget',    Icon: Wallet },   // hidden — using Family Budget
  // { key: 'budget2',   label: 'Budget 2',  Icon: PieChart }, // hidden — using Family Budget
  { key: 'familybudget', label: 'Family Budget', Icon: TrendingUp },
  { key: 'calendar',  label: 'Calendar',  Icon: CalendarDays },
  // { key: 'tax',       label: 'Tax',       Icon: Receipt },       // hidden — not actively used
  // { key: 'watchlist', label: 'Watchlist', Icon: Bookmark },      // hidden — not actively used
  { key: 'advisor',   label: 'Advisor',   Icon: MessageSquare },
  { key: 'news',      label: 'News',      Icon: Newspaper },
];

// Mobile bottom nav: 4 highest-value tabs — rest go into ··· more sheet
const BOTTOM_NAV_KEYS = ['overview', 'holdings', 'familybudget', 'advisor'];
const BOTTOM_NAV_TABS = BOTTOM_NAV_KEYS.map(k => TABS.find(t => t.key === k));
const MORE_SHEET_TABS = TABS.filter(t => !BOTTOM_NAV_KEYS.includes(t.key));

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
  const budget     = useBudget(user);
  const budget2    = useBudget2(user);
  const importHook = useImport(user, () => portfolio.reloadHoldings());
  const casImport  = useCASImport(user, () => portfolio.reloadHoldings());
  const ai         = useAI();
  const brokerSearch = useBrokerSearch();
  const {
    mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfSearching, mfNav, setMfNav,
    stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockSearching,
    stockInfo, setStockInfo, stockLooking, setStockLooking,
    etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfSearching, etfInfo, setEtfInfo,
    usSearch, setUsSearch, usResults, setUsResults, usSearching, setUsSearching,
    usdInrRate, setUsdInrRate, usdInrLoading, setUsdInrLoading,
    handleMfSearch, handleStockSearch, handleEtfSearch, handleUsSearch, fetchUsdInr,
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
  const [showAuditLog,   setShowAuditLog]   = useState(false);

  // Reset sheet/expanded on tab change
  useEffect(() => {
    setMoreSheetOpen(false);
    setExpandedHolding(null);
  }, [tab]);

  const { supported: pushSupported, subscribed: pushSubscribed, loading: pushLoading, toggle: togglePush } = usePushNotifications();

  // Gmail status now lives in useGmailStatus() (P3-5) — auto-refetches
  // whenever the Settings panel (showSettings) opens.
  const {
    gmailStatus, setGmailStatus, gmailLoading, setGmailLoading,
    gmailChecking, setGmailChecking, fetchGmailStatus,
  } = useGmailStatus(showSettings);

  // Handle OAuth callback params (?gmail_connected=1 or ?gmail_error=...)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('gmail_connected')) {
      window.history.replaceState({}, '', window.location.pathname);
      setShowSettings(true);
      fetchGmailStatus();
    }
    if (p.has('gmail_error')) {
      window.history.replaceState({}, '', window.location.pathname);
      toast.error(`Gmail connection failed: ${p.get('gmail_error')}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Destructure hook state ────────────────────────────────────
  const {
    holdings, setHoldings, members, goals, alerts, liabilities, setLiabilities, loaded,
    assetTypes, syncSt, priceRefreshing, lastPriceRefresh, priceCount,
    profile, wealthSnapshots, benchmark, demoMode,
  } = portfolio;

  // ── Computed / memoized values ────────────────────────────────

  const allHoldings = holdings;
  const allMembers  = members;

  // Member-scoped only — drives Overview, Goals, Calendar, Health Score, etc.
  // Not affected by the Holdings type filter.
  const memberH = useMemo(() =>
    selMember === 'all' ? allHoldings : allHoldings.filter(h => h.member_id === selMember),
    [allHoldings, selMember]
  );

  // Type-filtered on top of memberH — used exclusively by HoldingsTab grid.
  const visH = useMemo(() => {
    if (filterType === 'ALL') return memberH;
    return memberH.filter(h => h.type === filterType);
  }, [memberH, filterType]);

  const valINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getValINR(h));
    return m;
  }, [allHoldings]);

  const invINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInvINR(h));
    return m;
  }, [allHoldings]);

  const valNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getVal(h));
    return m;
  }, [allHoldings]);

  const invNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInv(h));
    return m;
  }, [allHoldings]);

  const xirrCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getXIRR(h));
    return m;
  }, [allHoldings]);

  const allCur = useMemo(
    () => allHoldings.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0),
    [allHoldings, valINRCache]
  );
  // allInv excludes holdings with unknown cost basis (null) — prevents gain % distortion
  const allInv = useMemo(
    () => allHoldings.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null ? s : s+v; }, 0),
    [allHoldings, invINRCache]
  );

  // totCur/totInv are member-scoped but NOT type-filtered — Overview always shows the full member picture.
  const totCur  = useMemo(() => memberH.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0), [memberH, valINRCache]);
  const totInv  = useMemo(() => memberH.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null ? s : s+v; }, 0), [memberH, invINRCache]);
  const totGain = totCur - totInv;
  const totPct  = totInv > 0 ? ((totCur - totInv) / totInv) * 100 : 0;

  // ── NRI split: Indian (₹ native) vs US ($ native) ────────────────
  const nriMetrics = useMemo(() => {
    const liveRate = getLiveUsdInr();
    let india_cur = 0, india_inv = 0;
    let us_cur = 0,    us_inv = 0;
    let us_inv_hist_inr = 0; // US invested at purchase-time rate (for FX impact)
    for (const h of memberH) {
      const natVal = valNativeCache.get(h.id) || 0;
      const natInv = invNativeCache.get(h.id); // may be null
      if (isUSDHolding(h)) {
        us_cur += natVal;
        if (natInv != null) us_inv += natInv;
        const hist = getInvINRHist(h);
        if (hist != null) us_inv_hist_inr += hist;
      } else {
        india_cur += natVal;
        if (natInv != null) india_inv += natInv;
      }
    }
    const india_gain = india_cur - india_inv;
    const india_pct  = india_inv > 0 ? (india_gain / india_inv) * 100 : 0;
    const us_gain    = us_cur - us_inv;
    const us_pct     = us_inv > 0 ? (us_gain / us_inv) * 100 : 0;
    // Combined in ₹ (US converted at live rate — pure price gain, no FX noise)
    const combined_cur  = india_cur + us_cur * liveRate;
    const combined_inv  = india_inv + us_inv * liveRate;
    const combined_gain = combined_cur - combined_inv;
    const combined_pct  = combined_inv > 0 ? (combined_gain / combined_inv) * 100 : 0;
    // FX impact = what exchange-rate movement added/removed on US invested amount
    const fx_gain = us_inv * liveRate - us_inv_hist_inr;
    return {
      india_cur, india_inv, india_gain, india_pct,
      us_cur,    us_inv,    us_gain,    us_pct,
      combined_cur, combined_inv, combined_gain, combined_pct,
      fx_gain, liveRate,
    };
  }, [memberH, valNativeCache, invNativeCache]);

  const byType = useMemo(() => {
    const map = {};
    for (const h of memberH) {
      if (!map[h.type]) map[h.type] = { cur: 0, inv: 0, count: 0 };
      map[h.type].cur   += valINRCache.get(h.id) || 0;
      map[h.type].inv   += invINRCache.get(h.id) || 0;
      map[h.type].count += 1;
    }
    const total = Object.values(map).reduce((s, v) => s + v.cur, 0);
    return Object.entries(map)
      .map(([t, v]) => ({ t, v: v.cur, i: v.inv, count: v.count, pct: total > 0 ? (v.cur / total) * 100 : 0 }))
      .sort((a, b) => b.v - a.v);
  }, [memberH, valINRCache, invINRCache]);

  const mSum = useMemo(() =>
    allMembers.map(m => {
      const mh  = allHoldings.filter(h => h.member_id === m.id);
      const cur = mh.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
      const inv = mh.reduce((s, h) => s + (invINRCache.get(h.id) || 0), 0);
      const pct = inv > 0 ? ((cur - inv) / inv) * 100 : 0;
      return { ...m, cur, inv, gain: cur - inv, pct };
    }),
    [allMembers, allHoldings, valINRCache, invINRCache]
  );

  const trigAlerts = useMemo(() => {
    const triggered = [];
    // Derive current USD/INR rate from any USD holding
    const usdInrRate = allHoldings.find(h => (h.usd_inr_rate || 0) > 0)?.usd_inr_rate || 0;
    for (const a of alerts) {
      if (!a.active) continue;
      if (a.type === 'RETURN_TARGET') {
        if (totPct < a.threshold) triggered.push(a);
      } else if (a.type === 'USD_INR_RATE') {
        if (usdInrRate > 0 && usdInrRate > +a.threshold) triggered.push(a);
      } else if (a.type === 'HOLDING_PRICE' || a.type === 'HOLDING_RETURN') {
        const h = allHoldings.find(hh => hh.id === a.holdingId);
        if (!h) continue;
        if (a.type === 'HOLDING_PRICE') {
          const price = Number(h.current_price || h.current_nav || 0);
          if (a.direction === 'above' && price > +a.threshold) triggered.push(a);
          if (a.direction === 'below' && price > 0 && price < +a.threshold) triggered.push(a);
        } else {
          const cur = valINRCache.get(h.id) || 0;
          const inv = invINRCache.get(h.id) || 0;
          if (inv <= 0) continue;
          const ret = ((cur - inv) / inv) * 100;
          if (a.direction === 'above' && ret > +a.threshold) triggered.push(a);
          if (a.direction === 'below' && ret < +a.threshold) triggered.push(a);
        }
      } else {
        const typeVal = allHoldings
          .filter(h => h.type === a.assetType)
          .reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
        const pct = allCur > 0 ? (typeVal / allCur) * 100 : 0;
        if (a.type === 'ALLOCATION_DRIFT' && pct > a.threshold) triggered.push(a);
        if (a.type === 'CONCENTRATION'    && pct < a.threshold) triggered.push(a);
      }
    }
    return triggered;
  }, [alerts, allHoldings, allCur, totPct, valINRCache, invINRCache]);

  // ── buildPortfolioContext (stays in App — depends on all memoized caches) ──
  function buildPortfolioContext() {
    const sorted = [...allHoldings]
      .sort((a, b) => (valINRCache.get(b.id) || 0) - (valINRCache.get(a.id) || 0));
    const topH  = sorted.slice(0, 20);
    const restH = sorted.slice(20);          // all holdings beyond top-20
    const memberNames = Object.fromEntries(allMembers.map(m => [m.id, m.name]));

    // Top-20: full detail including XIRR
    const holdingsText = topH.map(h => {
      const cur = valINRCache.get(h.id) || 0;
      const inv = invINRCache.get(h.id) || 0;
      const xi  = xirrCache.get(h.id);
      const pct = inv > 0 ? (((cur - inv) / inv) * 100).toFixed(1) : '0';
      const xirrStr = xi?.value != null ? ` | XIRR: ${xi.value.toFixed(1)}% (${xi.method})` : '';
      return `  - ${h.name} (${AT[h.type]?.label || h.type}): current=${fmtCrINR(cur)}, invested=${fmtCrINR(inv)}, gain=${pct}%${xirrStr} [${memberNames[h.member_id] || 'Unassigned'}]`;
    }).join('\n');

    // Holdings 21+: compact one-liner per holding so AI is aware they exist
    const restText = restH.length > 0
      ? '\n\nADDITIONAL HOLDINGS (compact — use get_holdings tool for detail):\n' +
        restH.map(h => {
          const cur = valINRCache.get(h.id) || 0;
          const inv = invINRCache.get(h.id) || 0;
          const pct = inv > 0 ? (((cur - inv) / inv) * 100).toFixed(1) : '?';
          const ticker = h.ticker || h.scheme_code || '';
          return `  ${h.name}${ticker ? ` [${ticker}]` : ''} | ${AT[h.type]?.label || h.type} | ${fmtCrINR(cur)} | ${pct}% gain | ${memberNames[h.member_id] || 'Unassigned'}`;
        }).join('\n')
      : '';

    const byTypeText = byType
      .map(row => `  ${AT[row.t]?.label || row.t}: ${fmtCrINR(row.v)} (${allCur > 0 ? ((row.v / allCur) * 100).toFixed(1) : 0}%)`)
      .join('\n');
    const goalsText = goals.map(g => `  - ${g.name}: target=${fmtCrINR(g.targetAmount)}, by ${g.targetDate}`).join('\n');
    const alertsText = trigAlerts.length > 0
      ? trigAlerts.map(a => `  - ${a.label || a.type}: threshold=${a.threshold}%`).join('\n')
      : '  None triggered';

    return `PORTFOLIO SUMMARY (${new Date().toLocaleDateString('en-IN')})
Total Value: ${fmtCrINR(allCur)} | Invested: ${fmtCrINR(allInv)} | Gain: ${totPct.toFixed(1)}%
Members: ${allMembers.map(m => m.name).join(', ')} | Total holdings: ${allHoldings.length}

HOLDINGS — top 20 by value (full detail):
${holdingsText}${restText}

ALLOCATION BY TYPE:
${byTypeText}

GOALS:
${goalsText || '  None set'}

TRIGGERED ALERTS:
${alertsText}`;
  }

  // ── buildSuggestedQuestions — portfolio-state-aware advisor prompts ──────────
  function buildSuggestedQuestions() {
    const questions = [];

    // ── Always-on anchors ──────────────────────────────────────────────────────
    questions.push("What is my total portfolio value and overall return?");
    questions.push("Which is my largest single holding?");

    // ── Triggered alerts ───────────────────────────────────────────────────────
    if (trigAlerts.length > 0) {
      questions.push(`I have ${trigAlerts.length} triggered alert${trigAlerts.length > 1 ? 's' : ''} — what should I do?`);
    }

    // ── Goals ─────────────────────────────────────────────────────────────────
    if (goals.length > 0) {
      // Find the goal closest to its deadline
      const upcoming = [...goals]
        .filter(g => g.targetDate)
        .sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate))[0];
      if (upcoming) {
        questions.push(`How far am I from my "${upcoming.name}" goal?`);
      } else {
        questions.push("How far am I from my financial goals?");
      }
    }

    // ── Family members ────────────────────────────────────────────────────────
    if (allMembers.length >= 2) {
      const [m1, m2] = allMembers;
      questions.push(`Compare ${m1.name}'s and ${m2.name}'s portfolios.`);
    }

    // ── Allocation insights ───────────────────────────────────────────────────
    const equityTypes = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF", "MF"]);
    const equityVal   = byType.filter(r => equityTypes.has(r.t)).reduce((s, r) => s + r.v, 0);
    const equityPct   = allCur > 0 ? (equityVal / allCur) * 100 : 0;
    if (equityPct > 75) {
      questions.push(`${equityPct.toFixed(0)}% of my portfolio is in equity — am I over-exposed?`);
    } else if (equityPct < 30 && allCur > 0) {
      questions.push("My equity exposure seems low — should I rebalance?");
    }

    // ── Underperformers ───────────────────────────────────────────────────────
    const losers = allHoldings.filter(h => {
      const cur = valINRCache.get(h.id) || 0;
      const inv = invINRCache.get(h.id) || 0;
      return inv > 0 && cur < inv;
    });
    if (losers.length > 0) {
      const biggest = losers.sort((a, b) => {
        const ga = (valINRCache.get(a.id) || 0) - (invINRCache.get(a.id) || 0);
        const gb = (valINRCache.get(b.id) || 0) - (invINRCache.get(b.id) || 0);
        return ga - gb;
      })[0];
      questions.push(`Should I exit or hold ${biggest.name} which is at a loss?`);
    }

    // ── Asset-type specific ───────────────────────────────────────────────────
    const hasFD     = allHoldings.some(h => h.type === "FD");
    const hasCrypto = allHoldings.some(h => h.type === "CRYPTO");
    const hasMF     = allHoldings.some(h => h.type === "MF");
    const hasUS     = allHoldings.some(h => ["US_STOCK", "US_ETF"].includes(h.type));

    if (hasFD)     questions.push("When do my FDs mature and should I reinvest them?");
    if (hasCrypto) questions.push("What percentage of my portfolio is in crypto and is it too much?");
    if (hasMF)     questions.push("Which mutual fund has the best XIRR?");
    if (hasUS)     questions.push("How is my US portfolio performing vs my Indian holdings?");

    // ── Tax window (Jan–Mar is tax harvesting season) ────────────────────────
    const month = new Date().getMonth() + 1;
    if (month >= 1 && month <= 3) {
      questions.push("It's tax season — which holdings should I sell to harvest losses?");
    }

    // Return up to 8, prioritising the dynamic ones over static fallbacks
    return questions.slice(0, 8);
  }

  // ── Shared helpers ────────────────────────────────────────────
  function openMemberModal(memberId) {
    if (memberId) {
      const m = members.find(x => x.id === memberId);
      setNewMember({
        name: m?.name || '', relation: m?.relation || '',
        pan: '', pan_masked: m?.pan_masked || '',
        dob: m?.dob || '', email: m?.email || '',
        nominee_name: m?.nominee_name || '', nominee_relation: m?.nominee_relation || '',
      });
      setEditingMemberId(memberId);
    } else {
      setNewMember({ name: '', relation: '', dob: '', email: '', nominee_name: '', nominee_relation: '' });
      setEditingMemberId(null);
    }
    setModal('member');
  }

  function editH(h) {
    setForm({
      member_id:      h.member_id      || '',
      type:           h.type           || 'US_STOCK',
      name:           h.name           || '',
      ticker:         h.ticker         || '',
      scheme_code:    h.scheme_code    || '',
      interest_rate:  h.interest_rate  || '',
      start_date:     h.start_date     || '',
      maturity_date:  h.maturity_date  || '',
      maturity_amount: h.maturity_amount || '',
      purchase_value: h.purchase_value || '',
      current_value:  h.current_value  || '',
      principal:          h.principal          || '',
      usd_inr_rate:       h.usd_inr_rate       || '',
      currency:           h.currency           || 'INR',
      policy_type:        h.policy_type        || 'TERM',
      sum_assured:        h.sum_assured        || '',
      premium:            h.premium            || '',
      premium_frequency:  h.premium_frequency  || 'ANNUAL',
    });
    setEditHolding(h);
    setModal('add');
  }

  // Renew a matured FD: same row, next term. Proceeds become the new principal,
  // the old maturity date becomes the new start date; user fills rate + new maturity.
  function renewFD(h, maturityValue) {
    editH(h);
    setForm(p => ({
      ...p,
      principal:       String(Math.round(maturityValue || h.principal || 0)),
      start_date:      h.maturity_date || p.start_date,
      maturity_date:   '',
      maturity_amount: '',
      maturity_status: 'active',
    }));
  }

  // ── Broker search handlers ────────────────────────────────────
  // Broker-search handlers now provided by useBrokerSearch().

  // Map an ImportHub selection to the matching flow.
  function handleImportSelect(key) {
    switch (key) {
      case 'cas':       casImport.setCasModal(true); break;
      case 'fd':        setForm(p => ({ ...p, type: 'FD' })); setModal('add'); break;
      case 'snaptrade': setShowSnapTrade(true); break;
      case 'csv':       setModal('import'); break;
      case 'manual':    setModal('add'); break;
      case 'setu':      setShowSetuAA(true); break;
      default: break;
    }
  }

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
  // State ownership stays right here — same pattern as PortfolioProvider.
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
      <main className="main">
      <PortfolioProvider value={sharedPortfolioProps}>

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

        {loaded && tab === 'budget' && (
          <ErrorBoundary tab="Budget">
            <BudgetTab
              {...budget}
              allCur={allCur} allInv={allInv} totInv={totInv} totPct={totPct}
              sipHoldings={allHoldings.filter(h=>h.type==='MF').slice(0,5).map(h=>({id:h.id,name:h.name}))}
              allMembers={allMembers}
              fmtCr={fmtCr} fmtPct={fmtPct}
              api={api} FG={FG} MA={MA} Overlay={Overlay}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'budget2' && (
          <ErrorBoundary tab="Budget 2">
            <Budget2Tab
              {...budget2}
              api={api}
              Overlay={Overlay}
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

        {loaded && tab === 'tax' && (
          <ErrorBoundary tab="Tax">
            <TaxTab
              members={members}
              selMember={selMember}
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'watchlist' && (
          <ErrorBoundary tab="Watchlist">
            <WatchlistTab />
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

      </PortfolioProvider>
      </main>

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

      {/* ── Add / Edit Holding (+ FD Certificate Scanner) ───────────
          Extracted to features/holdings/HoldingFormModal.jsx (P3-5, step 3).
          State (form, editHolding, broker-search state, fdScanOpen, modal) all
          stays here and is passed in as props — markup-only extraction. */}
      <HoldingFormModal
        modal={modal} setModal={setModal}
        form={form} setForm={setForm} editHolding={editHolding} setEditHolding={setEditHolding}
        members={members} AT={AT}
        mfSearch={mfSearch} setMfSearch={setMfSearch} mfResults={mfResults} setMfResults={setMfResults}
        mfSearching={mfSearching} setMfNav={setMfNav} handleMfSearch={handleMfSearch}
        stockSearch={stockSearch} setStockSearch={setStockSearch} stockResults={stockResults} setStockResults={setStockResults}
        stockSearching={stockSearching} setStockInfo={setStockInfo} handleStockSearch={handleStockSearch}
        etfSearch={etfSearch} setEtfSearch={setEtfSearch} etfResults={etfResults} setEtfResults={setEtfResults}
        etfSearching={etfSearching} setEtfInfo={setEtfInfo} handleEtfSearch={handleEtfSearch}
        usSearch={usSearch} setUsSearch={setUsSearch} usResults={usResults} setUsResults={setUsResults}
        usSearching={usSearching} handleUsSearch={handleUsSearch}
        usdInrRate={usdInrRate} usdInrLoading={usdInrLoading} fetchUsdInr={fetchUsdInr}
        fdScanOpen={fdScanOpen} setFdScanOpen={setFdScanOpen}
        saveHolding={portfolio.saveHolding} api={api}
        Overlay={Overlay} FG={FG} MA={MA} FmtInput={FmtInput} FDScanSheet={FDScanSheet}
      />

      {/* ── Add / Edit Goal ─────────────────────────────────────── */}
      {/* Markup extracted to features/goals/GoalFormModal.jsx (P3-5); form state
          (goalForm, editGoalId) now lives in useGoalForm() (P3-5). `modal` visibility
          stays in useUiState(), shared across all modals. */}
      <GoalFormModal
        modal={modal} setModal={setModal}
        goalForm={goalForm} setGoalForm={setGoalForm}
        editGoalId={editGoalId} setEditGoalId={setEditGoalId}
        members={members} AT={AT} allHoldings={allHoldings} valINRCache={valINRCache} goals={goals}
        addGoal={portfolio.addGoal}
        Overlay={Overlay} FG={FG} MA={MA} FmtInput={FmtInput} HoldingsPicker={HoldingsPicker}
      />

      {/* ── Add Alert ────────────────────────────────────────────
          Extracted to features/strategy/AlertFormModal.jsx (P3-5, step 3). */}
      <AlertFormModal
        modal={modal} setModal={setModal}
        alertForm={alertForm} setAlertForm={setAlertForm}
        AT={AT}
        addAlert={portfolio.addAlert}
        Overlay={Overlay} FG={FG} MA={MA}
      />

      {/* ── Add / Edit Member ────────────────────────────────────
          Extracted to features/members/MemberFormModal.jsx (P3-5, step 3). */}
      <MemberFormModal
        modal={modal} setModal={setModal}
        newMember={newMember} setNewMember={setNewMember}
        editingMemberId={editingMemberId} setEditingMemberId={setEditingMemberId}
        members={members}
        saveMember={portfolio.saveMember}
        Overlay={Overlay} FG={FG} MA={MA}
      />

      {/* ── Audit Log ───────────────────────────────────────────── */}
      {showAuditLog && (
        <AuditLogPanel onClose={() => setShowAuditLog(false)} api={api} />
      )}

      {/* ── Settings ─────────────────────────────────────────────
          Extracted to components/modals/SettingsModal.jsx (P3-5, step 3). */}
      <SettingsModal
        showSettings={showSettings} setShowSettings={setShowSettings}
        user={user} signOut={signOut}
        setShowImportHub={setShowImportHub} setShowAuditLog={setShowAuditLog}
        theme={theme} setTheme={setTheme}
        portfolio={portfolio} api={api} setPpfRate={setPpfRate} setEpfRate={setEpfRate}
        gmailStatus={gmailStatus} setGmailStatus={setGmailStatus}
        gmailLoading={gmailLoading} setGmailLoading={setGmailLoading}
        gmailChecking={gmailChecking} setGmailChecking={setGmailChecking}
        fetchGmailStatus={fetchGmailStatus}
        pushSupported={pushSupported} pushSubscribed={pushSubscribed} pushLoading={pushLoading} togglePush={togglePush}
        confirmSignOut={confirmSignOut} setConfirmSignOut={setConfirmSignOut}
        toast={toast}
        Overlay={Overlay}
      />

      {/* ── Import Hub ───────────────────────────────────────────── */}
      {showImportHub && (
        <ImportHub onClose={() => setShowImportHub(false)} onSelect={handleImportSelect} api={api} />
      )}

      {/* ── CAS Import modal ─────────────────────────────────────── */}
      {casImport.casModal && (
        <CASImportModal
          casImport={casImport}
          members={members}
          onClose={() => { casImport.resetCASDownloader(); }}
          onPriceRefresh={() => portfolio.refreshPrices?.()}
        />
      )}

      {/* ── Setu Account Aggregator Import ─────────────────────── */}
      {showSetuAA && (
        <Overlay onClose={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }} wide>
          <SetuAAImport
            mode="wealth"
            members={members}
            api={async (url, opts = {}) => {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error || 'Request failed');
              return d;
            }}
            onClose={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }}
            onImported={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }}
          />
        </Overlay>
      )}

      {/* ── SnapTrade Import ─────────────────────────────────────── */}
      {showSnapTrade && (
        <Overlay onClose={() => { portfolio.reloadHoldings(); setSelMember('all'); setShowSnapTrade(false); }} wide>
          <SnapTradeImport
            onClose={() => { portfolio.reloadHoldings(); setSelMember('all'); setShowSnapTrade(false); }}
            members={members}
          />
        </Overlay>
      )}

      {/* ── Import modal ─────────────────────────────────────────── */}
      {(modal === 'import') && (
        <ImportModal
          importState={importHook.importState}
          setImportState={importHook.setImportState}
          members={members}
          AT={AT}
          handleImportFile={file => importHook.handleImportFile(file, null, members)}
          executeImport={() => importHook.executeImport(members)}
          resetImport={importHook.resetImport}
          importFileRef={importFileRef}
          onClose={() => { importHook.resetImport(); setModal(null); }}
          fmt={fmt}
          submitCASPassword={() => importHook.submitCASPassword(members)}
        />
      )}

      {/* ── Goal Plan modal ─────────────────────────────────────── */}
      {modal === 'goalplan' && (
        <GoalPlanModal
          open
          onClose={() => setModal(null)}
          goals={goals}
          members={members}
          holdings={allHoldings}
          allCur={allCur}
          allInv={allInv}
          AT={AT}
          getValINR={getValINR}
          usdInr={usdInrRate}
        />
      )}

      {/* ── Transaction panel ────────────────────────────────────── */}
      {txnHolding && (
        <TransactionPanel
          holding={txnHolding}
          txnForm={txnForm}
          setTxnForm={setTxnForm}
          onAddTxn={() => portfolio.addTransaction(txnForm, null, null, txnHolding, txnSaving)
            .then(res => { if (res?.hlds) setTxnForm(BT); })}
          onDeleteTxn={(txnId, holdingId) => portfolio.deleteTransaction(txnId, holdingId)}
          onReload={portfolio.reloadHoldings}
          onClose={() => setTxnHolding(null)}
          fxRate={usdInrRate}
          fxLoading={usdInrLoading}
          onFetchFx={fetchUsdInr}
        />
      )}

      {/* ── Artifact panel ───────────────────────────────────────── */}
      {artifactHolding && (
        <ArtifactPanel
          holding={artifactHolding}
          token={null}
          onClose={() => setArtifactHolding(null)}
        />
      )}

      {/* old inline CAS + broker overlays removed — now handled by CASImportModal and Import Hub above */}

      {/* ── Hidden file input for import ─────────────────────────── */}
      <input ref={importFileRef} type="file" style={{display:'none'}} accept=".csv,.xlsx,.xls,.pdf"
        onChange={e => importHook.handleImportFile(e.target.files[0], null, members)}/>

      {/* ── PWA install prompt ───────────────────────────────────── */}
      <InstallPrompt />

    </div>
    </AppShellProvider>
  );
}
