/**
 * NewsTab.jsx — Portfolio-filtered financial news feed.
 *
 * Sources:
 *  • Yahoo Finance news per holding ticker (Indian .NS / US tickers)
 *  • RBI notification RSS feed (macro)
 *
 * Filter chips: All | 🇮🇳 Indian | 🇺🇸 US | 📋 Macro
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Newspaper, ExternalLink } from 'lucide-react';

// ── Asset types that have Yahoo Finance news ──────────────────────────────────
const MARKET_TYPES = new Set(["US_STOCK","US_ETF","IN_STOCK","IN_ETF","CRYPTO","US_BOND"]);

function extractTickers(holdings) {
  const seen = new Set();
  const tickers = [];
  for (const h of holdings) {
    if (!MARKET_TYPES.has(h.type) || !h.ticker) continue;
    let sym = h.ticker.toUpperCase();
    if (h.type === "IN_STOCK" || h.type === "IN_ETF") {
      sym = sym.replace(/\.(NS|BO)$/, "") + ".NS";
    } else if (h.type === "CRYPTO") {
      if (!sym.includes("-")) sym = `${sym}-USD`;
    }
    if (!seen.has(sym)) { seen.add(sym); tickers.push(sym); }
    if (tickers.length >= 8) break;
  }
  return tickers;
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  if (min < 1)    return "just now";
  if (min < 60)   return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

const FILTERS = [
  { key: "ALL",   label: "All" },
  { key: "IN",    label: "🇮🇳 Indian" },
  { key: "US",    label: "🇺🇸 US" },
  { key: "MACRO", label: "📋 Macro" },
];

const CAT_BADGE = {
  IN:    { label: "India",    bg: "#1a3a2a", color: "#4caf9a", border: "#4caf9a44" },
  US:    { label: "US",       bg: "#1a2a3a", color: "#6ab0e8", border: "#6ab0e844" },
  MACRO: { label: "Macro",    bg: "#2d2a1a", color: "#c9a84c", border: "#c9a84c44" },
};

export default function NewsTab({ holdings = [], api }) {
  const [articles, setArticles] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState("ALL");
  const [fetchedAt, setFetchedAt] = useState(null);
  const [error,    setError]    = useState(null);

  const tickers = extractTickers(holdings);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const qs = tickers.length ? `?tickers=${tickers.join(",")}` : "";
      const data = await api(`/api/news${qs}`);
      setArticles(data.articles || []);
      setFetchedAt(data.fetchedAt ? new Date(data.fetchedAt) : new Date());
    } catch (e) {
      setError(e.message || "Failed to load news");
    }
    setLoading(false);
  }, [tickers.join(","), loading]);  // eslint-disable-line

  useEffect(() => { load(); }, [tickers.join(",")]); // eslint-disable-line

  const visible = filter === "ALL" ? articles : articles.filter(a => a.category === filter);

  // Count per category for chip badges
  const counts = { IN: 0, US: 0, MACRO: 0 };
  for (const a of articles) if (counts[a.category] !== undefined) counts[a.category]++;

  return (
    <div className="card">
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginBottom: ".9rem", flexWrap: "wrap" }}>
        <Newspaper size={16} strokeWidth={1.8} style={{ color: "var(--accent-1)", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: ".95rem", color: "var(--text-primary)" }}>
          Financial News
        </span>
        {fetchedAt && (
          <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginLeft: "auto" }}>
            Updated {timeAgo(fetchedAt.getTime())}
          </span>
        )}
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: ".35rem",
            background: "var(--bg-card-2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: ".28rem .65rem", cursor: loading ? "not-allowed" : "pointer",
            fontSize: ".72rem", color: "var(--text-secondary)",
          }}
          title="Refresh news"
        >
          <RefreshCw size={12} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
          Refresh
        </button>
      </div>

      {/* ── Ticker pills ── */}
      {tickers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem", marginBottom: ".75rem" }}>
          <span style={{ fontSize: ".65rem", color: "var(--text-muted)", alignSelf: "center" }}>Tracking:</span>
          {tickers.map(t => (
            <span key={t} style={{
              fontSize: ".6rem", padding: ".15rem .45rem", borderRadius: 10,
              background: "var(--bg-card-2)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", fontWeight: 600,
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* ── Filter chips ── */}
      <div style={{ display: "flex", gap: ".4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {FILTERS.map(f => {
          const cnt = f.key === "ALL" ? articles.length : counts[f.key];
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: ".3rem .7rem", borderRadius: 20, fontSize: ".72rem", cursor: "pointer",
                fontWeight: active ? 700 : 500,
                background: active ? "var(--accent-1)" : "var(--bg-card-2)",
                color: active ? "#fff" : "var(--text-secondary)",
                border: active ? "none" : "1px solid var(--border)",
                transition: "all .15s",
              }}
            >
              {f.label} {cnt > 0 && <span style={{ opacity: .75 }}>({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ padding: ".6rem .9rem", background: "#3a1a1a", border: "1px solid #e07c5a44",
          borderRadius: 8, fontSize: ".78rem", color: "#e07c5a", marginBottom: ".8rem" }}>
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && articles.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{
              height: 70, borderRadius: 8, background: "var(--bg-card-2)",
              animation: "pulse 1.5s ease-in-out infinite",
            }} />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && visible.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--text-muted)", fontSize: ".82rem" }}>
          {tickers.length === 0
            ? "Add Indian or US stocks/ETFs to your portfolio to see news here."
            : "No news found for the selected filter."}
        </div>
      )}

      {/* ── News list ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
        {visible.map(a => {
          const badge = CAT_BADGE[a.category] || CAT_BADGE.MACRO;
          return (
            <a
              key={a.id}
              href={a.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", gap: ".75rem", alignItems: "flex-start",
                padding: ".75rem .85rem", borderRadius: 10,
                background: "var(--bg-card-2)", border: "1px solid var(--border)",
                textDecoration: "none", transition: "border-color .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent-1)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              {/* Thumbnail */}
              {a.thumbnail && (
                <img
                  src={a.thumbnail}
                  alt=""
                  style={{ width: 64, height: 48, borderRadius: 6, objectFit: "cover",
                    flexShrink: 0, background: "var(--bg-card-3)" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              )}

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".4rem", marginBottom: ".3rem", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: ".58rem", padding: ".1rem .4rem", borderRadius: 8, fontWeight: 700,
                    background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                  }}>
                    {badge.label}
                  </span>
                  <span style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>
                    {a.publisher}
                  </span>
                  <span style={{ fontSize: ".62rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                    {timeAgo(a.publishedAt)}
                  </span>
                </div>
                <div style={{
                  fontSize: ".82rem", fontWeight: 600, color: "var(--text-primary)",
                  lineHeight: 1.4,
                  display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {a.title}
                </div>
                {a.sourceTicker && a.category !== "MACRO" && (
                  <div style={{ fontSize: ".6rem", color: "var(--text-muted)", marginTop: ".25rem" }}>
                    via {a.sourceTicker}
                  </div>
                )}
              </div>

              <ExternalLink size={12} strokeWidth={1.8}
                style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: ".2rem" }} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
