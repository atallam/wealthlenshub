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
    { key: "connect",  label: "Connect" },
    { key: "accounts", label: "Accounts" },
    { key: "preview",  label: "Preview" },
    { key: "done",     label: "Done" },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div style={{ display: "flex", gap: ".2rem", alignItems: "center", marginBottom: "1.4rem" }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: ".2rem", flex: 1 }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: ".6rem", fontWeight: 700, flexShrink: 0,
            background: i <= idx ? "var(--primary-dim)" : "var(--bg-muted)",
            border:     i <= idx ? "1px solid var(--primary)" : "1px solid var(--border)",
            color:      i <= idx ? "var(--primary)" : "var(--text-muted)",
          }}>{i + 1}</div>
          <div style={{
            fontSize: ".65rem", letterSpacing: ".06em", whiteSpace: "nowrap", fontWeight: i <= idx ? 600 : 400,
            color: i <= idx ? "var(--primary)" : "var(--text-muted)",
          }}>{s.label}</div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < idx ? "var(--primary)" : "var(--border)", margin: "0 .3rem", opacity: i < idx ? .4 : 1 }} />
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
  US_STOCK: { label: "US Stock", color: "#2563EB", bg: "rgba(37,99,235,.1)" },
  US_ETF:   { label: "US ETF",   color: "#1D4ED8", bg: "rgba(29,78,216,.1)" },
  US_BOND:  { label: "US Bond",  color: "#4B6878", bg: "rgba(75,104,120,.1)" },
  CRYPTO:   { label: "Crypto",   color: "#D97706", bg: "rgba(217,119,6,.1)" },
  IN_STOCK: { label: "IN Stock", color: "#C2410C", bg: "rgba(194,65,12,.1)" },
  IN_ETF:   { label: "IN ETF",   color: "#B45309", bg: "rgba(180,83,9,.1)" },
  MF:       { label: "Mut. Fund",color: "#7C3AED", bg: "rgba(124,58,237,.1)" },
  FD:       { label: "Fixed Dep",color: "#92400E", bg: "rgba(146,64,14,.1)" },
  CASH:     { label: "Cash",     color: "var(--gain)", bg: "var(--gain-dim)" },
  OTHER:    { label: "Other",    color: "var(--text-muted)", bg: "var(--bg-muted)" },
};

// Flush-and-fill: dup_status is informational only — no resolution required.
const DUP_DISPLAY = {
  new:           { label: "New",       color: "var(--gain)",    icon: "✦", bg: "var(--gain-dim)" },
  existing:      { label: "Refresh",   color: "#2563EB",        icon: "↻", bg: "rgba(37,99,235,.08)" },
  manual_conflict:{ label: "Manual ⚠", color: "var(--warning)", icon: "⚠", bg: "var(--warning-dim)" },
  // legacy values
  exact_match:   { label: "Refresh",   color: "#2563EB",        icon: "↻", bg: "rgba(37,99,235,.08)" },
  qty_changed:   { label: "Refresh",   color: "#2563EB",        icon: "↻", bg: "rgba(37,99,235,.08)" },
  manual_exists: { label: "Manual ⚠",  color: "var(--warning)", icon: "⚠", bg: "var(--warning-dim)" },
};

// ── Warning color for disconnect actions ──────────────────────────────────────
const WARN = "var(--loss)";         // #DC2626
const WARN_DIM = "var(--loss-dim)"; // rgba(220,38,38,.1)
const WARN_BORDER = "rgba(220,38,38,.35)";

export default function SnapTradeImport({ onClose, members = [] }) {
  const [step,               setStep]               = useState("connect");
  const [loading,            setLoading]            = useState(false);
  const [error,              setError]              = useState("");
  const [registered,         setRegistered]         = useState(false);
  const [connections,        setConnections]        = useState([]);
  const [accounts,           setAccounts]           = useState([]);
  const [selectedAcct,       setSelectedAcct]       = useState(null);
  const [selectedBrokerage,  setSelectedBrokerage]  = useState("");
  const [holdings,           setHoldings]           = useState([]);
  const [previewSummary,     setPreviewSummary]     = useState(null);
  const [resolutions,        setResolutions]        = useState({});  // unused in flush-and-fill; kept for doImport cleanup
  const [importResult,       setImportResult]       = useState(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(null);
  const [disconnecting,      setDisconnecting]      = useState(false);
  const [memberMap,          setMemberMap]          = useState({});

  useEffect(() => { checkStatus(); }, []);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError("");
    try {
      await api("/api/snaptrade/status");
      const reg = await api("/api/snaptrade/register", { method: "POST" });
      setRegistered(true);
      if (reg.already_registered) await loadConnectionsAndAccounts();
    } catch (e) {
      if (e.message.includes("Missing SNAPTRADE"))
        setError("SnapTrade is not configured — add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to environment.");
      else setError(e.message);
    }
    setLoading(false);
  }, []);

  async function loadConnectionsAndAccounts() {
    try {
      const [connResp, acctResp] = await Promise.all([
        api("/api/snaptrade/connections").catch(() => ({ connections: [] })),
        api("/api/snaptrade/accounts").catch(()   => ({ accounts: [] })),
      ]);
      setConnections(connResp.connections || []);
      setAccounts(acctResp.accounts || []);
      if ((connResp.connections || []).length > 0) setStep("accounts");
    } catch { /* ignore */ }
  }

  async function handleConnect() {
    setLoading(true); setError("");
    try {
      const resp = await api("/api/snaptrade/connect", { method: "POST", body: JSON.stringify({}) });
      if (resp.redirect_uri) {
        const popup = window.open(resp.redirect_uri, "snaptrade_connect", "width=500,height=700");
        if (!popup) {
          setError("Popup was blocked — allow popups for this site and try again.");
        } else {
          const pollInterval = setInterval(async () => {
            if (popup.closed) {
              clearInterval(pollInterval);
              setLoading(true);
              await new Promise(r => setTimeout(r, 2000));
              await loadConnectionsAndAccounts();
              setLoading(false);
            }
          }, 1000);
        }
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function previewHoldings(accountId, brokerageName) {
    setLoading(true); setError(""); setSelectedAcct(accountId); setSelectedBrokerage(brokerageName || "");
    try {
      const resp = await api(`/api/snaptrade/holdings/${accountId}?brokerage=${encodeURIComponent(brokerageName || "")}`);
      setHoldings(resp.assets || []);
      setPreviewSummary(resp.summary || null);
      setResolutions({});
      setStep("preview");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function doImport() {
    if (!selectedAcct) return;
    setLoading(true); setError("");
    try {
      const resp = await api(`/api/snaptrade/import/${selectedAcct}`, {
        method: "POST",
        body: JSON.stringify({
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
      const result = await api(`/api/snaptrade/connections/${authId}`, { method: "DELETE" });
      setShowDisconnectConfirm(null);
      if ((result.remaining_connections || 0) === 0) {
        setStep("connect"); setAccounts([]); setConnections([]);
      } else {
        await loadConnectionsAndAccounts();
      }
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
  const existingCount       = previewSummary?.existing_count       || 0;
  const manualConflictCount = previewSummary?.manual_conflict_count || 0;
  const canImport = holdings.length > 0;

  return (
    <div style={{ fontFamily: "var(--font-ui)", color: "var(--text)" }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".4rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>
          🇺🇸 SnapTrade Import
        </div>
        {connections.length > 0 && step !== "done" && (
          <button onClick={() => setShowDisconnectConfirm("all")}
            style={{ background: "none", border: `1px solid ${WARN_BORDER}`, color: WARN, padding: ".28rem .7rem", borderRadius: 4, cursor: "pointer", fontSize: ".65rem", letterSpacing: ".04em", transition: "all .2s", fontFamily: "var(--font-ui)" }}
            onMouseEnter={e => { e.currentTarget.style.background = WARN_DIM; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
            Disconnect All
          </button>
        )}
      </div>
      <div style={{ fontSize: ".73rem", color: "var(--text-muted)", marginBottom: "1.2rem" }}>
        Connect US brokerage accounts via SnapTrade to auto-import positions.
      </div>

      <StepBar step={step} />

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div style={{ background: WARN_DIM, border: `1px solid ${WARN_BORDER}`, borderRadius: 6, padding: ".55rem .85rem", fontSize: ".75rem", color: WARN, marginBottom: "1rem", display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span>⚠</span><span style={{ flex: 1 }}>{error}</span>
          <span onClick={() => setError("")} style={{ cursor: "pointer", opacity: .6, fontSize: ".8rem" }}>✕</span>
        </div>
      )}

      {/* ── Spinner ───────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{ width: 28, height: 28, border: "2px solid var(--primary-dim)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "snapspin 1s linear infinite", margin: "0 auto .8rem" }} />
          <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
            {step === "connect" ? "Checking connection…" : step === "preview" ? "Fetching positions…" : "Processing…"}
          </div>
          <style>{`@keyframes snapspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ══ STEP: CONNECT ════════════════════════════════════════ */}
      {!loading && step === "connect" && (
        <div>
          <div style={{ fontSize: ".73rem", color: "var(--text-dim)", marginBottom: "1rem", lineHeight: 1.5 }}>
            Choose a brokerage to connect. You'll be redirected to their login page — your credentials are never shared with WealthLens.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: ".6rem" }}>
            {[
              { label: "Fidelity",    icon: "🏦" },
              { label: "Schwab",      icon: "🏦" },
              { label: "Robinhood",   icon: "🪶" },
              { label: "Alpaca",      icon: "🦙" },
              { label: "IBKR",        icon: "🏛️" },
              { label: "All Brokers", icon: "🔗" },
            ].map(b => (
              <button key={b.label} onClick={() => handleConnect()}
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: ".85rem .5rem", cursor: "pointer", textAlign: "center", transition: "all .2s", color: "var(--text)", fontFamily: "var(--font-ui)" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.background = "var(--primary-dim)"; e.currentTarget.style.color = "var(--primary)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)";  e.currentTarget.style.background = "var(--bg-card)";    e.currentTarget.style.color = "var(--text)"; }}>
                <div style={{ fontSize: "1.3rem", marginBottom: ".3rem" }}>{b.icon}</div>
                <div style={{ fontSize: ".73rem", fontWeight: 600 }}>{b.label}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: "1rem", textAlign: "center", lineHeight: 1.6 }}>
            Powered by SnapTrade · OAuth2 · Your credentials stay with your broker
          </div>
        </div>
      )}

      {/* ══ STEP: ACCOUNTS ═══════════════════════════════════════ */}
      {!loading && step === "accounts" && (
        <div>
          {connections.length > 0 && (
            <div style={{ marginBottom: "1.2rem" }}>
              <div style={{ fontSize: ".65rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".6rem", fontWeight: 600 }}>
                Connected Brokerages
              </div>
              {connections.map(c => (
                <div key={c.authorization_id} style={{ display: "flex", alignItems: "center", gap: ".7rem", padding: ".65rem .85rem", marginBottom: ".4rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ fontSize: "1.1rem" }}>{brokerIcon(c.brokerage_slug)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".8rem", color: "var(--text)", fontWeight: 600 }}>{c.brokerage}</div>
                    <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 2 }}>
                      {c.status === "active"
                        ? <span style={{ color: "var(--gain)" }}>● Active</span>
                        : <span style={{ color: WARN }}>● Disabled</span>}
                    </div>
                  </div>
                  <button onClick={() => setShowDisconnectConfirm(c.authorization_id)}
                    style={{ background: "none", border: `1px solid ${WARN_BORDER}`, color: WARN, padding: ".22rem .55rem", borderRadius: 4, cursor: "pointer", fontSize: ".65rem", transition: "all .2s", fontFamily: "var(--font-ui)" }}
                    onMouseEnter={e => { e.currentTarget.style.background = WARN_DIM; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}

          {accounts.length > 0 ? (
            <>
              <div style={{ fontSize: ".65rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".6rem", fontWeight: 600 }}>
                Accounts — assign member &amp; click to preview
              </div>
              {accounts.map(a => (
                <div key={a.account_id} style={{ marginBottom: ".4rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, transition: "all .2s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: ".7rem", padding: ".75rem .85rem", cursor: "pointer" }}
                    onClick={() => previewHoldings(a.account_id, a.brokerage)}
                    onMouseEnter={e => { e.currentTarget.parentElement.style.borderColor = "var(--primary)"; e.currentTarget.parentElement.style.background = "var(--primary-dim)"; }}
                    onMouseLeave={e => { e.currentTarget.parentElement.style.borderColor = "var(--border)";  e.currentTarget.parentElement.style.background = "var(--bg-card)"; }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".85rem", background: "var(--primary-dim)", border: "1px solid var(--border-mid)", color: "var(--primary)", flexShrink: 0 }}>
                      {brokerIcon(a.brokerage_slug)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: ".8rem", color: "var(--text)", fontWeight: 600 }}>{a.account_name || a.brokerage}</div>
                      <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 2 }}>
                        {a.brokerage} · {a.account_number ? `••${a.account_number.slice(-4)}` : "Account"}
                      </div>
                    </div>
                    <div style={{ fontSize: ".72rem", color: "var(--primary)", fontWeight: 600 }}>Preview →</div>
                  </div>
                  {members.length > 0 && (
                    <div style={{ padding: "0 .85rem .6rem", display: "flex", alignItems: "center", gap: ".5rem" }}
                      onClick={e => e.stopPropagation()}>
                      <span style={{ fontSize: ".6rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Assign to:</span>
                      <select value={memberMap[a.account_id] || ""}
                        onChange={e => setMemberMap(prev => ({ ...prev, [a.account_id]: e.target.value || null }))}
                        style={{ flex: 1, fontSize: ".68rem", padding: ".25rem .4rem", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--font-ui)", cursor: "pointer", maxWidth: 200 }}>
                        <option value="">— No member —</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: ".8rem" }}>
              {connections.length === 0 ? "No brokerages connected yet." : "No accounts found. Try refreshing."}
            </div>
          )}

          <button onClick={() => setStep("connect")}
            style={{ display: "block", width: "100%", marginTop: ".8rem", background: "none", border: "1px dashed var(--border-mid)", color: "var(--primary)", padding: ".55rem", borderRadius: 6, cursor: "pointer", fontSize: ".72rem", transition: "all .2s", fontFamily: "var(--font-ui)", fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--primary-dim)"; e.currentTarget.style.borderColor = "var(--primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "var(--border-mid)"; }}>
            + Connect another brokerage
          </button>
        </div>
      )}

      {/* ══ STEP: PREVIEW ════════════════════════════════════════ */}
      {!loading && step === "preview" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".7rem" }}>
            <div style={{ fontSize: ".65rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>
              {holdings.length} positions found
              {holdings.length > 0 && <span style={{ fontWeight: 400 }}> · Total {fmtVal(holdings.reduce((s, h) => s + h.market_value, 0))}</span>}
            </div>
            {selectedBrokerage && (
              <div style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".65rem", color: "var(--primary)", fontWeight: 600 }}>
                <span>{brokerIcon(accounts.find(a => a.account_id === selectedAcct)?.brokerage_slug)}</span>
                {selectedBrokerage}
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>via SnapTrade</span>
              </div>
            )}
          </div>

          {/* Flush-and-fill info banner */}
          {(existingCount > 0 || manualConflictCount > 0) && (
            <div style={{ background: "rgba(37,99,235,.06)", border: "1px solid rgba(37,99,235,.25)", borderRadius: 8, padding: ".7rem .9rem", marginBottom: "1rem" }}>
              <div style={{ fontSize: ".7rem", fontWeight: 700, color: "#2563EB", marginBottom: ".3rem", letterSpacing: ".03em" }}>↻ Flush &amp; Fill</div>
              <div style={{ fontSize: ".72rem", color: "var(--text)", lineHeight: 1.7 }}>
                {existingCount > 0 && (
                  <span><span style={{ color: "#2563EB", fontWeight: 700 }}>{existingCount}</span> existing holding{existingCount !== 1 ? "s" : ""} will be replaced. </span>
                )}
                {manualConflictCount > 0 && (
                  <span><span style={{ color: "var(--warning)", fontWeight: 700 }}>{manualConflictCount}</span> manual holding{manualConflictCount !== 1 ? "s" : ""} with the same ticker will be preserved. </span>
                )}
                <span style={{ color: "var(--text-dim)" }}>
                  {previewSummary?.new_count ?? holdings.filter(h => h.dup_status === "new").length} new position{(previewSummary?.new_count ?? holdings.filter(h => h.dup_status === "new").length) !== 1 ? "s" : ""} will be added.
                </span>
              </div>
            </div>
          )}

          {/* Holdings table */}
          {holdings.length > 0 ? (
            <div style={{ maxHeight: 360, overflowY: "auto", marginBottom: "1rem", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-muted)" }}>
                    <th style={thStyle}>Ticker</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Source</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Units</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Value</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const typeInfo = TYPE_DISPLAY[h.asset_type] || TYPE_DISPLAY.OTHER;
                    const dupInfo  = DUP_DISPLAY[h.dup_status]  || DUP_DISPLAY.new;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg)" }}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{h.ticker}</div>
                          <div style={{ fontSize: ".6rem", color: "var(--text-muted)", marginTop: 1, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.asset_name}</div>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: ".65rem", padding: ".15rem .4rem", borderRadius: 4, background: typeInfo.bg, color: typeInfo.color, fontWeight: 600, whiteSpace: "nowrap" }}>{typeInfo.label}</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>{h.brokerage_name || h.source || "—"}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: ".71rem" }}>
                          {h.units?.toFixed(h.units % 1 === 0 ? 0 : 4)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: ".71rem" }}>
                          ${h.current_price?.toFixed(2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: ".71rem", fontWeight: 600 }}>
                          {fmtVal(h.market_value)}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: ".65rem", padding: ".15rem .4rem", borderRadius: 4, background: dupInfo.bg, color: dupInfo.color, fontWeight: 600, whiteSpace: "nowrap" }}>{dupInfo.icon} {dupInfo.label}</span>
                          {h.dup_detail && <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 2, maxWidth: 140, lineHeight: 1.3 }}>{h.dup_detail}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: ".8rem" }}>
              No positions found in this account.
            </div>
          )}

          <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end", alignItems: "center" }}>
            <button onClick={() => { setStep("accounts"); setHoldings([]); setResolutions({}); setPreviewSummary(null); }} style={btnSecondary}>← Back</button>
            {holdings.length > 0 && (
              <button onClick={doImport} disabled={!canImport}
                style={{ ...btnPrimary, opacity: canImport ? 1 : 0.45, cursor: canImport ? "pointer" : "not-allowed" }}>
                {existingCount > 0
                  ? `Refresh ${holdings.length} position${holdings.length !== 1 ? "s" : ""} (replaces ${existingCount})`
                  : `Import ${holdings.length} position${holdings.length !== 1 ? "s" : ""} into WealthLens`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ STEP: DONE ═══════════════════════════════════════════ */}
      {!loading && step === "done" && importResult && (
        <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <div style={{ fontSize: "2.4rem", marginBottom: ".6rem" }}>✅</div>
          <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text)", marginBottom: ".4rem", letterSpacing: "-.01em" }}>
            Import Complete
          </div>
          <div style={{ display: "flex", gap: ".8rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "1.4rem", fontSize: ".73rem" }}>
            {importResult.assets_imported > 0 && (
              <span style={{ color: "var(--gain)", fontWeight: 600 }}>✦ {importResult.assets_imported} position{importResult.assets_imported !== 1 ? "s" : ""} synced</span>
            )}
            {(importResult.assets_skipped || 0) > 0 && (
              <span style={{ color: "var(--text-muted)" }}>— {importResult.assets_skipped} skipped (cash sweep)</span>
            )}
          </div>
          <div style={{ display: "flex", gap: ".6rem", justifyContent: "center" }}>
            <button onClick={() => { setStep("accounts"); setImportResult(null); setResolutions({}); }} style={btnSecondary}>Import another account</button>
            <button onClick={onClose} style={btnPrimary}>Done</button>
          </div>
        </div>
      )}

      {/* ══ DISCONNECT CONFIRM MODAL ══════════════════════════════ */}
      {showDisconnectConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,61,56,.35)", backdropFilter: "blur(4px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={() => !disconnecting && setShowDisconnectConfirm(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--bg-card)", border: `1px solid ${WARN_BORDER}`, borderRadius: 12, padding: "1.5rem", width: "100%", maxWidth: 380, boxShadow: "var(--shadow-lg)" }}>
            <div style={{ fontSize: "1.4rem", textAlign: "center", marginBottom: ".6rem" }}>⚠️</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)", textAlign: "center", marginBottom: ".5rem" }}>
              {showDisconnectConfirm === "all" ? "Disconnect All Brokerages?" : "Disconnect Brokerage?"}
            </div>
            <div style={{ fontSize: ".75rem", color: "var(--text-dim)", textAlign: "center", lineHeight: 1.65, marginBottom: "1.2rem" }}>
              {showDisconnectConfirm === "all"
                ? <><span>This will </span><strong style={{ color: WARN }}>delete your SnapTrade account</strong><span>, revoke all connections, and remove all imported holdings.</span></>
                : "This will revoke the OAuth connection and remove the broker's imported holdings. You can reconnect anytime."}
            </div>
            {disconnecting ? (
              <div style={{ textAlign: "center", padding: ".5rem" }}>
                <div style={{ width: 24, height: 24, border: `2px solid ${WARN_DIM}`, borderTopColor: WARN, borderRadius: "50%", animation: "snapspin 1s linear infinite", margin: "0 auto .5rem" }} />
                <div style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Disconnecting…</div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: ".6rem" }}>
                <button onClick={() => setShowDisconnectConfirm(null)} style={{ ...btnSecondary, flex: 1, textAlign: "center" }}>Cancel</button>
                <button onClick={() => { if (showDisconnectConfirm === "all") disconnectAll(); else disconnectConnection(showDisconnectConfirm); }}
                  style={{ flex: 1, textAlign: "center", background: WARN_DIM, border: `1px solid ${WARN_BORDER}`, color: WARN, padding: ".52rem 1rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem", fontWeight: 600, transition: "all .2s", fontFamily: "var(--font-ui)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(220,38,38,.18)"}
                  onMouseLeave={e => e.currentTarget.style.background = WARN_DIM}>
                  Yes, Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Style constants (all using CSS variables for theme compatibility) ─────────
const thStyle = {
  fontSize: ".6rem", letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--text-muted)", textAlign: "left", padding: ".5rem .6rem",
  borderBottom: "1px solid var(--border)", fontWeight: 700, fontFamily: "var(--font-ui)",
  background: "var(--bg-muted)",
};
const tdStyle = { padding: ".5rem .6rem", fontSize: ".73rem", color: "var(--text)" };
const btnSecondary = {
  background: "none", border: "1px solid var(--border)", color: "var(--text-dim)",
  padding: ".52rem 1rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem",
  transition: "all .2s", fontFamily: "var(--font-ui)", fontWeight: 500,
};
const btnPrimary = {
  background: "var(--primary-dim)", border: "1px solid var(--primary)", color: "var(--primary)",
  padding: ".52rem 1.2rem", borderRadius: 6, cursor: "pointer", fontSize: ".78rem",
  fontWeight: 700, transition: "all .2s", fontFamily: "var(--font-ui)",
};
