import { Router } from "express";
import rateLimit from "express-rate-limit";
import { auth, sendError } from "../lib/auth.js";

const router = Router();

// Rate limit: 20 requests/minute per authenticated user.
// Keyed on user ID (set by auth middleware) so limits are per-account, not per-IP.
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests — please wait a minute before trying again." },
});

// Allowed models — restrict to cost-appropriate tiers only.
const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20241022",
  "claude-sonnet-4-6",
]);

router.post("/chat", auth, aiLimiter, async (req, res) => {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_KEY not set on server" });

  // Enforce model restriction — prevent client from requesting opus or future expensive models.
  const requestedModel = req.body?.model;
  if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
    return res.status(400).json({ error: `Model '${requestedModel}' is not permitted. Use a claude-haiku or claude-sonnet variant.` });
  }

  // Cap max_tokens to prevent runaway usage.
  const body = {
    ...req.body,
    max_tokens: Math.min(req.body?.max_tokens || 1024, 2048),
  };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic error:", response.status, JSON.stringify(data));
      return res.status(response.status).json({ error: data?.error?.message || "Anthropic API error", detail: data });
    }
    res.json(data);
  } catch (e) {
    console.error("AI chat error:", e.message);
    sendError(res, e);
  }
});

export default router;
