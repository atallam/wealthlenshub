import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../lib/db.js";
import { auth, sendError, strictLimiter } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { persistBrokerSync } from "../services/brokers/persistSync.js";

const router = Router();
const KITE_BASE = "https://api.kite.trade";

function kiteTokenValid(tokenDate) {
  if (!tokenDate) return false;
  return tokenDate === new Date().toISOString().slice(0, 10);
}

async function kiteGet(path, accessToken, apiKey) {
  const r = await fetch(`${KITE_BASE}${path}`, { headers: { "X-Kite-Version": "3", "Authorization": `token ${apiKey}:${accessToken}` } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.message || `Kite ${r.status}`); }
  return r.json();
}

async function upsertKiteConn(userId, fields) {
  const { error } = await supabase.from("kite_connections").upsert({ user_id: userId, updated_at: new Date().toISOString(), ...fields }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

async function getKiteConn(userId) {
  const { data, error } = await supabase.from("kite_connections").select("*").eq("user_id", userId).single();
  if (error || !data) throw new Error("No Kite connection — connect first.");
  return data;
}

router.post("/connect", auth, async (req, res) => {
  try {
    const { api_key } = req.body;
    if (!api_key?.trim()) return res.status(400).json({ error: "api_key required" });
    await upsertKiteConn(req.user.id, { api_key: api_key.trim() });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

router.get("/login-url", auth, async (req, res) => {
  try {
    const conn = await getKiteConn(req.user.id);
    const loginUrl = `https://kite.zerodha.com/connect/login?api_key=${conn.api_key}&v=3`;
    res.json({ login_url: loginUrl });
  } catch (e) { sendError(res, e); }
});

router.post("/callback", auth, async (req, res) => {
  try {
    const { request_token } = req.body;
    if (!request_token) return res.status(400).json({ error: "request_token required" });
    const conn = await getKiteConn(req.user.id);
    const r = await fetch(`${KITE_BASE}/session/token`, {
      method: "POST",
      headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_key: conn.api_key, request_token, checksum: "" }).toString(),
    });
    const data = await r.json();
    if (!r.ok || !data.data?.access_token) return res.status(400).json({ error: data.message || "Token exchange failed" });
    const today = new Date().toISOString().slice(0, 10);
    await upsertKiteConn(req.user.id, { access_token: encrypt(data.data.access_token), token_date: today, profile_name: data.data?.user_name || "", profile_email: data.data?.email || "" });
    res.json({ ok: true, profile_name: data.data?.user_name || "", token_date: today });
  } catch (e) { console.error("Kite callback:", e.message); sendError(res, e); }
});

router.get("/status", auth, async (req, res) => {
  try {
    const { data } = await supabase.from("kite_connections").select("api_key,token_date,profile_name,profile_email,last_synced_at").eq("user_id", req.user.id).single();
    if (!data) return res.json({ connected: false });
    res.json({ connected: true, token_valid: kiteTokenValid(data.token_date), token_date: data.token_date, profile_name: data.profile_name, profile_email: data.profile_email, last_synced_at: data.last_synced_at, needs_reauth: !kiteTokenValid(data.token_date) });
  } catch { res.json({ connected: false }); }
});

router.post("/sync", auth, strictLimiter, async (req, res) => {
  try {
    const { member_id } = req.body;
    const conn = await getKiteConn(req.user.id);
    if (!kiteTokenValid(conn.token_date)) return res.status(401).json({ error: "Kite token expired — re-authorize.", needs_reauth: true });
    const rawToken = decrypt(conn.access_token);
    const [holdingsResp, mfResp] = await Promise.all([
      kiteGet("/portfolio/holdings", rawToken, conn.api_key),
      kiteGet("/portfolio/holdings/mf", rawToken, conn.api_key).catch(() => ({ data: [] })),
    ]);
    const now = new Date().toISOString(); const today = now.slice(0, 10); const rows = [];
    for (const h of (holdingsResp.data || [])) {
      if (!h.tradingsymbol || (h.quantity || 0) <= 0) continue;
      rows.push({ id: `kite_${req.user.id.slice(0,8)}_${h.tradingsymbol}`.replace(/[^a-zA-Z0-9_-]/g,"_"), user_id: req.user.id, member_id: member_id || null, type: h.instrument_type === "ETF" ? "IN_ETF" : "IN_STOCK", name: h.tradingsymbol, ticker: h.tradingsymbol, units: h.quantity, purchase_price: h.average_price || 0, current_price: h.last_price || 0, purchase_value: (h.average_price||0)*h.quantity, current_value: (h.last_price||0)*h.quantity, currency: "INR", source: "kite", brokerage_name: "Zerodha", last_synced: now, price_fetched_at: now, start_date: today });
    }
    for (const h of (mfResp.data || [])) {
      if (!h.folio || (h.quantity || 0) <= 0) continue;
      rows.push({ id: `kite_mf_${req.user.id.slice(0,8)}_${h.folio}`.replace(/[^a-zA-Z0-9_-]/g,"_"), user_id: req.user.id, member_id: member_id || null, type: "MF", name: h.fund || h.tradingsymbol || h.folio, ticker: "", scheme_code: h.tradingsymbol || "", units: h.quantity, purchase_nav: h.average_price||0, current_nav: h.last_price||0, purchase_price: h.average_price||0, current_price: h.last_price||0, purchase_value: (h.average_price||0)*h.quantity, current_value: (h.last_price||0)*h.quantity, currency: "INR", source: "kite", brokerage_name: "Zerodha Coin", last_synced: now, price_fetched_at: now, start_date: today });
    }
    const result = await persistBrokerSync(req.user.id, rows, { connTable: "kite_connections", source: "kite_sync" });
    res.json(result);
  } catch (e) {
    console.error("Kite sync:", e.message);
    if (e.message.includes("TokenException") || e.message.includes("Invalid")) return res.status(401).json({ error: "Token invalid.", needs_reauth: true });
    sendError(res, e);
  }
});

router.delete("/disconnect", auth, async (req, res) => {
  try {
    await supabase.from("kite_connections").delete().eq("user_id", req.user.id);
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "kite");
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

export default router;
