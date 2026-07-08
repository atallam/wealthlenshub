// FDScanSheet.jsx — camera capture → OCR → editable review sheet for FD/CD
// Props:
//   onConfirm(fdData)  — called with extracted fields to pre-fill Add Holding form
//   onClose()          — close the sheet
//   api                — the parent's api() fetch helper (auto-attaches JWT)

import { useState, useRef } from "react";

export default function FDScanSheet({ onConfirm, onClose, api }) {
  const [phase, setPhase]     = useState("idle");   // idle | uploading | review | error
  const [errMsg, setErrMsg]   = useState("");
  const [fd, setFd]           = useState(null);
  const fileRef               = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setPhase("uploading");
    setErrMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const { fd: extracted } = await api("/api/fd/scan", { method: "POST", body: form });
      setFd(extracted);
      setPhase("review");
    } catch (e) {
      setErrMsg(e.message || "OCR failed — try a clearer image");
      setPhase("error");
    }
  }

  function fieldSet(key, val) {
    setFd(prev => ({ ...prev, [key]: val }));
  }

  function handleConfirm() {
    onConfirm(fd);
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,.4)" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        zIndex:310,
        background:"var(--bg-card)",
        borderRadius:"16px 16px 0 0",
        boxShadow:"0 -4px 32px rgba(0,0,0,.18)",
        maxHeight:"90dvh",
        overflowY:"auto",
        padding:"1rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom))",
        WebkitOverflowScrolling:"touch",
      }}>
        {/* Handle */}
        <div style={{ width:40, height:4, borderRadius:2, background:"var(--border-mid)", margin:"0 auto .75rem" }}/>

        {/* Title */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1rem" }}>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.2rem", color:"var(--text)" }}>
            Scan FD Certificate
          </div>
          <button className="delbtn" aria-label="Close" onClick={onClose} style={{ color:"var(--text-muted)" }}>✕</button>
        </div>

        {/* ── IDLE ── */}
        {phase === "idle" && (
          <div style={{ textAlign:"center", padding:"2rem 0" }}>
            <div style={{ fontSize:"2.5rem", marginBottom:".75rem" }}>📷</div>
            <div style={{ fontSize:".85rem", color:"var(--text-dim)", marginBottom:"1.5rem", lineHeight:1.5 }}>
              Take a photo or upload your FD receipt.<br/>
              Claude Vision will extract all details automatically.
            </div>
            {/* Camera (mobile) */}
            <button
              style={{ display:"block", width:"100%", padding:".75rem", marginBottom:".75rem",
                background:"var(--primary)", color:"#fff", border:"none",
                borderRadius:10, fontSize:".9rem", fontWeight:600, cursor:"pointer" }}
              onClick={() => { fileRef.current.setAttribute("capture","environment"); fileRef.current.click(); }}
            >
              📸 Take Photo
            </button>
            {/* File picker */}
            <button
              style={{ display:"block", width:"100%", padding:".75rem",
                background:"var(--bg-muted)", color:"var(--text)", border:"1px solid var(--border)",
                borderRadius:10, fontSize:".9rem", cursor:"pointer" }}
              onClick={() => { fileRef.current.removeAttribute("capture"); fileRef.current.click(); }}
            >
              📁 Choose File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display:"none" }}
              onChange={e => handleFile(e.target.files[0])}
            />
            <div style={{ fontSize:".7rem", color:"var(--text-muted)", marginTop:"1rem" }}>
              Supports JPG · PNG · PDF · up to 15 MB
            </div>
          </div>
        )}

        {/* ── UPLOADING ── */}
        {phase === "uploading" && (
          <div style={{ textAlign:"center", padding:"3rem 0" }}>
            <div style={{ fontSize:"2rem", marginBottom:"1rem" }}>🔍</div>
            <div style={{ fontSize:".9rem", color:"var(--text-dim)", marginBottom:".5rem" }}>Analysing with Claude Vision…</div>
            <div style={{ fontSize:".75rem", color:"var(--text-muted)" }}>This usually takes 5–10 seconds</div>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div style={{ textAlign:"center", padding:"2rem 0" }}>
            <div style={{ fontSize:"2rem", marginBottom:".75rem" }}>⚠️</div>
            <div style={{ fontSize:".85rem", color:"var(--loss)", marginBottom:"1.5rem" }}>{errMsg}</div>
            <button
              onClick={() => setPhase("idle")}
              style={{ padding:".65rem 1.5rem", background:"var(--primary)", color:"#fff",
                border:"none", borderRadius:8, fontSize:".85rem", cursor:"pointer" }}>
              Try Again
            </button>
          </div>
        )}

        {/* ── REVIEW ── */}
        {phase === "review" && fd && (
          <>
            <div style={{ fontSize:".75rem", color:"var(--primary)", marginBottom:"1rem", fontWeight:600 }}>
              ✅ Extracted — review and confirm
            </div>

            <ReviewField label="Bank / Institution" value={fd.bank_name||""}
              onChange={v => fieldSet("bank_name", v)} />
            <ReviewField label="Account Holder" value={fd.account_holder||""}
              onChange={v => fieldSet("account_holder", v)} />
            <ReviewField label="FD / Receipt No." value={fd.fd_number||""}
              onChange={v => fieldSet("fd_number", v)} />

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".65rem" }}>
              <ReviewField label="Principal (₹)" value={fd.principal ?? ""}
                type="number" onChange={v => fieldSet("principal", v)} />
              <ReviewField label="Rate % p.a." value={fd.interest_rate ?? ""}
                type="number" onChange={v => fieldSet("interest_rate", v)} />
              <ReviewField label="Start Date" value={fd.start_date||""}
                type="date" onChange={v => fieldSet("start_date", v)} />
              <ReviewField label="Maturity Date" value={fd.maturity_date||""}
                type="date" onChange={v => fieldSet("maturity_date", v)} />
              <ReviewField label="Tenure (months)" value={fd.tenure_months ?? ""}
                type="number" onChange={v => fieldSet("tenure_months", v)} />
              <ReviewField label="Maturity Amount (₹)" value={fd.maturity_amount ?? ""}
                type="number" onChange={v => fieldSet("maturity_amount", v)} />
            </div>

            <div style={{ marginTop:"1.25rem", display:"flex", gap:".75rem" }}>
              <button
                onClick={() => setPhase("idle")}
                style={{ flex:1, padding:".7rem",
                  background:"var(--bg-muted)", color:"var(--text)", border:"1px solid var(--border)",
                  borderRadius:10, fontSize:".88rem", cursor:"pointer" }}>
                Re-scan
              </button>
              <button
                onClick={handleConfirm}
                style={{ flex:2, padding:".7rem",
                  background:"var(--primary)", color:"#fff", border:"none",
                  borderRadius:10, fontSize:".88rem", fontWeight:600, cursor:"pointer" }}>
                Use These Details →
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Small inline field component
function ReviewField({ label, value, onChange, type = "text" }) {
  return (
    <div style={{ marginBottom:".6rem" }}>
      <div style={{ fontSize:".65rem", color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:".25rem" }}>
        {label}
      </div>
      <input
        type={type}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        style={{
          display:"block", width:"100%", boxSizing:"border-box",
          padding:".5rem .75rem",
          background:"var(--bg-muted)", color:"var(--text)",
          border:"1px solid var(--border)", borderRadius:7,
          fontSize:".82rem", fontFamily:"inherit",
          outline:"none",
        }}
      />
    </div>
  );
}
