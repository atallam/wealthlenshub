/**
 * services/watchlist.service.js — Watchlist CRUD + live price enrichment.
 * Moved out of routes/watchlist.js (P3-2) — same queries, same enrichment logic.
 */
import { supabase } from "../lib/db.js";
import { stockPrice, mfNav, yahooPrice, fetchUsdInr } from "../lib/prices.js";

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

/** List a user's watchlist, enriched with live prices. */
export async function list(userId) {
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return enrichWithPrice(data || []);
}

/** Add a ticker to the watchlist. */
export async function create(userId, { ticker, name, asset_type = "IN_STOCK", target_price, notes }) {
  const { data, error } = await supabase
    .from("watchlist")
    .insert({
      user_id:      userId,
      ticker:       ticker.trim().toUpperCase(),
      name:         name?.trim() || ticker.trim().toUpperCase(),
      asset_type,
      target_price: target_price ? Number(target_price) : null,
      notes:        notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  const [enriched] = await enrichWithPrice([data]);
  return enriched;
}

/** Update a watchlist item's name / target price / notes. */
export async function update(userId, id, { name, target_price, notes }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name         !== undefined) patch.name         = name?.trim() || null;
  if (target_price !== undefined) patch.target_price = target_price ? Number(target_price) : null;
  if (notes        !== undefined) patch.notes        = notes?.trim() || null;

  const { data, error } = await supabase
    .from("watchlist")
    .update(patch)
    .eq("id",      id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  if (!data) return null;
  const [enriched] = await enrichWithPrice([data]);
  return enriched;
}

/** Remove a watchlist item. */
export async function remove(userId, id) {
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id",      id)
    .eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
}
