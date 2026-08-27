/**
 * routes/notifications.js — In-App Notification Centre API
 *
 * GET  /api/notifications          — list (optionally ?unread_only=true, ?limit=50)
 * POST /api/notifications/read-all — mark all as read
 * POST /api/notifications/:id/read — mark one as read
 * DELETE /api/notifications/clear  — delete all read notifications
 */
import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";

const router = Router();

// ── List notifications ────────────────────────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const unreadOnly = req.query.unread_only === "true";

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.eq("read", false);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const unreadCount = unreadOnly
      ? data.length
      : (data || []).filter(n => !n.read).length;

    res.json({ notifications: data || [], unreadCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark one as read ──────────────────────────────────────────────────────────
router.post("/:id/read", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark all as read ──────────────────────────────────────────────────────────
router.post("/read-all", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", req.user.id)
      .eq("read", false);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Clear all read notifications ──────────────────────────────────────────────
router.delete("/clear", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", req.user.id)
      .eq("read", true);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helper: insert a notification (called from cron routes) ───────────────────
export async function insertNotification(userId, kind, title, body = null, url = null) {
  try {
    await supabase.from("notifications").insert({ user_id: userId, kind, title, body, url });
  } catch (e) {
    console.error("insertNotification failed:", e.message);
  }
}

export default router;
