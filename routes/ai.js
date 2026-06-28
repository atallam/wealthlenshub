import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";

const router = Router();

router.post("/chat", auth, async (req, res) => {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_KEY not set on server" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) { console.error("Anthropic error:", response.status, JSON.stringify(data)); return res.status(response.status).json({ error: data?.error?.message || "Anthropic API error", detail: data }); }
    res.json(data);
  } catch (e) { console.error("AI chat error:", e.message); sendError(res, e); }
});

export default router;
