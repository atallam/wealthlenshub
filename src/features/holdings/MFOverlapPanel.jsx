/**
 * MFOverlapPanel.jsx — Mutual Fund portfolio overlap analysis UI
 * Shows pairwise overlap between the user's MF holdings using stock-level data.
 */
import { useState, useEffect, useMemo } from "react";
import { api } from "../../lib/api.js";

function OverlapBadge({ pct }) {
  const color = pct >= 60 ? "#e07c5a" : pct >= 35 ? "#f0a050" : "#4caf9a";
  return (
    <span style={{
      display: "inline-block", fontWeight: 700, fontSize: ".75rem",
      padding: "2px 8px", borderRadius: 20,
      background: color + "22", color, border: `1px solid ${color}44`,
    }}>
      {pct.toFixed(1)}%
    </span>
  );
}

export default function MFOverlapPanel({ mfHoldings = [] }) {
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(null); // pair index

  const schemeCodes = useMemo(
    () => [...new Set(mfHoldings.map(h => h.scheme_code).filter(Boolean))],
    [mfHoldings]
  );

  useEffect(() => { setResult(null); setError(null); }, [schemeCodes.join(",")]);

  async function analyse() {
    if (schemeCodes.length < 2) return;
    setLoading(true); setError(null);
    try {
      const data = await api("/api/mf/overlap", {
        method: "POST",
        body: JSON.stringify({ schemeCodes }),
      });
      setResult(data);
    } catch (e) {
      setError(e.message || "Failed to fetch overlap data.");
    } finally {
      setLoading(false);
    }
  }

  if (schemeCodes.length < 2) {
    return (
      <div style={{ padding: "1.2rem", color: "var(--text-muted)", fontSize: ".8rem", textAlign: "center" }}>
        Add at least 2 mutual fund holdings to analyse overlap.
      </div>
    );
  }

  return (
    <div style={{ padding: "0 .25rem 1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600, marginBottom: ".2rem" }}>
            MF Overlap Analysis
          </div>
          <div style={{ fontSize: ".78rem", color: "var(--text-dim)" }}>
            {schemeCodes.length} funds · pairwise stock-level overlap
          </div>
        </div>
        <button
          className="btn-o"
          onClick={analyse}
          disabled={loading}
          style={{ fontSize: ".78rem", minWidth: 90 }}
        >
          {loading ? "Analysing…" : result ? "Refresh" : "Analyse"}
        </button>
      </div>

      {error && (
        <div style={{ padding: ".6rem .8rem", background: "rgba(220,38,38,.1)", borderRadius: 6, color: "#e07c5a", fontSize: ".78rem", marginBottom: ".75rem" }}>
          {error}
        </div>
      )}

      {/* Fund availability */}
      {result && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginBottom: ".9rem" }}>
          {result.funds.map(f => (
            <div key={f.code} style={{
              display: "flex", alignItems: "center", gap: ".35rem",
              padding: "3px 8px", borderRadius: 20, fontSize: ".7rem",
              background: f.dataAvailable ? "rgba(76,175,154,.1)" : "rgba(200,200,200,.1)",
              border: `1px solid ${f.dataAvailable ? "rgba(76,175,154,.3)" : "var(--border)"}`,
              color: f.dataAvailable ? "#4caf9a" : "var(--text-muted)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
              {!f.dataAvailable && <span style={{ opacity: .6 }}>(no data)</span>}
            </div>
          ))}
        </div>
      )}

      {/* Overlap matrix */}
      {result?.matrix?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", marginBottom: ".9rem" }}>
          {result.matrix.map((pair, i) => {
            const isExp = expanded === i;
            const noData = !pair.count;
            return (
              <div key={i} style={{
                borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--card)", overflow: "hidden",
              }}>
                <div
                  onClick={() => !noData && setExpanded(isExp ? null : i)}
                  style={{
                    display: "flex", alignItems: "center", gap: ".6rem",
                    padding: ".6rem .8rem", cursor: noData ? "default" : "pointer",
                  }}
                >
                  {/* Fund names */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".75rem", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {pair.fundA.name}
                    </div>
                    <div style={{ fontSize: ".65rem", color: "var(--text-muted)", margin: ".1rem 0" }}>vs</div>
                    <div style={{ fontSize: ".75rem", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {pair.fundB.name}
                    </div>
                  </div>
                  {/* Metrics */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {noData ? (
                      <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>No data</span>
                    ) : (
                      <>
                        <OverlapBadge pct={pair.weightedPct} />
                        <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: ".15rem" }}>
                          {pair.count} shared · Jaccard {pair.jaccard}%
                        </div>
                      </>
                    )}
                  </div>
                  {!noData && (
                    <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginLeft: ".2rem" }}>
                      {isExp ? "▲" : "▼"}
                    </span>
                  )}
                </div>

                {/* Expanded: shared stock list */}
                {isExp && pair.topShared?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: ".6rem .8rem" }}>
                    <div style={{ fontSize: ".65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".4rem" }}>
                      Shared holdings
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
                      {pair.topShared.slice(0, 10).map((s, si) => (
                        <div key={si} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                          <span style={{ fontSize: ".72rem", color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.key}
                          </span>
                          <span style={{ fontSize: ".68rem", color: "var(--text-muted)", flexShrink: 0 }}>
                            {s.pA.toFixed(1)}% / {s.pB.toFixed(1)}%
                          </span>
                          {/* Bar */}
                          <div style={{ width: 50, height: 4, borderRadius: 2, background: "var(--border)", flexShrink: 0, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(s.minV * 5, 100)}%`, background: "#a084ca", borderRadius: 2 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Top overlapping stocks */}
      {result?.topSharedStocks?.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: ".75rem" }}>
          <div style={{ fontSize: ".72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600, marginBottom: ".5rem" }}>
            Most Duplicated Stocks
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem" }}>
            {result.topSharedStocks.slice(0, 12).map((s, i) => (
              <div key={i} style={{
                padding: "3px 9px", borderRadius: 20, fontSize: ".7rem",
                background: "rgba(160,132,202,.12)", color: "#a084ca",
                border: "1px solid rgba(160,132,202,.25)",
              }}>
                {s.key}
                <span style={{ opacity: .65, marginLeft: 4 }}>×{s.funds}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && (
        <div style={{ padding: ".8rem", color: "var(--text-muted)", fontSize: ".78rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
          Click Analyse to compute stock-level overlap across your {schemeCodes.length} MF holdings.
          <br />
          <span style={{ fontSize: ".7rem", opacity: .7 }}>Uses AMFI monthly portfolio disclosures · refreshed weekly</span>
        </div>
      )}
    </div>
  );
}
