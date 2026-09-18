/**
 * ConcallOutlookCard.jsx — Portfolio-wide concall calendar + insights.
 *
 * Self-contained (fetches its own data via Supabase auth, same pattern as
 * ConcallPanel.jsx) so it drops into CalendarTab without new props.
 *
 * Two tabs:
 *   - Insights — latest signal/score per equity holding, worst first. Built
 *     entirely from data ConcallPanel already computed and saved; no new
 *     LLM calls happen when this card loads.
 *   - Calendar — a per-holding next-concall estimate derived from the last
 *     analysed quarter's typical reporting cadence, plus a confirmed date
 *     when a live BSE board-meeting filing is found and parses cleanly.
 */

import { useState, useEffect } from "react";
import { supabase } from "../../supabase.js";

const SIGNAL_META = {
  CONFIRMS:   { label: "Confirms",   color: "#4caf9a" },
  NEUTRAL:    { label: "Neutral",    color: "#c9a84c" },
  CHALLENGES: { label: "Challenges", color: "#e07c5a" },
  BREAKS:     { label: "Breaks",     color: "#e05a5a" },
};

const TREND_ICON = { IMPROVING: "▲", STABLE: "●", DETERIORATING: "▼", VOLATILE: "↕" };

const STATUS_META = {
  overdue:  { label: "Overdue — re-check for a new quarter", color: "#e07c5a" },
  due_now:  { label: "Due any time",                          color: "#c9a84c" },
  upcoming: { label: "Upcoming",                              color: "#5a9ce0" },
};

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function apiFetch(path) {
  const token = await getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const json = await res.json().catch(() => ({ error: "Invalid response" }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export default function ConcallOutlookCard() {
  const [insights, setInsights] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [tab,      setTab]      = useState("insights"); // "insights" | "calendar"

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [i, c] = await Promise.all([
          apiFetch("/api/concall/insights"),
          apiFetch("/api/concall/calendar"),
        ]);
        if (!cancelled) { setInsights(i); setCalendar(c.calendar || []); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".55rem", gap: ".5rem", flexWrap: "wrap" }}>
        <div className="ctitle" style={{ marginBottom: 0 }}>✦ Concall Outlook</div>
        <div style={{ display: "flex", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, gap: 1 }}>
          {[["insights", "Insights"], ["calendar", "Calendar"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              fontSize: ".65rem", padding: ".2rem .5rem", borderRadius: 4, border: "none", cursor: "pointer",
              background: tab === k ? "var(--bg-card)" : "transparent",
              color:      tab === k ? "var(--text)"    : "var(--text-muted)",
              fontWeight: tab === k ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {loading && <div className="empty" style={{ padding: ".75rem 0" }}>Loading concall outlook…</div>}
      {!loading && error && <div style={{ fontSize: ".72rem", color: "#e07c5a" }}>{error}</div>}

      {/* ── Insights tab ── */}
      {!loading && !error && tab === "insights" && insights && (
        <>
          {insights.needs_attention > 0 && (
            <div style={{ fontSize: ".68rem", color: "#e07c5a", background: "rgba(224,124,90,.08)", border: "1px solid rgba(224,124,90,.2)", borderRadius: 4, padding: ".25rem .6rem", marginBottom: ".65rem", display: "inline-block" }}>
              ⚠ {insights.needs_attention} holding{insights.needs_attention > 1 ? "s" : ""} challenging or breaking thesis
            </div>
          )}

          {insights.insights.length === 0
            ? <div className="empty" style={{ padding: ".75rem 0" }}>No analysed concalls yet</div>
            : insights.insights.map(row => {
                const sig = SIGNAL_META[row.signal] || SIGNAL_META.NEUTRAL;
                return (
                  <div key={row.holding_id} style={{ display: "flex", gap: ".6rem", padding: ".55rem 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: sig.color, marginTop: ".3rem", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: ".75rem", color: "var(--text)", display: "flex", alignItems: "center", gap: ".4rem", flexWrap: "wrap" }}>
                        <span>{row.name}</span>
                        {row.ticker && <span style={{ fontSize: ".62rem", color: "var(--text-muted)" }}>{row.ticker}</span>}
                        {row.trend_direction && (
                          <span style={{ fontSize: ".68rem", color: "var(--text-muted)" }} title={`Trend: ${row.trend_direction}`}>
                            {TREND_ICON[row.trend_direction]}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>{row.quarter} · {sig.label}</div>
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: ".78rem", color: sig.color, flexShrink: 0 }}>
                      {(row.score ?? 0).toFixed(1)}
                    </div>
                  </div>
                );
              })
          }

          {insights.unanalysed.length > 0 && (
            <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: ".65rem" }}>
              {insights.unanalysed.length} equity holding{insights.unanalysed.length > 1 ? "s" : ""} not yet analysed — open a holding's Concall panel to fetch.
            </div>
          )}
        </>
      )}

      {/* ── Calendar tab ── */}
      {!loading && !error && tab === "calendar" && calendar && (
        calendar.length === 0
          ? <div className="empty" style={{ padding: ".75rem 0" }}>No estimates yet — analyse at least one quarter per holding first</div>
          : calendar.map(row => {
              const confirmed = row.confirmed;
              const est = row.estimate;
              const statusMeta = est ? (STATUS_META[est.status] || STATUS_META.upcoming) : null;
              return (
                <div key={row.holding_id} style={{ display: "flex", gap: ".6rem", padding: ".55rem 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
                  <div style={{ fontSize: "1rem", flexShrink: 0 }}>📞</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".75rem", color: "var(--text)" }}>
                      {row.name} {row.ticker && <span style={{ fontSize: ".62rem", color: "var(--text-muted)" }}>{row.ticker}</span>}
                    </div>
                    {confirmed ? (
                      <div style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>
                        Filed: {confirmed.subject?.slice(0, 60)}{confirmed.subject?.length > 60 ? "…" : ""}
                        {confirmed.source_url && (
                          <a href={confirmed.source_url} target="_blank" rel="noreferrer" style={{ marginLeft: ".4rem", color: "#5a9ce0" }}>source</a>
                        )}
                      </div>
                    ) : est ? (
                      <div style={{ fontSize: ".65rem", color: statusMeta.color }}>{statusMeta.label}</div>
                    ) : (
                      <div style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>No estimate — analyse a quarter first</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: ".72rem", color: confirmed ? "#4caf9a" : "var(--text-muted)" }}>
                      {confirmed ? fmtDate(confirmed.date) : est ? `${fmtDate(est.window_start)}–${fmtDate(est.window_end)}` : "—"}
                    </div>
                    {est && !confirmed && <div style={{ fontSize: ".6rem", color: "var(--text-muted)" }}>estimated</div>}
                  </div>
                </div>
              );
            })
      )}
    </div>
  );
}
