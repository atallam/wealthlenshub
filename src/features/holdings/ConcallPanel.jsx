/**
 * ConcallPanel.jsx — Per-holding earnings call analysis panel.
 *
 * Displayed inline below a holding row when the user clicks ✦ Concall.
 * Shows:
 *   - Composite score ring (0–10) + thesis signal badge
 *   - Sub-scores (guidance / tone / clarity / surprise)
 *   - Bull & bear points with evidence
 *   - Management guidance summary
 *   - Key risks
 *   - Quarter selector (history)
 *   - Auto-fetch button + manual upload fallback
 *   - 90-day cache indicator
 *
 * Props:
 *   holding  — the holding object ({ id, name, ticker, type })
 *   onClose  — called when the panel should close
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabase.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const EQUITY_TYPES = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF"]);

const SIGNAL_META = {
  CONFIRMS:   { label: "Confirms thesis",    color: "#4caf9a", bg: "rgba(76,175,154,.12)",  icon: "✦" },
  NEUTRAL:    { label: "Neutral",             color: "#c9a84c", bg: "rgba(201,168,76,.12)",  icon: "◆" },
  CHALLENGES: { label: "Challenges thesis",  color: "#e07c5a", bg: "rgba(224,124,90,.12)",  icon: "⚠" },
  BREAKS:     { label: "Breaks thesis",      color: "#e05a5a", bg: "rgba(224,90,90,.14)",   icon: "✖" },
};

// ── Token helper ──────────────────────────────────────────────────────────────

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = await res.json().catch(() => ({ error: "Invalid response" }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ── Score ring component ──────────────────────────────────────────────────────

function ScoreRing({ score, size = 72 }) {
  const r   = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = ((score || 0) / 10) * circ;
  const color = score >= 7 ? "#4caf9a" : score >= 5 ? "#c9a84c" : "#e07c5a";

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round" />
      <text x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: size * 0.3, fontWeight: 700, fontFamily: "'DM Mono',monospace", transform: "rotate(90deg)", transformOrigin: `${size / 2}px ${size / 2}px` }}>
        {(score || 0).toFixed(1)}
      </text>
    </svg>
  );
}

// ── Sub-score bar ─────────────────────────────────────────────────────────────

function ScoreBar({ label, value, weight }) {
  const pct = ((value || 0) / 10) * 100;
  const color = value >= 7 ? "#4caf9a" : value >= 5 ? "#c9a84c" : "#e07c5a";
  return (
    <div style={{ marginBottom: ".55rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: ".72rem", color: "var(--text-secondary)" }}>
          {label} <span style={{ color: "var(--text-muted)", fontSize: ".65rem" }}>({Math.round(weight * 100)}%)</span>
        </span>
        <span style={{ fontSize: ".72rem", fontFamily: "'DM Mono',monospace", color }}>
          {(value || 0).toFixed(1)}
        </span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,.07)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width .5s ease" }} />
      </div>
    </div>
  );
}

// ── Evidence point ────────────────────────────────────────────────────────────

function EvidencePoint({ point, evidence, color }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: ".5rem", borderRadius: 6, border: `1px solid ${color}22`, background: `${color}08`, padding: ".45rem .65rem" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", cursor: evidence ? "pointer" : "default", userSelect: "none" }}
        onClick={() => evidence && setOpen(o => !o)}
      >
        <span style={{ fontSize: ".78rem", color: "var(--text-primary)", fontWeight: 500 }}>
          <span style={{ color, marginRight: 5 }}>{color === "#4caf9a" ? "▲" : "▼"}</span>{point}
        </span>
        {evidence && <span style={{ fontSize: ".68rem", color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>}
      </div>
      {open && evidence && (
        <div style={{ marginTop: ".35rem", fontSize: ".72rem", color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.5, paddingTop: ".35rem", borderTop: `1px solid ${color}18` }}>
          "{evidence}"
        </div>
      )}
    </div>
  );
}

// ── Manual upload form ────────────────────────────────────────────────────────

function ManualUpload({ holdingId, quarter, onResult }) {
  const [mode, setMode]   = useState("text");   // "text" | "pdf"
  const [text, setText]   = useState("");
  const [file, setFile]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  async function submit() {
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      let body;
      let headers = token ? { Authorization: `Bearer ${token}` } : {};

      if (mode === "pdf" && file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("quarter", quarter);
        body = fd;
      } else {
        if (!text.trim()) throw new Error("Paste the transcript text first.");
        body = JSON.stringify({ text: text.trim(), quarter });
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(`/api/concall/${holdingId}/analyze-text`, {
        method: "POST", body, headers,
      });
      const json = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onResult(json.analysis);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem", padding: ".85rem", background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8 }}>
      <div style={{ fontSize: ".8rem", fontWeight: 500, color: "var(--text-secondary)", marginBottom: ".65rem" }}>
        📎 Upload transcript manually
      </div>
      <div style={{ display: "flex", gap: ".5rem", marginBottom: ".65rem" }}>
        {["text", "pdf"].map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{ padding: ".3rem .75rem", borderRadius: 5, cursor: "pointer", fontSize: ".72rem", fontWeight: 500,
              background: mode === m ? "rgba(160,132,202,.2)" : "transparent",
              border: `1px solid ${mode === m ? "rgba(160,132,202,.4)" : "rgba(255,255,255,.1)"}`,
              color: mode === m ? "#a084ca" : "var(--text-muted)" }}>
            {m === "text" ? "Paste text" : "Upload PDF"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste the full earnings call transcript here…"
          style={{ width: "100%", minHeight: 120, background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 6, color: "var(--text-primary)", fontSize: ".73rem", padding: ".5rem .65rem",
            resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
        />
      ) : (
        <div>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }}
            onChange={e => setFile(e.target.files[0] || null)} />
          <button onClick={() => fileRef.current?.click()}
            style={{ padding: ".35rem .85rem", borderRadius: 5, cursor: "pointer", fontSize: ".72rem",
              background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", color: "var(--text-secondary)" }}>
            {file ? `📄 ${file.name}` : "Choose PDF…"}
          </button>
        </div>
      )}

      {error && <div style={{ marginTop: ".5rem", fontSize: ".72rem", color: "#e07c5a" }}>{error}</div>}

      <button onClick={submit} disabled={loading}
        style={{ marginTop: ".65rem", padding: ".38rem 1rem", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer",
          fontSize: ".75rem", fontWeight: 500, background: "rgba(160,132,202,.2)", border: "1px solid rgba(160,132,202,.35)",
          color: "#a084ca", opacity: loading ? 0.6 : 1 }}>
        {loading ? "Analysing…" : "Analyse"}
      </button>
    </div>
  );
}

// ── Main ConcallPanel ─────────────────────────────────────────────────────────

export default function ConcallPanel({ holding, onClose }) {
  const [analysis, setAnalysis]   = useState(null);
  const [history,  setHistory]    = useState([]);
  const [quarter,  setQuarter]    = useState(null);
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState(null);
  const [stale,    setStale]      = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Load latest on mount
  useEffect(() => {
    loadLatest();
    loadHistory();
  }, [holding.id]);

  async function loadLatest() {
    setLoading(true); setError(null);
    try {
      const data = await apiFetch(`/api/concall/${holding.id}`);
      if (data.analysis) {
        setAnalysis(data.analysis);
        setQuarter(data.analysis.quarter);
        setStale(!!data.stale);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const data = await apiFetch(`/api/concall/${holding.id}/history`);
      setHistory(data.history || []);
    } catch { /* non-fatal */ }
  }

  async function runAutoAnalyze(force = false) {
    setLoading(true); setError(null); setShowUpload(false);
    try {
      const data = await apiFetch(`/api/concall/${holding.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      setAnalysis(data.analysis);
      setQuarter(data.analysis.quarter);
      setStale(false);
      await loadHistory();
    } catch (e) {
      setError(e.message);
      setShowUpload(true);   // surface manual fallback on failure
    } finally {
      setLoading(false);
    }
  }

  async function loadQuarter(q) {
    setQuarter(q);
    const found = history.find(h => h.quarter === q);
    if (found) {
      // Load full record
      try {
        const data = await apiFetch(`/api/concall/${holding.id}`);
        setAnalysis(data.analysis);
      } catch { /* keep existing */ }
    }
  }

  function handleManualResult(a) {
    setAnalysis(a);
    setQuarter(a.quarter);
    setShowUpload(false);
    setStale(false);
    loadHistory();
  }

  const sig = analysis ? (SIGNAL_META[analysis.signal] || SIGNAL_META.NEUTRAL) : null;

  // ── Panel shell ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: "var(--bg-card, rgba(255,255,255,.03))",
      border: "1px solid rgba(255,255,255,.08)",
      borderRadius: 10,
      padding: "1rem 1.1rem",
      marginBottom: ".65rem",
      position: "relative",
    }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
        <div>
          <span style={{ fontSize: ".82rem", fontWeight: 600, color: "#a084ca" }}>✦ Concall Analysis</span>
          <span style={{ fontSize: ".7rem", color: "var(--text-muted)", marginLeft: ".5rem" }}>{holding.name}</span>
          {holding.ticker && (
            <span style={{ fontSize: ".65rem", background: "rgba(201,168,76,.1)", color: "#c9a84c", padding: "1px 5px", borderRadius: 3, marginLeft: ".4rem", border: "1px solid rgba(201,168,76,.2)" }}>
              {holding.ticker}
            </span>
          )}
        </div>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>
          ✕
        </button>
      </div>

      {/* ── Quarter selector ── */}
      {history.length > 1 && (
        <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
          {history.map(h => (
            <button key={h.quarter} onClick={() => loadQuarter(h.quarter)}
              style={{
                padding: ".25rem .6rem", borderRadius: 4, cursor: "pointer", fontSize: ".7rem", fontWeight: 500,
                background: quarter === h.quarter ? "rgba(160,132,202,.2)" : "transparent",
                border: `1px solid ${quarter === h.quarter ? "rgba(160,132,202,.4)" : "rgba(255,255,255,.1)"}`,
                color: quarter === h.quarter ? "#a084ca" : "var(--text-muted)",
              }}>
              {h.quarter}
            </button>
          ))}
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: ".8rem" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: ".5rem", opacity: .7 }}>✦</div>
          Fetching and analysing transcript…
        </div>
      )}

      {/* ── Error state ── */}
      {!loading && error && (
        <div style={{ marginBottom: ".75rem" }}>
          <div style={{ padding: ".65rem .85rem", background: "rgba(224,124,90,.08)", border: "1px solid rgba(224,124,90,.2)", borderRadius: 6, fontSize: ".75rem", color: "#e07c5a" }}>
            {error}
          </div>
        </div>
      )}

      {/* ── No data yet ── */}
      {!loading && !analysis && !error && (
        <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "1.8rem", marginBottom: ".5rem", opacity: .5 }}>📞</div>
          <div style={{ fontSize: ".8rem", marginBottom: ".5rem" }}>No analysis for this holding yet.</div>
          <div style={{ fontSize: ".72rem", marginBottom: "1rem" }}>Auto-sourcing tries NSE, BSE, Screener and Motley Fool.</div>
        </div>
      )}

      {/* ── Analysis result ── */}
      {!loading && analysis && (
        <>
          {/* Stale indicator */}
          {stale && (
            <div style={{ fontSize: ".68rem", color: "#c9a84c", background: "rgba(201,168,76,.08)", border: "1px solid rgba(201,168,76,.18)", borderRadius: 4, padding: ".25rem .6rem", marginBottom: ".65rem", display: "inline-block" }}>
              ⚠ Cached result may be outdated — refresh to re-analyse
            </div>
          )}

          {/* Score + signal */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginBottom: "1rem" }}>
            <ScoreRing score={analysis.score} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", padding: ".3rem .75rem", borderRadius: 20,
                background: sig.bg, border: `1px solid ${sig.color}44`, marginBottom: ".5rem" }}>
                <span style={{ color: sig.color, fontWeight: 700, fontSize: ".85rem" }}>{sig.icon}</span>
                <span style={{ color: sig.color, fontWeight: 600, fontSize: ".78rem" }}>{sig.label}</span>
              </div>
              <div style={{ fontSize: ".72rem", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                {analysis.summary}
              </div>
              <div style={{ fontSize: ".62rem", color: "var(--text-muted)", marginTop: ".35rem" }}>
                {analysis.quarter} · via {analysis.source_provider || "manual"}
                {analysis.analysed_at && ` · ${new Date(analysis.analysed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}`}
              </div>
            </div>
          </div>

          {/* Sub-scores */}
          <div style={{ marginBottom: "1rem", padding: ".75rem", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
            <div style={{ fontSize: ".7rem", fontWeight: 600, color: "var(--text-muted)", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".6rem" }}>
              Score breakdown
            </div>
            <ScoreBar label="Guidance"  value={analysis.score_guidance} weight={0.35} />
            <ScoreBar label="Tone"      value={analysis.score_tone}     weight={0.25} />
            <ScoreBar label="Clarity"   value={analysis.score_clarity}  weight={0.25} />
            <ScoreBar label="Surprise"  value={analysis.score_surprise} weight={0.15} />
          </div>

          {/* Bull / Bear */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: ".7rem", fontWeight: 600, color: "#4caf9a", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".5rem" }}>
                Positives
              </div>
              {(analysis.bull_points || []).map((p, i) => (
                <EvidencePoint key={i} {...p} color="#4caf9a" />
              ))}
            </div>
            <div>
              <div style={{ fontSize: ".7rem", fontWeight: 600, color: "#e07c5a", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".5rem" }}>
                Concerns
              </div>
              {(analysis.bear_points || []).map((p, i) => (
                <EvidencePoint key={i} {...p} color="#e07c5a" />
              ))}
            </div>
          </div>

          {/* Guidance */}
          {analysis.guidance && (
            <div style={{ marginBottom: "1rem", padding: ".75rem", background: "rgba(90,156,224,.04)", border: "1px solid rgba(90,156,224,.12)", borderRadius: 8 }}>
              <div style={{ fontSize: ".7rem", fontWeight: 600, color: "#5a9ce0", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".5rem" }}>
                Management guidance
              </div>
              {[
                { label: "Revenue",  val: analysis.guidance.revenue },
                { label: "Margins",  val: analysis.guidance.margins },
                { label: "Capex",    val: analysis.guidance.capex },
              ].filter(r => r.val).map(r => (
                <div key={r.label} style={{ display: "flex", gap: ".5rem", marginBottom: ".3rem" }}>
                  <span style={{ fontSize: ".7rem", color: "var(--text-muted)", minWidth: 55 }}>{r.label}:</span>
                  <span style={{ fontSize: ".72rem", color: "var(--text-secondary)" }}>{r.val}</span>
                </div>
              ))}
              {analysis.guidance.commentary && (
                <div style={{ marginTop: ".4rem", fontSize: ".72rem", color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.5, paddingTop: ".4rem", borderTop: "1px solid rgba(90,156,224,.1)" }}>
                  "{analysis.guidance.commentary}"
                </div>
              )}
            </div>
          )}

          {/* Key risks */}
          {(analysis.key_risks || []).length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: ".7rem", fontWeight: 600, color: "#c9a84c", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: ".5rem" }}>
                Key risks
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyleType: "disc" }}>
                {analysis.key_risks.map((r, i) => (
                  <li key={i} style={{ fontSize: ".73rem", color: "var(--text-secondary)", marginBottom: ".25rem", lineHeight: 1.45 }}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ── Action buttons ── */}
      {!loading && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginTop: analysis ? ".25rem" : 0 }}>
          <button onClick={() => runAutoAnalyze(!analysis)}
            style={{ padding: ".38rem .9rem", borderRadius: 6, cursor: "pointer", fontSize: ".73rem", fontWeight: 500,
              background: "rgba(160,132,202,.15)", border: "1px solid rgba(160,132,202,.3)", color: "#a084ca" }}>
            {analysis ? "↺ Re-analyse" : "✦ Fetch & analyse"}
          </button>
          <button onClick={() => setShowUpload(v => !v)}
            style={{ padding: ".38rem .9rem", borderRadius: 6, cursor: "pointer", fontSize: ".73rem", fontWeight: 500,
              background: showUpload ? "rgba(201,168,76,.15)" : "rgba(255,255,255,.04)",
              border: `1px solid ${showUpload ? "rgba(201,168,76,.3)" : "rgba(255,255,255,.1)"}`,
              color: showUpload ? "#c9a84c" : "var(--text-muted)" }}>
            📎 Upload manually
          </button>
        </div>
      )}

      {/* ── Manual upload form ── */}
      {showUpload && !loading && (
        <ManualUpload
          holdingId={holding.id}
          quarter={quarter || ""}
          onResult={handleManualResult}
        />
      )}
    </div>
  );
}
