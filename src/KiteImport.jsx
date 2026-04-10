// src/KiteImport.jsx
// Zerodha Kite Personal API — connect + sync component
// Mirrors SnapTradeImport.jsx patterns exactly

import { useState, useEffect, useCallback } from "react";

const S = {
  wrap:    { fontFamily: "'DM Sans', sans-serif", maxWidth: 520, margin: "0 auto" },
  card:    { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "1rem", marginBottom: ".75rem" },
  label:   { fontSize: ".65rem", letterSpacing: ".1em", textTransform: "uppercase", color: "#c9a84c", marginBottom: ".5rem" },
  input:   { width: "100%", padding: ".5rem .7rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "#fff", fontSize: ".82rem", fontFamily: "'DM Mono', monospace", boxSizing: "border-box" },
  primary: { padding: ".5rem 1.2rem", borderRadius: 6, border: "none", cursor: "pointer", fontSize: ".78rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, background: "#c9a84c", color: "#1a1a1a" },
  danger:  { padding: ".45rem .9rem", borderRadius: 6, border: "1px solid rgba(224,124,90,.4)", cursor: "pointer", fontSize: ".75rem", fontFamily: "'DM Sans', sans-serif", background: "transparent", color: "#e07c5a" },
  ghost:   { padding: ".45rem .9rem", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", cursor: "pointer", fontSize: ".75rem", fontFamily: "'DM Sans', sans-serif", background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.7)" },
  pill:    (ok) => ({ display: "inline-block", fontSize: ".6rem", padding: "2px 7px", borderRadius: 10, background: ok ? "rgba(76,175,154,.15)" : "rgba(224,124,90,.15)", color: ok ? "#4caf9a" : "#e07c5a", border: `1px solid ${ok ? "rgba(76,175,154,.3)" : "rgba(224,124,90,.3)"}` }),
};

export default function KiteImport({ onClose, members = [], api }) {
  const [step, setStep] = useState("check");   // check | setup | reauth | ready | syncing | done
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [memberId, setMemberId] = useState(members[0]?.id || "");
  const [loginUrl, setLoginUrl] = useState("");

  // ── Load status on mount ─────────────────────────────────────────
  useEffect(() => { checkStatus(); }, []);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const s = await api("/api/kite/status");
      setStatus(s);
      if (!s.connected) setStep("setup");
      else if (s.needs_reauth) setStep("reauth");
      else setStep("ready");
    } catch {
      setStep("setup");
    }
    setLoading(false);
  }, [api]);

  // ── Step 1: Save API key ─────────────────────────────────────────
  async function handleSaveKey() {
    if (!apiKey.trim()) return setError("Enter your Kite Personal API key.");
    setLoading(true); setError("");
    try {
      await api("/api/kite/connect", { method: "POST", body: JSON.stringify({ api_key: apiKey.trim() }) });
      // Now fetch login URL
      const { login_url } = await api("/api/kite/login-url");
      setLoginUrl(login_url);
      setStep("reauth");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Step 2: Open Kite OAuth, then accept pasted request_token ────
  async function openKiteLogin() {
    if (!loginUrl) {
      setLoading(true);
      try {
        const { login_url } = await api("/api/kite/login-url");
        setLoginUrl(login_url);
      } catch (e) { setError(e.message); setLoading(false); return; }
      setLoading(false);
    }
    window.open(loginUrl, "kite_login", "width=520,height=700");
  }

  // ── Step 3: Exchange request_token ───────────────────────────────
  async function handleCallback() {
    if (!sessionToken.trim()) return setError("Paste the request_token from the redirect URL.");
    setLoading(true); setError("");
    try {
      const r = await api("/api/kite/callback", {
        method: "POST",
        body: JSON.stringify({ request_token: sessionToken.trim() }),
      });
      setStatus(s => ({ ...s, connected: true, token_valid: true, profile_name: r.profile_name, needs_reauth: false }));
      setStep("ready");
      setSessionToken("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Sync holdings ────────────────────────────────────────────────
  async function handleSync() {
    setStep("syncing"); setError("");
    try {
      const r = await api("/api/kite/sync", {
        method: "POST",
        body: JSON.stringify({ member_id: memberId || undefined }),
      });
      if (r.needs_reauth) { setStep("reauth"); return; }
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e.message);
      if (e.message.includes("expired") || e.message.includes("reauth")) setStep("reauth");
      else setStep("ready");
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────
  async function handleDisconnect() {
    if (!confirm("Disconnect Zerodha and remove all Kite-synced holdings?")) return;
    setLoading(true);
    try {
      await api("/api/kite/disconnect", { method: "DELETE" });
      setStatus(null); setStep("setup");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Render helpers ───────────────────────────────────────────────
  const Header = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
      <div>
        <div style={{ fontSize: "1.05rem", fontFamily: "'Cormorant Garamond', serif", color: "#fff" }}>
          🟢 Zerodha Kite
        </div>
        <div style={{ fontSize: ".68rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>
          Personal API — free · equity + Coin MF · daily token
        </div>
      </div>
      {status?.connected && (
        <span style={S.pill(status.token_valid)}>
          {status.token_valid ? "Token valid" : "Token expired"}
        </span>
      )}
      <button onClick={onClose} style={{ ...S.ghost, padding: ".3rem .6rem" }}>✕</button>
    </div>
  );

  if (step === "check" || loading && step === "check") return (
    <div style={S.wrap}>
      <Header />
      <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,.4)", fontSize: ".8rem" }}>
        Checking connection…
      </div>
    </div>
  );

  return (
    <div style={S.wrap}>
      <Header />

      {error && (
        <div style={{ padding: ".6rem .8rem", background: "rgba(224,124,90,.1)", border: "1px solid rgba(224,124,90,.3)", borderRadius: 6, color: "#e07c5a", fontSize: ".75rem", marginBottom: ".75rem" }}>
          {error}
        </div>
      )}

      {/* ── SETUP: Enter API key ── */}
      {step === "setup" && (
        <div style={S.card}>
          <div style={S.label}>Step 1 — Create a Personal App</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", lineHeight: 1.7, marginBottom: ".8rem" }}>
            1. Go to <a href="https://developers.kite.trade/" target="_blank" rel="noopener" style={{ color: "#c9a84c" }}>developers.kite.trade</a><br />
            2. Sign in → My Apps → <b>Create New App</b><br />
            3. Type: <code style={{ color: "#c9a84c" }}>Personal</code> · Redirect URL: <code style={{ color: "#c9a84c" }}>{window.location.origin}/import/kite/callback</code><br />
            4. Copy the <b>API Key</b> and paste below.
          </div>
          <div style={S.label}>Your Kite API Key</div>
          <input
            style={{ ...S.input, marginBottom: ".8rem" }}
            placeholder="e.g. ycavr5szpoa6nzmp"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <button onClick={handleSaveKey} disabled={loading} style={S.primary}>
            {loading ? "Saving…" : "Save & Continue →"}
          </button>
        </div>
      )}

      {/* ── REAUTH: Open login + paste token ── */}
      {step === "reauth" && (
        <div style={S.card}>
          <div style={S.label}>{status?.connected ? "Re-Authorize (daily)" : "Step 2 — Authorize"}</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", lineHeight: 1.7, marginBottom: ".8rem" }}>
            Kite tokens expire daily (SEBI requirement).<br />
            1. Click <b>Open Zerodha Login</b> below<br />
            2. Log in with your Zerodha credentials<br />
            3. After login, copy the <code style={{ color: "#c9a84c" }}>request_token</code> value from the redirect URL<br />
            &nbsp;&nbsp;&nbsp;e.g. <code style={{ color: "rgba(255,255,255,.3)", fontSize: ".65rem" }}>…/callback?request_token=<b>PASTE_THIS</b>&status=success</code>
          </div>
          <button onClick={openKiteLogin} style={{ ...S.ghost, marginBottom: ".8rem" }}>
            🔗 Open Zerodha Login
          </button>
          <div style={S.label}>Paste request_token</div>
          <input
            style={{ ...S.input, marginBottom: ".8rem" }}
            placeholder="request_token from redirect URL"
            value={sessionToken}
            onChange={e => setSessionToken(e.target.value)}
          />
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button onClick={handleCallback} disabled={loading || !sessionToken.trim()} style={S.primary}>
              {loading ? "Verifying…" : "Authorize →"}
            </button>
            {status?.connected && (
              <button onClick={() => setStep("ready")} style={S.ghost}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* ── READY: Sync ── */}
      {step === "ready" && (
        <>
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: ".82rem", color: "#e8e0d0", fontWeight: 500 }}>
                  {status?.profile_name || "Connected"}
                </div>
                <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.35)", marginTop: 2 }}>
                  Token: {status?.token_date} · Last sync: {status?.last_synced_at ? new Date(status.last_synced_at).toLocaleDateString("en-IN") : "Never"}
                </div>
              </div>
              <span style={S.pill(true)}>Ready</span>
            </div>
          </div>

          {members.length > 1 && (
            <div style={S.card}>
              <div style={S.label}>Assign to member</div>
              <select
                value={memberId}
                onChange={e => setMemberId(e.target.value)}
                style={{ ...S.input }}
              >
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: ".6rem", marginTop: ".25rem" }}>
            <button onClick={handleSync} style={S.primary}>⟳ Sync Holdings</button>
            <button onClick={() => setStep("reauth")} style={S.ghost}>Re-Authorize Token</button>
            <button onClick={handleDisconnect} style={S.danger}>Disconnect</button>
          </div>
        </>
      )}

      {/* ── SYNCING ── */}
      {step === "syncing" && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 28, height: 28, border: "2px solid rgba(201,168,76,.2)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.4)", marginTop: ".8rem" }}>
            Fetching holdings from Zerodha…
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === "done" && result && (
        <div style={{ ...S.card, textAlign: "center" }}>
          <div style={{ fontSize: "1.8rem", marginBottom: ".5rem" }}>✅</div>
          <div style={{ fontSize: ".9rem", color: "#4caf9a", marginBottom: ".3rem" }}>
            {result.synced} holdings synced
          </div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.4)", marginBottom: "1rem" }}>
            {result.equity_count} equities · {result.mf_count} mutual funds (Coin)
          </div>
          <div style={{ display: "flex", gap: ".5rem", justifyContent: "center" }}>
            <button onClick={() => { setResult(null); setStep("ready"); }} style={S.ghost}>Sync Again</button>
            <button onClick={onClose} style={S.primary}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
