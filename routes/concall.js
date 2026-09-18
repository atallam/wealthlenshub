/**
 * routes/concall.js — Earnings call analysis API
 *
 * Endpoints:
 *   POST /api/concall/:holdingId/analyze         Auto-source transcript then analyse
 *   POST /api/concall/:holdingId/analyze-text    Manual upload (PDF or plain text)
 *   GET  /api/concall/calendar                   Portfolio-wide upcoming concall estimates
 *   GET  /api/concall/insights                   Portfolio-wide latest signal/score, worst first
 *   GET  /api/concall/:holdingId                 Latest cached analysis
 *   GET  /api/concall/:holdingId/history          All quarters for this holding
 *   GET  /api/concall/:holdingId/trend            Quarter-over-quarter trend narrative
 *
 * NOTE: /calendar and /insights are registered before the generic
 * GET /:holdingId route below — Express matches routes in registration
 * order, and /:holdingId would otherwise swallow them (holdingId="calendar").
 *
 * Caching: results are stored in concall_analyses with a 90-day expiry.
 * The auto-analyze endpoint respects the cache and skips re-analysis if still fresh.
 * Use { force: true } in the request body to override the cache.
 *
 * Auth: all routes require a valid Supabase Bearer token via lib/auth.js.
 * Rate limiting: inherits the global apiLimiter from server.js.
 */

import { Router }    from "express";
import multer        from "multer";
import { auth, sendError } from "../lib/auth.js";
import { findTranscript, debugTranscript } from "../lib/concall/providers.js";
import { extractPdf, prepareTranscript } from "../lib/concall/extractor.js";
import { validateTranscript }            from "../lib/concall/validate.js";
import { analyzeTranscript }             from "../lib/concall/analyzer.js";
import { analyzeTrend }                  from "../lib/concall/trend.js";
import { estimateNextConcall, findBoardMeetingFiling } from "../lib/concall/calendar.js";
import { pLimit }                        from "../lib/utils.js";
import * as concall from "../services/concall.service.js";

const router = Router();

// Multer: memory storage for PDF uploads (max 15 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf"));
  },
});

// In-process cache for trend narratives, keyed by holdingId + the latest
// quarter seen in that holding's history. Once a new quarter's analysis is
// saved the key changes and the old entry is simply never hit again — no
// explicit invalidation needed. Lost on server restart, which is fine: the
// next request just recomputes it once (same trade-off as the Gmail
// pendingJobs Map in routes/gmail.js).
const trendCache = new Map(); // `${holdingId}:${latestQuarter}` -> { trend, cachedAt }
const TREND_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// In-process cache for the portfolio calendar — one entry per user, since
// computing it scans every equity holding and does a handful of live BSE
// lookups. Same trade-off as trendCache: lost on restart, recomputed once.
const calendarCache = new Map(); // userId -> { data, cachedAt }
const CALENDAR_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Only the N holdings whose deterministic estimate is soonest get a live BSE
// lookup — there's no point probing BSE for holdings that aren't due for
// months, and this bounds the endpoint's worst-case latency regardless of
// portfolio size.
const LIVE_LOOKUP_CANDIDATES = 8;
const LIVE_LOOKUP_DEADLINE_MS = 20_000; // hard cap on the whole batch, same spirit as the 25s deadline in routes/import.js

const CALENDAR_STATUS_RANK = { overdue: 0, due_now: 1, upcoming: 2 };
const SIGNAL_URGENCY       = { BREAKS: 0, CHALLENGES: 1, NEUTRAL: 2, CONFIRMS: 3 };

// ── Asset type guard ──────────────────────────────────────────────────────────

const EQUITY_TYPES = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF"]);

function isEquity(type) {
  return EQUITY_TYPES.has(type);
}

// ── POST /api/concall/:holdingId/analyze ─────────────────────────────────────

router.post("/:holdingId/analyze", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const { force = false } = req.body;
    const userId = req.user.id;

    const holding = await concall.getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });
    if (!isEquity(holding.type)) {
      return res.status(400).json({ error: `Concall analysis is only available for equity holdings (got ${holding.type})` });
    }

    const quarter = concall.currentQuarter();

    // Check cache (unless force = true)
    if (!force) {
      const cached = await concall.getCachedAnalysis(holdingId, quarter);
      if (cached) {
        return res.json({ cached: true, analysis: cached });
      }
    }

    if (!holding.ticker) {
      return res.status(422).json({
        error: "No ticker symbol for this holding — cannot auto-source transcript.",
        hint:  "Add a ticker to this holding, or use the manual upload endpoint.",
      });
    }

    // Provider chain
    const found = await findTranscript(holding.ticker, holding.type);
    if (!found) {
      return res.status(404).json({
        error:  "Could not auto-source an earnings call transcript for this holding.",
        hint:   "Use the manual upload endpoint (/analyze-text) to paste or upload a transcript.",
        ticker: holding.ticker,
      });
    }

    // Validate
    const prepared = prepareTranscript(found.text);
    const vr = validateTranscript(prepared);
    if (!vr.ok) {
      return res.status(422).json({
        error:    `Transcript quality check failed: ${vr.reason}`,
        provider: found.provider,
        hint:     "Try uploading a transcript manually.",
      });
    }

    // Analyse
    const result = await analyzeTranscript(prepared, {
      name:    holding.name,
      ticker:  holding.ticker,
      type:    holding.type,
      quarter,
    });

    // Persist
    const saved = await concall.saveAnalysis(holdingId, userId, quarter, result, {
      provider: found.provider,
      url:      found.url,
      chars:    prepared.length,
    });

    return res.json({ cached: false, analysis: saved });
  } catch (e) {
    sendError(res, e);
  }
});

// ── POST /api/concall/:holdingId/analyze-text ─────────────────────────────────

router.post("/:holdingId/analyze-text", auth, upload.single("file"), async (req, res) => {
  try {
    const { holdingId } = req.params;
    const userId = req.user.id;

    const holding = await concall.getHolding(holdingId);
    if (!holding) return res.status(404).json({ error: "Holding not found" });
    if (!isEquity(holding.type)) {
      return res.status(400).json({ error: `Concall analysis is only available for equity holdings` });
    }

    const quarter = (req.body.quarter || concall.currentQuarter()).trim();

    // Get raw text — either from uploaded PDF or from body.text
    let rawText = "";
    if (req.file) {
      rawText = await extractPdf(req.file.buffer);
    } else if (req.body.text) {
      rawText = String(req.body.text);
    } else {
      return res.status(400).json({ error: "Provide either a PDF file upload or a 'text' field" });
    }

    const prepared = prepareTranscript(rawText);

    const vr = validateTranscript(prepared);
    if (!vr.ok) {
      return res.status(422).json({ error: `Transcript quality check failed: ${vr.reason}` });
    }

    const result = await analyzeTranscript(prepared, {
      name:    holding.name,
      ticker:  holding.ticker,
      type:    holding.type,
      quarter,
    });

    const saved = await concall.saveAnalysis(holdingId, userId, quarter, result, {
      provider: "manual",
      url:      null,
      chars:    prepared.length,
    });

    return res.json({ cached: false, analysis: saved });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/calendar ─────────────────────────────────────────────────

/**
 * Portfolio-wide upcoming-concall estimates for every equity holding the
 * user owns. Combines a deterministic estimate (always available once a
 * holding has one analysed quarter) with a best-effort confirmed date from
 * a live BSE board-meeting filing for the holdings due soonest.
 *
 * Cached per-user for 12h — this scans every equity holding and makes a
 * handful of outbound BSE calls, so it isn't something to recompute on
 * every panel open.
 */
router.get("/calendar", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const cached = calendarCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < CALENDAR_CACHE_TTL_MS) {
      return res.json({ calendar: cached.data, cached: true });
    }

    const holdings = await concall.getEquityHoldings(userId);
    const latestByHolding = await concall.getLatestPerHolding(userId);

    const rows = holdings
      .filter(h => h.ticker)
      .map(h => {
        const latest = latestByHolding.get(h.id);
        return {
          holding_id: h.id,
          name: h.name,
          ticker: h.ticker,
          estimate: latest ? estimateNextConcall(latest.quarter_date) : null,
          confirmed: null,
        };
      });

    // Rank by urgency (overdue/due-now first, then soonest upcoming, then
    // "no estimate yet" last) and only spend BSE calls on the front of that list.
    const rank = r => r.estimate ? CALENDAR_STATUS_RANK[r.estimate.status] ?? 2 : 3;
    const candidates = rows
      .slice()
      .sort((a, b) => {
        const rd = rank(a) - rank(b);
        if (rd !== 0) return rd;
        const ad = a.estimate?.window_start, bd = b.estimate?.window_start;
        if (!ad || !bd) return 0;
        return new Date(ad) - new Date(bd);
      })
      .slice(0, LIVE_LOOKUP_CANDIDATES);

    const tasks = candidates.map(r => async () => {
      const live = await findBoardMeetingFiling(r.ticker).catch(() => null);
      return { holding_id: r.holding_id, live };
    });

    const withDeadline = (p, ms) => Promise.race([
      p,
      new Promise(resolve => setTimeout(() => resolve([]), ms)),
    ]);
    const results = await withDeadline(pLimit(tasks, 4), LIVE_LOOKUP_DEADLINE_MS);

    const liveByHolding = new Map(
      (results || []).filter(r => r && !r._err).map(r => [r.holding_id, r.live])
    );
    for (const r of rows) {
      const live = liveByHolding.get(r.holding_id);
      r.confirmed = live?.meeting_date
        ? { date: live.meeting_date, source_url: live.filed_url, subject: live.subject }
        : null;
    }

    // Final sort for display: confirmed dates first (soonest), then
    // estimates by urgency/soonest, then "no estimate" last.
    rows.sort((a, b) => {
      const aDate = a.confirmed?.date, bDate = b.confirmed?.date;
      if (aDate && bDate) return new Date(aDate) - new Date(bDate);
      if (aDate) return -1;
      if (bDate) return 1;
      const rd = rank(a) - rank(b);
      if (rd !== 0) return rd;
      const ad = a.estimate?.window_start, bd = b.estimate?.window_start;
      if (!ad || !bd) return 0;
      return new Date(ad) - new Date(bd);
    });

    calendarCache.set(userId, { data: rows, cachedAt: Date.now() });
    return res.json({ calendar: rows, cached: false });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/insights ─────────────────────────────────────────────────

/**
 * Portfolio-wide latest concall signal/score per equity holding, sorted
 * worst-first (BREAKS > CHALLENGES > NEUTRAL > CONFIRMS, then lowest score).
 * Pure aggregation of data ConcallPanel already saved — no LLM calls here.
 * Trend direction is included only when the per-holding trend endpoint has
 * already been computed and is still in trendCache; it's a bonus field,
 * never recomputed on this endpoint's behalf.
 */
router.get("/insights", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const holdings = await concall.getEquityHoldings(userId);
    const latestByHolding = await concall.getLatestPerHolding(userId);

    const analysed = [];
    const unanalysed = [];

    for (const h of holdings) {
      const latest = latestByHolding.get(h.id);
      if (!latest) {
        unanalysed.push({ holding_id: h.id, name: h.name, ticker: h.ticker || null });
        continue;
      }

      const trendEntry = trendCache.get(`${h.id}:${latest.quarter}`);

      analysed.push({
        holding_id:      h.id,
        name:            h.name,
        ticker:          h.ticker || null,
        quarter:         latest.quarter,
        quarter_date:    latest.quarter_date,
        score:           latest.score,
        signal:          latest.signal,
        summary:         latest.summary,
        trend_direction: trendEntry?.trend?.trend_direction || null,
        next_expected:   estimateNextConcall(latest.quarter_date),
      });
    }

    analysed.sort((a, b) => {
      const rankA = SIGNAL_URGENCY[a.signal] ?? 4;
      const rankB = SIGNAL_URGENCY[b.signal] ?? 4;
      if (rankA !== rankB) return rankA - rankB;
      return (a.score ?? 10) - (b.score ?? 10); // worst score first within the same signal
    });

    return res.json({
      insights: analysed,
      unanalysed,
      needs_attention: analysed.filter(a => a.signal === "BREAKS" || a.signal === "CHALLENGES").length,
    });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/:holdingId ───────────────────────────────────────────────

router.get("/:holdingId", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const userId = req.user.id;

    const holding = await concall.getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });

    const { analysis, noData } = await concall.getLatest(holdingId, userId);
    if (noData) return res.json({ analysis: null, no_data: true });

    const fresh = analysis.expires_at && new Date(analysis.expires_at) > new Date();
    return res.json({ analysis, stale: !fresh });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/:holdingId/debug ────────────────────────────────────────

/**
 * Runs each provider individually for this holding and returns per-provider
 * success/failure detail. Use this to diagnose why auto-analysis is 404ing.
 *
 * Response shape:
 *   {
 *     holding: { id, name, ticker, type },
 *     providers: [
 *       { name: "BSEFilingProvider", status: "success"|"null"|"error",
 *         chars: 1234, url: "...", error: null },
 *       ...
 *     ]
 *   }
 */
router.get("/:holdingId/debug", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const holding = await concall.getHolding(holdingId);
    if (!holding || holding._notFound) {
      return res.status(404).json({ error: "Holding not found", debug: holding });
    }

    const results = await debugTranscript(holding.ticker, holding.type);
    return res.json({
      holding: { id: holding.id, name: holding.name, ticker: holding.ticker, type: holding.type },
      providers: results,
    });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/:holdingId/history ──────────────────────────────────────

router.get("/:holdingId/history", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const userId = req.user.id;

    const holding = await concall.getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });

    const history = await concall.getHistory(holdingId, userId);
    return res.json({ history });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/:holdingId/trend ────────────────────────────────────────

/**
 * Quarter-over-quarter trend narrative — reasons over the structured history
 * already sitting in concall_analyses (no re-fetching of transcripts, so
 * this is cheap even for holdings with a year+ of quarters analysed).
 *
 * Needs at least 2 analysed quarters; returns { trend: null, reason } and a
 * 200 (not an error — this is an expected state for a newly-tracked holding)
 * when there isn't enough history yet.
 */
router.get("/:holdingId/trend", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const userId = req.user.id;

    const holding = await concall.getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });

    const history = await concall.getTrendHistory(holdingId, userId);
    if (history.length < 2) {
      return res.json({ trend: null, reason: "insufficient_history", quarters_available: history.length });
    }

    const latestQuarter = history[history.length - 1].quarter;
    const cacheKey = `${holdingId}:${latestQuarter}`;
    const cached = trendCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < TREND_CACHE_TTL_MS) {
      return res.json({ trend: cached.trend, cached: true });
    }

    const trend = await analyzeTrend(history, { name: holding.name, ticker: holding.ticker });
    trendCache.set(cacheKey, { trend, cachedAt: Date.now() });

    return res.json({ trend, cached: false });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
