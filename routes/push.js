/**
 * routes/push.js — Web Push subscription management
 *
 * Endpoints:
 *   GET  /api/push/vapid-key          → { publicKey }
 *   POST /api/push/subscribe           → { ok }
 *   DELETE /api/push/unsubscribe       → { ok }
 *   POST /api/push/send-test          → { ok }  (dev only)
 */

import { Router } from "express";
import webpush from "web-push";
import { auth, sendError } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

const router = Router();

// ── VAPID setup ───────────────────────────────────────────────────────────────
// Generate once: node -e "const wp=require('web-push'); console.log(JSON.stringify(wp.generateVAPIDKeys()))"
// Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_CONTACT = process.env.VAPID_CONTACT     || "mailto:admin@wealthlenshub.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn("⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — Web Push disabled.");
}

export function pushEnabled() {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

// ── Send a push to all subscriptions for a user ───────────────────────────────
export async function sendPushToUser(userId, payload) {
  if (!pushEnabled()) return;
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", userId);

  if (!subs?.length) return;

  const body = JSON.stringify(typeof payload === "string" ? { title: payload } : payload);

  await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        body,
        { TTL: 3600 }
      ).catch(async err => {
        // 410 Gone or 404 = subscription expired → delete it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions")
            .delete().eq("endpoint", sub.endpoint);
        }
      })
    )
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** Public VAPID key — needed by the browser to subscribe */
router.get("/vapid-key", (req, res) => {
  if (!pushEnabled()) return res.json({ publicKey: null, enabled: false });
  res.json({ publicKey: VAPID_PUBLIC, enabled: true });
});

/** Save a push subscription */
router.post("/subscribe", auth, async (req, res) => {
  try {
    if (!pushEnabled()) return res.status(503).json({ error: "Push notifications not configured on server." });
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "endpoint, keys.p256dh and keys.auth required" });
    }
    const ua = req.headers["user-agent"] || "";
    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: req.user.id, endpoint, p256dh: keys.p256dh, auth_key: keys.auth, user_agent: ua },
      { onConflict: "user_id,endpoint" }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

/** Remove a push subscription (called when user toggles off or browser unsubscribes) */
router.delete("/unsubscribe", auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await supabase.from("push_subscriptions")
      .delete().eq("user_id", req.user.id).eq("endpoint", endpoint);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

/** Dev-only test push to the calling user */
router.post("/send-test", auth, async (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(403).json({ error: "Not available in production" });
  try {
    await sendPushToUser(req.user.id, {
      title: "WealthLens Alert",
      body: "🔔 Push notifications are working!",
      icon: "/icon-192.png",
      url: "/",
    });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

export default router;
