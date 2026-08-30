import { useState, useEffect } from "react";

// FI types shown per mode
const WEALTH_FI_TYPES = [
  { key: "DEPOSIT",      label: "Bank Accounts",  icon: "🏦", desc: "Savings & current accounts" },
  { key: "TERM_DEPOSIT", label: "Fixed Deposits",  icon: "📜", desc: "FDs across banks" },
  { key: "MUTUAL_FUNDS", label: "Mutual Funds",    icon: "📊", desc: "All MF folios" },
  { key: "EQUITIES",     label: "Stocks",          icon: "📈", desc: "Demat equity holdings" },
  { key: "ETF",          label: "ETFs",            icon: "🔷", desc: "Exchange traded funds" },
  { key: "EPF",          label: "EPF",             icon: "🏛️", desc: "Employee Provident Fund" },
  { key: "PPF",          label: "PPF",             icon: "📗", desc: "Public Provident Fund" },
];
const BUDGET_FI_TYPES = [
  { key: "DEPOSIT",     label: "Bank Accounts",  icon: "🏦", desc: "Savings & current — individual txns" },
  { key: "CREDIT_CARD", label: "Credit Cards",   icon: "💳", desc: "Credit card statements" },
];

// ── SetuAAImport ───────────────────────────────────────────────────────────────
// mode="wealth"  → consent + fetch holdings → import to portfolio (default)
// mode="budget"  → consent + fetch transactions → import to Family Budget tab
export default function SetuAAImport({ onClose, onImported, members, api, mode = "wealth" }) {
  const isBudget = mode === "budget";
  const [step, setStep] = useState("check");
  const [status, setStatus] = useState(null);
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [consentId, setConsentId] = useState(null);
  const [consentUrl, setConsentUrl] = useState(null);

  // Wealth mode
  const [holdings, setHoldings] = useState([]);
  const [assignMember, setAssignMember] = useState(members?.[0]?.id || "");

  // Budget mode
  const [transactions, setTransactions] = useState([]);
  const [budgetMember, setBudgetMember] = useState(members?.[0]?.id || "");
  const [txnFilter, setTxnFilter] = useState("ALL"); // ALL | DEBIT | CREDIT

  const [importCount, setImportCount] = useState(0);
  const [dupeCount, setDupeCount] = useState(0);
  const [pastConsents, setPastConsents] = useState([]);
  const [connections, setConnections] = useState([]);

  // On mount: check config + load past data
  useEffect(() => {
    (async () => {
      try {
        const s = await api("/api/setu/status");
        setStatus(s);
        if (!s.configured) { setStep("error"); return; }
        const [c, cn] = await Promise.all([
          api("/api/setu/consents"),
          api("/api/setu/connections").catch(() => ({ connections: [] })),
        ]);
        setPastConsents((c.consents || []).filter(x => x.purpose === mode || !x.purpose));
        setConnections(cn.connections || []);
        setStep("mobile");
      } catch (e) { setError(e.message); setStep("error"); }
    })();
  }, []);

  async function createConsent() {
    if (!mobile.match(/^\d{10}$/)) { setError("Enter a valid 10-digit mobile number"); return; }
    setLoading(true); setError("");
    try {
      const endpoint = isBudget ? "/api/setu/consent-budget" : "/api/setu/consent";
      const resp = await api(endpoint, { method: "POST", body: JSON.stringify({ mobile }) });
      setConsentId(resp.consent_id);
      setConsentUrl(resp.url);
      setStep("consent");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  function openConsent() {
    if (consentUrl) window.open(consentUrl, "_blank");
    setStep("waiting");
  }

  async function checkAndFetch() {
    setLoading(true); setError("");
    try {
      const cs = await api(`/api/setu/consent/${consentId}`);
      if (cs.status === "ACTIVE" || cs.status === "APPROVED") {
        const endpoint = isBudget
          ? `/api/setu/fetch-transactions/${consentId}`
          : `/api/setu/fetch/${consentId}`;
        const fd = await api(endpoint, { method: "POST" });
        if (isBudget) {
          setTransactions(fd.transactions || []);
          setStep(fd.transactions?.length > 0 ? "preview" : "done");
        } else {
          setHoldings(fd.holdings || []);
          setStep(fd.holdings?.length > 0 ? "preview" : "done");
        }
      } else if (cs.status === "REJECTED") {
        setError("Consent was rejected. Please try again.");
        setStep("mobile");
      } else {
        setError(`Consent is still ${cs.status}. Complete the approval in the Setu window, then click "Check again".`);
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function importWealth() {
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

  async function importBudget() {
    setLoading(true); setError("");
    try {
      const resp = await api("/api/setu/import-budget", {
        method: "POST",
        body: JSON.stringify({ transactions, consent_id: consentId, member_id: budgetMember }),
      });
      setImportCount(resp.imported);
      setDupeCount(resp.duplicates || 0);
      setStep("done");
      if (onImported) onImported();
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function resumeConsent(c) {
    setConsentId(c.consent_id);
    if (c.status === "ACTIVE" || c.status === "APPROVED") {
      setLoading(true);
      try {
        const endpoint = isBudget
          ? `/api/setu/fetch-transactions/${c.consent_id}`
          : `/api/setu/fetch/${c.consent_id}`;
        const fd = await api(endpoint, { method: "POST" });
        if (isBudget) { setTransactions(fd.transactions || []); setStep(fd.transactions?.length > 0 ? "preview" : "done"); }
        else { setHoldings(fd.holdings || []); setStep(fd.holdings?.length > 0 ? "preview" : "done"); }
      } catch (e) { setError(e.message); }
      setLoading(false);
    } else {
      setConsentUrl(c.redirect_url);
      setStep("consent");
    }
  }

  async function removeConnection(id) {
    try {
      await api(`/api/setu/connections/${id}`, { method: "DELETE" });
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch (e) { setError(e.message); }
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = { fontFamily: "'DM Sans',sans-serif" };
  const card = { background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", marginBottom: ".8rem" };
  const btn  = { padding: ".5rem 1.2rem", borderRadius: 6, border: "none", cursor: "pointer", fontSize: ".78rem", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 };
  const primary   = { ...btn, background: "#4caf9a", color: "var(--text)" };
  const secondary = { ...btn, background: "var(--bg-muted)", color: "var(--text-dim)", border: "1px solid var(--border)" };
  const danger    = { ...btn, background: "rgba(224,124,90,.1)", color: "#e07c5a", border: "1px solid rgba(224,124,90,.3)", padding: ".25rem .5rem", fontSize: ".65rem" };

  const fiTypes = isBudget ? BUDGET_FI_TYPES : WEALTH_FI_TYPES;
  const title   = isBudget ? "🔗 Bank Transaction Import" : "🔗 Account Aggregator Import";
  const subtitle = isBudget
    ? "Fetch bank & credit card transactions for Family Budget"
    : "Fetch holdings (MF, FD, stocks, EPF, PPF) for your portfolio";

  // Filtered transactions for preview
  const filteredTxns = txnFilter === "ALL" ? transactions : transactions.filter(t => t.txn_type === txnFilter);

  return (
    <div style={{ ...S, maxWidth: 580, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.2rem" }}>
        <div>
          <div style={{ fontSize: "1.1rem", fontFamily: "'Cormorant Garamond',serif", color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginTop: 2 }}>
            {subtitle} {status?.sandbox && <span style={{ color: "#c9a84c" }}>· Sandbox</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
      </div>

      {error && (
        <div style={{ padding: ".6rem .8rem", background: "rgba(224,124,90,.1)", border: "1px solid rgba(224,124,90,.3)", borderRadius: 6, color: "#e07c5a", fontSize: ".75rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* ── LOADING ── */}
      {step === "check" && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 28, height: 28, border: "2px solid rgba(201,168,76,.2)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: ".8rem" }}>Checking Setu AA configuration...</div>
        </div>
      )}

      {/* ── NOT CONFIGURED ── */}
      {step === "error" && !error && (
        <div style={card}>
          <div style={{ fontSize: ".85rem", color: "#e07c5a", marginBottom: ".5rem" }}>⚠ Setu AA Not Configured</div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Set these environment variables on Render:<br />
            <code style={{ color: "#c9a84c" }}>SETU_CLIENT_ID</code>, <code style={{ color: "#c9a84c" }}>SETU_CLIENT_SECRET</code>, <code style={{ color: "#c9a84c" }}>SETU_PRODUCT_INSTANCE_ID</code>, <code style={{ color: "#c9a84c" }}>SETU_ENABLED=true</code><br /><br />
            Get credentials from <a href="https://bridge.setu.co" target="_blank" rel="noopener" style={{ color: "#5a9ce0" }}>bridge.setu.co</a>
          </div>
        </div>
      )}

      {/* ── MOBILE INPUT ── */}
      {step === "mobile" && (
        <>
          {/* Saved connections */}
          {connections.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: ".68rem", color: "#4caf9a", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".6rem" }}>
                Active Connections
              </div>
              {connections.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".45rem 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <span style={{ fontSize: ".78rem", color: "var(--text)" }}>
                      {c.mobile_masked ? `+91 ••••••${c.mobile_masked}` : "Linked account"}
                    </span>
                    {c.institution_names?.length > 0 && (
                      <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginLeft: 6 }}>{c.institution_names.join(", ")}</span>
                    )}
                    <div style={{ fontSize: ".62rem", color: "var(--text-muted)", marginTop: 1 }}>
                      Last synced: {c.last_synced_at ? new Date(c.last_synced_at).toLocaleDateString() : "Never"}
                      {c.txn_count > 0 && ` · ${c.txn_count} txns`}
                      {c.holdings_count > 0 && ` · ${c.holdings_count} holdings`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: ".4rem" }}>
                    <button onClick={() => resumeConsent({ consent_id: c.consent_id, status: "ACTIVE" })} style={{ ...secondary, padding: ".25rem .5rem", fontSize: ".65rem" }}>
                      🔄 Re-sync
                    </button>
                    <button onClick={() => removeConnection(c.id)} style={danger}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={card}>
            <div style={{ fontSize: ".78rem", color: "var(--text)", marginBottom: ".8rem" }}>
              Enter the mobile number linked to your {isBudget ? "bank/credit card accounts" : "bank accounts"}
            </div>
            <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
              <span style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>+91</span>
              <input
                type="tel" maxLength={10} placeholder="9876543210"
                value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ""))}
                style={{ flex: 1, padding: ".5rem .7rem", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: ".85rem", fontFamily: "'DM Mono',monospace" }}
              />
              <button onClick={createConsent} disabled={loading || mobile.length !== 10} style={{ ...primary, opacity: mobile.length === 10 ? 1 : 0.45 }}>
                {loading ? "Creating..." : "Connect"}
              </button>
            </div>
            <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: ".6rem", lineHeight: 1.5 }}>
              Setu will send an OTP to verify your number. Your data is fetched only with your explicit consent (RBI AA framework).
            </div>
          </div>

          {/* FI types we'll request */}
          <div style={card}>
            <div style={{ fontSize: ".68rem", color: "#c9a84c", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".6rem" }}>What we'll request</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: ".5rem" }}>
              {fiTypes.map(f => (
                <div key={f.key} style={{ padding: ".4rem .6rem", background: "rgba(76,175,154,.04)", border: "1px solid rgba(76,175,154,.12)", borderRadius: 6 }}>
                  <div style={{ fontSize: ".9rem" }}>{f.icon} <span style={{ fontSize: ".72rem", color: "var(--text)" }}>{f.label}</span></div>
                  <div style={{ fontSize: ".6rem", color: "var(--text-muted)" }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Past consents */}
          {pastConsents.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: ".68rem", color: "#a084ca", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: ".6rem" }}>Previous Imports</div>
              {pastConsents.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".4rem 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <span style={{ fontSize: ".72rem", color: "var(--text-dim)" }}>{new Date(c.created_at).toLocaleDateString()}</span>
                    <span style={{ fontSize: ".65rem", marginLeft: 8, padding: "1px 5px", borderRadius: 3,
                      background: c.status === "ACTIVE" ? "rgba(76,175,154,.12)" : "rgba(201,168,76,.12)",
                      color: c.status === "ACTIVE" ? "#4caf9a" : "#c9a84c" }}>{c.status}</span>
                    {(c.holdings_count > 0 || c.txn_count > 0) && (
                      <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginLeft: 6 }}>
                        {isBudget ? `${c.txn_count || 0} txns` : `${c.holdings_count || 0} holdings`}
                      </span>
                    )}
                  </div>
                  {(c.status === "ACTIVE" || c.status === "PENDING") && (
                    <button onClick={() => resumeConsent(c)} style={{ ...secondary, padding: ".25rem .5rem", fontSize: ".65rem" }}>
                      {c.status === "ACTIVE" ? "Re-fetch" : "Resume"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── CONSENT REDIRECT ── */}
      {step === "consent" && (
        <div style={card}>
          <div style={{ fontSize: ".85rem", color: "#4caf9a", marginBottom: ".6rem" }}>✓ Consent request created</div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
            Click below to open Setu's consent screen. Verify your mobile via OTP, select your {isBudget ? "bank/credit card accounts" : "banks and accounts"}, and approve the data request.
          </div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button onClick={openConsent} style={primary}>Open Consent Screen →</button>
            <button onClick={() => setStep("waiting")} style={secondary}>I already approved</button>
          </div>
        </div>
      )}

      {/* ── WAITING ── */}
      {step === "waiting" && (
        <div style={card}>
          <div style={{ fontSize: ".85rem", color: "#c9a84c", marginBottom: ".6rem" }}>⏳ Waiting for consent approval</div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
            Complete the consent flow in the Setu window, then click below to fetch your data.
            {status?.sandbox && <div style={{ color: "#c9a84c", marginTop: ".4rem" }}>Sandbox: Use Setu FIP-2 with OTP <strong>123456</strong></div>}
          </div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button onClick={checkAndFetch} disabled={loading} style={primary}>
              {loading ? "Fetching data..." : "Check & Fetch Data"}
            </button>
            <button onClick={() => { if (consentUrl) window.open(consentUrl, "_blank"); }} style={secondary}>Re-open consent</button>
          </div>
        </div>
      )}

      {/* ── PREVIEW: WEALTH HOLDINGS ── */}
      {step === "preview" && !isBudget && (
        <>
          <div style={card}>
            <div style={{ fontSize: ".85rem", color: "#4caf9a", marginBottom: ".5rem" }}>✓ {holdings.length} holdings found</div>
            {members?.length > 0 && (
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: ".8rem" }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Assign to:</span>
                <select value={assignMember} onChange={e => setAssignMember(e.target.value)}
                  style={{ padding: ".35rem .5rem", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: ".75rem" }}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".72rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Name","Type","Value","Source"].map(h => (
                      <th key={h} style={{ textAlign: h === "Value" ? "right" : "left", padding: ".4rem", color: "var(--text-muted)", fontSize: ".65rem", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: ".45rem .4rem", color: "var(--text)" }}>{h.name}</td>
                      <td style={{ padding: ".45rem .4rem" }}>
                        <span style={{ fontSize: ".65rem", padding: "1px 5px", borderRadius: 3, background: "rgba(160,132,202,.1)", color: "#a084ca" }}>{h.type}</span>
                      </td>
                      <td style={{ padding: ".45rem .4rem", textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#c9a84c" }}>
                        ₹{(h.current_value || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ padding: ".45rem .4rem", fontSize: ".65rem", color: "var(--text-muted)" }}>{h.fip_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={secondary}>Cancel</button>
            <button onClick={importWealth} disabled={loading} style={primary}>
              {loading ? "Importing..." : `Import ${holdings.length} Holdings`}
            </button>
          </div>
        </>
      )}

      {/* ── PREVIEW: BUDGET TRANSACTIONS ── */}
      {step === "preview" && isBudget && (
        <>
          <div style={card}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".8rem" }}>
              <div style={{ fontSize: ".85rem", color: "#4caf9a" }}>
                ✓ {transactions.length} transactions found
                <span style={{ fontSize: ".68rem", color: "var(--text-muted)", marginLeft: 8 }}>
                  {transactions.filter(t => t.txn_type === "DEBIT").length} debits · {transactions.filter(t => t.txn_type === "CREDIT").length} credits
                </span>
              </div>
              {/* Filter buttons */}
              <div style={{ display: "flex", gap: ".3rem" }}>
                {["ALL","DEBIT","CREDIT"].map(f => (
                  <button key={f} onClick={() => setTxnFilter(f)} style={{ ...btn, padding: ".2rem .5rem", fontSize: ".62rem",
                    background: txnFilter === f ? (f === "CREDIT" ? "rgba(76,175,154,.2)" : f === "DEBIT" ? "rgba(224,124,90,.2)" : "rgba(160,132,202,.2)") : "transparent",
                    color: txnFilter === f ? "var(--text)" : "var(--text-muted)", border: "1px solid var(--border)" }}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Member assignment */}
            {members?.length > 0 && (
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: ".8rem" }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>Assign to member:</span>
                <select value={budgetMember} onChange={e => setBudgetMember(e.target.value)}
                  style={{ padding: ".35rem .5rem", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: ".75rem" }}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".72rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Date","Description","Category","Amount","Type"].map(h => (
                      <th key={h} style={{ textAlign: h === "Amount" ? "right" : "left", padding: ".4rem", color: "var(--text-muted)", fontSize: ".62rem", textTransform: "uppercase", position: "sticky", top: 0, background: "var(--bg-muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.slice(0, 200).map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: ".4rem", color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: ".68rem" }}>{t.txn_date}</td>
                      <td style={{ padding: ".4rem", color: "var(--text)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.description}</td>
                      <td style={{ padding: ".4rem" }}>
                        <span style={{ fontSize: ".62rem", padding: "1px 5px", borderRadius: 3, background: "rgba(160,132,202,.1)", color: "#a084ca" }}>{t.category}</span>
                      </td>
                      <td style={{ padding: ".4rem", textAlign: "right", fontFamily: "'DM Mono',monospace", color: t.txn_type === "CREDIT" ? "#4caf9a" : "#e07c5a", whiteSpace: "nowrap" }}>
                        {t.txn_type === "CREDIT" ? "+" : "-"}₹{t.amount.toLocaleString("en-IN")}
                      </td>
                      <td style={{ padding: ".4rem" }}>
                        <span style={{ fontSize: ".6rem", padding: "1px 4px", borderRadius: 3,
                          background: t.txn_type === "CREDIT" ? "rgba(76,175,154,.12)" : "rgba(224,124,90,.12)",
                          color: t.txn_type === "CREDIT" ? "#4caf9a" : "#e07c5a" }}>{t.txn_type}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTxns.length > 200 && (
                <div style={{ fontSize: ".65rem", color: "var(--text-muted)", padding: ".5rem", textAlign: "center" }}>
                  Showing 200 of {filteredTxns.length} — all will be imported
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={secondary}>Cancel</button>
            <button onClick={importBudget} disabled={loading} style={primary}>
              {loading ? "Importing..." : `Import ${transactions.length} Transactions → Family Budget`}
            </button>
          </div>
        </>
      )}

      {/* ── DONE ── */}
      {step === "done" && (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>✅</div>
          {isBudget ? (
            <>
              <div style={{ fontSize: ".9rem", color: "#4caf9a", marginBottom: ".3rem" }}>
                {importCount > 0 ? `${importCount} transactions imported` : "No new transactions found"}
              </div>
              {dupeCount > 0 && <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: ".3rem" }}>{dupeCount} duplicates skipped</div>}
              <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Transactions are now visible in the <strong>Family Budget → Transactions</strong> tab.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: ".9rem", color: "#4caf9a", marginBottom: ".3rem" }}>
                {importCount > 0 ? `${importCount} holdings imported` : "No new holdings found"}
              </div>
              <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Your portfolio has been updated with data from the Account Aggregator.
              </div>
            </>
          )}
          <button onClick={onClose} style={primary}>Done</button>
        </div>
      )}
    </div>
  );
}
