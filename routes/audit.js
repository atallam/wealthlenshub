/**
 * routes/audit.js — Audit log API
 *
 * GET /api/audit-logs
 *   Query params:
 *     limit    — rows per page (default 50, max 200)
 *     offset   — pagination offset (default 0)
 *     action   — filter by exact action label (e.g. HOLDING_DELETE)
 *     category — filter by entity_type (e.g. holding, transaction)
 *     from     — ISO date string, start of range
 *     to       — ISO date string, end of range
 *     status   — 'ok' (2xx/3xx) | 'error' (4xx/5xx)
 *
 * Returns: { logs: [...], total: number, has_more: boolean }
 */

import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import * as auditLogs from "../services/audit.service.js";

const router = Router();

// GET /api/audit-logs
router.get("/", auth, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit  || "50",  10), 200);
    const offset   = Math.max(parseInt(req.query.offset || "0",   10), 0);
    const result = await auditLogs.list(req.user.id, {
      limit, offset,
      action:   req.query.action   || null,
      category: req.query.category || null,
      from:     req.query.from     || null,
      to:       req.query.to       || null,
      status:   req.query.status   || null,
    });
    res.json(result);
  } catch (e) {
    sendError(res, e);
  }
});

// GET /api/audit-logs/summary
// Returns action counts for the last 30 days — used by the UI filter chips
router.get("/summary", auth, async (req, res) => {
  try {
    res.json(await auditLogs.summary(req.user.id));
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
