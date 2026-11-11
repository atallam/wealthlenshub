import { X as XIcon } from "lucide-react";
import { fdDaysLeft, fdValue } from "../../utils.js";
import { useState } from "react";

export // ── Matured FDs — action needed ───────────────────────────────────────────────
// An FD past its maturity date is idle money until the user decides what to do.
// Three exits: Renew (same row, next term), Convert to cash, Mark closed.

function MaturedFDBanner({ maturedH, renewFD, resolveFD, fmtNative, valNativeCache }) {
  if (!maturedH.length) return null;
  const total = maturedH.reduce((s, h) => s + (valNativeCache?.get(h.id) ?? fdValue(h)), 0);
  const allINR = maturedH.every(h => !h.currency || h.currency === "INR");
  const btn = (bg, fg, border) => ({
    padding: ".25rem .6rem", background: bg, border: `1px solid ${border}`, color: fg,
    borderRadius: 5, fontSize: ".68rem", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap",
  });
  return (
    <div style={{
      background: "linear-gradient(135deg,rgba(224,124,90,.12),rgba(201,168,76,.06))",
      border: "1px solid rgba(224,124,90,.4)",
      borderRadius: 8, padding: ".6rem .85rem", marginBottom: ".65rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap", marginBottom: ".4rem" }}>
        <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>🏦</span>
        <span style={{ fontSize: ".78rem", color: "#e07c5a", fontWeight: 700 }}>
          {maturedH.length} FD{maturedH.length > 1 ? "s have" : " has"} matured — decide what to do with the money
        </span>
        {allINR && <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>· {fmtNative ? fmtNative(total, maturedH[0]) : Math.round(total).toLocaleString("en-IN")} sitting idle</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
        {maturedH.map(h => {
          const val   = valNativeCache?.get(h.id) ?? fdValue(h);
          const ago   = -fdDaysLeft(h);
          const canAct = !h.source || h.source === "manual";
          return (
            <div key={h.id} style={{
              display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap",
              padding: ".4rem .6rem", borderRadius: 6, background: "var(--bg-muted)", border: "1px solid var(--border)",
            }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: ".78rem", color: "var(--text)", fontWeight: 600 }}>{h.name}</div>
                <div style={{ fontSize: ".68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {fmtNative ? fmtNative(val, h) : Math.round(val).toLocaleString("en-IN")}
                  {h.maturity_amount ? " (bank-stated)" : " (estimated)"}
                  {" · matured "}{ago === 0 ? "today" : `${ago}d ago`}
                  {h.interest_rate ? ` · ${h.interest_rate}%` : ""}
                </div>
              </div>
              {canAct ? (
                <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
                  <button title="Same FD, next term — pre-fills the form with the proceeds as new principal"
                    onClick={() => renewFD(h, val)} style={btn("rgba(76,175,154,.15)", "#4caf9a", "rgba(76,175,154,.4)")}>↻ Renew</button>
                  <button title="Proceeds withdrawn to a bank account — becomes a Cash holding"
                    onClick={() => resolveFD(h, "cash", val)} style={btn("rgba(201,168,76,.15)", "#c9a84c", "rgba(201,168,76,.4)")}>→ Convert to cash</button>
                  <button title="No longer tracked — removed from portfolio, kept in history"
                    onClick={() => resolveFD(h, "closed", val)} style={btn("rgba(224,124,90,.12)", "#e07c5a", "rgba(224,124,90,.4)")}>✕ Mark closed</button>
                </div>
              ) : (
                <span style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>imported — re-import to update</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export // ── Per-holding alert panel ───────────────────────────────────────────────────

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

export const CONCALL_TYPES = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF"]);

export // Manual holdings — no live feed, need periodic user updates
const STALE_DEFAULTS = { IN_BOND:45, FD:90, PPF:90, EPF:90, REAL_ESTATE:180, CASH:14, INSURANCE:365, OTHER:60 };

export function daysSinceUpdate(h) {
  const last = h.updated_at ? new Date(h.updated_at) : h.created_at ? new Date(h.created_at) : new Date(0);
  return Math.floor((Date.now() - last) / 864e5);
}

export function computeStale(holdings, ST) {
  const now = Date.now();
  return holdings.filter(h => {
    const thresh = ST[h.type];
    if (!thresh) return false;
    const lastTouched = h.updated_at ? new Date(h.updated_at) : h.created_at ? new Date(h.created_at) : new Date(0);
    return Math.floor((now - lastTouched) / 864e5) >= thresh;
  });
}
