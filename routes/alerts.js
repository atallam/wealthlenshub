/**
 * routes/alerts.js — Alert notification endpoints.
 *
 * POST /api/alerts/notify
 *   Body: { trigAlerts: [...], portfolioSummary?: string }
 *   Sends a formatted digest email to the authenticated user's email address.
 *   Requires RESEND_API_KEY in .env.
 */
import { Router }           from "express";
import { auth, sendError }  from "../lib/auth.js";
import { sendAlertDigest }  from "../services/alert-mailer.js";

const router = Router();

router.post("/notify", auth, async (req, res) => {
  try {
    const { trigAlerts, portfolioSummary } = req.body;

    if (!Array.isArray(trigAlerts) || trigAlerts.length === 0) {
      return res.status(400).json({ error: "No triggered alerts provided" });
    }
    if (trigAlerts.length > 50) {
      return res.status(400).json({ error: "Too many alerts in payload" });
    }

    const email = req.user.email;
    if (!email) {
      return res.status(400).json({ error: "No email address on this account" });
    }

    const result = await sendAlertDigest(email, trigAlerts, portfolioSummary || "");
    res.json({ ok: true, email_id: result.id, sent_to: email });
  } catch (e) {
    sendError(res, e, e.status || 500);
  }
});

export default router;
