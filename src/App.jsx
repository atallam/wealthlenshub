import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LayoutDashboard, BarChart2, Target, Compass,
  Users, Wallet, CalendarDays, MessageSquare,
  RefreshCw, Settings, LogOut, Eye, X, MoreHorizontal,
  AlertTriangle, Download, Receipt,
} from 'lucide-react';
import { supabase, signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword, signOut } from './supabase.js';
import { api } from './lib/api.js';
import SnapTradeImport from './SnapTradeImport.jsx';
import KiteImport from './KiteImport.jsx';
import BreezeImport from './BreezeImport.jsx';
// SetuAAImport — disabled until Setu integration is ready
// import SetuAAImport from './SetuAAImport.jsx';

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
import { useImport } from './hooks/useImport.js';
import { useCASImport } from './hooks/useCASImport.js';
import { useAI } from './hooks/useAI.js';
import { useBrokerSearch } from './hooks/useBrokerSearch.js';
import { useUiState } from './hooks/useUiState.js';
import { useHoldingsView } from './hooks/useHoldingsView.js';

// ── Tab components ───────────────────────────────────────────────
import OverviewTab from './features/overview/OverviewTab.jsx';
import HoldingsTab from './features/holdings/HoldingsTab.jsx';
import GoalsTab from './features/goals/GoalsTab.jsx';
import StrategyTab from './features/strategy/StrategyTab.jsx';
import MembersTab from './features/members/MembersTab.jsx';
import BudgetTab from './features/budget/BudgetTab.jsx';
import CalendarTab from './features/calendar/CalendarTab.jsx';
import AdvisorTab from './features/advisor/AdvisorTab.jsx';
import TaxTab from './features/tax/TaxTab.jsx';

// ── Shared components ────────────────────────────────────────────
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

// ── Context ──────────────────────────────────────────────────────
import { PortfolioProvider } from './contexts/PortfolioContext.jsx';

// ── Error boundary ───────────────────────────────────────────────
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';

// ── API helper imported from lib/api.js (see top imports) ────────

const TABS = [
  { key: 'overview',  label: 'Overview',  Icon: LayoutDashboard },
  { key: 'holdings',  label: 'Holdings',  Icon: BarChart2 },
  { key: 'goals',     label: 'Goals',     Icon: Target },
  { key: 'strategy',  label: 'Strategy',  Icon: Compass },
  { key: 'members',   label: 'Members',   Icon: Users },
  { key: 'budget',    label: 'Budget',    Icon: Wallet },
  { key: 'calendar',  label: 'Calendar',  Icon: CalendarDays },
  { key: 'tax',       label: 'Tax',       Icon: Receipt },
  { key: 'advisor',   label: 'Advisor',   Icon: MessageSquare },
];

export default function App() {
  // ── Auth ──────────────────────────────────────────────────────
  const [user,        setUser]        = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authErr,     setAuthErr]     = useState('');

  // ── Cross-tab UI state ────────────────────────────────────────
  const [tab,              setTab]              = useState('overview');
  const [selMember,        setSelMember]        = useState('all');
  // Modal/sheet/dropdown UI toggles now live in useUiState().

  // ── Holding / member form state ───────────────────────────────
  const [form,            setForm]            = useState(BF);
  const [editHolding,     setEditHolding]     = useState(null);
  const [newMember,       setNewMember]       = useState({ name: '', relation: '' });
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [memberAction,    setMemberAction]    = useState(null);
  const [goalForm,        setGoalForm]        = useState(BG);
  const [editGoalId,      setEditGoalId]      = useState(null);
  const [alertForm,       setAlertForm]       = useState(BA);

  // ── Broker search state now lives in useBrokerSearch() (see below) ──

  // ── Misc state ────────────────────────────────────────────────
  const [txnHolding,      setTxnHolding]      = useState(null);
  const [txnForm,         setTxnForm]         = useState(BT);
  const [artifactHolding, setArtifactHolding] = useState(null);
  const [targetAlloc, setTargetAlloc] = useState({
    IN_STOCK:35,MF:25,IN_ETF:5,US_STOCK:10,US_ETF:5,US_BOND:0,
    CRYPTO:3,CASH:0,FD:5,PPF:5,EPF:5,REAL_ESTATE:2,INSURANCE:0,OTHER:0,
  });
  const [rebalMember, setRebalMember] = useState('all');
  const [rebalCash,   setRebalCash]   = useState('');
  const [nwMember,    setNwMember]    = useState('all');
  const [bmPeriod,    setBmPeriod]    = useState('1Y');
  const [calMonth,    setCalMonth]    = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  // ── Gmail state ───────────────────────────────────────────────
  const [gmailStatus,   setGmailStatus]   = useState(null);
  const [gmailLoading,  setGmailLoading]  = useState(false);
  const [gmailChecking, setGmailChecking] = useState(false);

  const fetchGmailStatus = useCallback(async () => {
    try { setGmailStatus(await api('/api/gmail/status')); } catch {}
  }, []);

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
      alert(`Gmail connection failed: ${p.get('gmail_error')}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refs ──────────────────────────────────────────────────────
  const importFileRef    = useRef();
  const txnSaving        = useRef(false);
  const aiBottomRef      = useRef();

  // ── Hooks ─────────────────────────────────────────────────────
  const portfolio  = usePortfolio(user);
  const budget     = useBudget(user);
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
    showImportHub, setShowImportHub, showSnapTrade, setShowSnapTrade,
    showKite, setShowKite, showBreeze, setShowBreeze, moreSheetOpen, setMoreSheetOpen,
    expandedHolding, setExpandedHolding, showQuietAlerts, setShowQuietAlerts,
  } = ui;
  const { filterType, setFilterType, sortCol, setSortCol, sortDir, setSortDir, toggleSort } = useHoldingsView();

  // ── Auth listener ─────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Reset sheet/expanded on tab change
  useEffect(() => {
    setMoreSheetOpen(false);
    setExpandedHolding(null);
  }, [tab]);

  // Fetch Gmail status whenever Settings panel opens
  useEffect(() => {
    if (showSettings) fetchGmailStatus();
  }, [showSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Destructure hook state ────────────────────────────────────
  const {
    holdings, setHoldings, members, goals, alerts, liabilities, setLiabilities, loaded,
    assetTypes, syncSt, priceRefreshing, lastPriceRefresh, priceCount,
    profile, wealthSnapshots, benchmark, demoMode,
  } = portfolio;

  // ── Computed / memoized values ────────────────────────────────

  const allHoldings = holdings;
  const allMembers  = members;

  const visH = useMemo(() => {
    let h = selMember === 'all' ? allHoldings : allHoldings.filter(h => h.member_id === selMember);
    if (filterType !== 'ALL') h = h.filter(h => h.type === filterType);
    return h;
  }, [allHoldings, selMember, filterType]);

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

  const totCur  = useMemo(() => visH.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0), [visH, valINRCache]);
  const totInv  = useMemo(() => visH.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null ? s : s+v; }, 0), [visH, invINRCache]);
  const totGain = totCur - totInv;
  const totPct  = totInv > 0 ? ((totCur - totInv) / totInv) * 100 : 0;

  // ── NRI split: Indian (₹ native) vs US ($ native) ────────────────
  const nriMetrics = useMemo(() => {
    const liveRate = getLiveUsdInr();
    let india_cur = 0, india_inv = 0;
    let us_cur = 0,    us_inv = 0;
    let us_inv_hist_inr = 0; // US invested at purchase-time rate (for FX impact)
    for (const h of visH) {
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
  }, [visH, valNativeCache, invNativeCache]);

  const byType = useMemo(() => {
    const map = {};
    for (const h of visH) {
      if (!map[h.type]) map[h.type] = { cur: 0, inv: 0, count: 0 };
      map[h.type].cur   += valINRCache.get(h.id) || 0;
      map[h.type].inv   += invINRCache.get(h.id) || 0;
      map[h.type].count += 1;
    }
    const total = Object.values(map).reduce((s, v) => s + v.cur, 0);
    return Object.entries(map)
      .map(([t, v]) => ({ t, v: v.cur, i: v.inv, count: v.count, pct: total > 0 ? (v.cur / total) * 100 : 0 }))
      .sort((a, b) => b.v - a.v);
  }, [visH, valINRCache, invINRCache]);

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
  }, [alerts, allHoldings, allCur, totPct, valINRCache]);

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
      setNewMember({ name: m?.name || '', relation: m?.relation || '', pan: '', pan_masked: m?.pan_masked || '' });
      setEditingMemberId(memberId);
    } else {
      setNewMember({ name: '', relation: '' });
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

  // ── Broker search handlers ────────────────────────────────────
  // Broker-search handlers now provided by useBrokerSearch().

  // Map an ImportHub selection to the matching flow.
  function handleImportSelect(key) {
    switch (key) {
      case 'cas':       casImport.setCasModal(true); break;
      case 'kite':      setShowKite(true); break;
      case 'breeze':    setShowBreeze(true); break;
      case 'fd':        setForm(p => ({ ...p, type: 'FD' })); setModal('add'); break;
      case 'snaptrade': setShowSnapTrade(true); break;
      case 'csv':       setModal('import'); break;
      case 'manual':    setModal('add'); break;
      default: break;
    }
  }

  // ── Auth guards ───────────────────────────────────────────────
  if (authLoading) return <div className="splash">Loading…</div>;
  if (!user)       return <LoginScreen error={authErr} />;

  // ── Props bundle shared across most tabs ──────────────────────
  const sharedPortfolioProps = {
    holdings, allHoldings, allMembers, members, goals, alerts, liabilities, setLiabilities,
    loaded, demoMode, wealthSnapshots, benchmark,
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
  };

  // ══════════════════════════════════════════════════════════════
  return (
    <div className="app">

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="hdr">
        <div className="hdr-left">
          <div className="logo">Wealth<span>Lens</span></div>
          {demoMode && (
            <span style={{marginLeft:'.5rem',fontSize:'.62rem',background:'rgba(160,132,202,.12)',border:'1px solid rgba(160,132,202,.3)',color:'#A084CA',borderRadius:4,padding:'2px 8px',letterSpacing:'.06em',fontWeight:600}}>
              DEMO
            </span>
          )}
        </div>

        <div className="hdr-right">
          {/* Sync status */}
          {syncSt === 'saving' && <span className="sync-saving">saving…</span>}
          {syncSt === 'saved'  && <span className="sync-saved">saved</span>}
          {syncSt === 'error'  && <span className="sync-error">save error</span>}

          {/* Triggered alerts badge */}
          {trigAlerts.length > 0 && (
            <button className="btn-o" style={{borderColor:'rgba(220,38,38,.3)',color:'var(--loss)'}}
              onClick={() => setTab('strategy')}>
              <AlertTriangle size={13} strokeWidth={2}/> {trigAlerts.length}
            </button>
          )}

          {/* Price refresh */}
          <button className="btn-o"
            onClick={portfolio.refreshPrices} disabled={priceRefreshing}
            title={lastPriceRefresh ? `Last: ${ago(lastPriceRefresh)}` : 'Refresh prices'}>
            <RefreshCw size={13} strokeWidth={2} style={priceRefreshing ? {animation:'spin 1s linear infinite'} : {}}/>
          </button>

          <button className="btn-o" onClick={() => setShowImportHub(true)} title="Import Holdings" aria-label="Import Holdings">
            <Download size={13} strokeWidth={2}/>
          </button>
          <button className="btn-o" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings"><Settings size={13} strokeWidth={2}/></button>
          <button className="btn-o" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={13} strokeWidth={2}/></button>
        </div>
      </header>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── MEMBER FILTER BAR ──────────────────────────────────── */}
      {allMembers.length > 1 && (
        <div className="mbar">
          <button className={selMember === 'all' ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember('all')}>All</button>
          {allMembers.map(m => (
            <button key={m.id} className={selMember === m.id ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* ── TAB BAR ────────────────────────────────────────────── */}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            <span className="tab-icon"><t.Icon size={15} strokeWidth={1.8}/></span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

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
            />
          </ErrorBoundary>
        )}

        {loaded && tab === 'budget' && (
          <ErrorBoundary tab="Budget">
            <BudgetTab
              {...budget}
              allCur={allCur} allInv={allInv} totInv={totInv} totPct={totPct}
              fmtCr={fmtCr} fmtPct={fmtPct}
              sipHoldings={allHoldings.filter(h=>h.type==='MF').slice(0,5).map(h=>({id:h.id,name:h.name}))}
              api={api} FG={FG} MA={MA} Overlay={Overlay}
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

      {/* ── FAB — Add Holding (mobile) ──────────────────────────── */}
      <button className="fab" onClick={() => setModal('add')} title="Add holding" aria-label="Add holding">+</button>

      {/* ── BOTTOM NAV (mobile) ─────────────────────────────────── */}
      <nav className="bnav">
        {TABS.slice(0, 4).map(t => (
          <button key={t.key} className={tab === t.key ? 'bnav-btn active' : 'bnav-btn'} onClick={() => setTab(t.key)}>
            <span className="bnav-icon"><t.Icon size={20} strokeWidth={1.7}/></span>
            <span className="bnav-label">{t.label}</span>
          </button>
        ))}
        <button className={moreSheetOpen ? 'bnav-btn active' : 'bnav-btn'} onClick={() => setMoreSheetOpen(p => !p)}>
          <span className="bnav-icon"><MoreHorizontal size={20} strokeWidth={1.7}/></span>
          <span className="bnav-label">More</span>
        </button>
      </nav>

      {/* ── MORE SHEET (mobile) ─────────────────────────────────── */}
      {moreSheetOpen && (
        <>
          {/* Backdrop dismiss */}
          <div style={{position:'fixed',inset:0,zIndex:205,background:'rgba(0,0,0,.15)'}}
            onClick={() => setMoreSheetOpen(false)}/>
          <div className="more-sheet" style={{zIndex:210}}>
            <div className="more-sheet-handle"/>
            <div className="more-sheet-grid">
              {TABS.slice(4).map(t => (
                <button key={t.key} className={tab === t.key ? 'more-sheet-item act' : 'more-sheet-item'}
                  onClick={() => { setTab(t.key); setMoreSheetOpen(false); }}>
                  <span className="msi-icon"><t.Icon size={22} strokeWidth={1.6}/></span>
                  <span className="msi-label">{t.label}</span>
                </button>
              ))}
              <button className="more-sheet-item" onClick={() => { setShowImportHub(true); setMoreSheetOpen(false); }}>
                <span className="msi-icon"><Download size={22} strokeWidth={1.6}/></span>
                <span className="msi-label">Import</span>
              </button>
              <button className="more-sheet-item" onClick={() => { setShowSettings(true); setMoreSheetOpen(false); }}>
                <span className="msi-icon"><Settings size={22} strokeWidth={1.6}/></span>
                <span className="msi-label">Settings</span>
              </button>
              <button className="more-sheet-item" style={{color:'var(--loss)'}} onClick={() => { if(confirm('Sign out?')) signOut(); setMoreSheetOpen(false); }}>
                <span className="msi-icon"><LogOut size={22} strokeWidth={1.6}/></span>
                <span className="msi-label">Sign Out</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════ */}

      {/* ── Add / Edit Holding ──────────────────────────────────── */}
      {(modal === 'add' || modal === 'quickadd') && (
        <Overlay onClose={() => { setModal(null); setForm(BF); setEditHolding(null); }} wide>
          <div className="modtitle">{editHolding ? 'Edit Holding' : 'Add Holding'}</div>

          <FG label="Member">
            <select className="fi fs" value={form.member_id} onChange={e => setForm(p => ({ ...p, member_id: e.target.value }))}>
              <option value="">— Select member —</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.relation})</option>)}
            </select>
          </FG>

          <FG label="Asset Type">
            <select className="fi fs" value={form.type}
              onChange={e => { setForm(p => ({ ...p, type: e.target.value })); setMfNav(null); setStockInfo(null); setEtfInfo(null); }}>
              {Object.entries(AT).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </FG>

          {/* MF search */}
          {form.type === 'MF' && (
            <FG label="Search Mutual Fund">
              <input className="fi" placeholder="e.g. Mirae Asset, Axis Midcap…" value={mfSearch}
                onChange={e => handleMfSearch(e.target.value)}/>
              {mfSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {mfResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {mfResults.map(f => (
                    <div key={f.schemeCode} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, name: f.schemeName, scheme_code: String(f.schemeCode) })); setMfSearch(f.schemeName); setMfResults([]); }}>
                      {f.schemeName}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* IN_STOCK search */}
          {form.type === 'IN_STOCK' && (
            <FG label="Search Indian Stock">
              <input className="fi" placeholder="e.g. RELIANCE, TCS…" value={stockSearch}
                onChange={e => handleStockSearch(e.target.value)}/>
              {stockSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {stockResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {stockResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setStockSearch(r.name || r.symbol); setStockResults([]); }}>
                      <span style={{color:'var(--gold)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* IN_ETF search */}
          {form.type === 'IN_ETF' && (
            <FG label="Search Indian ETF">
              <input className="fi" placeholder="e.g. NIFTYBEES, GOLDBEES…" value={etfSearch}
                onChange={e => handleEtfSearch(e.target.value)}/>
              {etfSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {etfResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {etfResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setEtfSearch(r.name || r.symbol); setEtfResults([]); }}>
                      <span style={{color:'var(--gold)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* US stock / ETF / Crypto search */}
          {['US_STOCK','US_ETF','CRYPTO'].includes(form.type) && (
            <FG label={`Search ${AT[form.type]?.label}`}>
              <input className="fi" placeholder="e.g. NVDA, VOO, BTC-USD…" value={usSearch}
                onChange={e => handleUsSearch(e.target.value)}/>
              {usSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {usResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {usResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setUsSearch(r.name || r.symbol); setUsResults([]); }}>
                      <span style={{color:'var(--primary)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* Name / Ticker */}
          <div className="frow">
            <FG label="Name">
              <input className="fi" placeholder="Holding name" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}/>
            </FG>
            {['IN_STOCK','IN_ETF','US_STOCK','US_ETF','US_BOND','CRYPTO'].includes(form.type) && (
              <FG label="Ticker">
                <input className="fi" placeholder="e.g. RELIANCE, NVDA" value={form.ticker}
                  onChange={e => setForm(p => ({ ...p, ticker: e.target.value.toUpperCase() }))}/>
              </FG>
            )}
          </div>

          {/* FD Scan button */}
          {form.type === 'FD' && (
            <div style={{marginBottom:'.75rem'}}>
              <button
                type="button"
                onClick={() => setFdScanOpen(true)}
                style={{display:'flex',alignItems:'center',gap:'.5rem',padding:'.55rem 1rem',
                  background:'rgba(13,148,136,.08)',color:'var(--primary)',
                  border:'1px solid rgba(13,148,136,.25)',borderRadius:8,
                  fontSize:'.82rem',fontWeight:600,cursor:'pointer',width:'100%',justifyContent:'center'}}>
                📷 Scan Certificate — auto-fill with Claude Vision
              </button>
            </div>
          )}

          {/* FD / PPF / EPF fields */}
          {['FD','PPF','EPF'].includes(form.type) && (<>
            {/* FD: currency selector — shown first so it can drive label below */}
            {form.type === 'FD' && (
              <div className="frow" style={{marginBottom:'.5rem'}}>
                <FG label="Currency">
                  <select className="fi fs" value={form.currency||'INR'}
                    onChange={e => setForm(p => ({ ...p, currency: e.target.value, usd_inr_rate: '' }))}>
                    <option value="INR">₹ INR — Indian Rupee</option>
                    <option value="USD">$ USD — US Dollar (FCNR)</option>
                    <option value="SGD">S$ SGD — Singapore Dollar</option>
                    <option value="GBP">£ GBP — British Pound</option>
                    <option value="EUR">€ EUR — Euro</option>
                  </select>
                </FG>
                {(form.currency && form.currency !== 'INR') && (
                  <FG label={`1 ${form.currency} = ₹ (exchange rate)`}>
                    <input type="number" className="fi"
                      placeholder={form.currency==='USD'?'e.g. 84.5':form.currency==='SGD'?'e.g. 63.2':form.currency==='GBP'?'e.g. 107.0':'e.g. 90.0'}
                      value={form.usd_inr_rate||''}
                      onChange={e => setForm(p => ({ ...p, usd_inr_rate: e.target.value }))}/>
                  </FG>
                )}
              </div>
            )}
            <div className="frow">
              <FG label={form.type==='FD'&&form.currency&&form.currency!=='INR'?`Principal ${form.currency}`:"Principal ₹"}>
                <FmtInput value={form.principal} placeholder="e.g. 500000"
                  onChange={e => setForm(p => ({ ...p, principal: e.target.value }))}/>
              </FG>
              {form.type === 'FD' && (
                <FG label="Interest Rate % p.a.">
                  <input type="number" className="fi" placeholder="e.g. 7.25" value={form.interest_rate}
                    onChange={e => setForm(p => ({ ...p, interest_rate: e.target.value }))}/>
                </FG>
              )}
            </div>
            <div className="frow">
              <FG label="Start Date">
                <input type="date" className="fi" value={form.start_date}
                  onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}/>
              </FG>
              {form.type === 'FD' && (
                <FG label="Maturity Date">
                  <input type="date" className="fi" value={form.maturity_date}
                    onChange={e => setForm(p => ({ ...p, maturity_date: e.target.value }))}/>
                </FG>
              )}
            </div>
          </>)}

          {/* Real estate */}
          {form.type === 'REAL_ESTATE' && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="e.g. 5000000"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="e.g. 7000000"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* Insurance */}
          {form.type === 'INSURANCE' && (<>
            <div className="frow">
              <FG label="Policy Type">
                <select className="fi fs" value={form.policy_type||'TERM'} onChange={e=>setForm(p=>({...p,policy_type:e.target.value}))}>
                  <option value="TERM">🛡️ Term — Pure protection</option>
                  <option value="ENDOWMENT">💰 Endowment — Protection + savings</option>
                  <option value="ULIP">📈 ULIP — Unit-linked</option>
                  <option value="WHOLE_LIFE">🔄 Whole Life — Lifelong cover</option>
                  <option value="HEALTH">🏥 Health / Mediclaim</option>
                  <option value="VEHICLE">🚗 Vehicle / Motor</option>
                </select>
              </FG>
              <FG label="Sum Assured ₹ (coverage)">
                <FmtInput value={form.sum_assured||''} placeholder="e.g. 10000000"
                  onChange={e=>setForm(p=>({...p,sum_assured:e.target.value}))}/>
              </FG>
            </div>
            <div className="frow">
              <FG label="Premium ₹ per period">
                <FmtInput value={form.premium||''} placeholder="e.g. 25000"
                  onChange={e=>setForm(p=>({...p,premium:e.target.value}))}/>
              </FG>
              <FG label="Frequency">
                <select className="fi fs" value={form.premium_frequency||'ANNUAL'} onChange={e=>setForm(p=>({...p,premium_frequency:e.target.value}))}>
                  <option value="ANNUAL">Annual</option>
                  <option value="SEMI">Semi-Annual (every 6 months)</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </FG>
            </div>
            <div className="frow">
              <FG label="Policy Start Date">
                <input type="date" className="fi" value={form.start_date}
                  onChange={e=>setForm(p=>({...p,start_date:e.target.value}))}/>
              </FG>
              <FG label="Maturity / Expiry Date">
                <input type="date" className="fi" value={form.maturity_date}
                  onChange={e=>setForm(p=>({...p,maturity_date:e.target.value}))}/>
              </FG>
            </div>
            {/* Savings-type policies: show current / invested value */}
            {['ENDOWMENT','ULIP','WHOLE_LIFE'].includes(form.policy_type||'TERM')&&(
              <div className="frow">
                <FG label="Total Premiums Paid ₹">
                  <FmtInput value={form.principal||''} placeholder="e.g. 150000"
                    onChange={e=>setForm(p=>({...p,principal:e.target.value}))}/>
                </FG>
                <FG label="Current Surrender / Fund Value ₹">
                  <FmtInput value={form.current_value||''} placeholder="e.g. 180000"
                    onChange={e=>setForm(p=>({...p,current_value:e.target.value}))}/>
                </FG>
              </div>
            )}
          </>)}

          {/* Indian instruments */}
          {['MF','IN_STOCK','IN_ETF'].includes(form.type) && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="total invested"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="current value"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* US instruments */}
          {['US_STOCK','US_ETF','US_BOND','CRYPTO','CASH'].includes(form.type) && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="purchase ₹"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="current ₹"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
              <FG label={<>USD/INR Rate <button type="button" onClick={fetchUsdInr} style={{fontSize:'.58rem',color:'#5a9ce0',background:'none',border:'none',cursor:'pointer'}}>{usdInrLoading ? '…' : '⟳'}</button></>}>
                <input type="number" className="fi" placeholder={String(usdInrRate)} value={form.usd_inr_rate}
                  onChange={e => setForm(p => ({ ...p, usd_inr_rate: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* Other / Cash simple value */}
          {['OTHER'].includes(form.type) && (
            <FG label="Current Value ₹">
              <FmtInput value={form.current_value} placeholder="e.g. 250000"
                onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
            </FG>
          )}

          <MA>
            <button className="btnc" onClick={() => { setModal(null); setForm(BF); setEditHolding(null); }}>Cancel</button>
            <button className="btns" onClick={() =>
              portfolio.saveHolding(form, editHolding, () => { setModal(null); setForm(BF); setEditHolding(null); })}>
              {editHolding ? 'Update Holding' : 'Save Holding'}
            </button>
          </MA>
        </Overlay>
      )}

      {/* ── FD Certificate Scanner ──────────────────────────────── */}
      {fdScanOpen && (
        <FDScanSheet
          api={api}
          onClose={() => setFdScanOpen(false)}
          onConfirm={fd => {
            setForm(p => ({
              ...p,
              name:          fd.bank_name ? `${fd.bank_name} FD` : p.name,
              principal:     fd.principal  != null ? String(fd.principal)    : p.principal,
              interest_rate: fd.interest_rate != null ? String(fd.interest_rate) : p.interest_rate,
              start_date:    fd.start_date    || p.start_date,
              maturity_date: fd.maturity_date || p.maturity_date,
            }));
            setFdScanOpen(false);
          }}
        />
      )}

      {/* ── Add / Edit Goal ─────────────────────────────────────── */}
      {modal === 'goal' && (
        <Overlay onClose={() => { setModal(null); setGoalForm(BG); setEditGoalId(null); }} wide>
          <div className="modtitle">{editGoalId ? 'Edit Goal' : 'New Goal'}</div>
          <div className="frow">
            <FG label="Goal Name">
              <input className="fi" placeholder="e.g. Retirement Corpus" value={goalForm.name}
                onChange={e => setGoalForm(p => ({ ...p, name: e.target.value }))}/>
            </FG>
            <FG label="Category">
              <select className="fi fs" value={goalForm.category} onChange={e => setGoalForm(p => ({ ...p, category: e.target.value }))}>
                {['Retirement','Education','Real Estate','Emergency Fund','Wealth','Travel','Other'].map(c =>
                  <option key={c} value={c}>{c}</option>)}
              </select>
            </FG>
          </div>
          <div className="frow">
            <FG label="Target Amount ₹">
              <FmtInput value={goalForm.targetAmount} placeholder="e.g. 10000000"
                onChange={e => setGoalForm(p => ({ ...p, targetAmount: e.target.value }))}/>
            </FG>
            <FG label="Target Date">
              <input type="date" className="fi" value={goalForm.targetDate}
                onChange={e => setGoalForm(p => ({ ...p, targetDate: e.target.value }))}/>
            </FG>
          </div>
          <div className="frow">
            <FG label="Monthly SIP ₹ (optional)">
              <FmtInput value={goalForm.monthlyContribution} placeholder="e.g. 25000"
                onChange={e => setGoalForm(p => ({ ...p, monthlyContribution: e.target.value }))}/>
            </FG>
            <FG label="Priority">
              <input type="number" className="fi" min={1} max={10} value={goalForm.priority}
                onChange={e => setGoalForm(p => ({ ...p, priority: +e.target.value }))}/>
            </FG>
          </div>
          <FG label="Link Members">
            <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginTop:'.3rem'}}>
              <button type="button" className={goalForm.linkedMembers.includes('all') ? 'tag-btn active' : 'tag-btn'}
                onClick={() => setGoalForm(p => ({ ...p, linkedMembers: ['all'] }))}>All Members</button>
              {members.map(m => (
                <button key={m.id} type="button"
                  className={goalForm.linkedMembers.includes(m.id) ? 'tag-btn active' : 'tag-btn'}
                  onClick={() => setGoalForm(p => {
                    const lm = p.linkedMembers.filter(x => x !== 'all');
                    return { ...p, linkedMembers: lm.includes(m.id) ? lm.filter(x => x !== m.id) : [...lm, m.id] };
                  })}>{m.name}</button>
              ))}
            </div>
          </FG>
          <FG label="Link Asset Types">
            <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginTop:'.3rem'}}>
              {Object.entries(AT).map(([k, v]) => (
                <button key={k} type="button"
                  className={goalForm.linkedTypes.includes(k) ? 'tag-btn active' : 'tag-btn'}
                  onClick={() => setGoalForm(p => ({
                    ...p, linkedTypes: p.linkedTypes.includes(k)
                      ? p.linkedTypes.filter(x => x !== k)
                      : [...p.linkedTypes, k],
                  }))}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </FG>
          <FG label="Earmark Specific Holdings (optional)">
            <div style={{fontSize:'.68rem',color:'var(--text-muted)',marginBottom:'.4rem',lineHeight:1.5}}>
              Selected holdings are always counted toward this goal — on top of any linked asset types above. Useful for FDs, PPF accounts, or specific stocks you've mentally set aside.
            </div>
            <HoldingsPicker
              allHoldings={allHoldings}
              valINRCache={valINRCache}
              AT={AT}
              members={members}
              selected={goalForm.linkedHoldingIds || []}
              onChange={ids => setGoalForm(p => ({ ...p, linkedHoldingIds: ids }))}
              goals={goal