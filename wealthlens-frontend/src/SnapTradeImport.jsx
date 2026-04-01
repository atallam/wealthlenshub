import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

function StepBar({ step }) {
  const steps = [
    { key: "connect", label: "Connect" },
    { key: "accounts", label: "Accounts" },
    { key: "preview", label: "Preview" },
    { key: "done", label: "Done" },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div style={{ display: "flex", gap: ".2rem", alignItems: "center", marginBottom: "1.4rem" }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: ".2rem", flex: 1 }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: ".6rem", fontWeight: 600, flexShrink: 0,
            background: i <= idx ? "rgba(167,139,250,.18)" : "rgba(255,255,255,.05)",
            border: `1px solid ${i <= idx ? "rgba(167,139,250,.5)" : "rgba(255,255,255,.1)"}`,
            color: i <= idx ? "#a78bfa" : "rgba(255,255,255,.3)",
          }}>{i + 1}</div>
          <div style={{
            fontSize: ".62rem", letterSpacing: ".06em", whiteSpace: "nowrap",
            color: i <= idx ? "#a78bfa" : "rgba(255,255,255,.3)",
          }}>{s.label}</div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < idx ? "rgba(167,139,250,.3)" : "rgba(255,255,255,.06)", margin: "0 .3rem" }} />
          )}
        </div>
      ))}
    </div>
  );
}

const BROKER_ICONS = {
  fidelity: "🏦", schwab: "🏦", robinhood: "🪶", alpaca: "🦙",
  interactive_brokers: "🏛️", etrade: "📈", questrade: "📊",
  wealthsimple: "💚", td: "🟢", coinbase: "🪙", default: "🔗",
};
function brokerIcon(slug) { return BROKER_ICONS[slug?.toLowerCase()] || BROKER_ICONS.default; }

const TYPE_DISPLAY = {
  US_STOCK: { label: "US Stock", color: "#5a9ce0", bg: "rgba(90,156,224,.12)" },
  US_ETF: { label: "US ETF", color: "#4a8cd8", bg: "rgba(74,140,216,.12)" },
  US_BOND: { label: "US Bond", color: "#7095b0", bg: "rgba(112,149,176,.12)" },
  CRYPTO: { label: "Crypto", color: "#f7931a", bg: "rgba(247,147,26,.12)" },
  IN_STOCK: { label: "Indian Stock", color: "#e07c5a", bg: "rgba(224,124,90,.12)" },
  IN_ETF: { label: "Indian ETF", color: "#f0a050", bg: "rgba(240,160,80,.12)" },
  MF: { label: "Mutual Fund", color: "#a084ca", bg: "rgba(160,132,202,.12)" },
  FD: { label: "Fixed Deposit", color: "#c9a84c", bg: "rgba(201,168,76,.12)" },
  CASH: { label: "Cash", color: "#4caf9a", bg: "rgba(76,175,154,.12)" },
  OTHER: { label: "Other", color: "rgba(255,255,255,.5)", bg: "rgba(255,255,255,.05)" },
};

const DUP_DISPLAY = {
  new: { label: "New", color: "#4caf9a", icon: "✦", bg: "rgba(76,175,154,.1)" },
  exact_match: { label: "Exists", color: "#c9a84c", icon: "≡", bg: "rgba(201,168,76,.1)" },
  qty_changed: { label: "Updated", color: "#5a9ce0", icon: "↻", bg: "rgba(90,156,224,.1)" },
  manual_exists: { label: "Manual", color: "#e07c5a", icon: "⚠", bg: "rgba(224,124,90,.1)" },
};

export default function SnapTradeImport({ onClose, members = [] }) {
  const [step, setStep] = useState("connect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [connections, setConnections] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAcct, setSelectedAcct] = useState(null);
  const [selectedBrokerage, setSelectedBrokerage] = useState("");  // brokerage name for selected account
  const [holdings, setHoldings] = useState([]);
  const [dupSummary, setDupSummary] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [memberMap, setMemberMap] = useState({});  // { accountId: memberId }

  useEffect(() => { checkStatus(); }, []);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError("");
    try {
      await api("/api/snaptrade/status");
      const reg = await api("/api/snaptrade/register", { method: "POST" });
      setRegistered(true);
      if (reg.already_registered) await loadConnectionsAndAccounts();
    } catch (e) {
      if (e.message.includes("Missing SNAPTRADE")) setError("SnapTrade is not configured — add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to environment.");
      else setError(e.message);
    }
    setLoading(false);
  }, []);

  async function loadConnectionsAndAccounts() {
    try {
      const [connResp, acctResp] = await Promise.all([
        api("/api/snaptrade/connections").catch(() => ({ connections: [] })),
        api("/api/snaptrade/accounts").catch(() => ({ accounts: [] })),
      ]);
      setConnections(connResp.connections || []);
      setAccounts(acctResp.accounts || []);
      if ((connResp.connections || []).length > 0) setStep("accounts");
    } catch { /* ignore */ }
  }

  async function handleConnect(broker) {
    setLoading(true); setError("");
    try {
      const resp = await api("/api/snaptrade/connect", { method: "POST", body: JSON.stringify({ broker: broker || undefined }) });
      if (resp.redirect_uri) {
        const popup = window.open(resp.redirect_uri, "snaptrade_connect", "width=500,height=700");
        const pollInterval = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(pollInterval);
            setLoading(true);
            await new Promise(r => setTimeout(r, 2000));
            await loadConnectionsAndAccounts();
            setLoading(false);
          }
        }, 1000);
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function previewHoldings(accountId, brokerageName) {
    setLoading(true); setError(""); setSelectedAcct(accountId); setSelectedBrokerage(brokerageName || "");
    try {
      const resp = await api(`/api/snaptrade/holdings/${accountId}?brokerage=${encodeURIComponent(brokerageName || "")}`);
      setHoldings(resp.assets || []);
      setDupSummary(resp.duplicates || null);
      // Do NOT pre-fill resolutions — user must explicitly choose for every duplicate
      setResolutions({});
      setStep("preview");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  function setResolution(ticker, action) { setResolutions(prev => ({ ...prev, [ticker]: action })); }

  function bulkResolve(action) {
    const updated = { ...resolutions };
    for (const h of holdings) { if (h.dup_status !== "new") updated[h.ticker] = action; }
    setResolutions(updated);
  }

  async function doImport() {
    if (!selectedAcct) return;
    setLoading(true); setError("");
    try {
      const resp = await api(`/api/snaptrade/import/${selectedAcct}`, {
        method: "POST",
        body: JSON.stringify({
          resolutions,
          brokerage_name: selectedBrokerage,
          member_id: memberMap[selectedAcct] || null,
        }),
      });
      setImportResult(resp);
      setStep("done");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function disconnectConnection(authId) {
    setDisconnecting(true); setError("");
    try {
      await api(`/api/snaptrade/connections/${authId}`, { method: "DELETE" });
      setShowDisconnectConfirm(null);
      await loadConnectionsAndAccounts();
      if (connections.length <= 1) { setStep("connect"); setAccounts([]); setConnections([]); }
    } catch (e) { setError(e.message); }
    setDisconnecting(false);
  }

  async function disconnectAll() {
    setDisconnecting(true); setError("");
    try {
      await api("/api/snaptrade/disconnect", { method: "DELETE" });
      setShowDisconnectConfirm(null);
      setStep("connect"); setRegistered(false); setConnections([]); setAccounts([]); setHoldings([]); setImportResult(null);
    } catch (e) { setError(e.message); }
    setDisconnecting(false);
  }

  const fmtVal = n => "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const hasDuplicates = dupSummary && (dupSummary.exact_match_count + dupSummary.qty_changed_count + dupSummary.manual_exists_count) > 0;
  const unresolvedDupCount = holdings.filter(h => h.dup_status !== "new" && !resolutions[h.ticker]).length;
  const importableCount = holdings.filter(h => h.dup_status === "new" || (resolutions[h.ticker] && resolutions[h.ticker] !== "skip")).length;
  const canImport = unresolvedDupCount === 0 && importableCount > 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".4rem" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.3rem", color: "#ffffff" }}>🇺🇸 SnapTrade Import</div>
        {connections.length > 0 && step !== "done" && (
          <button onClick={() => setShowDisconnectConfirm("all")} style={{ background: "none", border: "1px solid rgba(224,124,90,.25)", color: "rgba(224,124,90,.7)", padding: ".28rem .7rem", borderRadius: 4, cursor: "pointer", fontSize: ".65rem", letterSpacing: ".04em", transition: "all .2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(224,124,90,.08)"; e.currentTarget.style.color = "#e07c5a"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(224,124,90,.7)"; }}>Disconnect All</button>
        )}
      </div>
      <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.45)", marginBottom: "1.2rem" }}>Connect US brokerage accounts via SnapTrade to auto-import positions.</div>
      <StepBar step={step} />

      {error && (<div style={{ background: "rgba(224,124,90,.08)", border: "1px solid rgba(224,124,90,.25)", borderRadius: 6, padding: ".55rem .85rem", fontSize: ".75rem", color: "#e07c5a", marginBottom: "1rem", display: "flex", alignItems: "center", gap: ".5rem" }}><span>⚠</span><span style={{ flex: 1 }}>{error}</span><span onClick={() => setError("")} style={{ cursor: "pointer", opacity: .6, fontSize: ".8rem" }}>✕</span></div>)}

      {loading && (<div style={{ textAlign: "center", padding: "2rem 0" }}><div style={{ width: 30, height: 30, border: "2px solid rgba(167,139,250,.15)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "snapspin 1s linear infinite", margin: "0 auto .8rem" }} /><div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.45)" }}>{step === "connect" ? "Checking connection…" : step === "preview" ? "Fetching positions…" : "Processing…"}</div><style>{`@keyframes snapspin{to{transform:rotate(360deg)}}`}</style></div>)}

      {/* STEP: CONNECT */}
      {!loading && step === "connect" && (<div>
        <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.6)", marginBottom: "1rem" }}>Choose a brokerage to connect. You'll be redirected to their login page — your credentials are never shared with WealthLens.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: ".6rem" }}>
          {[{ slug: "FIDELITY", label: "Fidelity", icon: "🏦" },{ slug: "SCHWAB", label: "Schwab", icon: "🏦" },{ slug: "ROBINHOOD", label: "Robinhood", icon: "🪶" },{ slug: "ALPACA", label: "Alpaca", icon: "🦙" },{ slug: "INTERACTIVE_BROKERS", label: "IBKR", icon: "🏛️" },{ slug: "", label: "All Brokers", icon: "🔗" }].map(b => (
            <button key={b.slug || "all"} onClick={() => handleConnect(b.slug)} style={{ background: "rgba(167,139,250,.04)", border: "1px solid rgba(167,139,250,.18)", borderRadius: 8, padding: ".85rem .5rem", cursor: "pointer", textAlign: "center", transition: "all .2s", color: "#ffffff" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.45)"; e.currentTarget.style.background = "rgba(167,139,250,.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.18)"; e.currentTarget.style.background = "rgba(167,139,250,.04)"; }}>
              <div style={{ fontSize: "1.3rem", marginBottom: ".3rem" }}>{b.icon}</div>
              <div style={{ fontSize: ".75rem", fontWeight: 500 }}>{b.label}</div>
            </button>))}
        </div>
        <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.3)", marginTop: "1rem", textAlign: "center", lineHeight: 1.6 }}>Powered by SnapTrade · OAuth2 · Your credentials stay with your broker</div>
      </div>)}

      {/* STEP: ACCOUNTS */}
      {!loading && step === "accounts" && (<div>
        {connections.length > 0 && (<div style={{ marginBottom: "1.2rem" }}>
          <div style={{ fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: ".6rem" }}>Connected Brokerages</div>
          {connections.map(c => (<div key={c.authorization_id} style={{ display: "flex", alignItems: "center", gap: ".7rem", padding: ".65rem .85rem", marginBottom: ".4rem", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8 }}>
            <div style={{ fontSize: "1.1rem" }}>{brokerIcon(c.brokerage_slug)}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: ".8rem", color: "#ffffff", fontWeight: 500 }}>{c.brokerage}</div><div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>{c.status === "active" ? <span style={{ color: "rgba(76,175,154,.8)" }}>● Active</span> : <span style={{ color: "rgba(224,124,90,.8)" }}>● Disabled</span>}</div></div>
            <button onClick={() => setShowDisconnectConfirm(c.authorization_id)} style={{ background: "none", border: "1px solid rgba(224,124,90,.2)", color: "rgba(224,124,90,.55)", padding: ".22rem .55rem", borderRadius: 4, cursor: "pointer", fontSize: ".62rem", transition: "all .2s" }}
              onMouseEnter={e => { e.currentTarget.style.color = "#e07c5a"; e.currentTarget.style.borderColor = "rgba(224,124,90,.4)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(224,124,90,.55)"; e.currentTarget.style.borderColor = "rgba(224,124,90,.2)"; }}>Disconnect</button>
          </div>))}
        </div>)}

        {accounts.length > 0 ? (<>
          <div style={{ fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: ".6rem" }}>Accounts — assign member & click to preview</div>
          {accounts.map(a => (<div key={a.account_id} style={{ marginBottom: ".4rem", background: "rgba(167,139,250,.04)", border: "1px solid rgba(167,139,250,.15)", borderRadius: 8, transition: "all .2s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".7rem", padding: ".75rem .85rem", cursor: "pointer" }}
              onClick={() => previewHoldings(a.account_id, a.brokerage)}
              onMouseEnter={e => { e.currentTarget.parentElement.style.borderColor = "rgba(167,139,250,.4)"; e.currentTarget.parentElement.style.background = "rgba(167,139,250,.08)"; }}
              onMouseLeave={e => { e.currentTarget.parentElement.style.borderColor = "rgba(167,139,250,.15)"; e.currentTarget.parentElement.style.background = "rgba(167,139,250,.04)"; }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".85rem", background: "rgba(167,139,250,.12)", border: "1px solid rgba(167,139,250,.25)", color: "#a78bfa", flexShrink: 0 }}>{brokerIcon(a.brokerage_slug)}</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: ".8rem", color: "#ffffff", fontWeight: 500 }}>{a.account_name || a.brokerage}</div><div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>{a.brokerage} · {a.account_number ? `••${a.account_number.slice(-4)}` : "Account"}</div></div>
              <div style={{ fontSize: ".72rem", color: "#a78bfa" }}>Preview →</div>
            </div>
            {members.length > 0 && (
              <div style={{ padding: "0 .85rem .6rem", display: "flex", alignItems: "center", gap: ".5rem" }}
                onClick={e => e.stopPropagation()}>
                <span style={{ fontSize: ".6rem", color: "rgba(255,255,255,.4)", whiteSpace: "nowrap" }}>Assign to:</span>
                <select value={memberMap[a.account_id] || ""}
                  onChange={e => setMemberMap(prev => ({ ...prev, [a.account_id]: e.target.value || null }))}
                  style={{ flex: 1, fontSize: ".68rem", padding: ".25rem .4rem", borderRadius: 4, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", color: "#fff", fontFamily: "'DM Sans',sans-serif", cursor: "pointer", maxWidth: 200 }}>
                  <option value="">— No member —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
          </div>))}
        </>) : (<div style={{ textAlign: "center", padding: "1.5rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>{connections.length === 0 ? "No brokerages connected yet." : "No accounts found. Try refreshing."}</div>)}
        <button onClick={() => setStep("connect")} style={{ display: "block", width: "100%", marginTop: ".8rem", background: "none", border: "1px dashed rgba(167,139,250,.25)", color: "rgba(167,139,250,.6)", padding: ".55rem", borderRadius: 6, cursor: "pointer", fontSize: ".72rem", transition: "all .2s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.5)"; e.currentTarget.style.color = "#a78bfa"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.25)"; e.currentTarget.style.color = "rgba(167,139,250,.6)"; }}>+ Connect another brokerage</button>
      </div>)}

      {/* STEP: PREVIEW with duplicate resolution */}
      {!loading && step === "preview" && (<div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".7rem" }}>
          <div style={{ fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>
            {holdings.length} positions found{holdings.length > 0 && ` · Total ${fmtVal(holdings.reduce((s, h) => s + h.market_value, 0))}`}
          </div>
          {selectedBrokerage && (
            <div style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".63rem", color: "rgba(167,139,250,.7)" }}>
              <span style={{ fontSize: ".75rem" }}>{brokerIcon(accounts.find(a => a.account_id === selectedAcct)?.brokerage_slug)}</span>
              {selectedBrokerage}
              <span style={{ color: "rgba(255,255,255,.3)" }}>via SnapTrade</span>
            </div>
          )}
        </div>

        {hasDuplicates && (<div style={{ background: unresolvedDupCount > 0 ? "rgba(224,124,90,.06)" : "rgba(201,168,76,.06)", border: `1px solid ${unresolvedDupCount > 0 ? "rgba(224,124,90,.25)" : "rgba(201,168,76,.2)"}`, borderRadius: 8, padding: ".7rem .85rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".5rem" }}>
            <span style={{ fontSize: ".85rem" }}>⚠</span>
            <span style={{ fontSize: ".78rem", color: unresolvedDupCount > 0 ? "#e07c5a" : "#c9a84c", fontWeight: 500 }}>
              {unresolvedDupCount > 0
                ? `${unresolvedDupCount} duplicate${unresolvedDupCount > 1 ? "s" : ""} need${unresolvedDupCount === 1 ? "s" : ""} your decision`
                : "Duplicates resolved"}
            </span>
          </div>
          <div style={{ fontSize: ".68rem", color: "rgba(255,255,255,.55)", lineHeight: 1.6, marginBottom: ".6rem" }}>
            {dupSummary.exact_match_count > 0 && <span style={{ marginRight: 12 }}>≡ {dupSummary.exact_match_count} already imported</span>}
            {dupSummary.qty_changed_count > 0 && <span style={{ marginRight: 12 }}>↻ {dupSummary.qty_changed_count} quantity changed</span>}
            {dupSummary.manual_exists_count > 0 && <span>⚠ {dupSummary.manual_exists_count} manual entries</span>}
          </div>
          <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", lineHeight: "26px", marginRight: 4 }}>Bulk:</span>
            {["skip", "replace", "merge"].map(action => (
              <button key={action} onClick={() => bulkResolve(action)} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", color: "rgba(255,255,255,.6)", padding: ".2rem .55rem", borderRadius: 4, cursor: "pointer", fontSize: ".62rem", transition: "all .15s", textTransform: "capitalize" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.4)"; e.currentTarget.style.color = "#a78bfa"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; e.currentTarget.style.color = "rgba(255,255,255,.6)"; }}>{action} all</button>
            ))}
          </div>
        </div>)}

        {holdings.length > 0 ? (<div style={{ maxHeight: 360, overflowY: "auto", marginBottom: "1rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle}>Ticker</th><th style={thStyle}>Type</th><th style={thStyle}>Source</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Units</th><th style={{ ...thStyle, textAlign: "right" }}>Price</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Value</th><th style={thStyle}>Status</th>
              {hasDuplicates && <th style={thStyle}>Action</th>}
            </tr></thead>
            <tbody>{holdings.map((h, i) => {
              const typeInfo = TYPE_DISPLAY[h.asset_type] || TYPE_DISPLAY.OTHER;
              const dupInfo = DUP_DISPLAY[h.dup_status] || DUP_DISPLAY.new;
              const resolution = resolutions[h.ticker];
              const isSkipped = resolution === "skip";
              const isUnresolved = h.dup_status !== "new" && !resolution;
              return (<tr key={i} style={{ borderBottom: `1px solid ${isUnresolved ? "rgba(224,124,90,.15)" : "rgba(255,255,255,.04)"}`, opacity: isSkipped ? 0.4 : 1, transition: "opacity .2s", background: isUnresolved ? "rgba(224,124,90,.03)" : "transparent" }}>
                <td style={tdStyle}><div style={{ fontWeight: 500, color: "#fff" }}>{h.ticker}</div><div style={{ fontSize: ".6rem", color: "rgba(255,255,255,.4)", marginTop: 1, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.asset_name}</div></td>
                <td style={tdStyle}><span style={{ fontSize: ".58rem", padding: ".1rem .35rem", borderRadius: 3, background: typeInfo.bg, color: typeInfo.color, whiteSpace: "nowrap" }}>{typeInfo.label}</span></td>
                <td style={tdStyle}><span style={{ fontSize: ".58rem", color: "rgba(255,255,255,.45)" }}>{h.brokerage_name || h.source || "—"}</span></td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace", fontSize: ".72rem" }}>{h.units?.toFixed(h.units % 1 === 0 ? 0 : 4)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace", fontSize: ".72rem" }}>${h.current_price?.toFixed(2)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace", fontSize: ".72rem", color: "#fff" }}>{fmtVal(h.market_value)}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: ".58rem", padding: ".1rem .35rem", borderRadius: 3, background: dupInfo.bg, color: dupInfo.color, whiteSpace: "nowrap" }}>{dupInfo.icon} {dupInfo.label}</span>
                  {h.dup_detail && <div style={{ fontSize: ".55rem", color: "rgba(255,255,255,.35)", marginTop: 2, maxWidth: 140, lineHeight: 1.3 }}>{h.dup_detail}</div>}
                </td>
                {hasDuplicates && (<td style={tdStyle}>
                  {h.dup_status !== "new" ? (<div style={{ display: "flex", gap: ".2rem" }}>
                    {["skip", "replace", "merge"].map(action => (
                      <button key={action} onClick={() => setResolution(h.ticker, action)} style={{
                        background: resolution === action ? actionColors[action].bg : "transparent",
                        border: `1px solid ${resolution === action ? actionColors[action].border : isUnresolved ? "rgba(224,124,90,.3)" : "rgba(255,255,255,.1)"}`,
                        color: resolution === action ? actionColors[action].color : isUnresolved ? "rgba(224,124,90,.6)" : "rgba(255,255,255,.35)",
                        padding: ".12rem .3rem", borderRadius: 3, cursor: "pointer", fontSize: ".55rem", transition: "all .15s", textTransform: "capitalize", lineHeight: 1.2,
                      }}>{action === "skip" ? "Skip" : action === "replace" ? "Replace" : "Merge"}</button>
                    ))}
                  </div>) : (<span style={{ fontSize: ".58rem", color: "rgba(76,175,154,.6)" }}>Auto-import</span>)}
                </td>)}
              </tr>);
            })}</tbody>
          </table>
        </div>) : (<div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>No positions found in this account.</div>)}

        <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end", alignItems: "center" }}>
          <button onClick={() => { setStep("accounts"); setHoldings([]); setResolutions({}); setDupSummary(null); }} style={btnSecondary}>← Back</button>
          {holdings.length > 0 && (<button onClick={doImport} disabled={!canImport} style={{ ...btnPrimary, opacity: canImport ? 1 : 0.45, cursor: canImport ? "pointer" : "not-allowed" }}>
            {unresolvedDupCount > 0
              ? `Resolve ${unresolvedDupCount} duplicate${unresolvedDupCount > 1 ? "s" : ""} to continue`
              : `Import ${importableCount} position${importableCount !== 1 ? "s" : ""} into WealthLens`
            }
          </button>)}
        </div>
      </div>)}

      {/* STEP: DONE */}
      {!loading && step === "done" && importResult && (<div style={{ textAlign: "center", padding: "1.5rem 0" }}>
        <div style={{ fontSize: "2.2rem", marginBottom: ".6rem" }}>✅</div>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.15rem", color: "#ffffff", marginBottom: ".4rem" }}>Import Complete</div>
        <div style={{ display: "flex", gap: ".8rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "1.2rem", fontSize: ".72rem" }}>
          {importResult.assets_imported > 0 && <span style={{ color: "#4caf9a" }}>✦ {importResult.assets_imported} imported</span>}
          {(importResult.assets_replaced || 0) > 0 && <span style={{ color: "#5a9ce0" }}>↻ {importResult.assets_replaced} replaced</span>}
          {(importResult.assets_merged || 0) > 0 && <span style={{ color: "#a084ca" }}>⊕ {importResult.assets_merged} merged</span>}
          {(importResult.assets_skipped || 0) > 0 && <span style={{ color: "rgba(255,255,255,.4)" }}>— {importResult.assets_skipped} skipped</span>}
        </div>
        <div style={{ display: "flex", gap: ".6rem", justifyContent: "center" }}>
          <button onClick={() => { setStep("accounts"); setImportResult(null); setResolutions({}); }} style={btnSecondary}>Import another account</button>
          <button onClick={onClose} style={btnPrimary}>Done</button>
        </div>
      </div>)}

      {/* DISCONNECT MODAL */}
      {showDisconnectConfirm && (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(3px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => !disconnecting && setShowDisconnectConfirm(null)}>
        <div onClick={e => e.stopPropagation()} style={{ background: "#0c1526", border: "1px solid rgba(224,124,90,.25)", borderRadius: 12, padding: "1.5rem", width: "100%", maxWidth: 380 }}>
          <div style={{ fontSize: "1.4rem", textAlign: "center", marginBottom: ".6rem" }}>⚠️</div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.1rem", color: "#ffffff", textAlign: "center", marginBottom: ".5rem" }}>{showDisconnectConfirm === "all" ? "Disconnect All Brokerages?" : "Disconnect Brokerage?"}</div>
          <div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.55)", textAlign: "center", lineHeight: 1.6, marginBottom: "1.2rem" }}>
            {showDisconnectConfirm === "all"
              ? <><span>This will </span><strong style={{ color: "#e07c5a" }}>delete your SnapTrade account</strong><span>, revoke all connections, and remove all imported holdings.</span></>
              : "This will revoke the OAuth connection and remove imported holdings. You can reconnect anytime."}
          </div>
          {disconnecting ? (<div style={{ textAlign: "center", padding: ".5rem" }}><div style={{ width: 24, height: 24, border: "2px solid rgba(224,124,90,.15)", borderTopColor: "#e07c5a", borderRadius: "50%", animation: "snapspin 1s linear infinite", margin: "0 auto .5rem" }} /><div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.4)" }}>Disconnecting…</div></div>
          ) : (<div style={{ display: "flex", gap: ".6rem" }}>
            <button onClick={() => setShowDisconnectConfirm(null)} style={{ ...btnSecondary, flex: 1, textAlign: "center" }}>Cancel</button>
            <button onClick={() => { if (showDisconnectConfirm === "all") disconnectAll(); else disconnectConnection(showDisconnectConfirm); }} style={{ flex: 1, textAlign: "center", background: "rgba(224,124,90,.12)", border: "1px solid rgba(224,124,90,.45)", color: "#e07c5a", padding: ".52rem 1rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem", fontWeight: 500, transition: "all .2s", fontFamily: "'DM Sans',sans-serif" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(224,124,90,.2)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(224,124,90,.12)"}>Yes, Disconnect</button>
          </div>)}
        </div>
      </div>)}
    </div>
  );
}

const thStyle = { fontSize: ".6rem", letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.45)", textAlign: "left", padding: "0 .5rem .5rem", borderBottom: "1px solid rgba(255,255,255,.06)" };
const tdStyle = { padding: ".55rem .5rem", fontSize: ".75rem", color: "rgba(255,255,255,.8)" };
const btnSecondary = { background: "none", border: "1px solid rgba(255,255,255,.15)", color: "rgba(255,255,255,.6)", padding: ".52rem 1rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem", transition: "all .2s", fontFamily: "'DM Sans',sans-serif" };
const btnPrimary = { background: "rgba(167,139,250,.14)", border: "1px solid rgba(167,139,250,.48)", color: "#a78bfa", padding: ".52rem 1.2rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem", fontWeight: 500, transition: "all .2s", fontFamily: "'DM Sans',sans-serif" };
const actionColors = {
  skip: { bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.18)", color: "rgba(255,255,255,.5)" },
  replace: { bg: "rgba(90,156,224,.1)", border: "rgba(90,156,224,.35)", color: "#5a9ce0" },
  merge: { bg: "rgba(160,132,202,.1)", border: "rgba(160,132,202,.35)", color: "#a084ca" },
};
