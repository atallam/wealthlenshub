// HoldingsTab.jsx — lines 2866–3205 of App.jsx

import { useState } from "react";
import { ClipboardList, Paperclip, Pencil, X as XIcon, Bell } from "lucide-react";
import ConcallPanel from "./ConcallPanel.jsx";

// ── Per-holding alert panel ───────────────────────────────────────────────────

function HoldingAlertPanel({ holding, alerts, setAlerts, onClose }) {
  const holdingAlerts = (alerts || []).filter(
    a => (a.type === "HOLDING_PRICE" || a.type === "HOLDING_RETURN") && a.holdingId === holding.id
  );

  const [form, setForm] = useState({ type: "HOLDING_PRICE", direction: "above", threshold: "" });
  const [saving, setSaving] = useState(false);

  function addAlert() {
    if (!form.threshold) return;
    setSaving(true);
    const typeLabel = form.type === "HOLDING_PRICE" ? "price" : "return";
    const label = `${holding.name} ${typeLabel} ${form.direction} ${form.type === "HOLDING_PRICE" ? "₹" : ""}${form.threshold}${form.type === "HOLDING_RETURN" ? "%" : ""}`;
    const newAlert = {
      id: Math.random().toString(36).slice(2),
      type: form.type,
      direction: form.direction,
      threshold: Number(form.threshold),
      holdingId: holding.id,
      holdingName: holding.name,
      label,
      active: true,
    };
    setAlerts(prev => [...prev, newAlert]);
    setForm({ type: "HOLDING_PRICE", direction: "above", threshold: "" });
    setSaving(false);
  }

  function removeAlert(id) {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  const rowStyle = { display: "flex", alignItems: "center", gap: ".5rem", padding: ".4rem .6rem", borderRadius: 6, background: "var(--bg-muted)", border: "1px solid var(--border)", marginBottom: ".35rem" };
  const badgeStyle = c => ({ fontSize: ".65rem", fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: `${c}1A`, color: c, border: `1px solid ${c}33` });

  return (
    <div style={{ padding: ".75rem", background: "rgba(201,168,76,.03)", border: "1px solid rgba(201,168,76,.15)", borderRadius: 8, margin: ".25rem 0 .5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".6rem" }}>
        <span style={{ fontSize: ".78rem", fontWeight: 700, color: "#c9a84c" }}>🔔 Price / Return Alerts — {holding.name}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><XIcon size={14}/></button>
      </div>

      {holdingAlerts.length === 0 && (
        <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: ".6rem" }}>No alerts set for this holding.</div>
      )}
      {holdingAlerts.map(a => (
        <div key={a.id} style={rowStyle}>
          <span style={badgeStyle(a.direction === "above" ? "#e07c5a" : "#4caf9a")}>{a.direction === "above" ? "▲" : "▼"} {a.direction}</span>
          <span style={badgeStyle("#a084ca")}>{a.type === "HOLDING_PRICE" ? "PRICE" : "RETURN"}</span>
          <span style={{ flex: 1, fontSize: ".75rem", color: "var(--text)" }}>{a.label}</span>
          <button onClick={() => removeAlert(a.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--loss)", padding: 0 }}><XIcon size={12}/></button>
        </div>
      ))}

      {/* Add form */}
      <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap", marginTop: ".5rem" }}>
        <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
          style={{ fontSize: ".72rem", padding: ".3rem .5rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer" }}>
          <option value="HOLDING_PRICE">Price</option>
          <option value="HOLDING_RETURN">Return %</option>
        </select>
        <select value={form.direction} onChange={e => setForm(p => ({ ...p, direction: e.target.value }))}
          style={{ fontSize: ".72rem", padding: ".3rem .5rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer" }}>
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
        <input
          type="number"
          placeholder={form.type === "HOLDING_PRICE" ? "Price (₹)" : "Return (%)"}
          value={form.threshold}
          onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))}
          style={{ fontSize: ".72rem", padding: ".3rem .5rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", width: 110 }}
        />
        <button onClick={addAlert} disabled={!form.threshold || saving}
          style={{ fontSize: ".72rem", padding: ".3rem .75rem", background: "rgba(201,168,76,.15)", border: "1px solid rgba(201,168,76,.4)", color: "#c9a84c", borderRadius: 5, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          + Add Alert
        </button>
      </div>
    </div>
  );
}

const CONCALL_TYPES = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF"]);

// Manual holdings — no live feed, need periodic user updates
const STALE_THRESHOLDS = { FD:90, PPF:90, EPF:90, REAL_ESTATE:180, CASH:14, INSURANCE:365, OTHER:60 };

function computeStale(holdings) {
  const now = Date.now();
  return holdings.filter(h => {
    const thresh = STALE_THRESHOLDS[h.type];
    if (!thresh) return false;
    const lastTouched = h.updated_at ? new Date(h.updated_at) : h.created_at ? new Date(h.created_at) : new Date(0);
    return Math.floor((now - lastTouched) / 864e5) >= thresh;
  });
}

export default function HoldingsTab({
  // Data
  visH,
  allMembers,
  demoMode,
  // Caches
  valINRCache,
  invINRCache,
  valNativeCache,
  invNativeCache,
  // Filter / sort state (shared across tabs via parent)
  filterType,
  setFilterType,
  sortCol,
  setSortCol,
  sortDir,
  setSortDir,
  expandedHolding,
  setExpandedHolding,
  // Actions (functions defined in parent, touch shared state)
  toggleSort,
  editH,
  deleteHolding,
  setTxnForm,
  setTxnHolding,
  setArtifactHolding,
  setModal,
  setShowImportHub,
  loadDemoData,
  // Formatting helpers
  fmt,
  fmtCr,
  fmtCrINR,
  fmtCrNative,
  fmtNative,
  fmtPct,
  ago,
  // Asset type map + USD helpers
  AT,
  isUSDHolding,
  // Transaction form blank
  BT,
  // Price refresh timestamp
  lastPriceRefresh,
  // Holding-level alerts
  alerts,
  setAlerts,
}) {
  const [concallHolding, setConcallHolding] = useState(null);
  const [alertHolding,   setAlertHolding]   = useState(null);
  const [showStaleOnly, setShowStaleOnly] = useState(false);

  // Stale detection — computed before render so JSX can reference staleH + displayH
  const staleH   = computeStale(visH);
  const staleIds = new Set(staleH.map(h => h.id));
  const displayH = showStaleOnly ? visH.filter(h => staleIds.has(h.id)) : visH;

  // ── Price freshness badge helpers ─────────────────────────────
  const livePriceHoldings = visH.filter(h => h.price_fetched_at);
  const priceFreshnessEl = (() => {
    if (!livePriceHoldings.length) return null;
    const oldest = new Date(Math.min(...livePriceHoldings.map(h => new Date(h.price_fetched_at))));
    const ageMs  = Date.now() - oldest.getTime();
    const ageMin = Math.floor(ageMs / 60_000);
    const color  = ageMin < 60 ? "#4caf9a" : ageMin < 240 ? "#c9a84c" : "#e07c5a";
    const label  = ageMin < 1
      ? "just now"
      : ageMin < 60
        ? `${ageMin}m ago`
        : ageMin < 1440
          ? `${Math.floor(ageMin / 60)}h ago`
          : `${Math.floor(ageMin / 1440)}d ago`;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: ".35rem",
        padding: ".2rem .6rem", borderRadius: 20,
        background: `${color}1A`, border: `1px solid ${color}44`,
        fontSize: ".65rem", color, fontWeight: 600,
        marginLeft: ".5rem", verticalAlign: "middle",
        cursor: "default",
      }} title={`Oldest live price fetched at ${oldest.toLocaleTimeString("en-IN")}`}>
        <span style={{width: 6, height: 6, borderRadius: "50%", background: color, display:"inline-block"}}/>
        Prices {label} · {livePriceHoldings.length} live
      </span>
    );
  })();

  return (
    <div className="card">
      {/* ── Live price freshness badge ── */}
      {priceFreshnessEl && (
        <div style={{marginBottom: ".55rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".35rem"}}>
          <span style={{fontSize: ".7rem", color: "var(--text-muted)"}}>Live prices:</span>
          {priceFreshnessEl}
        </div>
      )}
      {/* ── Data Freshness Banner ── */}
      {(()=>{
        const srcDates = {};
        for (const h of visH) {
          if (!h.source_date) continue;
          const src = h.source === "cas" ? (h.brokerage_name || "CAS") : (h.source || "manual");
          const mem = allMembers.find(m => m.id === h.member_id);
          const memName = mem?.name || "Unassigned";
          const key = `${src}|${memName}`;
          if (!srcDates[key] || h.source_date > srcDates[key].date) {
            srcDates[key] = { date: h.source_date, src, member: memName };
          }
        }
        const entries = Object.values(srcDates);
        if (entries.length === 0) return null;
        const allSame = entries.every(e => e.date === entries[0].date);
        return (
          <div style={{background:"linear-gradient(135deg,rgba(76,175,154,.08),rgba(160,132,202,.06))",border:"1px solid rgba(76,175,154,.18)",borderRadius:8,padding:".55rem .85rem",marginBottom:".65rem",display:"flex",alignItems:"center",gap:".65rem"}}>
            <div style={{fontSize:"1.15rem",lineHeight:1}}>📅</div>
            <div style={{flex:1}}>
              {allSame ? (
                <div style={{fontSize:".75rem",color:"#4caf9a",fontWeight:500}}>
                  Data as on {new Date(entries[0].date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                  <span style={{color:"var(--text-muted)",fontWeight:400,marginLeft:".5rem"}}>{entries.length} source{entries.length>1?"s":""}</span>
                </div>
              ) : (
                <div style={{display:"flex",flexWrap:"wrap",gap:".25rem .8rem"}}>
                  {entries.map((e,i) => (
                    <div key={i} style={{fontSize:".72rem"}}>
                      <span style={{color:"var(--text-dim)"}}>{e.member}:</span>{" "}
                      <span style={{color:"#4caf9a",fontWeight:500}}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span>
                      <span style={{color:"var(--text-muted)",marginLeft:".3rem",fontSize:".65rem"}}>{e.src}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".15rem"}}>NAVs & prices reflect the CAS statement date, not live market</div>
            </div>
          </div>
        );
      })()}
      {/* ── Stale Holdings Nudge Banner ── */}
      {staleH.length > 0 && (
          <div style={{
            background: "linear-gradient(135deg,rgba(192,148,50,.1),rgba(224,124,90,.07))",
            border: "1px solid rgba(192,148,50,.3)",
            borderRadius: 8,
            padding: ".55rem .85rem",
            marginBottom: ".65rem",
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
            flexWrap: "wrap",
          }}>
            <div style={{fontSize:"1.1rem",lineHeight:1}}>⚠️</div>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:".78rem",color:"#c9a84c",fontWeight:600}}>
                {staleH.length} holding{staleH.length > 1 ? "s" : ""} need updating
              </span>
              <span style={{fontSize:".7rem",color:"var(--text-muted)",marginLeft:".5rem"}}>
                — manually tracked assets with no live price feed
              </span>
            </div>
            <div style={{display:"flex",gap:".4rem",flexShrink:0}}>
              <button
                onClick={() => {
                  setShowStaleOnly(s => {
                    // if turning off, also reset the parent type filter to ALL
                    if (s) setFilterType("ALL");
                    return !s;
                  });
                }}
                style={{
                  padding: ".25rem .65rem",
                  background: showStaleOnly ? "#c9a84c" : "rgba(192,148,50,.15)",
                  border: "1px solid rgba(192,148,50,.4)",
                  color: showStaleOnly ? "#111" : "#c9a84c",
                  borderRadius: 5,
                  fontSize: ".7rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                {showStaleOnly ? "Show all" : `View ${staleH.length} stale`}
              </button>
            </div>
          </div>
      )}

      <div className="tbar">
        <div className={`fchip${filterType==="ALL"?" act":""}`} onClick={()=>{setFilterType("ALL");setShowStaleOnly(false);}}>All</div>
        {Object.entries(AT).map(([k,v])=>(<div key={k} className={`fchip${filterType===k?" act":""}`} onClick={()=>{setFilterType(k);setShowStaleOnly(false);}}>{v.icon} {v.label}</div>))}
      </div>

      {/* ── Export toolbar ── */}
      {displayH.length>0&&(
        <div style={{display:"flex",gap:".5rem",justifyContent:"flex-end",marginBottom:".55rem",flexWrap:"wrap"}}>
          <a href="/api/export/report" target="_blank" rel="noopener noreferrer" className="btn-o" style={{fontSize:".72rem",padding:".28rem .7rem",minHeight:32,borderColor:"rgba(201,168,76,.4)",color:"var(--accent-3, #c9a84c)"}}>
            ⎙ PDF Report
          </a>
          <a href="/api/export/xlsx" download className="btn-o" style={{fontSize:".72rem",padding:".28rem .7rem",minHeight:32,borderColor:"rgba(94,169,160,.4)",color:"var(--accent)"}}>
            ⬇ Excel (full)
          </a>
          <a href="/api/export/holdings" download className="btn-o" style={{fontSize:".72rem",padding:".28rem .7rem",minHeight:32}}>
            ⬇ Holdings CSV
          </a>
          <a href="/api/export/transactions" download className="btn-o" style={{fontSize:".72rem",padding:".28rem .7rem",minHeight:32,borderColor:"rgba(160,132,202,.4)",color:"var(--accent-2)"}}>
            ⬇ Transactions CSV
          </a>
        </div>
      )}

      {displayH.length===0?<div className="empty">{demoMode?"No holdings match the current filter": showStaleOnly ? "No stale holdings found — everything is up to date" : "No holdings yet"} — <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setModal("add")}>add to portfolio</span>{!demoMode&&setShowImportHub&&<>{" or "}<span style={{color:"#5ea9a0",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setShowImportHub(true)}>import from a broker</span></>}{!demoMode&&<>{" or "}<span style={{color:"#a084ca",cursor:"pointer",textDecoration:"underline"}} onClick={loadDemoData}>try sample data</span></>}</div>:(<>
        <div className="ht-desktop"><div className="ht-scroll-outer">
          <table className="ht">
            <thead><tr>
              {[
                {key:"name",    label:"Asset",       align:""},
                {key:"ticker",  label:"Ticker",      align:""},
                {key:"type",    label:"Type",        align:""},
                {key:"member",  label:"Member",      align:""},
                {key:"brokerage",label:"Source",     align:""},
                {key:"units",   label:"Units",       align:"r", tip:"Net units held after all buys minus sells"},
                {key:"avg",     label:"Avg Price",   align:"r", tip:"Weighted average purchase price across all buy transactions"},
                {key:"price",   label:"Cur. Price",  align:"r", tip:"Latest market price — live-fetched or manually entered"},
                {key:"current", label:"Value",       align:"r", tip:"Current market value = units × current price"},
                {key:"gain",    label:"P&L",         align:"r", tip:"Profit & Loss = current value minus total invested (unrealized)"},
              ].map(c=>(
                <th key={c.key} className={c.align} title={c.title||undefined}
                  onClick={()=>toggleSort(c.key)}
                  style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}>
                  {c.label}
                  {c.tip&&<span title={c.tip} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:13,height:13,borderRadius:"50%",border:"1px solid var(--border)",fontSize:"10px",color:"var(--text-muted)",marginLeft:3,cursor:"help",verticalAlign:"middle",fontStyle:"normal",fontWeight:400}}>?</span>}
                  {sortCol===c.key
                    ? <span style={{marginLeft:3,fontSize:".72rem",opacity:.7}}>{sortDir==="asc"?"▲":"▼"}</span>
                    : <span style={{marginLeft:3,fontSize:".72rem",opacity:.25}}>⇅</span>}
                </th>
              ))}
              <th style={{width:"130px",minWidth:"130px"}}/>
            </tr></thead>
            <tbody>
              {(()=>{
                // Group holdings into 3 categories — CASH split by currency
                const US_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
                const IN_TYPES = new Set(["IN_STOCK","IN_ETF","MF"]);
                const isUSCash = h => h.type === "CASH" && isUSDHolding(h);
                const isINCash = h => h.type === "CASH" && !isUSDHolding(h);
                const groups = [
                  { key: "us", label: "US Assets", icon: "$", color: "#5a9ce0", items: displayH.filter(h => US_TYPES.has(h.type) || isUSCash(h)) },
                  { key: "in", label: "Indian Assets", icon: "₹", color: "#e07c5a", items: displayH.filter(h => IN_TYPES.has(h.type) || isINCash(h)) },
                  { key: "other", label: "Other Assets", icon: "📦", color: "#c9a84c", items: displayH.filter(h => !US_TYPES.has(h.type) && !IN_TYPES.has(h.type) && h.type !== "CASH") },
                ].filter(g => g.items.length > 0);

                // Total column count: 10 data columns + 1 action = 11
                const COL_COUNT = 11;

                return groups.map((grp, gi) => {
                  const isUSGrp = grp.key === "us";
                  // US groups stay in $; Indian/Other groups use ₹ (INR-converted)
                  const grpCur = isUSGrp
                    ? grp.items.reduce((s, h) => s + (valNativeCache.get(h.id)||0), 0)
                    : grp.items.reduce((s, h) => s + (valINRCache.get(h.id)||0), 0);
                  const grpInv = isUSGrp
                    ? grp.items.reduce((s, h) => { const v=invNativeCache.get(h.id); return v==null?s:s+v; }, 0)
                    : grp.items.reduce((s, h) => { const v=invINRCache.get(h.id); return v==null?s:s+v; }, 0);
                  const grpCurINR = isUSGrp ? grp.items.reduce((s, h) => s + (valINRCache.get(h.id)||0), 0) : grpCur;
                  const grpG = grpCur - grpInv;
                  const grpP = grpInv > 0 ? (grpG / grpInv) * 100 : 0;
                  const fmtGrpCr = n => isUSGrp ? fmtCrNative(n, {currency:"USD"}) : fmtCr(n);
                  return [
                    // Spacer row between groups (skip for first)
                    gi > 0 && <tr key={`spc_${grp.key}`}><td colSpan={11} style={{padding:0,height:"18px",background:"transparent",border:"none"}}/></tr>,
                    // Section header row
                    <tr key={`hdr_${grp.key}`} style={{background:`${grp.color}0D`}}>
                      <td colSpan={8} style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span style={{fontSize:".78rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>
                          {grp.icon} {grp.label}
                        </span>
                        <span style={{fontSize:".65rem",color:"var(--text-muted)",marginLeft:10}}>{grp.items.length} holding{grp.items.length!==1?"s":""}</span>
                      </td>
                      <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:".76rem",color:grp.color,fontWeight:600}}>{fmtGrpCr(grpCur)}</span>
                        {isUSGrp
                          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"rgba(201,168,76,.75)",fontWeight:600}}>≈ {fmtCrINR(grpCurINR)}</div>
                          : null}
                      </td>
                      <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                        <span className={`mono${grpG>=0?" gain":" loss"}`} style={{fontSize:".72rem",fontWeight:600}}>{grpG>=0?"+":""}{fmtGrpCr(grpG)} ({fmtPct(grpP)})</span>
                      </td>
                      <td style={{borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}/>
                    </tr>,
                    // Holdings rows within this group
                    ...grp.items.map(h => {
                  const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id),hasInv=inv!=null&&inv>0,g=hasInv?cur-inv:null,p=hasInv?(g/inv)*100:null;
                  const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                  const a = h.type==="CASH" ? {..._a, label: isUSDHolding(h)?"Cash USD":"Cash INR", icon: isUSDHolding(h)?"💵":"₹"} : _a;
                  const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                  const isLive=!!h.price_fetched_at;
                  const units   = h.net_units ?? h.units ?? null;
                  const avgCost = h.avg_cost  ?? h.purchase_price ?? h.purchase_nav ?? null;
                  const isUS    = isUSDHolding(h);
                  const nativeSym = isUS ? "$" : "₹";
                  const fmtH = n => fmtNative(n, h);  // native formatter for this holding

                  const avgDisplay = avgCost
                    ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                        {nativeSym}{h.type==="MF"?Number(avgCost).toFixed(4):Number(avgCost).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—</span>;

                  const rawPrice = h.type==="MF" ? (h.current_nav||h.purchase_nav||null) : (h.current_price||h.purchase_price||null);
                  const curPriceDisplay = rawPrice
                    ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>
                        {nativeSym}{h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                      </span>
                    : <span style={{color:"var(--text-muted)"}}>—</span>;

                  const brokerLabel = h.brokerage_name && h.brokerage_name !== "Unknown" ? h.brokerage_name : null;
                  const src = h.source || "manual";
                  const srcLabel = src === "snaptrade" ? "SnapTrade" : src === "csv" || src === "import" ? "CSV" : src === "cas" ? "CAS" : "Manual";

                  return [
                    <tr key={h.id}>
                      <td>
                        <div className="hn">{h.name}</div>
                        <div className="hm">{mn}</div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          const matLabel=new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"});
                          return<div style={{marginTop:3,display:"inline-flex",alignItems:"center",gap:4,
                            fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                            background:mc+"22",color:mc,border:`1px solid ${mc}44`}}>
                            🏦 {matLabel} · {dLeft<=0?"Matured":`${dLeft}d`}
                            {h.interest_rate?<span style={{opacity:.8}}> · {h.interest_rate}%</span>:null}
                          </div>;
                        })()}
                        {h.type==="FD"&&h.currency&&h.currency!=="INR"&&(
                          <span style={{marginLeft:4,fontSize:".65rem",fontWeight:700,padding:"2px 6px",borderRadius:4,
                            background:"rgba(90,156,224,.15)",color:"#5a9ce0",border:"1px solid rgba(90,156,224,.3)"}}>
                            {h.currency}
                          </span>
                        )}
                        {h.type==="INSURANCE"&&(()=>{
                          const POLICY_ICON={TERM:"🛡️",ENDOWMENT:"💰",ULIP:"📈",WHOLE_LIFE:"🔄",HEALTH:"🏥",VEHICLE:"🚗"};
                          const pIcon=POLICY_ICON[h.policy_type]||"🛡️";
                          const dLeft=h.maturity_date?Math.ceil((new Date(h.maturity_date)-Date.now())/864e5):null;
                          const mc=dLeft===null?"#e07b8c":dLeft>180?"#4caf9a":dLeft>60?"#f0a050":"#e07c5a";
                          const matLabel=h.maturity_date?new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"}):null;
                          const freqLabel={ANNUAL:"yr",SEMI:"6mo",QUARTERLY:"qtr",MONTHLY:"mo"}[h.premium_frequency||"ANNUAL"];
                          return<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>
                            <span style={{fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                              background:"rgba(224,123,140,.15)",color:"#e07b8c",border:"1px solid rgba(224,123,140,.3)"}}>
                              {pIcon} {(h.policy_type||"TERM").replace("_"," ")}
                            </span>
                            {h.sum_assured>0&&<span style={{fontSize:".65rem",fontWeight:600,padding:"2px 6px",borderRadius:4,
                              background:"rgba(76,175,154,.1)",color:"#4caf9a",border:"1px solid rgba(76,175,154,.25)"}}>
                              Cover ₹{(h.sum_assured/100000).toFixed(0)}L
                            </span>}
                            {h.premium>0&&<span style={{fontSize:".65rem",padding:"2px 6px",borderRadius:4,
                              background:"var(--bg-muted)",color:"var(--text-muted)",border:"1px solid var(--border)"}}>
                              ₹{Math.round(h.premium/1000)}K/{freqLabel}
                            </span>}
                            {matLabel&&<span style={{fontSize:".65rem",padding:"2px 6px",borderRadius:4,
                              background:mc+"22",color:mc,border:`1px solid ${mc}44`}}>
                              {dLeft<=0?"Expired":dLeft===null?"":dLeft>365?`${Math.round(dLeft/365)}yr`:`${dLeft}d`} · {matLabel}
                            </span>}
                          </div>;
                        })()}
                      </td>
                      <td>
                        {(h.ticker||h.scheme_code)
                          ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".73rem",color:"#c9a84c",background:"rgba(201,168,76,.08)",padding:"2px 7px",borderRadius:3,border:"1px solid rgba(201,168,76,.2)"}}>
                              {h.ticker||`SC:${h.scheme_code}`}
                            </span>
                          : <span style={{fontSize:".7rem",color:"var(--text-muted)"}}>—</span>
                        }
                      </td>
                      <td><span className="tbadge2" style={{background:a.color+"22",color:a.color}}>{a.icon} {a.label}</span></td>
                      <td className="dim">
                        {mn}
                      </td>
                      <td>
                        {brokerLabel
                          ? <div><span style={{fontSize:".65rem",background:"rgba(167,139,250,.08)",color:"rgba(167,139,250,.7)",padding:"2px 6px",borderRadius:3,border:"1px solid rgba(167,139,250,.15)"}}>{brokerLabel}</span>
                              <div style={{fontSize:".72rem",color:"var(--text-muted)",marginTop:2}}>{srcLabel}</div></div>
                          : <span style={{fontSize:".65rem",color:"var(--text-muted)"}}>{srcLabel}</span>
                        }
                      </td>
                      <td className="r">
                        {units!=null
                          ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text)"}}>{Number(units).toLocaleString("en-IN",{maximumFractionDigits:4})}</span>
                          : <span style={{color:"var(--text-muted)"}}>—</span>}
                      </td>
                      <td className="r">{avgDisplay}</td>
                      <td className="r">
                        <div>{curPriceDisplay}</div>
                        {isLive&&<div style={{fontSize:".65rem",color:"#4caf9a",marginTop:1}}>● {ago(h.price_fetched_at)}</div>}
                      </td>
                      <td className="r">
                        <div style={{fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:".78rem"}}>{fmtCrNative(cur, h)}</div>
                      </td>
                      <td className="r">
                        {g===null
                          ? <div style={{fontSize:".7rem",color:"var(--text-muted)"}}>— no cost basis</div>
                          : <>
                            <div className={`mono${g>=0?" gain":" loss"}`} style={{fontSize:".78rem"}}>{g>=0?"+":""}{fmtNative(Math.abs(g), h)}</div>
                            <div className={`mono${p>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(p)}</div>
                          </>
                        }
                      </td>
                      <td style={{width:"130px",minWidth:"130px"}}>
                        <div style={{display:"flex",gap:3,alignItems:"center",justifyContent:"flex-end",width:"100%"}}>
                          {/* Concall — always reserve space, hide when not applicable */}
                          <button className="delbtn" title="Earnings call analysis" aria-label="Concall analysis"
                            onClick={()=>CONCALL_TYPES.has(h.type)&&setConcallHolding(concallHolding?.id===h.id?null:h)}
                            style={{
                              visibility: CONCALL_TYPES.has(h.type) ? "visible" : "hidden",
                              color: concallHolding?.id===h.id ? "#a084ca" : "var(--text-muted)",
                              fontWeight: concallHolding?.id===h.id ? 700 : 400,
                            }}>
                            ✦
                          </button>
                          {/* Holding Alerts */}
                          {(() => {
                            const hAlerts = (alerts||[]).filter(a => (a.type==="HOLDING_PRICE"||a.type==="HOLDING_RETURN") && a.holdingId===h.id);
                            return (
                              <button className="delbtn" title="Price / return alerts" aria-label="Holding alerts"
                                onClick={()=>setAlertHolding(alertHolding?.id===h.id?null:h)}
                                style={{color: hAlerts.length>0?"#c9a84c":alertHolding?.id===h.id?"#c9a84c":"var(--text-muted)"}}>
                                <Bell size={13} strokeWidth={1.8}/>
                                {hAlerts.length>0&&<span style={{fontSize:".65rem",marginLeft:1}}>{hAlerts.length}</span>}
                              </button>
                            );
                          })()}
                          {/* Transactions */}
                          <button className="delbtn" title="View transactions" aria-label="View transactions"
                            onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}}
                            style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)",gap:".25rem",fontSize:".72rem"}}>
                            <ClipboardList size={13} strokeWidth={1.8}/>
                            {(h.transaction_count??h.transactions?.length??0)>0&&<span>{h.transaction_count??h.transactions?.length}</span>}
                          </button>
                          {/* Documents */}
                          <button className="delbtn" title="Attach documents" aria-label="Attach documents"
                            onClick={()=>setArtifactHolding(h)}
                            style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)",gap:".25rem",fontSize:".72rem"}}>
                            <Paperclip size={13} strokeWidth={1.8}/>
                            {(h.artifacts||[]).length>0&&<span>{h.artifacts.length}</span>}
                          </button>
                          {/* Edit — always reserve space */}
                          <button className="delbtn" title="Modify holding" aria-label="Modify holding"
                            onClick={()=>editH(h)}
                            style={{
                              visibility: (!h.source||h.source==="manual") ? "visible" : "hidden",
                              color: "rgba(90,156,224,.65)",
                            }}><Pencil size={13} strokeWidth={1.8}/></button>
                          {/* Delete — always reserve space */}
                          <button className="delbtn" title="Delete holding" aria-label="Delete holding"
                            onClick={()=>deleteHolding(h.id)}
                            style={{visibility: (!h.source||h.source==="manual") ? "visible" : "hidden", color:"var(--loss)"}}>
                            <XIcon size={13} strokeWidth={2}/>
                          </button>
                        </div>
                      </td>
                    </tr>,
                    concallHolding?.id===h.id && (
                      <tr key={`concall_${h.id}`}>
                        <td colSpan={11} style={{padding:"0 .65rem .65rem",background:"rgba(160,132,202,.02)"}}>
                          <ConcallPanel holding={h} onClose={()=>setConcallHolding(null)} />
                        </td>
                      </tr>
                    ),
                    alertHolding?.id===h.id && (
                      <tr key={`alert_${h.id}`}>
                        <td colSpan={11} style={{padding:"0 .65rem .65rem",background:"rgba(201,168,76,.02)"}}>
                          <HoldingAlertPanel holding={h} alerts={alerts} setAlerts={setAlerts} onClose={()=>setAlertHolding(null)} />
                        </td>
                      </tr>
                    ),
                  ];
                    })
                  ];
                });
              })()}
            </tbody>
            {/* Totals footer row */}
            {displayH.length>0&&(()=>{
              const totI=displayH.reduce((s,h)=>{ const v=invINRCache.get(h.id); return v==null?s:s+v; },0);
              const totC=displayH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              const totG=totC-totI;
              const totP=totI>0?(totG/totI)*100:0;
              return(
              <tfoot>
                <tr style={{borderTop:"2px solid rgba(201,168,76,.2)"}}>
                  <td colSpan={8} style={{padding:".75rem .65rem",fontSize:".7rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-dim)",fontWeight:600}}>Total · {displayH.length} holding{displayH.length!==1?"s":""}</td>
                  <td className="r" style={{padding:".75rem .65rem"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#c9a84c",fontSize:".88rem"}}>{fmtCr(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"rgba(201,168,76,.8)",marginTop:1,fontWeight:600}}>≈ {fmtCrINR(totC)}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".65rem",color:"var(--text-muted)",marginTop:1}}>inv. {fmtCr(totI)}</div>
                  </td>
                  <td className="r" style={{padding:".75rem .65rem"}}>
                    <div className={`mono${totG>=0?" gain":" loss"}`} style={{fontWeight:600,fontSize:".83rem"}}>{totG>=0?"+":""}{fmtCr(totG)}</div>
                    <div className={`mono${totP>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(totP)}</div>
                  </td>
                  <td style={{padding:".75rem .65rem"}}/>
                </tr>
              </tfoot>);
            })()}
          </table>
        </div></div>{/* end ht-desktop */}
        {/* ── Mobile holding cards ── */}
        <div className="m-holdings-list">
          {(()=>{
            const US_T=new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
            const IN_T=new Set(["IN_STOCK","IN_ETF","MF"]);
            const isUSCash=h=>h.type==="CASH"&&isUSDHolding(h);
            const isINCash=h=>h.type==="CASH"&&!isUSDHolding(h);
            const groups=[
              {key:"us",label:"US Assets",icon:"$",color:"#5a9ce0",items:displayH.filter(h=>US_T.has(h.type)||isUSCash(h))},
              {key:"in",label:"Indian Assets",icon:"₹",color:"#e07c5a",items:displayH.filter(h=>IN_T.has(h.type)||isINCash(h))},
              {key:"other",label:"Other Assets",icon:"📦",color:"#c9a84c",items:displayH.filter(h=>!US_T.has(h.type)&&!IN_T.has(h.type)&&h.type!=="CASH")},
            ].filter(g=>g.items.length>0);
            return groups.map((grp,gi)=>{
              const isUSGrp=grp.key==="us";
              const grpCur=isUSGrp
                ?grp.items.reduce((s,h)=>s+(valNativeCache.get(h.id)||0),0)
                :grp.items.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              const grpInv=isUSGrp
                ?grp.items.reduce((s,h)=>{ const v=invNativeCache.get(h.id); return v==null?s:s+v; },0)
                :grp.items.reduce((s,h)=>{ const v=invINRCache.get(h.id); return v==null?s:s+v; },0);
              const grpG=grpCur-grpInv;
              const grpP=grpInv>0?(grpG/grpInv)*100:0;
              const fmtGrpCr=n=>isUSGrp?fmtCrNative(n,{currency:"USD"}):fmtCr(n);
              return(<div key={grp.key} style={gi>0?{marginTop:"1rem"}:{}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:".6rem .5rem",marginBottom:".35rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`,background:`${grp.color}0D`,borderRadius:"4px 4px 0 0"}}>
                  <span style={{fontSize:".76rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>{grp.icon} {grp.label} <span style={{color:"var(--text-muted)",fontWeight:400}}>{grp.items.length}</span></span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:grp.color,fontWeight:600}}>{fmtGrpCr(grpCur)} <span className={grpG>=0?"gain":"loss"} style={{fontSize:".65rem"}}>{grpG>=0?"+":""}{fmtPct(grpP)}</span></span>
                </div>
                {grp.items.map(h=>{
                  const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id),hasInv=inv!=null&&inv>0,g=hasInv?cur-inv:null,p=hasInv?(g/inv)*100:null;
                  const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                  const a=h.type==="CASH"?{..._a,label:isUSDHolding(h)?"Cash USD":"Cash INR",icon:isUSDHolding(h)?"💵":"₹"}:_a;
                  const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                  const units=h.net_units??h.units??null;
                  const isUS=isUSDHolding(h);
                  const nativeSym=isUS?"$":"₹";
                  const isExp=expandedHolding===h.id;
                  const rawPrice=h.type==="MF"?(h.current_nav||h.purchase_nav||null):(h.current_price||h.purchase_price||null);
                  return(<div key={h.id} className="m-hc" onClick={()=>setExpandedHolding(isExp?null:h.id)}>
                    <div className="m-hc-top">
                      <div style={{flex:1,minWidth:0}}>
                        <div className="m-hc-name">{h.name}</div>
                        <div className="m-hc-ticker">
                          {h.ticker||h.scheme_code||""}{mn&&<span style={{opacity:.5}}> · {mn}</span>}
                        </div>
                      </div>
                      <span className="tbadge2" style={{background:a.color+"22",color:a.color,flexShrink:0,marginLeft:8}}>{a.icon} {a.label}</span>
                    </div>
                    <div className="m-hc-grid">
                      <div className="m-hc-cell">
                        <span className="m-hc-lbl">Current Value</span>
                        <span className="m-hc-val" style={{fontWeight:600,color:"#c9a84c"}}>{fmtCrNative(cur,h)}</span>
                      </div>
                      <div className="m-hc-cell" style={{textAlign:"right"}}>
                        <span className="m-hc-lbl">P&L</span>
                        {g===null
                          ? <span className="m-hc-val" style={{color:"var(--text-muted)",fontSize:".7rem"}}>— no cost basis</span>
                          : <span className={`m-hc-val ${g>=0?"gain":"loss"}`} style={{fontWeight:600}}>
                              {g>=0?"+":""}{fmtNative(Math.abs(g),h)} ({fmtPct(p)})
                            </span>
                        }
                      </div>
                      {isExp&&<>
                        <div className="m-hc-cell">
                          <span className="m-hc-lbl">Units</span>
                          <span className="m-hc-val">{units!=null?Number(units).toLocaleString(undefined,{maximumFractionDigits:4}):"—"}</span>
                        </div>
                        <div className="m-hc-cell" style={{textAlign:"right"}}>
                          <span className="m-hc-lbl">Invested</span>
                          <span className="m-hc-val">{inv==null?"— (CAS import)":fmtCrNative(inv,h)}</span>
                        </div>
                        <div className="m-hc-cell">
                          <span className="m-hc-lbl">Cur. Price</span>
                          <span className="m-hc-val">{rawPrice?`${nativeSym}${h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}`:"—"}</span>
                          {h.price_fetched_at && (
                            <span style={{fontSize:".65rem",color:"#4caf9a",marginTop:2,display:"flex",alignItems:"center",gap:3}}>
                              <span style={{width:5,height:5,borderRadius:"50%",background:"#4caf9a",display:"inline-block"}}/>
                              {ago(h.price_fetched_at)}
                            </span>
                          )}
                        </div>
                        <div className="m-hc-cell" style={{textAlign:"right"}}>
                          <span className="m-hc-lbl">Source</span>
                          <span className="m-hc-val" style={{fontSize:".68rem"}}>{h.source==="snaptrade"?"SnapTrade":h.source==="csv"||h.source==="import"?"CSV":h.source==="cas"?"CAS":"Manual"}</span>
                        </div>
                        {(h.type==="FD"||h.type==="CD")&&h.maturity_date&&(()=>{
                          const dLeft=Math.ceil((new Date(h.maturity_date)-Date.now())/864e5);
                          const mc=dLeft>90?"#4caf9a":dLeft>30?"#f0a050":"#e07c5a";
                          return<div className="m-hc-cell" style={{gridColumn:"1/-1"}}>
                            <span className="m-hc-lbl">Maturity {h.currency&&h.currency!=="INR"&&<span style={{marginLeft:4,fontSize:".65rem",fontWeight:700,padding:"1px 5px",borderRadius:3,background:"rgba(90,156,224,.15)",color:"#5a9ce0",border:"1px solid rgba(90,156,224,.3)"}}>{h.currency}</span>}</span>
                            <span className="m-hc-val" style={{color:mc,fontWeight:600}}>
                              {new Date(h.maturity_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                              {" "}· {dLeft<=0?"Matured":`${dLeft}d remaining`}
                              {h.interest_rate?` · ${h.interest_rate}% p.a.`:""}
                            </span>
                          </div>;
                        })()}
                      </>}
                    </div>
                    {!isExp&&<div style={{textAlign:"center",marginTop:".4rem",fontSize:".65rem",color:"var(--text-muted)",letterSpacing:".08em",textTransform:"uppercase"}}>tap for details</div>}
                    {isExp&&<div className="m-hc-actions" onClick={e=>e.stopPropagation()}>
                      <button title="Transactions" aria-label="Transactions"
                        onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}}
                        style={{color:(h.transaction_count??h.transactions?.length??0)>0?"#a084ca":"var(--text-muted)",gap:".3rem",fontSize:".72rem"}}>
                        <ClipboardList size={16} strokeWidth={1.8}/>
                        {(h.transaction_count??h.transactions?.length??0)>0&&<span>{h.transaction_count??h.transactions?.length}</span>}
                      </button>
                      <button title="Documents" aria-label="Documents"
                        onClick={()=>setArtifactHolding(h)}
                        style={{color:(h.artifacts||[]).length>0?"#c9a84c":"var(--text-muted)",gap:".3rem",fontSize:".72rem"}}>
                        <Paperclip size={16} strokeWidth={1.8}/>
                        {(h.artifacts||[]).length>0&&<span>{h.artifacts.length}</span>}
                      </button>
                      {(!h.source||h.source==="manual")&&<button title="Edit" aria-label="Edit" onClick={()=>editH(h)} style={{color:"rgba(90,156,224,.65)"}}>
                        <Pencil size={16} strokeWidth={1.8}/>
                      </button>}
                      {(!h.source||h.source==="manual")&&<button title="Delete" aria-label="Delete" onClick={()=>deleteHolding(h.id)} style={{color:"var(--loss)"}}>
                        <XIcon size={16} strokeWidth={2}/>
                      </button>}
                    </div>}
                  </div>);
                })}
              </div>);
            });
          })()}
          {/* Mobile totals */}
          {displayH.length>0&&(()=>{
            const totI=displayH.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
            const totC=displayH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            const totG=totC-totI;const totP=totI>0?(totG/totI)*100:0;
            return(<div className="m-hc-totals">
              <div><div className="m-hc-lbl">{displayH.length} holding{displayH.length!==1?"s":""} · Invested</div><div className="m-hc-val" style={{color:"var(--text-dim)",marginTop:".15rem"}}>{fmtCr(totI)}</div></div>
              <div style={{textAlign:"right"}}><div className="m-hc-lbl">Current · P&L</div><div className="m-hc-val" style={{color:"#c9a84c",marginTop:".15rem"}}>{fmtCr(totC)}</div><div className={`m-hc-val ${totG>=0?"gain":"loss"}`} style={{fontWeight:600,fontSize:".75rem"}}>{totG>=0?"+":""}{fmtCr(totG)} ({fmtPct(totP)})</div></div>
            </div>);
          })()}
        </div>
      </>)}
      <div style={{marginTop:"1rem",padding:".75rem 1rem",background:"var(--bg-muted)",borderRadius:8,fontSize:".72rem",color:"var(--text-dim)",lineHeight:1.6}}>
        <strong style={{color:"var(--text)"}}>Live prices:</strong> Add NSE ticker (e.g. <code style={{color:"#c9a84c"}}>RELIANCE</code>) or AMFI scheme code (e.g. <code style={{color:"#c9a84c"}}>119551</code>) when adding a holding, then click <strong style={{color:"var(--text)"}}>⟳ Live Prices</strong> to auto-fetch. 📎 button attaches contract notes, statements, or receipts to any holding.
      </div>
    </div>
  );
}
