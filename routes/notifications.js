/**
 * routes/notifications.js — In-App Notification Centre API
 *
 * GET  /api/notifications          — list (optionally ?unread_only=true, ?limit=50)
 * POST /api/notifications/read-all — mark all as read
 * POST /api/notifications/:id/read — mark one as read
 * DELETE /api/notifications/clear  — delete all read notifications
 */
import { Router } from "express";
import { auth } from "../lib/auth.js";
import * as notifications from "../services/notifications.service.js";

const router = Router();

// ── List notifications ────────────────────────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const unreadOnly = req.query.unread_only === "true";
    const result = await notifications.list(req.user.id, { limit, unreadOnly });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark one as read ──────────────────────────────────────────────────────────
router.post("/:id/read", auth, async (req, res) => {
  try {
    res.json(await notifications.markRead(req.user.id, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark all as read ──────────────────────────────────────────────────────────
router.post("/read-all", auth, async (req, res) => {
  try {
    res.json(await notifications.markAllRead(req.user.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Clear all read notifications ──────────────────────────────────────────────
router.delete("/clear", auth, async (req, res) => {
  try {
    res.json(await notifications.clearRead(req.user.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helper: insert a notification (called from cron routes) ───────────────────
// Re-exported from the service so `import { insertNotification } from "./notifications.js"`
// in routes/cron.js keeps working unchanged.
export const insertNotification = notifications.insert;

export default router;
