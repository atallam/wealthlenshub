import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../lib/db.js";
import { auth, sendError, strictLimiter } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { takeSnapshot } from "../lib/snapshot.js";

const router = Router();
const BREEZE_BASE = "https://api.icicidirect.com/breezeapi/api/v1";

function breezeChecksum(timestamp, jsonBody, apiSecret) {
  return crypto.createHash("sha256").update(timestamp + jsonBody + apiSecret).digest("hex");
}

async function breezeReq(method, path, body, apiKey, apiSecret, sessionToken) {
  const timestamp = new Date().toISOString();
  const jsonBody = JSON.stringify(body || {});
  const r = await fetch(`${BREEZE_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Checksum": `token ${breezeChecksum(timestamp, jsonBody, apiSecret)}`, "X-Timestamp": timestamp, "X-AppKey": apiKey, "X-SessionToken": sessionToken },
    ...(method !== "GET" ? { body: jsonBody } : {}),
  });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.Error || b.message || `Breeze ${r.status}`); }
  return r.json();
}

async function upsertBreezeConn(userId, fields) {
  const { error } = await supabase.from("breeze_connections").upsert({ user_id: userId, updated_at: new Date().toISOString(), ...fields }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

async function getBreezeConn(userId) {
  const { data, error } = await supabase.from("breeze_connections").select("*").eq("user_id", userId).single();
  if (error || !data) throw new Error("No Breeze connection — connect first.");
  return data;
}

function tokenValid(tokenDate) {
  if (!tokenDate) return false;
  return tokenDate === new Date().toISOString().slice(0, 10);
}

router.post("/connect", auth, async (req, res) => {
  try {
    const { api_key, api_secret } = req.body;
    if (!api_key?.trim() || !api_secret?.trim()) return res.status(400).json({ error: "api_key and api_secret required" });
    await upsertBreezeConn(req.user.id, { api_key: encrypt(api_key.trim()), api_secret: encrypt(api_secret.trim()) });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

router.get("/login-url", auth, async (req, res) => {
  try {
    const conn = await getBreezeConn(req.user.id);
    const rawKey = decrypt(conn.api_key);
    res.json({ login_url: `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(rawKey)}` });
  } catch (e) { sendError(res, e); }
});

router.post("/callback", auth, async (req, res) => {
  try {
    const { session_token } = req.body;
    if (!session_token?.trim()) return res.status(400).json({ error: "session_token required" });
    const conn = await getBreezeConn(req.user.id);
    const rawKey = decrypt(conn.api_key); const rawSecret = decrypt(conn.api_secret);
    const profile = await breezeReq("GET", "/customerdetails", { SessionToken: session_token.trim(), AppKey: rawKey }, rawKey, rawSecret, session_token.trim());
    if (!profile?.Success?.idirect_userid) return res.status(400).json({ error: "Invalid session token." });
    const today = new Date().toISOString().slice(0, 10);
    await upsertBreezeConn(req.user.id, { session_token: encrypt(session_token.trim()), token_date: today, profile_name: profile.Success.idirect_user_name || "", client_id: profile.Success.idirect_userid || "" });
    res.json({ ok: true, profile_name: profile.Success.idirect_user_name || "", client_id: profile.Success.idirect_userid || "", token_date: today });
  } catch (e) { console.error("Breeze callback:", e.message); res.status(400).json({ error: e.message }); }
});

router.get("/status", auth, async (req, res) => {
  try {
    const { data } = await supabase.from("breeze_connections").select("token_date,profile_name,client_id,last_synced_at").eq("user_id", req.user.id).single();
    if (!data) return res.json({ connected: false });
    const tv = tokenValid(data.token_date);
    res.json({ connected: true, token_valid: tv, token_date: data.token_date, profile_name: data.profile_name, client_id: data.client_id, last_synced_at: data.last_synced_at, needs_reauth: !tv });
  } catch { res.json({ connected: false }); }
});

router.post("/sync", auth, strictLimiter, async (req, res) => {
  try {
    const { member_id } = req.body;
    const conn = await getBreezeConn(req.user.id);
    if (!tokenValid(conn.token_date)) return res.status(401).json({ error: "Breeze session expired — re-authorize.", needs_reauth: true });
    const rawKey = decrypt(conn.api_key); const rawSecret = decrypt(conn.api_secret); const rawToken = decrypt(conn.session_token);
    const [equityResp, mfResp] = await Promise.all([
      breezeReq("GET", "/portfolioholdings", { exchange_code: "NSE", product_type: "cash" }, rawKey, rawSecret, rawToken),
      breezeReq("GET", "/mfholdings", {}, rawKey, rawSecret, rawToken).catch(() => ({ Success: [] })),
    ]);
    const now = new Date().toISOString(); const today = now.slice(0, 10); const rows = [];
    for (const h of (equityResp?.Success || [])) {
      const qty = parseFloat(h.quantity || 0); if (qty <= 0) continue;
      const sym = h.stock_code || ""; const avg = parseFloat(h.average_price || 0); const ltp = parseFloat(h.ltp || 0);
      rows.push({ id: `breeze_${req.user.id.slice(0,8)}_${sym}`.replace(/[^a-zA-Z0-9_-]/g,"_"), user_id: req.user.id, member_id: member_id||null, type: "IN_STOCK", name: h.company_name||sym, ticker: sym, units: qty, purchase_price: avg, current_price: ltp, purchase_value: avg*qty, current_value: ltp*qty, currency: "INR", source: "breeze", brokerage_name: "ICICI Direct", last_synced: now, price_fetched_at: now, start_date: today });
    }
    for (const h of (mfResp?.Success || [])) {
      const units = parseFloat(h.quantity||h.units||0); if (units<=0) continue;
      const avgNav = parseFloat(h.average_price||0); const curNav = parseFloat(h.ltp||0);
      rows.push({ id: `breeze_mf_${req.user.id.slice(0,8)}_${(h.folio_number||h.scheme_name||"").slice(0,20)}`.replace(/[^a-zA-Z0-9_-]/g,"_"), user_id: req.user.id, member_id: member_id||null, type: "MF", name: h.scheme_name||"", ticker: "", scheme_code: h.isin||"", units, purchase_nav: avgNav, current_nav: curNav, purchase_price: avgNav, current_price: curNav, purchase_value: avgNav*units, current_value: curNav*units, currency: "INR", source: "breeze", brokerage_name: "ICICI Direct MF", last_synced: now, price_fetched_at: now, start_date: today });
    }
    if (!rows.length) return res.json({ synced: 0, message: "No holdings found." });
    const { error } = await supabase.from("holdings").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(error.message);
    await supabase.from("breeze_connections").update({ last_synced_at: now }).eq("user_id", req.user.id);
    // Snapshot directly (no fragile self-HTTP call reconstructed from the Host header).
    takeSnapshot(req.user.id, { source: "breeze_sync" }).catch(e => console.error("Breeze snapshot:", e.message));
    res.json({ synced: rows.length, equity_count: rows.filter(r => r.type === "IN_STOCK").length, mf_count: rows.filter(r => r.type === "MF").length });
  } catch (e) {
    console.error("Breeze sync:", e.message);
    if (e.message.includes("401") || e.message.includes("session")) return res.status(401).json({ error: "Session expired.", needs_reauth: true });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/disconnect", auth, async (req, res) => {
  try {
    await supabase.from("breeze_connections").delete().eq("user_id", req.user.id);
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "breeze");
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

export default router;
