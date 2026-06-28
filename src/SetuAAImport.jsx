import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";

const FI_TYPES = [
  { key: "DEPOSIT", label: "Bank Accounts", icon: "🏦", desc: "Savings & current accounts" },
  { key: "TERM_DEPOSIT", label: "Fixed Deposits", icon: "📜", desc: "FDs across banks" },
  { key: "MUTUAL_FUNDS", label: "Mutual Funds", icon: "📊", desc: "All MF folios" },
  { key: "EQUITIES", label: "Stocks", icon: "📈", desc: "Demat equity holdings" },
  { key: "ETF", label: "ETFs", icon: "🔷", desc: "Exchange traded funds" },
  { key: "EPF", label: "EPF", icon: "🏛️", desc: "Employee Provident Fund" },
  { key: "PPF", label: "PPF", icon: "📗", desc: "Public Provident Fund" },
];

export default function SetuAAImport({ onClose, onImported, members, api }) {
  const [step, setStep] = useState("check"); // check | mobile | consent | waiting | preview | done | error
  const [status, setStatus] = useState(null); // { configured, sandbox }
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [consentId, setConsentId] = useState(null);
  const [consentUrl, setConsentUrl] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [assignMember, setAssignMember] = useState(members?.[0]?.id || "");
  const [importCount, setImportCount] = useState(0);
  const [pastConsents, setPastConsents] = useState([]);

  // Step 1: Check if Setu is configured
  useEffect(() => {
    (async () => {
      try {
        const s = await api("/api/setu/status");
        setStatus(s);
        if (!s.configured) setStep("error");
        else {
          // Load past consents
          const c = await api("/api/setu/consents");
          setPastConsents(c.consents || []);
          setStep("mobile");
        }
      } catch (e) { setError(e.message); setStep("error"); }
    })();
  }, []);

  // Create consent
  async function createConsent() {
    if (!mobile.match(/^\d{10}$/)) { setError("Enter a valid 10-digit mobile number"); return; }
    setLoading(true); setError("");
    try {
      const resp = await api("/api/setu/consent", {
        method: "POST",
        body: JSON.stringify({ mobile }),
      });
      setConsentId(resp.consent_id);
      setConsentUrl(resp.url);
      setStep("consent");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // Open consent URL in new tab
  function openConsent() {
    if (consentUrl) window.open(consentUrl, "_blank");
    setStep("waiting");
  }

  // Check consent status and fetch data
  async function checkAndFetch() {
    setLoading(true); setError("");
    try {
      const cs = await api(`/api/setu/consent/${consentId}`);
      if (cs.status === "ACTIVE" || cs.status === "APPROVED") {
        // Consent approved — fetch FI data
        const fd = await api(`/api/setu/fetch/${consentId}`, { method: "POST" });
        setHoldings(fd.holdings || []);
        setStep(fd.holdings?.length > 0 ? "preview" : "done");
      } else if (cs.status === "REJECTED") {
        setError("Consent was rejected. Please try again.");
        setStep("mobile");
      } else {
        setError(`Consent is still ${cs.status}. Complete the approval in the Setu window, then click "Check again".`);
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // Import holdings
  async function importHoldings() {
    setLoading(true); setError("");
    try {
      const resp = await api("/api/setu/import", {
        method: "POST",
        body: JSON.stringify({ holdings, member_id: assignMember, consent_id: consentId }),
      });
      setImportCount(resp.imported);
      setStep("done");
      if (onImported) onImported();
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // Resume a past consent
  async function resumeConsent(c) {
    setConsentId(c.consent_id);
    if (c.status === "ACTIVE" || c.status === "APPROVED") {
      setLoading(true);
      try {
        const fd = await api(`/api/setu/fetch/${c.consent_id}`, { method: "POST" });
        setHoldings(fd.holdings || []);
        setStep(fd.holdings?.length > 0 ? "preview" : "done");
      } catch (e) { setError(e.message); }
      setLoading(false);
    } else {
      setConsentUrl(c.redirect_url);
      setStep("consent");
    }
  }

  const S = { fontFamily: "'DM Sans',sans-serif" };
  const cardS = { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "1rem" };
  const btnS = { padding: ".5rem 1.2rem", borderRadius: 6, border: "none", cursor: "pointer", fontSize: ".78rem", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 };
  const primaryBtn = { ...btnS, background: "#4caf9a", color: "#fff" };
  const secondaryBtn = { ...btnS, background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.7)", border: "1px solid rgba(255,255,255,.1)" };

  return (
    <div style={{ ...S, maxWidth: 560, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
        <div>
          <div style={{ fontSize: "1.1rem", fontFamily: "'Cormorant Garamond',serif", color: "#fff" }}>🔗 Account Aggregator Import</div>
          <div style={{ fontSize: ".68rem", color: "rgba(255,255,255,.4)", marginTop: 2 }}>
            RBI-regulated consent-based import via Setu {status?.sandbox ? <span style={{ color: "#c9a84c" }}>· Sandbox</span> : ""}
          </div>
        </div>
        <button onClick={onClose} style={{ ...secondaryBtn, padding: ".3rem .6rem" }}>✕</button>
      </div>

      {error && <div style={{ padding: ".6rem .8rem", background: "rgba(224,124,90,.1)", border: "1px solid rgba(224,124,90,.3)", borderRadius: 6, color: "#e07c5a", fontSize: ".75rem", marginBottom: "1rem" }}>{error}</div>}

      {/* STEP: Not configured */}
      {step === "error" && !error && (
        <div style={cardS}>
          <div style={{ fontSize: ".85rem", color: "#e07c5a", marginBottom: ".5rem" }}>⚠ Setu AA Not Configured</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", lineHeight: 1.6 }}>
            To enable Account Aggregator import, set these environment variables on Render:
            <br /><code style={{ color: "#c9a84c" }}>SETU_CLIENT_ID</code>, <code style={{ color: "#c9a84c" }}>SETU_CLIENT_SECRET</code>, <code style={{ color: "#c9a84c" }}>SETU_PRODUCT_INSTANCE_ID</code>
            <br /><br />Get credentials from <a href="https://bridge.setu.co" target="_blank" rel="noopener" style={{ color: "#5a9ce0" }}>bridge.setu.co</a> → Create FIU app → Step 5.
          </div>
        </div>
      )}

      {/* STEP: Enter mobile */}
      {step === "mobile" && (
        <>
          <div style={cardS}>
            <div style={{ fontSize: ".78rem", color: "rgba(255,255,255,.85)", marginBottom: ".8rem" }}>Enter your mobile number linked to your bank accounts</div>
            <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
              <span style={{ fontSize: ".82rem", color: "rgba(255,255,255,.4)" }}>+91</span>
              <input
                type="tel" maxLength={10} placeholder="9876543210"
                value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ""))}
                style={{ flex: 1, padding: ".5rem .7rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, color: "#fff", fontSize: ".85rem", fontFamily: "'DM Mono',monospace" }}
              />
              <button onClick={createConsent} disabled={loading || mobile.length !== 10} style={{ ...primaryBtn, opacity: mobile.length === 10 ? 1 : 0.4 }}>
                {loading ? "Creating..." : "Connect"}
              </button>
            </div>
            <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.3)", marginTop: ".6rem", lineHeight: 1.5 }}>
              Setu will send an OTP to verify your number, then show you which banks and FIPs to link. Your data is fetched only with your explicit consent.
            </div>
          </div>

          {/* FI types we'll request */}
          <div style={{ ...cardS, marginTop: ".8rem" }}>
            <div style={{ fontSize: ".68rem", color: "#c9a84c", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".6rem" }}>Data sources we'll request</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: ".5rem" }}>
              {FI_TYPES.map(f => (
                <div key={f.key} style={{ padding: ".4rem .6rem", background: "rgba(76,175,154,.04)", border: "1px solid rgba(76,175,154,.12)", borderRadius: 6 }}>
                  <div style={{ fontSize: ".9rem" }}>{f.icon} <span style={{ fontSize: ".72rem", color: "rgba(255,255,255,.8)" }}>{f.label}</span></div>
                  <div style={{ fontSize: ".6rem", color: "rgba(255,255,255,.35)" }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Past consents */}
          {pastConsents.length > 0 && (
            <div style={{ ...cardS, marginTop: ".8rem" }}>
              <div style={{ fontSize: ".68rem", color: "#a084ca", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".6rem" }}>Previous imports</div>
              {pastConsents.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".4rem 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                  <div>
                    <span style={{ fontSize: ".72rem", color: "rgba(255,255,255,.7)" }}>{new Date(c.created_at).toLocaleDateString()}</span>
                    <span style={{ fontSize: ".62rem", marginLeft: 8, padding: "1px 5px", borderRadius: 3,
                      background: c.status === "ACTIVE" ? "rgba(76,175,154,.12)" : "rgba(201,168,76,.12)",
                      color: c.status === "ACTIVE" ? "#4caf9a" : "#c9a84c" }}>{c.status}</span>
                    {c.holdings_count > 0 && <span style={{ fontSize: ".62rem", color: "rgba(255,255,255,.4)", marginLeft: 6 }}>{c.holdings_count} imported</span>}
                  </div>
                  {(c.status === "ACTIVE" || c.status === "PENDING") && (
                    <button onClick={() => resumeConsent(c)} style={{ ...secondaryBtn, padding: ".25rem .5rem", fontSize: ".65rem" }}>
                      {c.status === "ACTIVE" ? "Re-fetch" : "Resume"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* STEP: Redirect to consent */}
      {step === "consent" && (
        <div style={cardS}>
          <div style={{ fontSize: ".85rem", color: "#4caf9a", marginBottom: ".6rem" }}>✓ Consent request created</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", marginBottom: "1rem", lineHeight: 1.6 }}>
            Click the button below to open Setu's consent screen. You'll verify your mobile via OTP, select your banks and accounts, and approve the data request.
          </div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button onClick={openConsent} style={primaryBtn}>Open Consent Screen →</button>
            <button onClick={() => setStep("waiting")} style={secondaryBtn}>I already approved</button>
          </div>
        </div>
      )}

      {/* STEP: Waiting for approval */}
      {step === "waiting" && (
        <div style={cardS}>
          <div style={{ fontSize: ".85rem", color: "#c9a84c", marginBottom: ".6rem" }}>⏳ Waiting for consent approval</div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", marginBottom: "1rem", lineHeight: 1.6 }}>
            Complete the consent flow in the Setu window. Once approved, click below to fetch your data.
            {status?.sandbox && <div style={{ color: "#c9a84c", marginTop: ".4rem" }}>Sandbox tip: Use Setu FIP-2 with OTP <strong>123456</strong></div>}
          </div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button onClick={checkAndFetch} disabled={loading} style={primaryBtn}>
              {loading ? "Fetching data..." : "Check & Fetch Data"}
            </button>
            <button onClick={() => { if (consentUrl) window.open(consentUrl, "_blank"); }} style={secondaryBtn}>Re-open consent</button>
          </div>
        </div>
      )}

      {/* STEP: Preview holdings */}
      {step === "preview" && (
        <>
          <div style={cardS}>
            <div style={{ fontSize: ".85rem", color: "#4caf9a", marginBottom: ".5rem" }}>✓ {holdings.length} holdings found</div>
            <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: ".8rem" }}>
              <span style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)" }}>Assign to:</span>
              <select value={assignMember} onChange={e => setAssignMember(e.target.value)}
                style={{ padding: ".35rem .5rem", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 5, color: "#fff", fontSize: ".75rem" }}>
                {members?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".72rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                    <th style={{ textAlign: "left", padding: ".4rem", color: "rgba(255,255,255,.5)", fontSize: ".62rem", textTransform: "uppercase" }}>Name</th>
                    <th style={{ textAlign: "left", padding: ".4rem", color: "rgba(255,255,255,.5)", fontSize: ".62rem", textTransform: "uppercase" }}>Type</th>
                    <th style={{ textAlign: "right", padding: ".4rem", color: "rgba(255,255,255,.5)", fontSize: ".62rem", textTransform: "uppercase" }}>Value</th>
                    <th style={{ textAlign: "left", padding: ".4rem", color: "rgba(255,255,255,.5)", fontSize: ".62rem", textTransform: "uppercase" }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                      <td style={{ padding: ".45rem .4rem", color: "rgba(255,255,255,.85)" }}>{h.name}</td>
                      <td style={{ padding: ".45rem .4rem" }}>
                        <span style={{ fontSize: ".62rem", padding: "1px 5px", borderRadius: 3, background: "rgba(160,132,202,.1)", color: "#a084ca" }}>{h.type}</span>
                      </td>
                      <td style={{ padding: ".45rem .4rem", textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#c9a84c" }}>
                        ₹{(h.current_value || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ padding: ".45rem .4rem", fontSize: ".62rem", color: "rgba(255,255,255,.4)" }}>{h.fip_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: ".5rem", marginTop: ".8rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={secondaryBtn}>Cancel</button>
            <button onClick={importHoldings} disabled={loading} style={primaryBtn}>
              {loading ? "Importing..." : `Import ${holdings.length} Holdings`}
            </button>
          </div>
        </>
      )}

      {/* STEP: Done */}
      {step === "done" && (
        <div style={{ ...cardS, textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>✅</div>
          <div style={{ fontSize: ".9rem", color: "#4caf9a", marginBottom: ".3rem" }}>
            {importCount > 0 ? `${importCount} holdings imported successfully` : "No new holdings found"}
          </div>
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.4)", marginBottom: "1rem" }}>
            Your portfolio has been updated with data from the Account Aggregator.
          </div>
          <button onClick={onClose} style={primaryBtn}>Done</button>
        </div>
      )}

      {/* STEP: Loading */}
      {step === "check" && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 28, height: 28, border: "2px solid rgba(201,168,76,.2)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.4)", marginTop: ".8rem" }}>Checking Setu AA configuration...</div>
        </div>
      )}
    </div>
  );
}
