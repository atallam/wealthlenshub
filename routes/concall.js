/**
 * routes/concall.js — Earnings call analysis API
 *
 * Endpoints:
 *   POST /api/concall/:holdingId/analyze         Auto-source transcript then analyse
 *   POST /api/concall/:holdingId/analyze-text    Manual upload (PDF or plain text)
 *   GET  /api/concall/:holdingId                 Latest cached analysis
 *   GET  /api/concall/:holdingId/history          All quarters for this holding
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

export default router;
