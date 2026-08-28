/**
 * NewsTab.jsx — Portfolio-filtered financial news feed.
 *
 * Sources:
 *  • Yahoo Finance news per holding ticker (Indian .NS / US tickers)
 *  • ET Markets + Livemint RSS (broad Indian market news)
 *  • RBI + SEBI + ET Economy RSS (macro / policy)
 *
 * Filters:
 *  Row 1 — Category: All | 🇮🇳 Indian | 🇺🇸 US | 📋 Macro
 *  Row 2 — By Stock: All Stocks | one chip per portfolio ticker
 *            (chips only appear for portfolio tickers, not RSS feed sources)
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Newspaper, ExternalLink } from 'lucide-react';

// ── Asset types that have Yahoo Finance news ──────────────────────────────────
const MARKET_TYPES = new Set(["US_STOCK","US_ETF","IN_STOCK","IN_ETF","CRYPTO","US_BOND"]);

// sourceTicker values that come from RSS feeds (not portfolio holdings)
const RSS_SOURCES = new Set(["RBI","SEBI","ET_ECONOMY","ET_MARKETS","LIVEMINT"]);

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
    if (!seen.has(sym)) { seen.add(sym); tickers.push({ sym, name: h.name || sym, type: h.type }); }
    if (tickers.length >= 12) break;
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

const CAT_FILTERS = [
  { key: "ALL",   label: "All" },
  { key: "IN",    label: "🇮🇳 Indian" },
  { key: "US",    label: "🇺🇸 US" },
  { key: "MACRO", label: "📋 Macro" },
];

const CAT_BADGE = {
  IN:    { label: "India",  bg: "#1a3a2a", color: "#4caf9a", border: "#4caf9a44" },
  US:    { label: "US",     bg: "#1a2a3a", color: "#6ab0e8", border: "#6ab0e844" },
  MACRO: { label: "Macro",  bg: "#2d2a1a", color: "#c9a84c", border: "#c9a84c44" },
};

// Chip style helper
function chipStyle(active, accent = "var(--accent-1)") {
  return {
    padding: ".28rem .65rem", borderRadius: 20, fontSize: ".72rem",
    cursor: "pointer", fontWeight: active ? 700 : 500,
    background: active ? accent : "var(--bg-card-2)",
    color: active ? "#fff" : "var(--text-secondary)",
    border: active ? `1px solid ${accent}` : "1px solid var(--border)",
    transition: "all .15s", whiteSpace: "nowrap",
  };
}

export default function NewsTab({ holdings = [], api }) {
  const [articles,    setArticles]    = useState([]);
  const [rssSources,  setRssSources]  = useState(new Set(RSS_SOURCES));
  const [loading,     setLoading]     = useState(false);
  const [catFilter,   setCatFilter]   = useState("ALL");   // category filter
  const [tickerFilter,setTickerFilter]= useState(null);    // null = all stocks
  const [fetchedAt,   setFetchedAt]   = useState(null);
  const [error,       setError]       = useState(null);

  const tickerObjs  = extractTickers(holdings);
  const tickerSyms  = tickerObjs.map(t => t.sym);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const qs   = tickerSyms.length ? `?tickers=${tickerSyms.join(",")}` : "";
      const data = await api(`/api/news${qs}`);
      setArticles(data.articles || []);
      if (data.rssSources) setRssSources(new Set(data.rssSources));
      setFetchedAt(data.fetchedAt ? new Date(data.fetchedAt) : new Date());
    } catch (e) {
      setError(e.message || "Failed to load news");
    }
    setLoading(false);
  }, [tickerSyms.join(","), loading]);   // eslint-disable-line

  useEffect(() => { load(); }, [tickerSyms.join(",")]); // eslint-disable-line

  // ── Filter logic: category AND ticker (both apply) ──────────────────────────
  const visible = articles.filter(a => {
    const catOk    = catFilter === "ALL" || a.category === catFilter;
    const tickerOk = !tickerFilter || a.sourceTicker === tickerFilter;
    return catOk && tickerOk;
  });

  // Category counts (ignoring ticker filter for badge counts)
  const catCounts = { IN: 0, US: 0, MACRO: 0 };
  for (const a of articles) if (catCounts[a.category] !== undefined) catCounts[a.category]++;

  // Which portfolio tickers actually have articles?
  const tickersWithNews = tickerObjs.filter(t =>
    articles.some(a => a.sourceTicker === t.sym)
  );

  // Handle category chip click — clear ticker filter when switching category
  function handleCatFilter(key) {
    setCatFilter(key);
    setTickerFilter(null);
  }

  // Handle ticker chip click — toggle
  function handleTickerFilter(sym) {
    setTickerFilter(prev => prev === sym ? null : sym);
    setCatFilter("ALL");   // category becomes "All" when drilling into a ticker
  }

  return (
    <div className="card">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:".6rem", marginBottom:".9rem", flexWrap:"wrap" }}>
        <Newspaper size={16} strokeWidth={1.8} style={{ color:"var(--accent-1)", flexShrink:0 }} />
        <span style={{ fontWeight:700, fontSize:".95rem", color:"var(--text-primary)" }}>
          Financial News
        </span>
        {fetchedAt && (
          <span style={{ fontSize:".65rem", color:"var(--text-muted)", marginLeft:"auto" }}>
            Updated {timeAgo(fetchedAt.getTime())}
          </span>
        )}
        <button
          onClick={load} disabled={loading}
          style={{
            display:"flex", alignItems:"center", gap:".35rem",
            background:"var(--bg-card-2)", border:"1px solid var(--border)",
            borderRadius:6, padding:".28rem .65rem", cursor:loading ? "not-allowed" : "pointer",
            fontSize:".72rem", color:"var(--text-secondary)",
          }}
          title="Refresh news"
        >
          <RefreshCw size={12} style={loading ? { animation:"spin 1s linear infinite" } : {}} />
          Refresh
        </button>
      </div>

      {/* ── Row 1: Category filter ────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:".35rem", marginBottom:".6rem", flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:".65rem", color:"var(--text-muted)", marginRight:".1rem", flexShrink:0 }}>
          Market:
        </span>
        {CAT_FILTERS.map(f => {
          const cnt = f.key === "ALL" ? articles.length : catCounts[f.key];
          const active = catFilter === f.key && !tickerFilter;
          return (
            <button key={f.key} onClick={() => handleCatFilter(f.key)} style={chipStyle(active)}>
              {f.label}{cnt > 0 && <span style={{ opacity:.7, marginLeft:".25rem" }}>({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* ── Row 2: Per-stock filter (only when portfolio has tickers with news) */}
      {tickersWithNews.length > 0 && (
        <div style={{ display:"flex", gap:".35rem", marginBottom:".8rem", flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:".65rem", color:"var(--text-muted)", marginRight:".1rem", flexShrink:0 }}>
            Stock:
          </span>
          <button
            onClick={() => setTickerFilter(null)}
            style={chipStyle(!tickerFilter, "#6366f1")}
          >
            All Stocks
          </button>
          {tickersWithNews.map(t => {
            const active = tickerFilter === t.sym;
            const isIN   = t.type === "IN_STOCK" || t.type === "IN_ETF";
            // Short display label — strip .NS/.BO suffix for readability
            const label  = t.sym.replace(/\.(NS|BO)$/, "");
            return (
              <button
                key={t.sym}
                onClick={() => handleTickerFilter(t.sym)}
                title={t.name}
                style={chipStyle(active, isIN ? "#4caf9a" : "#6ab0e8")}
              >
                {isIN ? "🇮🇳" : "🇺🇸"} {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Active filter summary ─────────────────────────────────────────── */}
      {(tickerFilter || catFilter !== "ALL") && (
        <div style={{
          display:"flex", alignItems:"center", gap:".4rem",
          padding:".3rem .7rem", marginBottom:".7rem",
          background:"var(--bg-card-2)", borderRadius:8, fontSize:".72rem",
          color:"var(--text-secondary)", border:"1px solid var(--border)",
        }}>
          <span>Showing:</span>
          {tickerFilter
            ? <strong style={{ color:"var(--text-primary)" }}>{tickerFilter.replace(/\.(NS|BO)$/,"")}</strong>
            : <strong style={{ color:"var(--text-primary)" }}>
                {CAT_FILTERS.find(f => f.key === catFilter)?.label}
              </strong>
          }
          <span>· {visible.length} article{visible.length !== 1 ? "s" : ""}</span>
          <button
            onClick={() => { setCatFilter("ALL"); setTickerFilter(null); }}
            style={{
              marginLeft:"auto", background:"none", border:"none",
              color:"var(--text-muted)", cursor:"pointer", fontSize:".72rem", padding:"0 .2rem",
            }}
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding:".6rem .9rem", background:"#3a1a1a", border:"1px solid #e07c5a44",
          borderRadius:8, fontSize:".78rem", color:"#e07c5a", marginBottom:".8rem" }}>
          {error}
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────────────── */}
      {loading && articles.length === 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:".7rem" }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{
              height:70, borderRadius:8, background:"var(--bg-card-2)",
              animation:"pulse 1.5s ease-in-out infinite",
            }} />
          ))}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && visible.length === 0 && !error && (
        <div style={{ textAlign:"center", padding:"2.5rem 1rem", color:"var(--text-muted)", fontSize:".82rem" }}>
          {tickerSyms.length === 0
            ? "Add Indian or US stocks/ETFs to your portfolio to see news here."
            : tickerFilter
              ? `No recent articles found for ${tickerFilter.replace(/\.(NS|BO)$/,"")}.`
              : "No news found for the selected filter."
          }
        </div>
      )}

      {/* ── News list ─────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
        {visible.map(a => {
          const badge    = CAT_BADGE[a.category] || CAT_BADGE.MACRO;
          const isRssSource = rssSources.has(a.sourceTicker);
          // For portfolio-ticker articles show the cleaned ticker label
          const tickerLabel = !isRssSource
            ? a.sourceTicker?.replace(/\.(NS|BO)$/, "")
            : null;
          return (
            <a
              key={a.id}
              href={a.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:"flex", gap:".75rem", alignItems:"flex-start",
                padding:".75rem .85rem", borderRadius:10,
                background:"var(--bg-card-2)", border:"1px solid var(--border)",
                textDecoration:"none", transition:"border-color .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent-1)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              {/* Thumbnail */}
              {a.thumbnail && (
                <img
                  src={a.thumbnail} alt=""
                  style={{ width:64, height:48, borderRadius:6, objectFit:"cover",
                    flexShrink:0, background:"var(--bg-card-3)" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              )}

              {/* Text */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:".4rem", marginBottom:".3rem", flexWrap:"wrap" }}>
                  {/* Category badge */}
                  <span style={{
                    fontSize:".58rem", padding:".1rem .4rem", borderRadius:8, fontWeight:700,
                    background:badge.bg, color:badge.color, border:`1px solid ${badge.border}`,
                  }}>
                    {badge.label}
                  </span>
                  {/* Ticker tag (portfolio tickers only) */}
                  {tickerLabel && (
                    <button
                      onClick={e => { e.preventDefault(); handleTickerFilter(a.sourceTicker); }}
                      title={`Filter by ${tickerLabel}`}
                      style={{
                        fontSize:".58rem", padding:".1rem .4rem", borderRadius:8, fontWeight:700,
                        background: tickerFilter === a.sourceTicker ? "var(--accent-1)" : "var(--bg-card-3)",
                        color: tickerFilter === a.sourceTicker ? "#fff" : "var(--text-muted)",
                        border:"1px solid var(--border)", cursor:"pointer",
                      }}
                    >
                      {tickerLabel}
                    </button>
                  )}
                  <span style={{ fontSize:".65rem", color:"var(--text-muted)" }}>
                    {a.publisher}
                  </span>
                  <span style={{ fontSize:".62rem", color:"var(--text-muted)", marginLeft:"auto" }}>
                    {timeAgo(a.publishedAt)}
                  </span>
                </div>
                <div style={{
                  fontSize:".82rem", fontWeight:600, color:"var(--text-primary)",
                  lineHeight:1.4,
                  display:"-webkit-box", WebkitLineClamp:2,
                  WebkitBoxOrient:"vertical", overflow:"hidden",
                }}>
                  {a.title}
                </div>
              </div>
              <ExternalLink size={12} strokeWidth={1.8}
                style={{ color:"var(--text-muted)", flexShrink:0, marginTop:".2rem" }} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
