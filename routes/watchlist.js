/**
 * routes/watchlist.js — Watchlist CRUD with live price enrichment.
 *
 * GET    /api/watchlist          — list user's watchlist (with current prices)
 * POST   /api/watchlist          — add a ticker  { ticker, name, asset_type, target_price, notes }
 * PATCH  /api/watchlist/:id      — update { name, target_price, notes }
 * DELETE /api/watchlist/:id      — remove
 */
import { Router }          from "express";
import { auth, sendError } from "../lib/auth.js";
import * as watchlist      from "../services/watchlist.service.js";

const router = Router();

// ── GET /api/watchlist ────────────────────────────────────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    res.json(await watchlist.list(req.user.id));
  } catch (e) {
    sendError(res, e, 500);
  }
});

// ── POST /api/watchlist ───────────────────────────────────────────────────────

router.post("/", auth, async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });
    res.status(201).json(await watchlist.create(req.user.id, req.body));
  } catch (e) {
    sendError(res, e, 500);
  }
});

// ── PATCH /api/watchlist/:id ──────────────────────────────────────────────────

router.patch("/:id", auth, async (req, res) => {
  try {
    const updated = await watchlist.update(req.user.id, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) {
    sendError(res, e, 500);
  }
});

// ── DELETE /api/watchlist/:id ─────────────────────────────────────────────────

router.delete("/:id", auth, async (req, res) => {
  try {
    res.json(await watchlist.remove(req.user.id, req.params.id));
  } catch (e) {
    sendError(res, e, 500);
  }
});

export default router;
