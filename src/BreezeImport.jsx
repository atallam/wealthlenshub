// src/BreezeImport.jsx
// ICICI Direct Breeze API — connect + sync component
// Mirrors KiteImport.jsx; Breeze requires pasting session_token (no auto-redirect)

import { useState, useEffect, useCallback } from "react";

const S = {
  wrap:    { fontFamily: "'DM Sans', sans-serif", maxWidth: 520, margin: "0 auto" },
  card:    { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "1rem", marginBottom: ".75rem" },
  label:   { fontSize: ".65rem", letterSpacing: ".1em", textTransform: "uppercase", color: "#5a9ce0", marginBottom: ".5rem" },
  input:   { width: "100%", padding: ".5rem .7rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "#fff", fontSize: ".82rem", fontFamily: "'DM Mono', monospace", boxSizing: "border-box", marginBottom: ".6rem" },
  primary: { padding: ".5rem 1.2rem", borderRadius: 6, border: "none", cursor: "pointer", fontSize: ".78rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, background: "#5a9ce0", color: "#fff" },
  danger:  { padding: ".45rem .9rem", borderRadius: 6, border: "1px solid rgba(224,124,90,.4)", cursor: "pointer", fontSize: ".75rem", fontFamily: "'DM Sans', sans-serif", background: "transparent", color: "#e07c5a" },
  ghost:   { padding: ".45rem .9rem", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", cursor: "pointer", fontSize: ".75rem", fontFamily: "'DM Sans', sans-serif", background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.7)" },
  pill:    (ok) => ({ display: "inline-block", fontSize: ".6rem", padding: "2px 7px", borderRadius: 10, background: ok ? "rgba(76,175,154,.15)" : "rgba(224,124,90,.15)", color: ok ? "#4caf9a" : "#e07c5a", border: `1px solid ${ok ? "rgba(76,175,154,.3)" : "rgba(224,124,90,.3)"}` }),
};

export default function BreezeImport({ onClose, members = [], api }) {
  const [step, setStep] = useState("check");
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [memberId, setMemberId] = useState(members[0]?.id || "");

  useEffect(() => { checkStatus(); }, []);

  const checkStatus = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const s = await api("/api/breeze/status");
      setStatus(s);
      if (!s.connected) setStep("setup");
      else if (s.needs_reauth) setStep("reauth");
      else setStep("ready");
    } catch {
      setStep("setup");
    }
    setLoading(false);
  }, [api]);

  // ── Save credentials ─────────────────────────────────────────────
  async function handleSaveCreds() {
    if (!apiKey.trim() || !apiSecret.trim())
      return setError("Both API Key and API Secret are required.");
    setLoading(true); setError("");
    try {
      await api("/api/breeze/connect", {
        method: "POST",
        body: JSON.stringify({ api_key: apiKey.trim(), api_secret: apiSecret.trim() }),
      });
      const { login_url } = await api("/api/breeze/login-url");
      setLoginUrl(login_url);
      setStep("reauth");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Open Breeze login ────────────────────────────────────────────
  async function openBreezeLogin() {
    if (!loginUrl) {
      setLoading(true);
      try {
        const { login_url } = await api("/api/breeze/login-url");
        setLoginUrl(login_url);
      } catch (e) { setError(e.message); setLoading(false); return; }
      setLoading(false);
    }
    window.open(loginUrl, "breeze_login", "width=520,height=700");
  }

  // ── Submit session_token ─────────────────────────────────────────
  async function handleCallback() {
    if (!sessionToken.trim()) return setError("Paste the SessionToken from the redirect URL.");
    setLoading(true); setError("");
    try {
      const r = await api("/api/breeze/callback", {
        method: "POST",
        body: JSON.stringify({ session_token: sessionToken.trim() }),
      });
      setStatus(s => ({
        ...s, connected: true, token_valid: true,
        profile_name: r.profile_name, client_id: r.client_id, needs_reauth: false,
      }));
      setStep("ready");
      setSessionToken("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Sync holdings ────────────────────────────────────────────────
  async function handleSync() {
    setStep("syncing"); setError("");
    try {
      const r = await api("/api/breeze/sync", {
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
    if (!confirm("Disconnect ICICI Direct and remove all Breeze-synced holdings?")) return;
    setLoading(true);
    try {
      await api("/api/breeze/disconnect", { method: "DELETE" });
      setStatus(null); setStep("setup");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const Header = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
      <div>
        <div style={{ fontSize: "1.05rem", fontFamily: "'Cormorant Garamond', serif", color: "#fff" }}>
          🔵 ICICI Direct
        </div>
        <div style={{ fontSize: ".68rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>
          Breeze API — free · equity + MF · daily session
        </div>
      </div>
      {status?.connected && (
        <span style={S.pill(status.token_valid)}>
          {status.token_valid ? "Session valid" : "Session expired"}
        </span>
      )}
      <button onClick={onClose} style={{ ...S.ghost, padding: ".3rem .6rem" }}>✕</button>
    </div>
  );

  if (step === "check") return (
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

      {/* ── SETUP: Credentials ── */}
      {step === "setup" && (
        <div style={S.card}>
          <div style={S.label}>Step 1 — Register on ICICI Direct Developer Portal</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", lineHeight: 1.7, marginBottom: ".8rem" }}>
            1. Go to <a href="https://api.icicidirect.com/apiuser/apihome" target="_blank" rel="noopener" style={{ color: "#5a9ce0" }}>api.icicidirect.com</a> → Register<br />
            2. Create an app → get <b>AppKey</b> (API Key) and <b>client_secret</b><br />
            3. The API is free for all ICICIdirect customers.
          </div>

          <div style={S.label}>AppKey (API Key)</div>
          <input
            style={S.input}
            placeholder="e.g. 69I1o_408312906X5z4K)1nG7P066062"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            autoComplete="off"
          />

          <div style={S.label}>client_secret (API Secret)</div>
          <input
            style={{ ...S.input, marginBottom: ".8rem" }}
            type="password"
            placeholder="Your Breeze client_secret"
            value={apiSecret}
            onChange={e => setApiSecret(e.target.value)}
            autoComplete="new-password"
          />

          <button onClick={handleSaveCreds} disabled={loading} style={S.primary}>
            {loading ? "Saving…" : "Save & Continue →"}
          </button>
        </div>
      )}

      {/* ── REAUTH: Login + paste session_token ── */}
      {step === "reauth" && (
        <div style={S.card}>
          <div style={S.label}>{status?.connected ? "Re-Authorize (daily)" : "Step 2 — Authorize"}</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", lineHeight: 1.7, marginBottom: ".8rem" }}>
            Breeze sessions expire daily.<br />
            1. Click <b>Open ICICI Direct Login</b><br />
            2. Log in → after redirect, look at the URL<br />
            3. Copy the value after <code style={{ color: "#5a9ce0" }}>SessionToken=</code><br />
            &nbsp;&nbsp;&nbsp;<span style={{ color: "rgba(255,255,255,.3)", fontSize: ".65rem" }}>
              e.g. …?SessionToken=<b>58593&amp;…</b>
            </span>
          </div>

          <button
            onClick={openBreezeLogin}
            style={{ ...S.ghost, marginBottom: ".8rem", display: "block" }}
          >
            🔗 Open ICICI Direct Login
          </button>

          <div style={S.label}>Paste SessionToken</div>
          <input
            style={S.input}
            placeholder="SessionToken from redirect URL"
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

      {/* ── READY ── */}
      {step === "ready" && (
        <>
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: ".82rem", color: "#e8e0d0", fontWeight: 500 }}>
                  {status?.profile_name || "Connected"} {status?.client_id ? `(${status.client_id})` : ""}
                </div>
                <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.35)", marginTop: 2 }}>
                  Session: {status?.token_date} · Last sync: {status?.last_synced_at ? new Date(status.last_synced_at).toLocaleDateString("en-IN") : "Never"}
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
                style={{ ...S.input, marginBottom: 0 }}
              >
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: ".6rem", marginTop: ".25rem" }}>
            <button onClick={handleSync} style={S.primary}>⟳ Sync Holdings</button>
            <button onClick={() => setStep("reauth")} style={S.ghost}>Re-Authorize</button>
            <button onClick={handleDisconnect} style={S.danger}>Disconnect</button>
          </div>
        </>
      )}

      {/* ── SYNCING ── */}
      {step === "syncing" && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 28, height: 28, border: "2px solid rgba(90,156,224,.2)", borderTopColor: "#5a9ce0", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.4)", marginTop: ".8rem" }}>
            Fetching holdings from ICICI Direct…
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
            {result.equity_count} equities · {result.mf_count} mutual funds
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
