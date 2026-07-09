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
import { supabase }        from "../lib/db.js";
import { stockPrice, mfNav, yahooPrice, fetchUsdInr } from "../lib/prices.js";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

async function enrichWithPrice(items) {
  if (!items.length) return items;
  let usdInr = 0;
  try { const r = await fetchUsdInr(); usdInr = r.rate || 0; } catch { /* ignore */ }

  return Promise.all(items.map(async item => {
    let current_price = null;
    let price_change_pct = null;
    try {
      const t = item.ticker?.toUpperCase();
      if (!t) return item;
      if (item.asset_type === "MF") {
        current_price = await mfNav(t).catch(() => null);
      } else if (item.asset_type === "IN_STOCK" || item.asset_type === "IN_ETF") {
        const q = await stockPrice(`${t}.NS`, "NSE").catch(() => null);
        current_price = q?.price ?? await yahooPrice(`${t}.BO`).catch(() => null);
        price_change_pct = q?.changePercent ?? null;
      } else if (["US_STOCK","US_ETF","CRYPTO"].includes(item.asset_type)) {
        const sym = item.asset_type === "CRYPTO" && !t.includes("-") ? `${t}-USD` : t;
        const q   = await stockPrice(sym).catch(() => null);
        current_price = q?.price ?? null;
        price_change_pct = q?.changePercent ?? null;
      }
    } catch { /* price unavailable */ }
    const hit_target = item.target_price && current_price
      ? current_price >= Number(item.target_price)
      : null;
    return { ...item, current_price, price_change_pct, hit_target, usd_inr: usdInr || null };
  }));
}

// ── GET /api/watchlist ────────────────────────────────────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("watchlist")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) return sendError(res, error, 500);
    const enriched = await enrichWithPrice(data || []);
    res.json(enriched);
  } catch (e) {
    sendError(res, e);
  }
});

// ── POST /api/watchlist ───────────────────────────────────────────────────────

router.post("/", auth, async (req, res) => {
  try {
    const { ticker, name, asset_type = "IN_STOCK", target_price, notes } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    const { data, error } = await supabase
      .from("watchlist")
      .insert({
        user_id:      req.user.id,
        ticker:       ticker.trim().toUpperCase(),
        name:         name?.trim() || ticker.trim().toUpperCase(),
        asset_type,
        target_price: target_price ? Number(target_price) : null,
        notes:        notes?.trim() || null,
      })
      .select()
      .single();
    if (error) return sendError(res, error, 500);
    const [enriched] = await enrichWithPrice([data]);
    res.status(201).json(enriched);
  } catch (e) {
    sendError(res, e);
  }
});

// ── PATCH /api/watchlist/:id ──────────────────────────────────────────────────

router.patch("/:id", auth, async (req, res) => {
  try {
    const { name, target_price, notes } = req.body;
    const patch = { updated_at: new Date().toISOString() };
    if (name        !== undefined) patch.name         = name?.trim() || null;
    if (target_price !== undefined) patch.target_price = target_price ? Number(target_price) : null;
    if (notes        !== undefined) patch.notes        = notes?.trim() || null;

    const { data, error } = await supabase
      .from("watchlist")
      .update(patch)
      .eq("id",      req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .single();
    if (error) return sendError(res, error, 500);
    if (!data) return res.status(404).json({ error: "Not found" });
    const [enriched] = await enrichWithPrice([data]);
    res.json(enriched);
  } catch (e) {
    sendError(res, e);
  }
});

// ── DELETE /api/watchlist/:id ─────────────────────────────────────────────────

router.delete("/:id", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("watchlist")
      .delete()
      .eq("id",      req.params.id)
      .eq("user_id", req.user.id);
    if (error) return sendError(res, error, 500);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
