import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase.js';
import { uid, setLiveUsdInr, getLiveUsdInr, setPpfRate, setEpfRate } from '../utils.js';
import { BF, BG, BA, BT } from '../constants.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/shared/Toast.jsx';

// api() imported from src/lib/api.js above

// BF, BG, BA, BT imported from constants.js above

export function usePortfolio(user) {
  const toast = useToast();
  const [members,     setMembers]     = useState([]);
  const [holdings,    setHoldings]    = useState([]);
  const [goals,       setGoals]       = useState([]);
  const [alerts,      setAlerts]      = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [loaded,   setLoaded]   = useState(false);
  const [assetTypes, setAssetTypes] = useState([]);
  const [syncSt,   setSyncSt]   = useState("idle");
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [lastPriceRefresh, setLastPriceRefresh] = useState(null);
  const [priceCount, setPriceCount] = useState(0);
  const [profile, setProfile] = useState(null);
  const [wealthSnapshots, setWealthSnapshots] = useState([]);
  const [benchmark, setBenchmark] = useState(null);
  const [demoMode, setDemoMode] = useState(false);

  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);

  // ── Load data when signed in (fully parallelized) ──
  // Lines 1163–1213 in App.jsx
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [portfolio, hlds, prof, ats] = await Promise.all([
          api("/api/portfolio"),
          api("/api/holdings"),
          api("/api/profile").catch(() => null),
          api("/api/asset-types").catch(() => []),
        ]);
        if (portfolio) {
          setMembers(portfolio.members || []);
          setGoals(portfolio.goals || []);
          setAlerts(portfolio.alerts || []);
          setLiabilities(portfolio.liabilities || []);
        } else {
          setMembers([]);
          setGoals([]);
          setAlerts([]);
          setLiabilities([]);
        }
        setHoldings(hlds || []);
        const fetched = (hlds || []).filter(h => h.price_fetched_at).map(h => new Date(h.price_fetched_at));
        if (fetched.length) setLastPriceRefresh(new Date(Math.max(...fetched)));
        if (prof) {
          setProfile(prof);
          // Apply user-configured rates so PPF/EPF values update immediately
          if (prof.settings?.ppf_rate) setPpfRate(prof.settings.ppf_rate);
          if (prof.settings?.epf_rate) setEpfRate(prof.settings.epf_rate);
        }
        try { const fxData = await api("/api/forex/usdinr"); if (fxData?.rate) setLiveUsdInr(fxData.rate); } catch {}
        if (ats?.length) setAssetTypes(ats);
      } catch (e) { console.error("Load error", e); }
      setLoaded(true);
      api("/api/snapshots?months=24").then(d => setWealthSnapshots(d?.snapshots || [])).catch(() => {});
      api("/api/benchmark?period=1Y").then(d => setBenchmark(d)).catch(() => {});
    })();
  }, [user]);

  // ── Persist portfolio config (debounced) ── Lines 1328–1347
  const savePortfolio = useCallback((m, g, a, l) => {
    setSyncSt("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api("/api/portfolio", { method: "POST", body: JSON.stringify({ members: m, goals: g, alerts: a, liabilities: l }) });
        setSyncSt("saved");
      } catch (e) {
        setSyncSt("error");
        toast.error("Portfolio save failed — changes are NOT persisted: " + (e?.message || "unknown error"));
      }
    }, 1000);
  }, [toast]);

  useEffect(() => {
    if (loaded && user) {
      if (!initialLoadDone.current) { initialLoadDone.current = true; return; }
      savePortfolio(members, goals, alerts, liabilities);
    }
  }, [members, goals, alerts, liabilities, loaded, user, savePortfolio]);

  // ── Snapshot history reset ──
  async function resetSnapshotHistory() {
    try {
      await api("/api/snapshots/history", { method: "DELETE" });
      // Reload snapshots — will now contain only the most recent month
      const data = await api("/api/snapshots?months=24");
      setWealthSnapshots(data?.snapshots || []);
    } catch (e) { toast.error("Reset failed: " + e.message); }
  }

  // ── Real-time price refresh ── Lines 1351–1363
  async function refreshPrices() {
    if (priceRefreshing) return;
    setPriceRefreshing(true);
    try {
      const result = await api("/api/prices/refresh", { method: "POST" });
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
      setLastPriceRefresh(new Date());
      setPriceCount(result.updated || 0);
    } catch (e) { toast.error("Price refresh failed: " + e.message); }
    setPriceRefreshing(false);
  }

  // ── CRUD: Holdings ── Lines 1366–1458
  async function saveHolding(form, editHolding, onSuccess) {
    const h = {
      ...form,
      id: editHolding?.id || uid(),
      principal:      +form.principal || null,
      interest_rate:  +form.interest_rate || null,
      purchase_value: +form.purchase_value || null,
      current_value:  +form.current_value || null,
      usd_inr_rate:   +form.usd_inr_rate || getLiveUsdInr(),
      sum_assured:    form.sum_assured === "" || form.sum_assured == null ? null : +form.sum_assured,
      premium:        form.premium === "" || form.premium == null ? null : +form.premium,
    };
    try {
      if (editHolding) {
        await api(`/api/holdings/${h.id}`, { method: "PUT", body: JSON.stringify(h) });
      } else {
        await api("/api/holdings", { method: "POST", body: JSON.stringify(h) });
      }
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
      if (onSuccess) onSuccess(hlds, h, !editHolding);
    } catch (e) { toast.error("Save failed: " + e.message); }
  }

  async function addTransaction(txnForm, globalMfAmount, globalMfNav, txnHolding, txnSavingRef) {
    if (!txnForm.holding_id) { toast.error("Select a holding first"); return; }
    if (!txnForm.txn_date) { toast.error("Select a date for the transaction"); return; }
    if (txnSavingRef && txnSavingRef.current) return;

    const CASH_EVENTS = new Set(["DIVIDEND","BONUS","RIGHTS","SWP"]);
    const isCashEvent = CASH_EVENTS.has(txnForm.txn_type);

    let finalUnits, finalPrice, finalAmount;

    if (isCashEvent) {
      // Cash events bypass MF NAV logic — use form values directly
      if (txnForm.txn_type === "DIVIDEND") {
        if (!txnForm.amount || Number(txnForm.amount) <= 0) { toast.error("Enter total cash received for dividend"); return; }
        finalAmount = +txnForm.amount;
        finalUnits  = txnForm.units ? +txnForm.units : 0;
        finalPrice  = 0;
      } else if (txnForm.txn_type === "BONUS") {
        if (!txnForm.units || Number(txnForm.units) <= 0) { toast.error("Enter bonus units received"); return; }
        finalUnits  = +txnForm.units;
        finalPrice  = 0;
      } else {
        // RIGHTS / SWP
        if (!txnForm.units || !txnForm.price) { toast.error("Fill in units and price"); return; }
        finalUnits  = +txnForm.units;
        finalPrice  = +txnForm.price;
      }
    } else {
      const selH = holdings.find(h => h.id === txnForm.holding_id);
      const isMFGlobal = selH?.type === "MF";
      finalUnits = +txnForm.units;
      finalPrice = +txnForm.price;
      if (isMFGlobal) {
        if (!globalMfAmount || !globalMfNav?.nav) { toast.error("Enter amount and fetch NAV first"); return; }
        finalUnits = +(+globalMfAmount / globalMfNav.nav).toFixed(4);
        finalPrice = +globalMfNav.nav;
      } else {
        if (!txnForm.units || !txnForm.price) { toast.error("Fill in units and price"); return; }
      }
    }

    if (txnSavingRef) txnSavingRef.current = true;
    try {
      await api("/api/transactions", {
        method: "POST", body: JSON.stringify({
          holding_id: txnForm.holding_id,
          txn_type:   txnForm.txn_type,
          units:      finalUnits,
          price:      finalPrice,
          ...(finalAmount !== undefined ? { amount: finalAmount } : {}),
          price_usd:  txnForm.price_usd ? +txnForm.price_usd : undefined,
          txn_date:   txnForm.txn_date,
          notes:      txnForm.notes || "",
        })
      });
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
      return { hlds };
    } catch (e) { toast.error("Transaction failed: " + e.message); }
    finally { if (txnSavingRef) txnSavingRef.current = false; }
  }

  async function reloadHoldings(holdingId) {
    const hlds = await api("/api/holdings");
    setHoldings(hlds || []);
    return hlds;
  }

  async function deleteTransaction(txnId, holdingId) {
    const ok = await toast.confirm("Delete this transaction? This cannot be undone.", { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/api/transactions/${txnId}`, { method: "DELETE" });
    const hlds = await api("/api/holdings");
    setHoldings(hlds || []);
    return hlds;
  }

  async function deleteHolding(id) {
    const ok = await toast.confirm("Delete this holding and all its transactions? This cannot be undone.", { confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api(`/api/holdings/${id}`, { method: "DELETE" });
    setHoldings(p => p.filter(x => x.id !== id));
  }

  // ── CRUD: Members ── Lines 1713–1820
  function saveMember(newMember, editingMemberId, members, onDone) {
    if (!newMember.name.trim()) return;
    const email = (newMember.email || "").trim().toLowerCase();
    const pan = (newMember.pan || "").trim().toUpperCase();
    const dob = (newMember.dob || "").trim();
    if (editingMemberId) {
      setMembers(p => p.map(m => m.id === editingMemberId ? {
        ...m, name: newMember.name.trim(), relation: newMember.relation, email: email || m.email || "",
        ...(pan ? { pan } : {}), ...(dob ? { dob } : {}),
      } : m));
    } else {
      setMembers(p => [...p, {
        id: uid(), name: newMember.name.trim(), relation: newMember.relation, email: email || "",
        ...(pan ? { pan } : {}), ...(dob ? { dob } : {}),
      }]);
    }
    if (onDone) onDone();
  }

  async function deleteMember(memberId, reassignToId, holdings) {
    if (!memberId) return;
    const m = members.find(x => x.id === memberId);
    if (!m) return;
    const memberHoldings = holdings.filter(h => h.member_id === memberId);
    if (memberHoldings.length > 0 && reassignToId) {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      for (const h of memberHoldings) {
        await fetch("/api/holdings/" + h.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ ...h, member_id: reassignToId }),
        }).catch(() => {});
      }
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
    }
    setMembers(p => p.filter(x => x.id !== memberId));
  }

  async function mergeMembers(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    const sourceHoldings = holdings.filter(h => h.member_id === sourceId);
    for (const h of sourceHoldings) {
      await fetch("/api/holdings/" + h.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ ...h, member_id: targetId }),
      }).catch(() => {});
    }
    setMembers(p => p.filter(x => x.id !== sourceId));
    const hlds = await api("/api/holdings");
    setHoldings(hlds || []);
  }

  // ── CRUD: Goals ── Lines 1821–1845
  function goalDuplicateTypes(form, excludeId, goals) {
    const lt = form.linkedTypes || [];
    if (lt.length === 0) return [];
    const lm = form.linkedMembers || ["all"];
    const conflicts = [];
    goals.forEach(g => {
      if (g.id === excludeId) return;
      const glt = g.linkedTypes || [];
      const glm = g.linkedMembers || ["all"];
      const memberOverlap = lm.includes("all") || glm.includes("all") || lm.some(m => glm.includes(m));
      if (!memberOverlap) return;
      lt.forEach(t => { if (glt.includes(t)) conflicts.push({ type: t, goalName: g.name }); });
    });
    return conflicts;
  }

  function addGoal(goalForm, editGoalId) {
    const conflicts = goalDuplicateTypes(goalForm, editGoalId, goals);
    if (conflicts.length > 0) return;
    if (editGoalId) {
      setGoals(p => p.map(g => g.id === editGoalId ? { ...g, ...goalForm, targetAmount: +goalForm.targetAmount, monthlyContribution: +goalForm.monthlyContribution || 0 } : g));
    } else {
      setGoals(p => { const nextPri = p.length > 0 ? Math.max(...p.map(x => x.priority || 1)) + 1 : 1; return [...p, { id: uid(), ...goalForm, targetAmount: +goalForm.targetAmount, priority: goalForm.priority || nextPri, linkedMembers: goalForm.linkedMembers || ["all"], linkedTypes: goalForm.linkedTypes || [], monthlyContribution: +goalForm.monthlyContribution || 0 }]; });
    }
  }

  function deleteGoal(id) {
    setGoals(p => p.filter(g => g.id !== id));
  }

  // ── CRUD: Alerts ── Line 1846
  function addAlert(alertForm) {
    setAlerts(p => [...p, { id: uid(), ...alertForm, threshold: +alertForm.threshold }]);
  }

  function deleteAlert(id) {
    setAlerts(p => p.filter(a => a.id !== id));
  }

  // ── Demo mode ── Lines 2192–2230
  const SEED_DEMO = null; // SEED is defined in App.jsx; pass SEED as param to loadDemoData if needed
  function loadDemoData(SEED) {
    const demoHoldings = SEED.holdings.map(h => {
      const txns = (SEED.transactions[h.id] || []).map(t => ({
        id: "dt_" + Math.random().toString(36).slice(2, 8),
        holding_id: h.id,
        txn_type: t.type || "BUY",
        units: t.units, price: t.price,
        txn_date: t.date, notes: "Demo",
      }));
      const buys = txns.filter(t => t.txn_type === "BUY");
      const sells = txns.filter(t => t.txn_type === "SELL");
      const buyU = buys.reduce((s, t) => s + Number(t.units), 0);
      const sellU = sells.reduce((s, t) => s + Number(t.units), 0);
      const netU = buyU - sellU;
      const avgC = buyU > 0 ? buys.reduce((s, t) => s + Number(t.units) * Number(t.price), 0) / buyU : 0;
      return {
        ...h, transactions: txns, artifacts: [],
        net_units: netU, avg_cost: avgC, units: netU,
        purchase_price: avgC, purchase_nav: avgC,
        purchase_value: h.purchase_value || avgC * netU,
        start_date: h.start_date || (txns.length ? txns.sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date))[0]?.txn_date : null),
      };
    });
    setHoldings(demoHoldings);
    setMembers(SEED.members);
    setGoals(SEED.goals);
    setAlerts(SEED.alerts);
    setDemoMode(true);
  }

  function exitDemoMode() {
    setDemoMode(false);
    setHoldings([]);
    setMembers([]);
    setGoals([]);
    setAlerts([]);
  }

  return {
    // State
    holdings, setHoldings,
    members,  setMembers,
    goals,    setGoals,
    alerts,   setAlerts,
    liabilities, setLiabilities,
    loaded,
    assetTypes,
    syncSt,
    priceRefreshing,
    lastPriceRefresh,
    priceCount,
    profile,
    wealthSnapshots, setWealthSnapshots,
    benchmark, setBenchmark,
    demoMode,
    // Handlers
    refreshPrices,
    resetSnapshotHistory,
    saveHolding,
    addTransaction,
    reloadHoldings,
    deleteTransaction,
    deleteHolding,
    saveMember,
    deleteMember,
    mergeMembers,
    goalDuplicateTypes,
    addGoal,
    deleteGoal,
    addAlert,
    deleteAlert,
    loadDemoData,
    exitDemoMode,
    savePortfolio,
    // Exported constants needed by callers
    BF, BG, BA, BT, uid,
  };
}
