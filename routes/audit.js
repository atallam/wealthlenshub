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
import { supabase } from "../lib/db.js";

const router = Router();

// GET /api/audit-logs
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const limit    = Math.min(parseInt(req.query.limit  || "50",  10), 200);
    const offset   = Math.max(parseInt(req.query.offset || "0",   10), 0);
    const action   = req.query.action   || null;
    const category = req.query.category || null;
    const from     = req.query.from     || null;
    const to       = req.query.to       || null;
    const status   = req.query.status   || null; // 'ok' | 'error'

    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (action)   query = query.eq("action", action);
    if (category) query = query.eq("entity_type", category);
    if (from)     query = query.gte("created_at", from);
    if (to)       query = query.lte("created_at", to);
    if (status === "ok")    query = query.lt("status_code", 400);
    if (status === "error") query = query.gte("status_code", 400);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      logs:     data || [],
      total:    count || 0,
      has_more: (offset + limit) < (count || 0),
    });
  } catch (e) {
    sendError(res, e);
  }
});

// GET /api/audit-logs/summary
// Returns action counts for the last 30 days — used by the UI filter chips
router.get("/summary", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const since  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("action, entity_type, status_code")
      .eq("user_id", userId)
      .gte("created_at", since);

    if (error) throw error;

    // Aggregate on the server to keep payload small
    const byAction   = {};
    const byCategory = {};
    let errors = 0;

    for (const row of data || []) {
      byAction[row.action]          = (byAction[row.action] || 0) + 1;
      if (row.entity_type) {
        byCategory[row.entity_type] = (byCategory[row.entity_type] || 0) + 1;
      }
      if (row.status_code >= 400) errors++;
    }

    res.json({
      total:       (data || []).length,
      errors,
      by_action:   byAction,
      by_category: byCategory,
      since,
    });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
