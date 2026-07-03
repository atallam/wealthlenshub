// LiabilitiesPanel.jsx — Manage loans / liabilities for true net worth tracking.
// Shows add/edit/delete UI inline; no overlay needed.

import { useState } from 'react';
import { computeOutstanding, isAutoCalc, payoffLabel } from '../../lib/amortization.js';

const LIABILITY_TYPES = [
  { key: "HOME_LOAN",      label: "Home Loan",       icon: "🏠" },
  { key: "CAR_LOAN",       label: "Car Loan",         icon: "🚗" },
  { key: "PERSONAL_LOAN",  label: "Personal Loan",    icon: "💳" },
  { key: "EDUCATION_LOAN", label: "Education Loan",   icon: "🎓" },
  { key: "CREDIT_CARD",    label: "Credit Card",      icon: "💳" },
  { key: "OTHER",          label: "Other",             icon: "📋" },
];

const BLANK = { name: "", type: "HOME_LOAN", outstanding_amount: "", interest_rate: "", emi: "", currency: "INR", start_date: "", tenure_months: "", member_id: "" };

function uid() { return "lb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fmtAmt(n, currency = "INR") {
  if (!n && n !== 0) return "—";
  const v = +n;
  if (currency === "USD") return `$${v >= 1e7 ? (v/1e6).toFixed(2)+"M" : v >= 1e5 ? (v/1e3).toFixed(1)+"K" : v.toLocaleString("en-US")}`;
  if (v >= 1e7) return `₹${(v/1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v/1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

/** Returns today as "YYYY-MM" for the date input default */
function todayYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function LiabilitiesPanel({ liabilities, setLiabilities, fmtCrINR, members = [] }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(BLANK);

  const now = new Date();

  // Use computed (amortized) balance for the total, not raw outstanding_amount
  const totalLiabilities = liabilities.reduce((s, l) => s + computeOutstanding(l, now), 0);

  function startAdd() { setForm(BLANK); setEditId(null); setAdding(true); }
  function startEdit(l) { setForm({ ...l, tenure_months: l.tenure_months ?? "" }); setEditId(l.id); setAdding(true); }
  function cancel() { setAdding(false); setEditId(null); setForm(BLANK); }

  function save() {
    if (!form.name.trim() || !form.outstanding_amount) return;
    const entry = {
      ...form,
      tenure_months: form.tenure_months ? +form.tenure_months : undefined,
    };
    if (editId) {
      setLiabilities(p => p.map(l => l.id === editId ? { ...entry, id: editId } : l));
    } else {
      setLiabilities(p => [...p, { ...entry, id: uid() }]);
    }
    cancel();
  }

  function del(id) {
    setLiabilities(p => p.filter(l => l.id !== id));
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const typeInfo = t => LIABILITY_TYPES.find(x => x.key === t) || LIABILITY_TYPES[LIABILITY_TYPES.length - 1];

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
        <div>
          <div className="ctitle" style={{ marginBottom: ".1rem" }}>🏦 Liabilities</div>
          {liabilities.length > 0 && (
            <div style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
              Total outstanding: <span style={{ fontFamily: "'DM Mono',monospace", color: "#e07c5a" }}>
                {fmtCrINR ? fmtCrINR(totalLiabilities) : fmtAmt(totalLiabilities)}
              </span>
            </div>
          )}
        </div>
        {!adding && (
          <button className="btns" style={{ fontSize: ".7rem", padding: ".3rem .7rem" }} onClick={startAdd}>
            + Add
          </button>
        )}
      </div>

      {/* Liabilities list */}
      {liabilities.length > 0 && !adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginBottom: ".5rem" }}>
          {liabilities.map(l => {
            const ti = typeInfo(l.type);
            const auto = isAutoCalc(l);
            const currentBalance = computeOutstanding(l, now);
            const payoff = auto ? payoffLabel(l, now) : null;
            const owner = members.find(m => m.id === l.member_id);

            return (
              <div key={l.id} style={{
                display: "flex", alignItems: "center", gap: ".7rem",
                padding: ".6rem .8rem", borderRadius: 8,
                background: "var(--bg-muted)", border: "1px solid var(--border)",
              }}>
                <span style={{ fontSize: "1rem", flexShrink: 0 }}>{ti.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: ".8rem", color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}
                    {owner && (
                      <span style={{ marginLeft: 6, fontSize: ".65rem", fontWeight: 400, color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>
                        {owner.name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>
                    {ti.label}
                    {l.interest_rate ? ` · ${l.interest_rate}% p.a.` : ""}
                    {l.emi ? ` · EMI ${fmtAmt(l.emi, l.currency)}` : ""}
                    {payoff && (
                      <span style={{ marginLeft: 4, color: "rgba(76,175,154,.75)" }}>· {payoff}</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: ".82rem", color: "#e07c5a" }}>
                    {fmtAmt(currentBalance, l.currency)}
                  </div>
                  {auto && (
                    <div style={{ fontSize: ".58rem", color: "rgba(160,132,202,.7)", marginTop: 1 }}>
                      auto-calc
                    </div>
                  )}
                </div>
                <button onClick={() => startEdit(l)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: ".8rem", padding: "2px 4px" }}>✎</button>
                <button onClick={() => del(l.id)} style={{ background: "none", border: "none", color: "#e07c5a", cursor: "pointer", fontSize: ".8rem", padding: "2px 4px" }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {liabilities.length === 0 && !adding && (
        <div style={{ fontSize: ".78rem", color: "var(--text-muted)", padding: ".5rem 0" }}>
          No liabilities added — click Add to track loans and credit card balances.
        </div>
      )}

      {/* Add / Edit form */}
      {adding && (
        <div style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", marginTop: ".25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".6rem", marginBottom: ".6rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Name</div>
              <input className="fi" placeholder="e.g. SBI Home Loan" value={form.name} onChange={e => set("name", e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Type</div>
              <select className="fi fs" value={form.type} onChange={e => set("type", e.target.value)} style={{ width: "100%" }}>
                {LIABILITY_TYPES.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Currency</div>
              <select className="fi fs" value={form.currency} onChange={e => set("currency", e.target.value)} style={{ width: "100%" }}>
                <option value="INR">₹ INR</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>
                Principal / Initial Outstanding
                <span style={{ fontWeight: 400, marginLeft: 4, opacity: .7 }}>(at EMI start date)</span>
              </div>
              <input className="fi" type="number" placeholder="e.g. 2500000" value={form.outstanding_amount} onChange={e => set("outstanding_amount", e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Interest Rate (% p.a.)</div>
              <input className="fi" type="number" step="0.1" placeholder="e.g. 8.5" value={form.interest_rate} onChange={e => set("interest_rate", e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Monthly EMI</div>
              <input className="fi" type="number" placeholder="e.g. 25000" value={form.emi} onChange={e => set("emi", e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>
                EMI Start Date
                <span style={{ fontWeight: 400, marginLeft: 4, opacity: .7 }}>(enables auto-calc)</span>
              </div>
              <input className="fi" type="month" value={form.start_date} max={todayYM()} onChange={e => set("start_date", e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>Tenure (months, optional)</div>
              <input className="fi" type="number" placeholder="e.g. 240" value={form.tenure_months} onChange={e => set("tenure_months", e.target.value)} style={{ width: "100%" }} />
            </div>
            {members.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: ".25rem" }}>
                  Borrower <span style={{ fontWeight: 400, opacity: .7 }}>(optional — for per-person tracking)</span>
                </div>
                <select className="fi fs" value={form.member_id || ""} onChange={e => set("member_id", e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Family (unassigned) —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}{m.relation ? ` (${m.relation})` : ""}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Live preview of auto-calc if enough data is entered */}
          {isAutoCalc(form) && (() => {
            const preview = computeOutstanding(form, now);
            const pLabel = payoffLabel(form, now);
            return (
              <div style={{
                background: "rgba(76,175,154,.07)", border: "1px solid rgba(76,175,154,.25)",
                borderRadius: 8, padding: ".5rem .75rem", marginBottom: ".75rem",
                fontSize: ".72rem", color: "var(--text-muted)", lineHeight: 1.7,
              }}>
                <span style={{ color: "#4caf9a", fontWeight: 600 }}>✓ Auto-calc active</span>
                {" — "}current outstanding:{" "}
                <span style={{ fontFamily: "'DM Mono',monospace", color: "#e07c5a" }}>{fmtAmt(preview, form.currency)}</span>
                {pLabel && <span style={{ marginLeft: 6 }}>· payoff: <span style={{ color: "rgba(76,175,154,.85)" }}>{pLabel}</span></span>}
              </div>
            );
          })()}

          <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
            <button className="btn-o" style={{ fontSize: ".78rem" }} onClick={cancel}>Cancel</button>
            <button className="btns" style={{ fontSize: ".78rem" }} onClick={save} disabled={!form.name.trim() || !form.outstanding_amount}>
              {editId ? "Update" : "Add Liability"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
