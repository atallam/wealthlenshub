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

// ── Shared model/token validation ────────────────────────────────
function validateAiRequest(req, res) {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_KEY not set on server" }); return null; }
  const requestedModel = req.body?.model;
  if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
    res.status(400).json({ error: `Model '${requestedModel}' is not permitted. Use a claude-haiku or claude-sonnet variant.` });
    return null;
  }
  return {
    key,
    body: { ...req.body, max_tokens: Math.min(req.body?.max_tokens || 1024, 2048) },
  };
}

// ── Non-streaming endpoint (kept for compatibility) ───────────────
router.post("/chat", auth, aiLimiter, async (req, res) => {
  const validated = validateAiRequest(req, res);
  if (!validated) return;
  const { key, body } = validated;
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

// ── Streaming SSE endpoint ────────────────────────────────────────
// Returns text/event-stream. The Anthropic streaming protocol is forwarded
// directly — client parses content_block_delta events for text chunks.
router.post("/chat/stream", auth, aiLimiter, async (req, res) => {
  const validated = validateAiRequest(req, res);
  if (!validated) return;
  const { key, body } = validated;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "messages-2023-06-01",
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ type: "error", error: errData?.error?.message || "Anthropic API error" })}\n\n`);
      return res.end();
    }

    // Pipe Anthropic SSE stream directly to client
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (e) {
    console.error("AI stream error:", e.message);
    res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
    res.end();
  }
});

export default router;
