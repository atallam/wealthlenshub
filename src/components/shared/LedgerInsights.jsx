// LedgerInsights.jsx — XIRR + FIFO tax lots for one holding (Phase 3).
// Reads /api/analytics/holdings/:id, which derives everything from the
// transactions ledger (CAS-imported or manual). Purely presentational.

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const inr = (v, d = 0) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: d })}`;
const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
const BASIS_LABEL = { equity_stcg: "STCG", equity_ltcg: "LTCG", slab: "Slab", debt_ltcg: "LTCG (debt)" };

export default function LedgerInsights({ holdingId, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showLots, setShowLots] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/analytics/holdings/${holdingId}`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        const d = await res.json();
        if (!cancelled) { setData(d); setErr(""); }
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [holdingId, refreshKey]);

  if (err) return <div style={{ fontSize: ".68rem", color: "#e07c5a", marginBottom: ".8rem" }}>⚠ Analytics unavailable: {err}</div>;
  if (!data) return null;
  if (!data.ledger_rows) {
    return (
      <div style={{ fontSize: ".68rem", color: "var(--text-dim)", marginBottom: ".8rem" }}>
        No transaction ledger yet — XIRR and tax lots appear once transactions exist (import a <em>detailed</em> CAMS/KFintech CAS, or add them below).
      </div>
    );
  }

  const s = data.stats || {};
  const lots = data.lots || {};
  const approx = data.basis === "ledger_approx";
  const soon = lots.turning_ltcg_soon || [];
  const gainColor = (v) => (v > 0 ? "#4caf9a" : v < 0 ? "#e07c5a" : "var(--text)");

  return (
    <div style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, padding: ".8rem 1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".55rem" }}>
        <div style={{ fontSize: ".66rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 600 }}>
          Performance · from {data.ledger_rows} ledger row{data.ledger_rows !== 1 ? "s" : ""}
          {data.ledger_sources?.includes("cas") && <span style={{ marginLeft: 6, fontSize: ".6rem", padding: ".05rem .35rem", borderRadius: 3, background: "rgba(76,175,154,.15)", color: "#4caf9a", letterSpacing: 0, textTransform: "none" }}>CAS ledger</span>}
          {approx && <span title="Statement started with units already held; their cost is approximated. Import a since-inception CAS for exact lots." style={{ marginLeft: 6, fontSize: ".6rem", padding: ".05rem .35rem", borderRadius: 3, background: "rgba(201,168,76,.15)", color: "#c9a84c", letterSpacing: 0, textTransform: "none", cursor: "help" }}>≈ opening cost approx.</span>}
        </div>
        <span style={{ fontSize: ".62rem", padding: ".1rem .4rem", borderRadius: 3, background: "rgba(160,132,202,.12)", color: "#a084ca" }}>{data.asset_class}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: ".6rem", marginBottom: ".6rem" }}>
        <Stat label="XIRR" value={s.xirr_pct == null ? "—" : pct(s.xirr_pct)} color={gainColor(s.xirr_pct)} sub={s.since ? `since ${s.since}` : ""} big />
        <Stat label="Invested" value={inr(s.invested)} />
        <Stat label="Value + realised" value={inr((s.current_value || 0) + (s.withdrawn || 0) + (s.dividends || 0))} sub={s.dividends ? `incl. ${inr(s.dividends)} dividends` : ""} />
        <Stat label="Absolute gain" value={inr(s.absolute_gain)} color={gainColor(s.absolute_gain)} sub={pct(s.absolute_return_pct)} />
      </div>

      {lots.total_units > 0 && (
        <div style={{ fontSize: ".68rem", color: "var(--text)", display: "flex", flexWrap: "wrap", gap: ".4rem 1rem", alignItems: "center" }}>
          <span><b style={{ color: "#4caf9a" }}>{lots.ltcg_pct}%</b> of units are long-term</span>
          <span>unrealised: <b style={{ color: gainColor(lots.unrealized_ltcg) }}>{inr(lots.unrealized_ltcg)}</b> LTCG · <b style={{ color: gainColor(lots.unrealized_stcg) }}>{inr(lots.unrealized_stcg)}</b> short-term</span>
          {soon.length > 0 && <span style={{ color: "#c9a84c" }}>⏳ {soon.reduce((a, l) => a + l.units, 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} units turn long-term by {soon[soon.length - 1].ltcg_from}</span>}
          <button className="btnc" style={{ fontSize: ".62rem", padding: ".15rem .5rem", marginLeft: "auto" }} onClick={() => setShowLots((v) => !v)}>{showLots ? "Hide lots" : `Show ${lots.open.length} open lot${lots.open.length !== 1 ? "s" : ""}`}</button>
        </div>
      )}

      {showLots && lots.open.length > 0 && (
        <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto", marginTop: ".6rem", borderRadius: 8, border: "1px solid var(--border)" }}>
          <table className="ht" style={{ fontSize: ".68rem" }}>
            <thead><tr><th>Bought</th><th className="r">Units</th><th className="r">Cost</th><th className="r">Gain</th><th>Status</th><th>Long-term from</th></tr></thead>
            <tbody>
              {lots.open.map((l, i) => (
                <tr key={i}>
                  <td className="mono dim">{l.buy_date}{l.approx_cost ? " ≈" : ""}</td>
                  <td className="r mono">{Number(l.units).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                  <td className="r mono dim">{inr(l.buy_price, 2)}</td>
                  <td className="r mono" style={{ color: gainColor(l.gain) }}>{inr(l.gain)}</td>
                  <td><span style={{ fontSize: ".6rem", padding: ".05rem .35rem", borderRadius: 3, background: l.is_ltcg ? "rgba(76,175,154,.15)" : "rgba(224,124,90,.12)", color: l.is_ltcg ? "#4caf9a" : "#e07c5a" }}>{BASIS_LABEL[l.rate_basis] || l.rate_basis}</span></td>
                  <td className="mono dim">{l.ltcg_from || (l.is_ltcg ? "✓" : "n/a")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color, big }) {
  return (
    <div>
      <div style={{ fontSize: ".6rem", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? "1.05rem" : ".85rem", fontWeight: 600, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: ".6rem", color: "var(--text-dim)" }}>{sub}</div>}
    </div>
  );
}
