import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase.js';

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

// Lines 1000–1008 + 1215–1325 in App.jsx
export function useShares(user) {
  const [shares,        setShares]        = useState([]);      // shares I've granted
  const [sharedWithMe,  setSharedWithMe]  = useState([]);      // portfolios shared to me
  const [viewingShared, setViewingShared] = useState(null);    // { owner_id, owner_name, role } or null
  const [sharedHoldings, setSharedHoldings] = useState([]);   // holdings from shared portfolios (tagged with _shared)
  const [sharedMembers,  setSharedMembers]  = useState([]);   // members from shared portfolios
  const [shareEmail,    setShareEmail]    = useState("");
  const [shareRole,     setShareRole]     = useState("viewer");
  const [shareLoading,  setShareLoading]  = useState(false);
  const [shareError,    setShareError]    = useState("");

  // ── Share management helpers ── Lines 1215–1325
  async function loadShares() {
    try {
      const [myShares, receivedShares] = await Promise.all([
        api("/api/shares"), api("/api/shares/received"),
      ]);
      setShares(myShares.shares || []);
      setSharedWithMe(receivedShares.shared_with_me || []);
    } catch {}
  }

  async function addShare() {
    if (!shareEmail.trim()) return;
    setShareLoading(true); setShareError("");
    try {
      await api("/api/shares", { method: "POST", body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }) });
      setShareEmail(""); await loadShares();
    } catch (e) { setShareError(e.message); }
    setShareLoading(false);
  }

  async function removeShare(shareId) {
    if (!confirm("Remove this portfolio share? This action cannot be undone.")) return;
    try { await api(`/api/shares/${shareId}`, { method: "DELETE" }); await loadShares(); } catch {}
  }

  async function updateShareRole(shareId, newRole) {
    try { await api(`/api/shares/${shareId}`, { method: "PUT", body: JSON.stringify({ role: newRole }) }); await loadShares(); } catch {}
  }

  async function viewSharedPortfolio(ownerId, ownerName, role) {
    try {
      const resp = await api(`/api/shared-portfolio/${ownerId}`);
      setViewingShared({ owner_id: ownerId, owner_name: resp.owner_name || ownerName, role: resp.role || role });
      const tagged = (resp.holdings || []).map(h => ({
        ...h,
        _shared: true,
        _shared_owner: resp.owner_name || ownerName,
        _shared_owner_id: ownerId,
      }));
      setSharedHoldings(tagged);
      setSharedMembers(resp.portfolio?.members || []);
    } catch (e) { console.error("Shared portfolio load:", e.message); }
  }

  async function exitSharedView() {
    setViewingShared(null);
    setSharedHoldings([]);
    setSharedMembers([]);
  }

  // Lines 1263–1325
  async function loadAllSharedHoldings(members, userEmail) {
    if (sharedWithMe.length === 0) { setSharedHoldings([]); setSharedMembers([]); return; }
    console.log("Loading shared holdings from", sharedWithMe.length, "portfolios:", sharedWithMe.map(s => s.owner_name));
    const myEmail = userEmail?.toLowerCase();
    const mySelfMemberId = members.find(m => m.relation === "Self")?.id || members[0]?.id || null;
    const localMemberByEmail = new Map();
    for (const m of members) {
      if (m.email) localMemberByEmail.set(m.email.trim().toLowerCase(), m.id);
    }
    try {
      const results = await Promise.all(
        sharedWithMe.map(s =>
          api(`/api/shared-portfolio/${s.owner_id}`)
            .then(resp => {
              console.log(`Shared portfolio from ${resp.owner_name}: ${resp.holdings?.length || 0} holdings`);
              const rawMembers = resp.portfolio?.members || [];
              const skipMemberIds = new Map();
              for (const m of rawMembers) {
                if (!m.email) continue;
                const email = m.email.trim().toLowerCase();
                if (email === myEmail) {
                  skipMemberIds.set(m.id, mySelfMemberId);
                } else if (localMemberByEmail.has(email)) {
                  skipMemberIds.set(m.id, localMemberByEmail.get(email));
                }
              }
              return {
                holdings: (resp.holdings || []).map(h => {
                  const localId = h.member_id && skipMemberIds.get(h.member_id);
                  return {
                    ...h,
                    _shared: true,
                    _shared_owner: resp.owner_name || s.owner_name,
                    _shared_owner_id: s.owner_id,
                    member_id: localId || (h.member_id ? `shared_${s.owner_id}_${h.member_id}` : null),
                  };
                }),
                members: rawMembers
                  .filter(m => !skipMemberIds.has(m.id))
                  .map(m => ({
                    ...m,
                    _shared: true,
                    _shared_owner: resp.owner_name || s.owner_name,
                    _shared_owner_id: s.owner_id,
                    id: `shared_${s.owner_id}_${m.id}`,
                  })),
              };
            })
            .catch(e => { console.error(`Failed to load shared portfolio ${s.owner_id}:`, e.message); return { holdings: [], members: [] }; })
        )
      );
      const totalH = results.reduce((s, r) => s + r.holdings.length, 0);
      console.log(`Loaded ${totalH} shared holdings total`);
      setSharedHoldings(results.flatMap(r => r.holdings));
      setSharedMembers(results.flatMap(r => r.members));
    } catch (e) { console.error("loadAllSharedHoldings failed:", e.message); setSharedHoldings([]); setSharedMembers([]); }
  }

  return {
    // State
    shares, setShares,
    sharedWithMe, setSharedWithMe,
    viewingShared, setViewingShared,
    sharedHoldings, setSharedHoldings,
    sharedMembers, setSharedMembers,
    shareEmail, setShareEmail,
    shareRole, setShareRole,
    shareLoading,
    shareError,
    // Handlers
    loadShares,
    addShare,
    removeShare,
    updateShareRole,
    viewSharedPortfolio,
    exitSharedView,
    loadAllSharedHoldings,
  };
}
