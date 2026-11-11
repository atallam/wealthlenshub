// HoldingsTab.jsx — lines 2866–3205 of App.jsx

import { useState } from "react";
import MFOverlapPanel from "./MFOverlapPanel.jsx";
import CostBasisModal from "./CostBasisModal.jsx";
import { isMaturedFD, fdDaysLeft } from "../../utils.js";
import { downloadExport, openReportExport, exportToday } from "../../lib/exportDownload.js";
import { MaturedFDBanner, STALE_DEFAULTS, computeStale } from "./holdingsParts.jsx";
import HoldingsDesktopTable from "./HoldingsDesktopTable.jsx";
import HoldingsMobileList from "./HoldingsMobileList.jsx";
import StaleHoldingsBanner from "./StaleHoldingsBanner.jsx";

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
  sortDir,
  expandedHolding,
  setExpandedHolding,
  // Actions (functions defined in parent, touch shared state)
  toggleSort,
  editH,
  deleteHolding,
  resolveFD,
  renewFD,
  setTxnForm,
  setTxnHolding,
  setArtifactHolding,
  api,
  setHoldings,
  setModal,
  setShowImportHub,
  loadDemoData,
  // Formatting helpers
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
  alerts,
  setAlerts,
  // Staleness config (from profile.settings)
  staleThresholds,
  minDisplayDays = 14,
}) {
  // Merge user-configured thresholds with defaults
  const ST = { ...STALE_DEFAULTS, ...(staleThresholds || {}) };

  const [costBasisHolding, setCostBasisHolding] = useState(null);
  const [concallHolding, setConcallHolding] = useState(null);
  const [alertHolding,   setAlertHolding]   = useState(null);
  const [showStaleOnly, setShowStaleOnly] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportBusy, setExportBusy] = useState(null);   // key of in-flight export
  const [exportError, setExportError] = useState("");
  const [exportScope, setExportScope] = useState("view");   // "view" = what is on screen, "all" = everything
  async function runExport(item){
    if(exportBusy) return;
    setExportError(""); setExportBusy(item.key);
    try{
      // Scoped to the rows currently shown (type / member / stale filters); undefined = everything
      const ids = exportScope==="view" ? displayH.map(h=>h.id) : undefined;
      await (item.report ? openReportExport(ids) : downloadExport(item.href, item.file, ids));
      setShowExportMenu(false);
    }
    catch(e){ console.error("Export error:", e); setExportError(e.message||"Export failed"); }
    finally{ setExportBusy(null); }
  }

  // Stale detection — computed before render so JSX can reference staleH + displayH
  const staleH   = computeStale(visH, ST);
  const staleIds = new Set(staleH.map(h => h.id));
  // Matured, unresolved FDs — surfaced above everything else on this tab
  const maturedH = visH.filter(isMaturedFD).sort((a, b) => fdDaysLeft(a) - fdDaysLeft(b));
  const displayH = showStaleOnly ? visH.filter(h => staleIds.has(h.id)) : visH;

  // ── Price freshness badge helpers ─────────────────────────────
  // Only market-price types get live feeds — exclude manual types (FD/PPF/EPF/REAL_ESTATE/CASH/OTHER/INSURANCE)
  const LIVE_PRICE_TYPES = new Set(["US_STOCK","US_ETF","IN_STOCK","IN_ETF","MF","CRYPTO","US_BOND"]);
  const livePriceHoldings = visH.filter(h => h.price_fetched_at && LIVE_PRICE_TYPES.has(h.type));
  const priceFreshnessEl = (() => {
    if (!livePriceHoldings.length) return null;
    // Badge shows the LATEST refresh; holdings that didn't update with it are
    // called out separately. (Showing the oldest timestamp made one stuck
    // holding look like the whole refresh button was broken.)
    const times  = livePriceHoldings.map(h => new Date(h.price_fetched_at).getTime());
    const newest = Math.max(...times);
    const STALE_GAP_MS = 6 * 3600_000;   // >6h older than the latest refresh = didn't update
    const staleLive = livePriceHoldings.filter(h => newest - new Date(h.price_fetched_at).getTime() > STALE_GAP_MS);
    const fmtAge = (ms) => {
      const m = Math.floor(ms / 60_000);
      return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
    };
    const ageMin = Math.floor((Date.now() - newest) / 60_000);
    const color  = ageMin < 60 ? "#4caf9a" : ageMin < 240 ? "#c9a84c" : "#e07c5a";
    const chip = (c) => ({
      display: "inline-flex", alignItems: "center", gap: ".35rem",
      padding: ".2rem .6rem", borderRadius: 20,
      background: `${c}1A`, border: `1px solid ${c}44`,
      fontSize: ".65rem", color: c, fontWeight: 600,
      marginLeft: ".5rem", verticalAlign: "middle", cursor: "default",
    });
    const staleTip = staleLive
      .sort((a, b) => new Date(a.price_fetched_at) - new Date(b.price_fetched_at))
      .map(h => `${h.ticker || h.name} — ${fmtAge(Date.now() - new Date(h.price_fetched_at).getTime())}`)
      .join("\n");
    return (
      <>
        <span style={chip(color)} title={`Latest refresh: ${new Date(newest).toLocaleString("en-IN")}`}>
          <span style={{width: 6, height: 6, borderRadius: "50%", background: color, display:"inline-block"}}/>
          Prices {fmtAge(Date.now() - newest)} · {livePriceHoldings.length - staleLive.length}/{livePriceHoldings.length} live
        </span>
        {staleLive.length > 0 && (
          <span style={chip("#e07c5a")} title={`Didn't update in the latest refresh:\n${staleTip}`}>
            ⚠ {staleLive.length} not updated
          </span>
        )}
      </>
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
        // Group by member + statement source (NSDL / CDSL / CAMS…): each account can be a different month.
        const byKey = {};
        for (const h of visH) {
          if (!h.source_date) continue;
          const mem = allMembers.find(m => m.id === h.member_id);
          const memName = mem?.name || "Unassigned";
          const dep = h.source === "cas" && h.depository && h.depository !== "LEGACY" ? h.depository : "";
          const key = `${memName}|${dep}`;
          if (!byKey[key] || h.source_date > byKey[key].date) byKey[key] = { member: memName, dep, date: h.source_date };
        }
        // Order by allMembers order (matches the top member filter tabs), then source
        const order = (n) => { const i = allMembers.findIndex(m => m.name === n); return i < 0 ? 999 : i; };
        const entries = Object.values(byKey).sort((a, b) => order(a.member) - order(b.member) || a.dep.localeCompare(b.dep));
        if (entries.length === 0) return null;
        const fmt = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        const allSame = entries.every(e => e.date === entries[0].date);
        const newest = entries.reduce((m, e) => (e.date > m ? e.date : m), "");
        const daysBehind = (d) => Math.round((new Date(newest) - new Date(d)) / 86400000);
        return (
          <div style={{background:"linear-gradient(135deg,rgba(76,175,154,.08),rgba(160,132,202,.06))",border:"1px solid rgba(76,175,154,.18)",borderRadius:8,padding:".55rem .85rem",marginBottom:".65rem",display:"flex",alignItems:"center",gap:".65rem"}}>
            <div style={{fontSize:"1.15rem",lineHeight:1}}>📅</div>
            <div style={{flex:1}}>
              {allSame ? (
                <div style={{fontSize:".75rem",color:"#4caf9a",fontWeight:500}}>
                  Data as on {fmt(entries[0].date)}
                  <span style={{color:"var(--text-muted)",fontWeight:400,marginLeft:".5rem"}}>{[...new Set(entries.map(e=>e.member))].join(", ")}</span>
                </div>
              ) : (
                <div style={{display:"flex",flexWrap:"wrap",gap:".25rem .8rem"}}>
                  {entries.map((e,i) => {
                    const behind = daysBehind(e.date);
                    return (
                      <div key={i} style={{fontSize:".72rem"}}>
                        <span style={{color:"var(--text-dim)"}}>{e.member}{e.dep ? ` · ${e.dep}` : ""}:</span>{" "}
                        <span style={{color: behind > 0 ? "#c9a84c" : "#4caf9a",fontWeight:500}}>{fmt(e.date)}</span>
                        {behind > 0 && <span style={{color:"#c9a84c",marginLeft:".3rem",fontSize:".65rem"}}>({behind} day{behind!==1?"s":""} behind)</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{fontSize:".65rem",color:"var(--text-muted)",marginTop:".15rem"}}>
                {allSame ? "NAVs & prices reflect the CAS statement date, not live market"
                  : "Each account shows its own statement date — import the newer statement for any account marked behind. Refresh prices to bring values to today."}
              </div>
            </div>
          </div>
        );
      })()}
      {/* ── Matured FDs — action needed ── */}
      <MaturedFDBanner maturedH={maturedH} renewFD={renewFD} resolveFD={resolveFD}
        fmtNative={fmtNative} valNativeCache={valNativeCache} />
      {/* ── Stale Holdings Nudge Banner ── */}
      {<StaleHoldingsBanner {...{ ST, setFilterType, setShowStaleOnly, showStaleOnly, staleH }} />}

      <div className="tbar">
        <div className={`fchip${filterType==="ALL"?" act":""}`} onClick={()=>{setFilterType("ALL");setShowStaleOnly(false);}}>All</div>
        {Object.entries(AT).map(([k,v])=>(<div key={k} className={`fchip${filterType===k?" act":""}`} onClick={()=>{setFilterType(k);setShowStaleOnly(false);}}>{v.icon} {v.label}</div>))}
      </div>

      {/* ── Export toolbar ── */}
      {displayH.length>0&&(
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:".55rem",position:"relative"}}>
          <button
            className="btn-o"
            onClick={()=>setShowExportMenu(m=>!m)}
            style={{fontSize:".72rem",padding:".28rem .8rem",minHeight:32,display:"flex",alignItems:"center",gap:".35rem"}}>
            ⬇ Export {showExportMenu?"▲":"▼"}
          </button>
          {showExportMenu&&(
            <>
              {/* backdrop to close on outside tap */}
              <div onClick={()=>setShowExportMenu(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
              <div style={{position:"absolute",top:"calc(100% + .35rem)",right:0,zIndex:100,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,boxShadow:"0 6px 24px rgba(0,0,0,.18)",minWidth:170,overflow:"hidden"}}>
                <div role="radiogroup" aria-label="Export scope" style={{display:"flex",gap:0,padding:".4rem",borderBottom:"1px solid var(--border)"}}>
                  {[["view",`Current view (${displayH.length})`],["all","All holdings"]].map(([k,l])=>(
                    <button key={k} type="button" role="radio" aria-checked={exportScope===k} onClick={()=>setExportScope(k)}
                      style={{flex:1,fontSize:".68rem",fontWeight:600,padding:".3rem .5rem",cursor:"pointer",border:"1px solid var(--border)",background:exportScope===k?"var(--accent)":"transparent",color:exportScope===k?"#fff":"var(--text-muted)",borderRadius:k==="view"?"6px 0 0 6px":"0 6px 6px 0",fontFamily:"var(--font-ui)",whiteSpace:"nowrap"}}>{l}</button>
                  ))}
                </div>
                {[
                  {key:"report",label:"⎙ PDF Report",        color:"var(--accent-3,#c9a84c)", report:true},
                  {key:"xlsx",  label:"⬇ Excel (full)",      color:"var(--accent)",           href:"/api/export/xlsx",         file:`wealthlens-portfolio-${exportToday()}.xlsx`},
                  {key:"csv-h", label:"⬇ Holdings CSV",      color:"var(--text)",             href:"/api/export/holdings",     file:`wealthlens-holdings-${exportToday()}.csv`},
                  {key:"csv-t", label:"⬇ Transactions CSV",  color:"var(--accent-2)",         href:"/api/export/transactions", file:`wealthlens-transactions-${exportToday()}.csv`},
                ].map(item=>(
                  <button
                    key={item.key}
                    type="button"
                    disabled={!!exportBusy}
                    onClick={()=>runExport(item)}
                    style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",cursor:exportBusy?"wait":"pointer",opacity:exportBusy&&exportBusy!==item.key?.5:1,padding:".65rem 1rem",fontSize:".78rem",fontWeight:600,color:item.color,borderBottom:"1px solid var(--border)",fontFamily:"var(--font-ui)"}}>
                    {exportBusy===item.key?"Preparing…":item.label}
                  </button>
                ))}
                {exportError&&<div role="alert" style={{padding:".5rem 1rem",fontSize:".7rem",color:"var(--red,#c82333)",maxWidth:240}}>{exportError}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {displayH.length===0?<div className="empty">{demoMode?"No holdings match the current filter": showStaleOnly ? "No stale holdings found — everything is up to date" : "No holdings yet"} — <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setModal("add")}>add to portfolio</span>{!demoMode&&setShowImportHub&&<>{" or "}<span style={{color:"#5ea9a0",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setShowImportHub(true)}>import from a broker</span></>}{!demoMode&&<>{" or "}<span style={{color:"#a084ca",cursor:"pointer",textDecoration:"underline"}} onClick={loadDemoData}>try sample data</span></>}</div>:(<>
        <HoldingsDesktopTable {...{ AT, BT, ST, ago, alertHolding, alerts, allMembers, concallHolding, deleteHolding, demoMode, displayH, editH, fmtCr, fmtCrINR, fmtCrNative, fmtNative, fmtPct, invINRCache, invNativeCache, isUSDHolding, minDisplayDays, setAlertHolding, setAlerts, setArtifactHolding, setConcallHolding, setCostBasisHolding, setTxnForm, setTxnHolding, sortCol, sortDir, toggleSort, valINRCache, valNativeCache }} />{/* end ht-desktop */}
        {/* ── Mobile holding cards ── */}
        <HoldingsMobileList {...{ AT, BT, ST, ago, allMembers, deleteHolding, demoMode, displayH, editH, expandedHolding, fmtCr, fmtCrNative, fmtNative, fmtPct, invINRCache, invNativeCache, isUSDHolding, minDisplayDays, setArtifactHolding, setCostBasisHolding, setExpandedHolding, setTxnForm, setTxnHolding, valINRCache, valNativeCache }} />
      </>)}
      {/* ── MF Overlap Analysis ─────────────────────── */}
      {visH.filter(h=>h.type==="MF"&&h.scheme_code).length>=2&&(
        <div style={{marginTop:"1.25rem",borderTop:"1px solid var(--border)",paddingTop:"1rem"}}>
          <MFOverlapPanel mfHoldings={visH.filter(h=>h.type==="MF"&&h.scheme_code)} />
        </div>
      )}

      <div style={{marginTop:"1rem",padding:".75rem 1rem",background:"var(--bg-muted)",borderRadius:8,fontSize:".72rem",color:"var(--text-dim)",lineHeight:1.6}}>
        <strong style={{color:"var(--text)"}}>Live prices:</strong> Add NSE ticker (e.g. <code style={{color:"#c9a84c"}}>RELIANCE</code>) or AMFI scheme code (e.g. <code style={{color:"#c9a84c"}}>119551</code>) when adding a holding, then click <strong style={{color:"var(--text)"}}>⟳ Live Prices</strong> to auto-fetch. 📎 button attaches contract notes, statements, or receipts to any holding.
      </div>

      {costBasisHolding && (
        <CostBasisModal
          holding={costBasisHolding}
          api={api}
          onClose={()=>setCostBasisHolding(null)}
          onSaved={async()=>{ const hlds = await api("/api/holdings"); setHoldings(hlds || []); }}
        />
      )}
    </div>
  );
}
