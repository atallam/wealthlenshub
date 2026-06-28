import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LayoutDashboard, BarChart2, Target, Compass,
  Users, Wallet, CalendarDays, MessageSquare,
  RefreshCw, Settings, LogOut, Eye, X, MoreHorizontal,
  AlertTriangle, Download,
} from 'lucide-react';
import { supabase, signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword, signOut } from './supabase.js';
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
  getVal, getInv, getValINR, getInvINR,
  xirr, getXIRR, isUSDHolding, toINR, toUSD, fxFor,
  calcFD, calcAccr,
} from './utils.js';
import { AT, BF, BT, BG, BA, SEED } from './constants.js';
import './styles.css';

// ── Hooks ────────────────────────────────────────────────────────
import { usePortfolio } from './hooks/usePortfolio.js';
import { useShares } from './hooks/useShares.js';
import { useBudget } from './hooks/useBudget.js';
import { useImport } from './hooks/useImport.js';
import { useCASImport } from './hooks/useCASImport.js';
import { useAI } from './hooks/useAI.js';

// ── Tab components ───────────────────────────────────────────────
import OverviewTab from './components/tabs/OverviewTab.jsx';
import HoldingsTab from './components/tabs/HoldingsTab.jsx';
import GoalsTab from './components/tabs/GoalsTab.jsx';
import StrategyTab from './components/tabs/StrategyTab.jsx';
import MembersTab from './components/tabs/MembersTab.jsx';
import BudgetTab from './components/tabs/BudgetTab.jsx';
import CalendarTab from './components/tabs/CalendarTab.jsx';
import AdvisorTab from './components/tabs/AdvisorTab.jsx';

// ── Shared components ────────────────────────────────────────────
import LoginScreen from './components/shared/LoginScreen.jsx';
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

// ── API helper (attaches Supabase JWT) ───────────────────────────
async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

const TABS = [
  { key: 'overview',  label: 'Overview',  Icon: LayoutDashboard },
  { key: 'holdings',  label: 'Holdings',  Icon: BarChart2 },
  { key: 'goals',     label: 'Goals',     Icon: Target },
  { key: 'strategy',  label: 'Strategy',  Icon: Compass },
  { key: 'members',   label: 'Members',   Icon: Users },
  { key: 'budget',    label: 'Budget',    Icon: Wallet },
  { key: 'calendar',  label: 'Calendar',  Icon: CalendarDays },
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
  const [modal,            setModal]            = useState(null);
  const [fdScanOpen,       setFdScanOpen]       = useState(false);
  const [showSettings,     setShowSettings]     = useState(false);
  const [showImportHub,    setShowImportHub]    = useState(false);
  const [showSnapTrade,    setShowSnapTrade]    = useState(false);
  const [showKite,         setShowKite]         = useState(false);
  const [showBreeze,       setShowBreeze]       = useState(false);
  const [moreSheetOpen,    setMoreSheetOpen]     = useState(false);
  const [expandedHolding,  setExpandedHolding]  = useState(null);
  const [showQuietAlerts,  setShowQuietAlerts]  = useState(false);
  const [showSharedDropdown, setShowSharedDropdown] = useState(false);

  // ── Holding / member form state ───────────────────────────────
  const [form,            setForm]            = useState(BF);
  const [editHolding,     setEditHolding]     = useState(null);
  const [newMember,       setNewMember]       = useState({ name: '', relation: '' });
  const [shareWithFamily, setShareWithFamily] = useState(true);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [memberAction,    setMemberAction]    = useState(null);
  const [goalForm,        setGoalForm]        = useState(BG);
  const [editGoalId,      setEditGoalId]      = useState(null);
  const [alertForm,       setAlertForm]       = useState(BA);

  // ── Broker search state ───────────────────────────────────────
  const [mfSearch,       setMfSearch]       = useState('');
  const [mfResults,      setMfResults]      = useState([]);
  const [mfSearching,    setMfSearching]    = useState(false);
  const [mfNav,          setMfNav]          = useState(null);
  const [stockSearch,    setStockSearch]    = useState('');
  const [stockResults,   setStockResults]   = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockInfo,      setStockInfo]      = useState(null);
  const [stockLooking,   setStockLooking]   = useState(false);
  const [etfSearch,      setEtfSearch]      = useState('');
  const [etfResults,     setEtfResults]     = useState([]);
  const [etfSearching,   setEtfSearching]   = useState(false);
  const [etfInfo,        setEtfInfo]        = useState(null);
  const [usSearch,       setUsSearch]       = useState('');
  const [usResults,      setUsResults]      = useState([]);
  const [usSearching,    setUsSearching]    = useState(false);
  const [usdInrRate,     setUsdInrRate]     = useState(94.5);
  const [usdInrLoading,  setUsdInrLoading]  = useState(false);

  // ── Misc state ────────────────────────────────────────────────
  const [txnHolding,      setTxnHolding]      = useState(null);
  const [txnForm,         setTxnForm]         = useState(BT);
  const [artifactHolding, setArtifactHolding] = useState(null);
  const [filterType,      setFilterType]      = useState('ALL');
  const [sortCol,         setSortCol]         = useState(null);
  const [sortDir,         setSortDir]         = useState('asc');
  const [targetAlloc, setTargetAlloc] = useState({
    IN_STOCK:35,MF:25,IN_ETF:5,US_STOCK:10,US_ETF:5,US_BOND:0,
    CRYPTO:3,CASH:0,FD:5,PPF:5,EPF:5,REAL_ESTATE:2,OTHER:0,
  });
  const [rebalMember, setRebalMember] = useState('all');
  const [rebalCash,   setRebalCash]   = useState('');
  const [nwMember,    setNwMember]    = useState('all');
  const [bmPeriod,    setBmPeriod]    = useState('1Y');
  const [calMonth,    setCalMonth]    = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  // ── Refs ──────────────────────────────────────────────────────
  const importFileRef    = useRef();
  const txnSaving        = useRef(false);
  const aiBottomRef      = useRef();
  const stockSearchTimer = useRef();
  const usSearchTimer    = useRef();
  const mfSearchTimer    = useRef();
  const etfSearchTimer   = useRef();

  // ── Hooks ─────────────────────────────────────────────────────
  const portfolio  = usePortfolio(user);
  const shares     = useShares(user);
  const budget     = useBudget(user);
  const importHook = useImport(user, () => portfolio.reloadHoldings());
  const casImport  = useCASImport(user, () => portfolio.reloadHoldings());
  const ai         = useAI();

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

  // ── Destructure hook state ────────────────────────────────────
  const {
    holdings, setHoldings, members, goals, alerts, loaded,
    assetTypes, syncSt, priceRefreshing, lastPriceRefresh, priceCount,
    profile, wealthSnapshots, benchmark, demoMode,
  } = portfolio;

  const {
    sharedHoldings, sharedWithMe, sharedMembers, viewingShared,
  } = shares;

  // ── Computed / memoized values ────────────────────────────────

  const allHoldings = useMemo(
    () => viewingShared ? sharedHoldings : [...holdings, ...sharedHoldings],
    [holdings, sharedHoldings, viewingShared]
  );

  const allMembers = useMemo(
    () => [...members, ...sharedMembers],
    [members, sharedMembers]
  );

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
  const allInv = useMemo(
    () => allHoldings.reduce((s, h) => s + (invINRCache.get(h.id) || 0), 0),
    [allHoldings, invINRCache]
  );

  const totCur  = useMemo(() => visH.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0), [visH, valINRCache]);
  const totInv  = useMemo(() => visH.reduce((s, h) => s + (invINRCache.get(h.id) || 0), 0), [visH, invINRCache]);
  const totGain = totCur - totInv;
  const totPct  = totInv > 0 ? ((totCur - totInv) / totInv) * 100 : 0;

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
    for (const a of alerts) {
      if (!a.active) continue;
      if (a.type === 'RETURN_TARGET') {
        if (totPct < a.threshold) triggered.push(a);
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
    const topH = [...allHoldings]
      .sort((a, b) => (valINRCache.get(b.id) || 0) - (valINRCache.get(a.id) || 0))
      .slice(0, 20);
    const memberNames = Object.fromEntries(allMembers.map(m => [m.id, m.name]));
    const holdingsText = topH.map(h => {
      const cur = valINRCache.get(h.id) || 0;
      const inv = invINRCache.get(h.id) || 0;
      const xi  = xirrCache.get(h.id);
      const pct = inv > 0 ? (((cur - inv) / inv) * 100).toFixed(1) : '0';
      const xirrStr = xi?.value != null ? ` | XIRR: ${xi.value.toFixed(1)}% (${xi.method})` : '';
      return `  - ${h.name} (${AT[h.type]?.label || h.type}): current=${fmtCrINR(cur)}, invested=${fmtCrINR(inv)}, gain=${pct}%${xirrStr} [${memberNames[h.member_id] || 'Unassigned'}]`;
    }).join('\n');
    const byTypeText = byType
      .map(row => `  ${AT[row.t]?.label || row.t}: ${fmtCrINR(row.v)} (${allCur > 0 ? ((row.v / allCur) * 100).toFixed(1) : 0}%)`)
      .join('\n');
    const goalsText = goals.map(g => `  - ${g.name}: target=${fmtCrINR(g.targetAmount)}, by ${g.targetDate}`).join('\n');
    const alertsText = trigAlerts.length > 0
      ? trigAlerts.map(a => `  - ${a.label || a.type}: threshold=${a.threshold}%`).join('\n')
      : '  None triggered';
    return `PORTFOLIO SUMMARY (${new Date().toLocaleDateString('en-IN')})
Total Value: ${fmtCrINR(allCur)} | Invested: ${fmtCrINR(allInv)} | Gain: ${totPct.toFixed(1)}%
Members: ${allMembers.map(m => m.name).join(', ')}

HOLDINGS (top 20 by value):
${holdingsText}

ALLOCATION BY TYPE:
${byTypeText}

GOALS:
${goalsText || '  None set'}

TRIGGERED ALERTS:
${alertsText}`;
  }

  // ── Shared helpers ────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function openMemberModal(memberId) {
    if (memberId) {
      const m = members.find(x => x.id === memberId);
      setNewMember({ name: m?.name || '', relation: m?.relation || '' });
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
      principal:      h.principal      || '',
      usd_inr_rate:   h.usd_inr_rate   || '',
    });
    setEditHolding(h);
    setModal('add');
  }

  // ── Broker search handlers ────────────────────────────────────
  function handleMfSearch(v) {
    setMfSearch(v); setMfNav(null);
    clearTimeout(mfSearchTimer.current);
    if (!v.trim()) { setMfResults([]); return; }
    setMfSearching(true);
    mfSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/mf/search?q=${encodeURIComponent(v)}`); setMfResults(d?.funds || []); }
      catch { setMfResults([]); }
      setMfSearching(false);
    }, 350);
  }

  function handleStockSearch(v) {
    setStockSearch(v); setStockInfo(null);
    clearTimeout(stockSearchTimer.current);
    if (!v.trim()) { setStockResults([]); return; }
    setStockSearching(true);
    stockSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=NSE`); setStockResults(d?.results || []); }
      catch { setStockResults([]); }
      setStockSearching(false);
    }, 350);
  }

  function handleEtfSearch(v) {
    setEtfSearch(v); setEtfInfo(null);
    clearTimeout(etfSearchTimer.current);
    if (!v.trim()) { setEtfResults([]); return; }
    setEtfSearching(true);
    etfSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=NSE`); setEtfResults(d?.results || []); }
      catch { setEtfResults([]); }
      setEtfSearching(false);
    }, 350);
  }

  function handleUsSearch(v) {
    setUsSearch(v);
    clearTimeout(usSearchTimer.current);
    if (!v.trim()) { setUsResults([]); return; }
    setUsSearching(true);
    usSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=US`); setUsResults(d?.results || []); }
      catch { setUsResults([]); }
      setUsSearching(false);
    }, 350);
  }

  async function fetchUsdInr() {
    setUsdInrLoading(true);
    try { const d = await api('/api/forex/usdinr'); if (d?.rate) setUsdInrRate(d.rate); }
    catch {}
    setUsdInrLoading(false);
  }

  // ── Auth guards ───────────────────────────────────────────────
  if (authLoading) return <div className="splash">Loading…</div>;
  if (!user)       return <LoginScreen error={authErr} />;

  // ── Props bundle shared across most tabs ──────────────────────
  const sharedPortfolioProps = {
    holdings, sharedHoldings, allHoldings, allMembers, members, goals, alerts,
    loaded, demoMode, wealthSnapshots, benchmark, sharedWithMe,
    valINRCache, invINRCache, valNativeCache, invNativeCache, xirrCache,
    totCur, totInv, totGain, totPct, allCur, allInv, byType, mSum, trigAlerts,
    fmt, fmtCr, fmtINR, fmtCrINR, fmtCrUSD, fmtNative, fmtCrNative, fmtPct, ago, fmtSize,
    AT, BF, BT, BG, BA,
    DonutChart, Overlay, FG, MA, FmtInput,
    isUSDHolding, api,
    setModal, setShowSettings,
    exitDemoMode:  portfolio.exitDemoMode,
    loadDemoData:  () => portfolio.loadDemoData(SEED),
    refreshPrices: portfolio.refreshPrices,
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
          {/* Viewing shared portfolio indicator */}
          {viewingShared && (
            <div style={{display:'flex',alignItems:'center',gap:'.4rem',fontSize:'.72rem',color:'var(--text-dim)',background:'var(--bg-muted)',border:'1px solid var(--border)',borderRadius:6,padding:'.3rem .65rem'}}>
              <Eye size={13} strokeWidth={2}/>
              <span>{viewingShared.owner_name}</span>
              <button className="delbtn" style={{minWidth:'auto',minHeight:'auto',padding:'2px 4px'}} onClick={shares.exitSharedView}><X size={12}/></button>
            </div>
          )}

          {/* Shared portfolios dropdown */}
          {sharedWithMe.length > 0 && !viewingShared && (
            <div style={{position:'relative'}}>
              <button className="btn-o" onClick={() => setShowSharedDropdown(p => !p)}>
                <Users size={13} strokeWidth={2}/> Shared ({sharedWithMe.length})
              </button>
              {showSharedDropdown && (
                <div style={{position:'absolute',right:0,top:'110%',minWidth:200,background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'.4rem',zIndex:999,boxShadow:'var(--shadow-lg)'}}>
                  {sharedWithMe.map(s => (
                    <div key={s.owner_id}
                      onClick={() => { shares.viewSharedPortfolio(s.owner_id, s.owner_name, s.role); setShowSharedDropdown(false); }}
                      style={{padding:'.5rem .7rem',cursor:'pointer',borderRadius:6,fontSize:'.78rem',color:'var(--text)'}}>
                      {s.owner_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

          <button className="btn-o" onClick={() => setShowImportHub(true)} title="Import Holdings">
            <Download size={13} strokeWidth={2}/>
          </button>
          <button className="btn-o" onClick={() => setShowSettings(true)} title="Settings"><Settings size={13} strokeWidth={2}/></button>
          <button className="btn-o" onClick={signOut} title="Sign out"><LogOut size={13} strokeWidth={2}/></button>
        </div>
      </header>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── MEMBER FILTER BAR ──────────────────────────────────── */}
      {allMembers.length > 1 && (
        <div className="mbar">
          <button className={selMember === 'all' ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember('all')}>All</button>
          {allMembers.map(m => (
            <button key={m.id} className={selMember === m.id ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember(m.id)}>
              {m.name}{m._shared ? ` (${m._shared_owner})` : ''}
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

        {tab === 'overview' && (
          <OverviewTab
            {...sharedPortfolioProps}
            bmPeriod={bmPeriod} setBmPeriod={setBmPeriod}
            setBenchmark={portfolio.setBenchmark}
            nwMember={nwMember} setNwMember={setNwMember}
          />
        )}

        {tab === 'holdings' && (
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
        )}

        {tab === 'goals' && (
          <GoalsTab
            {...sharedPortfolioProps}
            setGoals={portfolio.setGoals}
            setGoalForm={setGoalForm}
            setEditGoalId={setEditGoalId}
          />
        )}

        {tab === 'strategy' && (
          <StrategyTab
            {...sharedPortfolioProps}
            targetAlloc={targetAlloc} setTargetAlloc={setTargetAlloc}
            rebalMember={rebalMember} setRebalMember={setRebalMember}
            rebalCash={rebalCash}     setRebalCash={setRebalCash}
            showQuietAlerts={showQuietAlerts} setShowQuietAlerts={setShowQuietAlerts}
            setAlertForm={setAlertForm}
            setAlerts={portfolio.setAlerts}
          />
        )}

        {tab === 'members' && (
          <MembersTab
            {...sharedPortfolioProps}
            openMemberModal={openMemberModal}
            setMemberAction={setMemberAction}
            memberAction={memberAction}
            deleteMember={(id, reassignTo) => portfolio.deleteMember(id, reassignTo, holdings)}
            mergeMembers={portfolio.mergeMembers}
          />
        )}

        {tab === 'budget' && (
          <BudgetTab
            {...budget}
            allCur={allCur} allInv={allInv} totInv={totInv}
            fmtCr={fmtCr} fmtPct={fmtPct}
            api={api} FG={FG} MA={MA} Overlay={Overlay}
          />
        )}

        {tab === 'calendar' && (
          <CalendarTab
            holdings={holdings} goals={goals}
            calMonth={calMonth} setCalMonth={setCalMonth}
          />
        )}

        {tab === 'advisor' && (
          <AdvisorTab
            aiMessages={ai.aiMessages}
            setAiMessages={ai.setAiMessages}
            aiInput={ai.aiInput}
            setAiInput={ai.setAiInput}
            aiLoading={ai.aiLoading}
            askAI={() => ai.askAI(buildPortfolioContext(), aiBottomRef)}
            aiBottomRef={aiBottomRef}
          />
        )}

      </main>

      {/* ── FAB — Add Holding (mobile) ──────────────────────────── */}
      <button className="fab" onClick={() => setModal('add')} title="Add holding">+</button>

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
            <div className="frow">
              <FG label="Principal ₹">
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
          <FG label="Notes (optional)">
            <input className="fi" placeholder="Notes about this goal…" value={goalForm.notes}
              onChange={e => setGoalForm(p => ({ ...p, notes: e.target.value }))}/>
          </FG>
          <MA>
            <button className="btnc" onClick={() => { setModal(null); setGoalForm(BG); setEditGoalId(null); }}>Cancel</button>
            <button className="btns" onClick={() => { portfolio.addGoal(goalForm, editGoalId); setModal(null); setGoalForm(BG); setEditGoalId(null); }}>
              {editGoalId ? 'Update Goal' : 'Save Goal'}
            </button>
          </MA>
        </Overlay>
      )}

      {/* ── Add Alert ───────────────────────────────────────────── */}
      {modal === 'alert' && (
        <Overlay onClose={() => { setModal(null); setAlertForm(BA); }} narrow>
          <div className="modtitle">New Alert</div>
          <FG label="Alert Type">
            <select className="fi fs" value={alertForm.type} onChange={e => setAlertForm(p => ({ ...p, type: e.target.value }))}>
              <option value="ALLOCATION_DRIFT">Allocation over threshold</option>
              <option value="CONCENTRATION">Allocation under threshold</option>
              <option value="RETURN_TARGET">Return below target</option>
            </select>
          </FG>
          {alertForm.type !== 'RETURN_TARGET' && (
            <FG label="Asset Type">
              <select className="fi fs" value={alertForm.assetType} onChange={e => setAlertForm(p => ({ ...p, assetType: e.target.value }))}>
                {Object.entries(AT).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </FG>
          )}
          <FG label="Threshold %">
            <input type="number" className="fi" placeholder="e.g. 60" value={alertForm.threshold}
              onChange={e => setAlertForm(p => ({ ...p, threshold: e.target.value }))}/>
          </FG>
          <FG label="Label">
            <input className="fi" placeholder="Alert description" value={alertForm.label}
              onChange={e => setAlertForm(p => ({ ...p, label: e.target.value }))}/>
          </FG>
          <MA>
            <button className="btnc" onClick={() => { setModal(null); setAlertForm(BA); }}>Cancel</button>
            <button className="btns" onClick={() => { portfolio.addAlert(alertForm); setModal(null); setAlertForm(BA); }}>Save Alert</button>
          </MA>
        </Overlay>
      )}

      {/* ── Add / Edit Member ───────────────────────────────────── */}
      {modal === 'member' && (
        <Overlay onClose={() => { setModal(null); setNewMember({ name: '', relation: '' }); setEditingMemberId(null); }} narrow>
          <div className="modtitle">{editingMemberId ? 'Edit Member' : 'Add Family Member'}</div>
          <FG label="Name">
            <input className="fi" placeholder="e.g. Priya" value={newMember.name}
              onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))}/>
          </FG>
          <FG label="Relation">
            <select className="fi fs" value={newMember.relation} onChange={e => setNewMember(p => ({ ...p, relation: e.target.value }))}>
              {['Self','Spouse','Child','Parent','Sibling','Other'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FG>
          {!editingMemberId && (
            <FG label="">
              <label style={{display:'flex',alignItems:'center',gap:'.5rem',fontSize:'.78rem',color:'var(--text-dim)',cursor:'pointer'}}>
                <input type="checkbox" checked={shareWithFamily} onChange={e => setShareWithFamily(e.target.checked)}/>
                Link as family member (share portfolio access)
              </label>
            </FG>
          )}
          <MA>
            <button className="btnc" onClick={() => { setModal(null); setNewMember({ name: '', relation: '' }); setEditingMemberId(null); }}>Cancel</button>
            <button className="btns" onClick={() => portfolio.saveMember(newMember, editingMemberId, members, shareWithFamily, sharedWithMe, user, () => {
              setModal(null); setNewMember({ name: '', relation: '' }); setEditingMemberId(null);
            })}>
              {editingMemberId ? 'Update' : 'Add Member'}
            </button>
          </MA>
        </Overlay>
      )}

      {/* ── Settings ────────────────────────────────────────────── */}
      {showSettings && (
        <Overlay onClose={() => setShowSettings(false)}>
          <div className="modtitle">⚙ Settings</div>
          <div style={{marginBottom:'1rem'}}>
            <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.35rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Signed in as</div>
            <div style={{fontSize:'.85rem',color:'var(--text)',fontWeight:500}}>{user.email}</div>
          </div>
          <div style={{marginBottom:'1rem'}}>
            <button className="btn-o" onClick={() => { setShowImportHub(true); setShowSettings(false); }}>
              <Download size={13} strokeWidth={2}/> Import Holdings
            </button>
          </div>
          <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem'}}>
            <button className="btn-o" style={{color:'var(--loss)',borderColor:'rgba(220,38,38,.25)'}}
              onClick={() => { if (confirm('Sign out?')) signOut(); }}>
              <LogOut size={13} strokeWidth={2}/> Sign Out
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Import Hub ───────────────────────────────────────────── */}
      {showImportHub && (
        <Overlay onClose={() => setShowImportHub(false)}>
          <div className="modtitle" style={{marginBottom:'1.4rem'}}>
            <Download size={16} strokeWidth={2} style={{display:'inline',verticalAlign:'middle',marginRight:'.45rem'}}/>
            Import Holdings
          </div>

          {/* ── Indian brokers / mutual funds ── */}
          <div style={{fontSize:'.65rem',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,marginBottom:'.5rem'}}>🇮🇳 India</div>
          <div style={{display:'flex',flexDirection:'column',gap:'.45rem',marginBottom:'1.1rem'}}>
            <button className="btn-o" style={{justifyContent:'flex-start',gap:'.65rem',padding:'.55rem .9rem',fontSize:'.82rem'}}
              onClick={() => { casImport.setCasModal(true); setShowImportHub(false); }}>
              <span style={{fontSize:'1rem'}}>📄</span>
              <span>
                <span style={{fontWeight:600}}>NSDL / CDSL CAS</span>
                <span style={{display:'block',fontSize:'.68rem',color:'var(--text-muted)',fontWeight:400,marginTop:'.1rem'}}>Import all mutual funds & demat holdings from your CAS PDF</span>
              </span>
            </button>
<button className="btn-o" style={{justifyContent:'flex-start',gap:'.65rem',padding:'.55rem .9rem',fontSize:'.82rem'}}
              onClick={() => { setShowImportHub(false); setForm(p => ({...p, type:'FD'})); setModal('add'); }}>
              <span style={{fontSize:'1rem'}}>🏦</span>
              <span>
                <span style={{fontWeight:600}}>Fixed Deposit (FD)</span>
                <span style={{display:'block',fontSize:'.68rem',color:'var(--text-muted)',fontWeight:400,marginTop:'.1rem'}}>Scan certificate with AI vision or enter details manually</span>
              </span>
            </button>
          </div>

          {/* ── US / Global ── */}
          <div style={{fontSize:'.65rem',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,marginBottom:'.5rem'}}>🇺🇸 US / Global</div>
          <div style={{display:'flex',flexDirection:'column',gap:'.45rem',marginBottom:'1.1rem'}}>
            <button className="btn-o" style={{justifyContent:'flex-start',gap:'.65rem',padding:'.55rem .9rem',fontSize:'.82rem'}}
              onClick={() => { setShowSnapTrade(true); setShowImportHub(false); }}>
              <span style={{fontSize:'1rem'}}>📥</span>
              <span>
                <span style={{fontWeight:600}}>SnapTrade — US Brokers</span>
                <span style={{display:'block',fontSize:'.68rem',color:'var(--text-muted)',fontWeight:400,marginTop:'.1rem'}}>Connect TD Ameritrade, Schwab, Fidelity, Robinhood &amp; more</span>
              </span>
            </button>
          </div>

          {/* ── CSV / Manual ── */}
          <div style={{fontSize:'.65rem',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-muted)',fontWeight:600,marginBottom:'.5rem'}}>Manual / CSV</div>
          <div style={{display:'flex',flexDirection:'column',gap:'.45rem'}}>
            <button className="btn-o" style={{justifyContent:'flex-start',gap:'.65rem',padding:'.55rem .9rem',fontSize:'.82rem'}}
              onClick={() => { setShowImportHub(false); setModal('import'); }}>
              <span style={{fontSize:'1rem'}}>📊</span>
              <span>
                <span style={{fontWeight:600}}>CSV / Excel Import</span>
                <span style={{display:'block',fontSize:'.68rem',color:'var(--text-muted)',fontWeight:400,marginTop:'.1rem'}}>Upload a spreadsheet of holdings or transactions</span>
              </span>
            </button>
            <button className="btn-o" style={{justifyContent:'flex-start',gap:'.65rem',padding:'.55rem .9rem',fontSize:'.82rem'}}
              onClick={() => { setShowImportHub(false); setModal('add'); }}>
              <span style={{fontSize:'1rem'}}>✏️</span>
              <span>
                <span style={{fontWeight:600}}>Add Manually</span>
                <span style={{display:'block',fontSize:'.68rem',color:'var(--text-muted)',fontWeight:400,marginTop:'.1rem'}}>Enter a single holding — stocks, MF, crypto, FD, PPF, EPF…</span>
              </span>
            </button>
          </div>
        </Overlay>
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

      {/* ── SnapTrade Import ─────────────────────────────────────── */}
      {showSnapTrade && (
        <SnapTradeImport
          onClose={() => setShowSnapTrade(false)}
          members={members}
        />
      )}

      {/* ── Kite Import ──────────────────────────────────────────── */}
      {showKite && (
        <KiteImport
          onClose={() => setShowKite(false)}
          members={members}
          api={api}
        />
      )}

      {/* ── Breeze Import ────────────────────────────────────────── */}
      {showBreeze && (
        <BreezeImport
          onClose={() => setShowBreeze(false)}
          members={members}
          api={api}
        />
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

    </div>
  );
}
