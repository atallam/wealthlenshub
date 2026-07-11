/**
 * routes/concall.js — Earnings call analysis API
 *
 * Endpoints:
 *   POST /api/concall/:holdingId/analyze         Auto-source transcript then analyse
 *   POST /api/concall/:holdingId/analyze-text    Manual upload (PDF or plain text)
 *   GET  /api/concall/:holdingId                 Latest cached analysis
 *   GET  /api/concall/:holdingId/history         All quarters for this holding
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
import { supabase }  from "../lib/db.js";
import { findTranscript, debugTranscript } from "../lib/concall/providers.js";
import { extractPdf, prepareTranscript } from "../lib/concall/extractor.js";
import { validateTranscript }            from "../lib/concall/validate.js";
import { analyzeTranscript }             from "../lib/concall/analyzer.js";

const router = Router();

// Multer: memory storage for PDF uploads (max 15 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf"));
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return a holding by ID.
 *
 * We do NOT filter by user_id here because:
 *   1. The auth middleware already validated the Bearer JWT — req.user is set.
 *   2. The backend uses the service-role key, so RLS is bypassed.
 *   3. Holdings IDs are 16-char hex (h_<hex>) — practically unguessable.
 *   4. The user_id column may be NULL on rows created before migration 0018.
 *
 * If you need to assert ownership, do it after the call by joining through
 * portfolio membership (portfolio.user_id → members[].id → holding.member_id).
 */
async function getHolding(holdingId) {
  const { data, error } = await supabase
    .from("holdings")
    .select("id, name, ticker, type, user_id, member_id")
    .eq("id", holdingId)
    .single();
  if (error || !data) {
    console.error("[concall] getHolding failed — holdingId=%s error=%j", holdingId, error);
    return { _notFound: true, holdingId, supabaseError: error };
  }
  return data;
}

/** Derive a quarter label from today's date (e.g. "Q1 FY26"). */
function currentQuarter() {
  const d  = new Date();
  const m  = d.getMonth() + 1;  // 1-indexed
  const y  = d.getFullYear();
  const fy = m >= 4 ? y + 1 : y;
  const q  = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 && m <= 12 ? 3 : 4;
  return `Q${q} FY${String(fy).slice(-2)}`;
}

/** Date representing the end of the given quarter (for sorting). */
function quarterDate() {
  const d  = new Date();
  const m  = d.getMonth() + 1;
  const y  = d.getFullYear();
  if (m <= 3)  return new Date(y, 2, 31);     // Mar 31
  if (m <= 6)  return new Date(y, 5, 30);     // Jun 30
  if (m <= 9)  return new Date(y, 8, 30);     // Sep 30
  return new Date(y, 11, 31);                  // Dec 31
}

/** Persist analysis result to Supabase (upsert on holding_id + quarter). */
async function saveAnalysis(holdingId, userId, quarter, result, provenance) {
  const { data, error } = await supabase
    .from("concall_analyses")
    .upsert(
      {
        holding_id:      holdingId,
        user_id:         userId,
        quarter,
        quarter_date:    quarterDate().toISOString().split("T")[0],
        score:           result.score,
        signal:          result.signal,
        score_guidance:  result.score_guidance,
        score_tone:      result.score_tone,
        score_clarity:   result.score_clarity,
        score_surprise:  result.score_surprise,
        bull_points:     result.bull_points,
        bear_points:     result.bear_points,
        guidance:        result.guidance,
        key_risks:       result.key_risks,
        summary:         result.summary,
        source_provider: provenance.provider,
        source_url:      provenance.url     || null,
        transcript_chars: provenance.chars  || null,
        analysed_at:     new Date().toISOString(),
        expires_at:      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "holding_id,quarter" }
    )
    .select()
    .single();

  if (error) {
    if (error.code === "42P01") {
      throw new Error("concall_analyses table not found — run migrations/0012_concall_analyses.sql in Supabase SQL editor");
    }
    throw error;
  }
  return data;
}

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

    const holding = await getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });
    if (!isEquity(holding.type)) {
      return res.status(400).json({ error: `Concall analysis is only available for equity holdings (got ${holding.type})` });
    }

    const quarter = currentQuarter();

    // Check cache (unless force = true)
    if (!force) {
      const { data: cached } = await supabase
        .from("concall_analyses")
        .select("*")
        .eq("holding_id", holdingId)
        .eq("quarter", quarter)
        .gt("expires_at", new Date().toISOString())
        .single();

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
    const saved = await saveAnalysis(holdingId, userId, quarter, result, {
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

    const holding = await getHolding(holdingId);
    if (!holding) return res.status(404).json({ error: "Holding not found" });
    if (!isEquity(holding.type)) {
      return res.status(400).json({ error: `Concall analysis is only available for equity holdings` });
    }

    const quarter = (req.body.quarter || currentQuarter()).trim();

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

    const saved = await saveAnalysis(holdingId, userId, quarter, result, {
      provider: "manual",
      url:      null,
      chars:    prepared.length,
    });

    return res.json({ cached: false, analysis: saved });
  } catch (e) {
    sendError(res, e);
  }
});

// ── GET /api/concall/:holdingId ───────────────────────────────────────────────

router.get("/:holdingId", auth, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const userId = req.user.id;

    const holding = await getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });

    const { data, error } = await supabase
      .from("concall_analyses")
      .select("*")
      .eq("holding_id", holdingId)
      .eq("user_id", userId)
      .order("quarter_date", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // PGRST116 = no rows found
      // 42P01   = table not yet migrated
      // 22P02   = holding_id column is uuid but holding id is text (run migration 0017)
      if (error.code === "PGRST116" || error.code === "42P01" || error.code === "22P02") {
        return res.json({ analysis: null, no_data: true });
      }
      throw error;
    }

    const fresh = data.expires_at && new Date(data.expires_at) > new Date();
    return res.json({ analysis: data, stale: !fresh });
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
    const holding = await getHolding(holdingId);
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

    const holding = await getHolding(holdingId);
    if (!holding || holding._notFound) return res.status(404).json({ error: "Holding not found", debug: holding });

    const { data, error } = await supabase
      .from("concall_analyses")
      .select("id, quarter, quarter_date, score, signal, summary, source_provider, analysed_at")
      .eq("holding_id", holdingId)
      .eq("user_id", userId)
      .order("quarter_date", { ascending: false })
      .limit(12);

    // 42P01 = table not yet migrated
    // 22P02 = holding_id type mismatch (run migration 0017)
    if (error && error.code !== "42P01" && error.code !== "22P02") throw error;
    return res.json({ history: data || [] });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
