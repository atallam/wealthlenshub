// TradebookImportModal.jsx — import a broker tradebook (CSV / XLSX) to give demat
// stocks their real purchase lots. Two steps, nothing is written until the second:
//   1. Preview  → POST /api/tradebook/preview : parsed + matched + reconciled vs CAS units
//   2. Import   → POST /api/tradebook/commit  : idempotent, safe to re-run on overlapping months

import { useRef, useState } from "react";
import { Overlay, MA } from "../../components/shared/Overlay.jsx";

const STATUS = {
  explained:  { label: "Fully explained", color: "#4caf9a", tip: "Tradebook units match the units on your depository statement." },
  gap:        { label: "Partly covered",  color: "#c9a84c", tip: "Some held units aren't in this tradebook — import an older tradebook, or use Set cost for the rest." },
  incomplete: { label: "Older buys missing", color: "#e07c5a", tip: "This file sells shares whose purchase isn't in the ledger — import the earlier tradebook first." },
  over:       { label: "More than held",  color: "#e07c5a", tip: "Tradebook shows more units than your statement — check the date range or a missing sale." },
};

export default function TradebookImportModal({ members = [], api, onClose, onDone }) {
  const inputRef = useRef(null);
  const [file, setFile]       = useState(null);
  const [memberId, setMember] = useState("");
  const [step, setStep]       = useState("upload");   // upload | review | done
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const [data, setData]       = useState(null);

  const form = (f) => {
    const fd = new FormData();
    fd.append("file", f);
    if (memberId) fd.append("member_id", memberId);
    return fd;
  };

  async function runPreview(f = file, mid = memberId) {
    if (!f) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (mid) fd.append("member_id", mid);
      setData(await api("/api/tradebook/preview", { method: "POST", body: fd }));
      setStep("review");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function runCommit() {
    setBusy(true); setError("");
    try {
      const res = await api("/api/tradebook/commit", { method: "POST", body: form(file) });
      setData(res); setStep("done");
      await onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const pickFile = (f) => { if (!f) return; setFile(f); setError(""); };
  const s = data?.summary;
  const importable = (s?.new_orders ?? 0) > 0;

  return (
    <Overlay onClose={onClose} wide label="Import broker tradebook">
      <div className="modtitle">
        {step === "done" ? "✓ Tradebook imported" : "Import broker tradebook"}
      </div>

      {step === "upload" && (
        <>
          <div style={{ fontSize: ".75rem", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: ".9rem" }}>
            Your depository statement shows <b>what you hold</b> but not <b>what you paid</b>. A tradebook has the date and
            price of every trade, so each stock gets exact purchase lots. Works with Zerodha, Groww, Upstox, Angel One, ICICI Direct
            and most other brokers — download the <b>Tradebook</b> (not Holdings) as CSV or Excel.
          </div>

          <div style={{ marginBottom: ".8rem" }}>
            <label className="flbl">Whose account is this?</label>
            <select className="fi fs" value={memberId} onChange={(e) => setMember(e.target.value)}>
              <option value="">All members (ask me if a stock is held by more than one)</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.relation ? ` (${m.relation})` : ""}</option>)}
            </select>
          </div>

          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
            style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "1.4rem", textAlign: "center", cursor: "pointer", background: "var(--bg-muted)" }}>
            <div style={{ fontSize: ".82rem", color: "var(--text)", fontWeight: 600 }}>{file ? file.name : "Drop your tradebook here or click to browse"}</div>
            <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginTop: 4 }}>.csv or .xlsx · up to 10 MB</div>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>

          {error && <div style={{ color: "#e07c5a", fontSize: ".74rem", marginTop: ".6rem" }}>{error}</div>}
          <MA>
            <button className="btnc" onClick={onClose}>Cancel</button>
            <button className="btns" disabled={!file || busy} onClick={() => runPreview()}>{busy ? "Reading…" : "Preview"}</button>
          </MA>
        </>
      )}

      {step !== "upload" && data && (
        <>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: ".6rem" }}>
            {data.broker} · {data.fills} trades · {data.period?.from} → {data.period?.to}
            {data.skipped_rows > 0 && ` · ${data.skipped_rows} non-equity/other rows ignored`}
          </div>

          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
            {[
              [s.new_orders, "new orders to add", "#4caf9a"],
              [s.duplicate_orders, "already imported", "var(--text-muted)"],
              [s.explained, "stocks fully explained", "#4caf9a"],
              [s.gaps + s.incomplete + s.over, "need attention", "#c9a84c"],
              [s.unmatched + s.ambiguous, "not matched", "#e07c5a"],
            ].map(([n, label, color]) => (
              <div key={label} style={{ flex: "1 1 110px", padding: ".45rem .6rem", borderRadius: 6, background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "1.05rem", fontWeight: 700, color }}>{n}</div>
                <div style={{ fontSize: ".64rem", color: "var(--text-muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {step === "done" && (
            <div style={{ fontSize: ".78rem", color: "var(--text)", marginBottom: ".7rem" }}>
              Added <b>{data.inserted}</b> trade{data.inserted === 1 ? "" : "s"}
              {data.retired_estimates > 0 && <> and replaced <b>{data.retired_estimates}</b> estimated cost entr{data.retired_estimates === 1 ? "y" : "ies"} with real trades</>}.
              {data.errors?.length > 0 && <span style={{ color: "#e07c5a" }}> Some rows failed: {data.errors[0]}</span>}
            </div>
          )}

          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            <table style={{ width: "100%", fontSize: ".72rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                  <th style={{ padding: ".4rem .5rem" }}>Stock</th>
                  <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>New</th>
                  <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>Held</th>
                  <th style={{ padding: ".4rem .5rem", textAlign: "right" }}>Tradebook</th>
                  <th style={{ padding: ".4rem .5rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.symbols.map((r) => {
                  const st = r.status === "ready" ? STATUS[r.reconcile] : null;
                  return (
                    <tr key={r.isin || r.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: ".35rem .5rem" }}>
                        <div style={{ color: "var(--text)", fontWeight: 600 }}>{r.holding?.name || r.symbol}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: ".64rem" }}>{r.symbol}</div>
                      </td>
                      <td style={{ padding: ".35rem .5rem", textAlign: "right" }}>{r.status === "ready" ? r.new_orders : "—"}</td>
                      <td style={{ padding: ".35rem .5rem", textAlign: "right" }}>{r.holding ? Number(r.holding.units).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "—"}</td>
                      <td style={{ padding: ".35rem .5rem", textAlign: "right" }}>{r.status === "ready" ? Number(r.ledger_units).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "—"}</td>
                      <td style={{ padding: ".35rem .5rem" }}>
                        {st ? (
                          <span title={st.tip} style={{ color: st.color, fontWeight: 600 }}>
                            {st.label}{r.reconcile === "gap" ? ` (${Number(r.gap_units).toLocaleString("en-IN", { maximumFractionDigits: 4 })} left)` : ""}
                            {r.replaces_estimates && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · replaces estimate</span>}
                          </span>
                        ) : r.status === "ambiguous" ? (
                          <span style={{ color: "#c9a84c" }} title="Held by more than one member — go back and choose whose account this is">Pick a member</span>
                        ) : (
                          <span style={{ color: "#e07c5a" }} title="No stock in your portfolio matches this symbol or ISIN">Not in portfolio</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.warnings?.length > 0 && (
            <div style={{ fontSize: ".66rem", color: "var(--text-muted)", marginTop: ".5rem" }}>
              {data.warnings.slice(0, 3).join(" · ")}{data.warnings.length > 3 ? ` · +${data.warnings.length - 3} more` : ""}
            </div>
          )}
          {step === "review" && (s.unmatched > 0) && (
            <div style={{ fontSize: ".66rem", color: "var(--text-muted)", marginTop: ".5rem" }}>
              "Not in portfolio" usually means a stock you've fully sold (not tracked) or a symbol the file spells differently.
            </div>
          )}
          {step === "done" && (s.gaps + s.incomplete > 0) && (
            <div style={{ fontSize: ".72rem", color: "#c9a84c", marginTop: ".6rem" }}>
              {s.gaps + s.incomplete} stock{s.gaps + s.incomplete === 1 ? "" : "s"} still need attention: import the broker's older tradebook, or use <b>Set cost</b> on the Holdings tab for the remaining units.
            </div>
          )}

          {error && <div style={{ color: "#e07c5a", fontSize: ".74rem", marginTop: ".6rem" }}>{error}</div>}
          <MA>
            {step === "review" ? (
              <>
                <button className="btnc" onClick={() => { setStep("upload"); setData(null); }} disabled={busy}>← Back</button>
                <button className="btns" onClick={runCommit} disabled={busy || !importable}>
                  {busy ? "Importing…" : importable ? `Import ${s.new_orders} order${s.new_orders === 1 ? "" : "s"}` : "Nothing new to import"}
                </button>
              </>
            ) : (
              <button className="btns" onClick={onClose}>Done</button>
            )}
          </MA>
        </>
      )}
    </Overlay>
  );
}
