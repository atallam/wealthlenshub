import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ── API helper (same pattern as App.jsx) ─────────────────────────
async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

// ── Step indicator ───────────────────────────────────────────────
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

// ── Broker logos/icons ────────────────────────────────────────────
const BROKER_ICONS = {
  fidelity: "🏦", schwab: "🏦", robinhood: "🪶", alpaca: "🦙",
  interactive_brokers: "🏛️", etrade: "📈", questrade: "📊",
  wealthsimple: "💚", td: "🟢", coinbase: "🪙", default: "🔗",
};
function brokerIcon(slug) {
  return BROKER_ICONS[slug?.toLowerCase()] || BROKER_ICONS.default;
}

// ══════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function SnapTradeImport({ onClose }) {
  // ── State ──────────────────────────────────────────────────────
  const [step, setStep]             = useState("connect"); // connect | accounts | preview | done
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [registered, setRegistered] = useState(false);
  const [connections, setConnections] = useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [selectedAcct, setSelectedAcct] = useState(null);
  const [holdings, setHoldings]     = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(null); // null | "all" | authId
  const [disconnecting, setDisconnecting] = useState(false);

  // ── On mount: check registration + connections ─────────────────
  useEffect(() => { checkStatus(); }, []);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError("");
    try {
      // Check if API is up
      await api("/api/snaptrade/status");
      // Check if already registered (register is idempotent)
      const reg = await api("/api/snaptrade/register", { method: "POST" });
      setRegistered(true);
      if (reg.already_registered) {
        // Fetch existing connections & accounts
        await loadConnectionsAndAccounts();
      }
    } catch (e) {
      if (e.message.includes("Missing SNAPTRADE")) {
        setError("SnapTrade is not configured — add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to environment.");
      } else {
        setError(e.message);
      }
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
      if ((connResp.connections || []).length > 0) {
        setStep("accounts");
      }
    } catch { /* ignore — will be empty */ }
  }

  // ── Connect a new brokerage ────────────────────────────────────
  async function handleConnect(broker) {
    setLoading(true); setError("");
    try {
      const resp = await api("/api/snaptrade/connect", {
        method: "POST",
        body: JSON.stringify({ broker: broker || undefined }),
      });
      if (resp.redirect_uri) {
        // Open SnapTrade Connection Portal
        const popup = window.open(resp.redirect_uri, "snaptrade_connect", "width=500,height=700");
        // Poll for completion
        const pollInterval = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(pollInterval);
            setLoading(true);
            // Give SnapTrade a moment to process the connection
            await new Promise(r => setTimeout(r, 2000));
            await loadConnectionsAndAccounts();
            setLoading(false);
          }
        }, 1000);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  // ── Preview holdings for an account ────────────────────────────
  async function previewHoldings(accountId) {
    setLoading(true); setError(""); setSelectedAcct(accountId);
    try {
      const resp = await api(`/api/snaptrade/holdings/${accountId}`);
      setHoldings(resp.assets || []);
      setStep("preview");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  // ── Import holdings ────────────────────────────────────────────
  async function doImport() {
    if (!selectedAcct) return;
    setLoading(true); setError("");
    try {
      const resp = await api(`/api/snaptrade/import/${selectedAcct}`, { method: "POST" });
      setImportResult(resp);
      setStep("done");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  // ── Disconnect a single brokerage connection ───────────────────
  async function disconnectConnection(authId) {
    setDisconnecting(true); setError("");
    try {
      await api(`/api/snaptrade/connections/${authId}`, { method: "DELETE" });
      setShowDisconnectConfirm(null);
      // Refresh
      await loadConnectionsAndAccounts();
      // If no connections left, go back to connect step
      if (connections.length <= 1) {
        setStep("connect");
        setAccounts([]);
        setConnections([]);
      }
    } catch (e) {
      setError(e.message);
    }
    setDisconnecting(false);
  }

  // ── Disconnect ALL (nuke SnapTrade user) ───────────────────────
  async function disconnectAll() {
    setDisconnecting(true); setError("");
    try {
      await api("/api/snaptrade/disconnect", { method: "DELETE" });
      setShowDisconnectConfirm(null);
      setStep("connect");
      setRegistered(false);
      setConnections([]);
      setAccounts([]);
      setHoldings([]);
      setImportResult(null);
    } catch (e) {
      setError(e.message);
    }
    setDisconnecting(false);
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  const fmtVal = n => "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".4rem" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.3rem", color: "#ffffff" }}>
          🇺🇸 SnapTrade Import
        </div>
        {connections.length > 0 && step !== "done" && (
          <button onClick={() => setShowDisconnectConfirm("all")} style={{
            background: "none", border: "1px solid rgba(224,124,90,.25)", color: "rgba(224,124,90,.7)",
            padding: ".28rem .7rem", borderRadius: 4, cursor: "pointer", fontSize: ".65rem",
            letterSpacing: ".04em", transition: "all .2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(224,124,90,.08)"; e.currentTarget.style.color = "#e07c5a"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(224,124,90,.7)"; }}
          >
            Disconnect All
          </button>
        )}
      </div>
      <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.45)", marginBottom: "1.2rem" }}>
        Connect US brokerage accounts via SnapTrade to auto-import positions.
      </div>

      <StepBar step={step} />

      {error && (
        <div style={{
          background: "rgba(224,124,90,.08)", border: "1px solid rgba(224,124,90,.25)",
          borderRadius: 6, padding: ".55rem .85rem", fontSize: ".75rem", color: "#e07c5a",
          marginBottom: "1rem", display: "flex", alignItems: "center", gap: ".5rem",
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>{error}</span>
          <span onClick={() => setError("")} style={{ cursor: "pointer", opacity: .6, fontSize: ".8rem" }}>✕</span>
        </div>
      )}

      {/* ── Loading spinner ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{
            width: 30, height: 30, border: "2px solid rgba(167,139,250,.15)",
            borderTopColor: "#a78bfa", borderRadius: "50%",
            animation: "snapspin 1s linear infinite", margin: "0 auto .8rem",
          }} />
          <div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.45)" }}>
            {step === "connect" ? "Checking connection…" : step === "preview" ? "Fetching positions…" : "Processing…"}
          </div>
          <style>{`@keyframes snapspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         STEP: CONNECT
      ════════════════════════════════════════════════════ */}
      {!loading && step === "connect" && (
        <div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.6)", marginBottom: "1rem" }}>
            Choose a brokerage to connect. You'll be redirected to their login page — your credentials are never shared with WealthLens.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: ".6rem" }}>
            {[
              { slug: "FIDELITY", label: "Fidelity", icon: "🏦" },
              { slug: "SCHWAB", label: "Schwab", icon: "🏦" },
              { slug: "ROBINHOOD", label: "Robinhood", icon: "🪶" },
              { slug: "ALPACA", label: "Alpaca", icon: "🦙" },
              { slug: "INTERACTIVE_BROKERS", label: "IBKR", icon: "🏛️" },
              { slug: "", label: "All Brokers", icon: "🔗" },
            ].map(b => (
              <button key={b.slug || "all"} onClick={() => handleConnect(b.slug)}
                style={{
                  background: "rgba(167,139,250,.04)", border: "1px solid rgba(167,139,250,.18)",
                  borderRadius: 8, padding: ".85rem .5rem", cursor: "pointer", textAlign: "center",
                  transition: "all .2s", color: "#ffffff",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.45)"; e.currentTarget.style.background = "rgba(167,139,250,.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.18)"; e.currentTarget.style.background = "rgba(167,139,250,.04)"; }}
              >
                <div style={{ fontSize: "1.3rem", marginBottom: ".3rem" }}>{b.icon}</div>
                <div style={{ fontSize: ".75rem", fontWeight: 500 }}>{b.label}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.3)", marginTop: "1rem", textAlign: "center", lineHeight: 1.6 }}>
            Powered by SnapTrade · OAuth2 · Your credentials stay with your broker
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         STEP: ACCOUNTS (with connection management)
      ════════════════════════════════════════════════════ */}
      {!loading && step === "accounts" && (
        <div>
          {/* ── Active Connections ── */}
          {connections.length > 0 && (
            <div style={{ marginBottom: "1.2rem" }}>
              <div style={{
                fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase",
                color: "rgba(255,255,255,.5)", marginBottom: ".6rem",
              }}>Connected Brokerages</div>
              {connections.map(c => (
                <div key={c.authorization_id} style={{
                  display: "flex", alignItems: "center", gap: ".7rem",
                  padding: ".65rem .85rem", marginBottom: ".4rem",
                  background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)",
                  borderRadius: 8,
                }}>
                  <div style={{ fontSize: "1.1rem" }}>{brokerIcon(c.brokerage_slug)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".8rem", color: "#ffffff", fontWeight: 500 }}>{c.brokerage}</div>
                    <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>
                      {c.status === "active" ? (
                        <span style={{ color: "rgba(76,175,154,.8)" }}>● Active</span>
                      ) : (
                        <span style={{ color: "rgba(224,124,90,.8)" }}>● Disabled — reconnect needed</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setShowDisconnectConfirm(c.authorization_id)} style={{
                    background: "none", border: "1px solid rgba(224,124,90,.2)",
                    color: "rgba(224,124,90,.55)", padding: ".22rem .55rem", borderRadius: 4,
                    cursor: "pointer", fontSize: ".62rem", transition: "all .2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#e07c5a"; e.currentTarget.style.borderColor = "rgba(224,124,90,.4)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "rgba(224,124,90,.55)"; e.currentTarget.style.borderColor = "rgba(224,124,90,.2)"; }}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Accounts list ── */}
          {accounts.length > 0 ? (
            <>
              <div style={{
                fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase",
                color: "rgba(255,255,255,.5)", marginBottom: ".6rem",
              }}>Accounts — click to preview & import</div>
              {accounts.map(a => (
                <div key={a.account_id} onClick={() => previewHoldings(a.account_id)}
                  style={{
                    display: "flex", alignItems: "center", gap: ".7rem",
                    padding: ".75rem .85rem", marginBottom: ".4rem",
                    background: "rgba(167,139,250,.04)", border: "1px solid rgba(167,139,250,.15)",
                    borderRadius: 8, cursor: "pointer", transition: "all .2s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.4)"; e.currentTarget.style.background = "rgba(167,139,250,.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.15)"; e.currentTarget.style.background = "rgba(167,139,250,.04)"; }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: ".85rem",
                    background: "rgba(167,139,250,.12)", border: "1px solid rgba(167,139,250,.25)",
                    color: "#a78bfa", flexShrink: 0,
                  }}>{brokerIcon(a.brokerage_slug)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".8rem", color: "#ffffff", fontWeight: 500 }}>
                      {a.account_name || a.brokerage}
                    </div>
                    <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>
                      {a.brokerage} · {a.account_number ? `••${a.account_number.slice(-4)}` : "Account"}
                    </div>
                  </div>
                  <div style={{ fontSize: ".72rem", color: "#a78bfa" }}>Preview →</div>
                </div>
              ))}
            </>
          ) : connections.length === 0 ? (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>
              No brokerages connected yet. Go back to connect one.
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>
              Connected but no accounts found. This can happen if the brokerage connection is still syncing. Try refreshing in a moment.
            </div>
          )}

          {/* ── Add another brokerage ── */}
          <button onClick={() => setStep("connect")} style={{
            display: "block", width: "100%", marginTop: ".8rem",
            background: "none", border: "1px dashed rgba(167,139,250,.25)",
            color: "rgba(167,139,250,.6)", padding: ".55rem", borderRadius: 6,
            cursor: "pointer", fontSize: ".72rem", transition: "all .2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.5)"; e.currentTarget.style.color = "#a78bfa"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,.25)"; e.currentTarget.style.color = "rgba(167,139,250,.6)"; }}
          >
            + Connect another brokerage
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         STEP: PREVIEW
      ════════════════════════════════════════════════════ */}
      {!loading && step === "preview" && (
        <div>
          <div style={{
            fontSize: ".63rem", letterSpacing: ".1em", textTransform: "uppercase",
            color: "rgba(255,255,255,.5)", marginBottom: ".7rem",
          }}>
            {holdings.length} positions found
            {holdings.length > 0 && ` · Total ${fmtVal(holdings.reduce((s, h) => s + h.market_value, 0))}`}
          </div>

          {holdings.length > 0 ? (
            <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: "1rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Ticker</th>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Units</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Value</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const pnlColor = h.unrealized_pnl >= 0 ? "#4caf9a" : "#e07c5a";
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500, color: "#fff" }}>{h.ticker}</div>
                          <div style={{ fontSize: ".6rem", color: "rgba(255,255,255,.4)", marginTop: 1, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {h.asset_name}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            fontSize: ".6rem", padding: ".12rem .38rem", borderRadius: 3,
                            background: "rgba(167,139,250,.1)", color: "#a78bfa",
                          }}>{h.asset_type}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                          {h.units?.toFixed(h.units % 1 === 0 ? 0 : 4)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                          ${h.current_price?.toFixed(2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#fff" }}>
                          {fmtVal(h.market_value)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'DM Mono',monospace", color: pnlColor }}>
                          {h.unrealized_pnl >= 0 ? "+" : ""}{fmtVal(h.unrealized_pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>
              No positions found in this account.
            </div>
          )}

          <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end" }}>
            <button onClick={() => { setStep("accounts"); setHoldings([]); }} style={btnSecondary}>← Back</button>
            {holdings.length > 0 && (
              <button onClick={doImport} style={btnPrimary}>
                Import {holdings.length} positions into WealthLens
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         STEP: DONE
      ════════════════════════════════════════════════════ */}
      {!loading && step === "done" && importResult && (
        <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <div style={{ fontSize: "2.2rem", marginBottom: ".6rem" }}>✅</div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.15rem", color: "#ffffff", marginBottom: ".4rem" }}>
            Import Complete
          </div>
          <div style={{ fontSize: ".8rem", color: "rgba(255,255,255,.55)", marginBottom: "1.2rem" }}>
            {importResult.assets_imported} positions imported into your portfolio
          </div>
          <div style={{ display: "flex", gap: ".6rem", justifyContent: "center" }}>
            <button onClick={() => { setStep("accounts"); setImportResult(null); }} style={btnSecondary}>
              Import another account
            </button>
            <button onClick={onClose} style={btnPrimary}>Done</button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
         DISCONNECT CONFIRMATION MODAL
      ════════════════════════════════════════════════════ */}
      {showDisconnectConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(3px)",
          zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
        }} onClick={() => !disconnecting && setShowDisconnectConfirm(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#0c1526", border: "1px solid rgba(224,124,90,.25)",
            borderRadius: 12, padding: "1.5rem", width: "100%", maxWidth: 380,
          }}>
            <div style={{ fontSize: "1.4rem", textAlign: "center", marginBottom: ".6rem" }}>⚠️</div>
            <div style={{
              fontFamily: "'Cormorant Garamond',serif", fontSize: "1.1rem",
              color: "#ffffff", textAlign: "center", marginBottom: ".5rem",
            }}>
              {showDisconnectConfirm === "all" ? "Disconnect All Brokerages?" : "Disconnect Brokerage?"}
            </div>
            <div style={{
              fontSize: ".75rem", color: "rgba(255,255,255,.55)", textAlign: "center",
              lineHeight: 1.6, marginBottom: "1.2rem",
            }}>
              {showDisconnectConfirm === "all" ? (
                <>This will <strong style={{ color: "#e07c5a" }}>delete your SnapTrade account</strong>, revoke all brokerage connections, and remove all imported holdings from WealthLens.</>
              ) : (
                <>This will revoke the OAuth connection to this brokerage and remove imported holdings. You can reconnect anytime.</>
              )}
            </div>

            {disconnecting ? (
              <div style={{ textAlign: "center", padding: ".5rem" }}>
                <div style={{
                  width: 24, height: 24, border: "2px solid rgba(224,124,90,.15)",
                  borderTopColor: "#e07c5a", borderRadius: "50%",
                  animation: "snapspin 1s linear infinite", margin: "0 auto .5rem",
                }} />
                <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.4)" }}>Disconnecting…</div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: ".6rem" }}>
                <button onClick={() => setShowDisconnectConfirm(null)} style={{
                  ...btnSecondary, flex: 1, textAlign: "center",
                }}>Cancel</button>
                <button onClick={() => {
                  if (showDisconnectConfirm === "all") disconnectAll();
                  else disconnectConnection(showDisconnectConfirm);
                }} style={{
                  flex: 1, textAlign: "center",
                  background: "rgba(224,124,90,.12)", border: "1px solid rgba(224,124,90,.45)",
                  color: "#e07c5a", padding: ".52rem 1rem", borderRadius: 6,
                  cursor: "pointer", fontSize: ".78rem", fontWeight: 500,
                  transition: "all .2s", fontFamily: "'DM Sans',sans-serif",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(224,124,90,.2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(224,124,90,.12)"}
                >
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

// ── Shared styles ────────────────────────────────────────────────
const thStyle = {
  fontSize: ".6rem", letterSpacing: ".08em", textTransform: "uppercase",
  color: "rgba(255,255,255,.45)", textAlign: "left",
  padding: "0 .5rem .5rem", borderBottom: "1px solid rgba(255,255,255,.06)",
};
const tdStyle = {
  padding: ".55rem .5rem", fontSize: ".75rem", color: "rgba(255,255,255,.8)",
};
const btnSecondary = {
  background: "none", border: "1px solid rgba(255,255,255,.15)",
  color: "rgba(255,255,255,.6)", padding: ".52rem 1rem", borderRadius: 6,
  cursor: "pointer", fontSize: ".78rem", transition: "all .2s",
  fontFamily: "'DM Sans',sans-serif",
};
const btnPrimary = {
  background: "rgba(167,139,250,.14)", border: "1px solid rgba(167,139,250,.48)",
  color: "#a78bfa", padding: ".52rem 1.2rem", borderRadius: 6,
  cursor: "pointer", fontSize: ".78rem", fontWeight: 500,
  transition: "all .2s", fontFamily: "'DM Sans',sans-serif",
};
