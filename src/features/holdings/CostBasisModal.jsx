// CostBasisModal.jsx — "Set cost basis" for holdings whose purchase cost is
// unknown (typically CAS demat stocks) or only estimated. Posts one manual
// OPENING lot to /api/transactions/cost-basis; the lot engine (lib/lots.js)
// then feeds Holdings + Tax, and the holding is flagged "approx".

import { useState } from "react";
import { Overlay, FG, MA } from "../../components/shared/Overlay.jsx";

export default function CostBasisModal({ holding, api, onClose, onSaved }) {
  const [avgPrice, setAvgPrice] = useState("");
  const [buyDate, setBuyDate]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  if (!holding) return null;
  const units = holding.net_units ?? holding.units;
  const sym = holding.currency === "USD" || /^US_/.test(holding.type || "") ? "$" : "₹";

  async function save() {
    setError("");
    if (!(Number(avgPrice) > 0)) { setError("Enter your average buy price per unit."); return; }
    setSaving(true);
    try {
      await api("/api/transactions/cost-basis", {
        method: "POST",
        body: JSON.stringify({
          holding_id: holding.id,
          avg_price: Number(avgPrice),
          ...(buyDate ? { buy_date: buyDate } : {}),
        }),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose} narrow label="Set cost basis">
      <div className="modtitle">Set cost basis</div>
      <div style={{ fontSize: ".78rem", color: "var(--text)", fontWeight: 600, marginBottom: ".2rem" }}>{holding.name}</div>
      <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: ".8rem", lineHeight: 1.45 }}>
        Your depository statement doesn't include what you paid. Enter the average buy price
        {units != null ? ` for your ${Number(units).toLocaleString("en-IN", { maximumFractionDigits: 4 })} units` : ""} and
        invested value, P&amp;L and tax lots will use it. It is marked <b>approximate</b> until you add real trades.
      </div>

      <FG label={`Average buy price (${sym} per unit)`}>
        <input type="number" className="fi" min="0" step="any" inputMode="decimal" autoFocus
          value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} placeholder="e.g. 1450.50" />
      </FG>
      <FG label="Buy date (optional)">
        <input type="date" className="fi" value={buyDate} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBuyDate(e.target.value)} />
        <div style={{ fontSize: ".66rem", color: "var(--text-muted)", marginTop: 3 }}>
          Decides short- vs long-term tax treatment. Leave blank if unsure — the holding's start date is used instead.
        </div>
      </FG>

      {error && <div style={{ color: "#e07c5a", fontSize: ".74rem", marginBottom: ".5rem" }}>{error}</div>}
      <MA>
        <button className="btnc" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btns" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save cost basis"}</button>
      </MA>
    </Overlay>
  );
}
