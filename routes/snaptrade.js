import { Router } from "express";
import { Snaptrade } from "snaptrade-typescript-sdk";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router = Router();

let _snapClient = null;
function getSnapClient() {
  if (!_snapClient) {
    const cid = process.env.SNAPTRADE_CLIENT_ID;
    const ckey = process.env.SNAPTRADE_CONSUMER_KEY;
    if (!cid || !ckey) throw new Error("Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY");
    _snapClient = new Snaptrade({ clientId: cid, consumerKey: ckey });
  }
  return _snapClient;
}

async function getSnapConn(userId) {
  const { data, error } = await supabase.from("snaptrade_connections").select("*").eq("owner_id", userId).single();
  if (error || !data) throw new Error("No SnapTrade connection found — register first.");
  return { ...data, user_secret: decrypt(data.user_secret_enc) };
}

function _extractTypeCode(typeField) {
  if (!typeField) return "";
  if (typeof typeField === "string") return typeField.toLowerCase().trim();
  if (typeof typeField === "object" && typeField.code) return typeField.code.toLowerCase().trim();
  return "";
}
function _extractTypeDesc(typeField) {
  if (!typeField) return "";
  if (typeof typeField === "object" && typeField.description) return typeField.description.toLowerCase().trim();
  return "";
}
const INDIAN_EXCHANGE_CODES = new Set(["NSE", "BSE", "XNSE", "XBOM"]);
function _isIndianExchange(exchangeObj) {
  if (!exchangeObj) return false;
  const code = (exchangeObj.code || "").toUpperCase();
  const mic  = (exchangeObj.mic_code || "").toUpperCase();
  return INDIAN_EXCHANGE_CODES.has(code) || INDIAN_EXCHANGE_CODES.has(mic);
}
const CASH_SWEEP_TICKERS = new Set(["SPAXX","FDRXX","FZFXX","FCASH","VMFXX","SWVXX","TTTXX","SPRXX","CORE","QCEQX"]);

function snapHoldingType(symbolObj) {
  const code = _extractTypeCode(symbolObj?.type);
  const desc = _extractTypeDesc(symbolObj?.type);
  const isIndia = _isIndianExchange(symbolObj?.exchange);
  const ticker = (symbolObj?.symbol || symbolObj?.raw_symbol || "").toUpperCase();
  if (["cs","ad","ps","wi","wt","rt"].includes(code)||desc.includes("common stock")||desc.includes("preferred stock")||desc.includes("equity")||desc==="stock") return isIndia?"IN_STOCK":"US_STOCK";
  if (["et","etf","cef"].includes(code)||desc.includes("etf")||desc.includes("exchange traded")||desc.includes("closed end")) return isIndia?"IN_ETF":"US_ETF";
  if (["oef"].includes(code)||desc.includes("open ended")||desc.includes("open-ended")||desc.includes("mutual fund")) return isIndia?"MF":"US_ETF";
  if (["crypto","cryptocurrency"].includes(code)||desc.includes("crypto")) return "CRYPTO";
  if (["bnd","bond","fixed_income","struct"].includes(code)||desc.includes("bond")||desc.includes("fixed income")||desc.includes("structured")) return isIndia?"FD":"US_BOND";
  if (["pm"].includes(code)||desc.includes("precious metal")) return "GOLD";
  if (["ut"].includes(code)||desc.includes("unit trust")||desc.includes("unit")) return isIndia?"MF":"US_ETF";
  if (ticker.includes("-USD")||ticker.includes("-USDT")||ticker.includes("-BTC")) return "CRYPTO";
  return "OTHER";
}

router.get("/status", auth, async (_req, res) => {
  try {
    const cid = process.env.SNAPTRADE_CLIENT_ID, ckey = process.env.SNAPTRADE_CONSUMER_KEY;
    if (!cid || !ckey) return res.status(502).json({ error: "SnapTrade not configured" });
    const resp = await getSnapClient().apiStatus.check();
    res.json({ status: "ok", snaptrade: resp.data });
  } catch (e) { res.status(502).json({ error: "SnapTrade API unreachable", detail: e.message }); }
});

router.post("/register", auth, async (req, res) => {
  try {
    const { data: existing } = await supabase.from("snaptrade_connections").select("snaptrade_user_id").eq("owner_id", req.user.id).single();
    if (existing) return res.json({ snaptrade_user_id: existing.snaptrade_user_id, already_registered: true });
    const snapUserId = `wlh-${req.user.id}`;
    let userSecret;
    try {
      const resp = await getSnapClient().authentication.registerSnapTradeUser({ userId: snapUserId });
      userSecret = resp.data.userSecret;
    } catch (regErr) {
      if (regErr.status === 400 || regErr.response?.status === 400) {
        const resetResp = await getSnapClient().authentication.resetSnapTradeUserSecret({ userId: snapUserId, userSecret: "placeholder" });
        userSecret = resetResp.data.userSecret;
      } else throw regErr;
    }
    await supabase.from("snaptrade_connections").insert({ owner_id: req.user.id, snaptrade_user_id: snapUserId, user_secret_enc: encrypt(userSecret), status: "active" });
    res.json({ snaptrade_user_id: snapUserId, registered: true });
  } catch (e) { const status = e.status || e.response?.status || 500; res.status(status).json({ error: e.message }); }
});

router.post("/connect", auth, async (req, res) => {
  try {
    const { broker } = req.body;
    const conn = await getSnapConn(req.user.id);
    const baseUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:5173";
    const params = { userId: conn.snaptrade_user_id, userSecret: conn.user_secret, customRedirect: `${baseUrl}/import/snaptrade/callback` };
    if (broker) params.broker = broker;
    const resp = await getSnapClient().authentication.loginSnapTradeUser(params);
    res.json({ redirect_uri: resp.data.redirectURI });
  } catch (e) { sendError(res, e); }
});

router.get("/accounts", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const resp = await getSnapClient().accountInformation.listUserAccounts({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret });
    res.json({ accounts: (resp.data || []).map(a => ({ account_id: a.id, brokerage: a.brokerage?.name || "", brokerage_slug: a.brokerage?.slug || "", account_name: a.name || "", account_number: a.number || "", account_type: a.meta?.type || a.raw_type || "" })), count: (resp.data || []).length });
  } catch (e) { sendError(res, e); }
});

router.get("/holdings/:accountId", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const client = getSnapClient();
    const brokerageName = req.query.brokerage || "SnapTrade";
    const [posResp, balResp, existingResp] = await Promise.all([
      client.accountInformation.getUserAccountPositions({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: req.params.accountId }),
      client.accountInformation.getUserAccountBalance({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: req.params.accountId }),
      supabase.from("holdings").select("id, ticker, units, name, type, source, source_account, brokerage_name, current_price, purchase_price").eq("user_id", req.user.id),
    ]);
    const existingMap = {};
    for (const h of existingResp.data || []) { if (h.ticker) existingMap[h.ticker.toUpperCase()] = h; }
    const positions = (posResp.data || []).map(p => {
      const units = Number(p.units || 0), price = Number(p.price || 0), avg = Number(p.average_purchase_price || 0);
      const ticker = p.symbol?.symbol?.symbol || "UNKNOWN";
      const desc = (p.symbol?.symbol?.description || "").toLowerCase();
      const typeCode = _extractTypeCode(p.symbol?.symbol?.type);
      const isCashSweep = CASH_SWEEP_TICKERS.has(ticker.toUpperCase()) || (typeCode === "oef" && (desc.includes("money market") || desc.includes("cash") || desc.includes("sweep")));
      if (isCashSweep) return null;
      const existing = existingMap[ticker.toUpperCase()];
      let dup_status = "new", dup_detail = null;
      if (existing) {
        const existingUnits = Number(existing.units || 0);
        const existSrc = existing.brokerage_name || existing.source || "manual";
        if (existingUnits === units && existing.source === "snaptrade") { dup_status = "exact_match"; dup_detail = `Already imported: ${existingUnits} units via ${existSrc}`; }
        else if (existing.source === "snaptrade") { dup_status = "qty_changed"; dup_detail = `${existSrc}: ${existingUnits} units → New: ${units} units`; }
        else { dup_status = "manual_exists"; dup_detail = `Manual entry exists: ${existing.name} (${existingUnits || "?"} units) via ${existSrc}`; }
      }
      return { ticker, asset_name: p.symbol?.symbol?.description || ticker, asset_type: snapHoldingType(p.symbol?.symbol), brokerage_name: brokerageName, source: "snaptrade", units, current_price: price, avg_cost: avg, market_value: units * price, unrealized_pnl: avg ? (price - avg) * units : 0, currency: p.symbol?.symbol?.currency?.code || "USD", dup_status, dup_detail, existing_id: existing?.id || null };
    }).filter(Boolean);
    const cashPositions = (balResp.data || []).filter(b => Number(b.cash || 0) > 0).map(b => {
      const cash = Number(b.cash), cur = b.currency?.code || "USD", ticker = `CASH-${cur}`;
      const existing = existingMap[ticker.toUpperCase()];
      return { ticker, asset_name: `Cash (${cur})`, asset_type: "CASH", brokerage_name: brokerageName, source: "snaptrade", units: 1, current_price: cash, avg_cost: cash, market_value: cash, unrealized_pnl: 0, currency: cur, dup_status: existing ? "exact_match" : "new", dup_detail: existing ? "Cash balance already tracked" : null, existing_id: existing?.id || null };
    });
    const all = [...positions, ...cashPositions];
    res.json({ account_id: req.params.accountId, assets: all, asset_count: all.length, total_market_value: Math.round(all.reduce((s, a) => s + a.market_value, 0) * 100) / 100, duplicates: { new_count: all.filter(a => a.dup_status === "new").length, exact_match_count: all.filter(a => a.dup_status === "exact_match").length, qty_changed_count: all.filter(a => a.dup_status === "qty_changed").length, manual_exists_count: all.filter(a => a.dup_status === "manual_exists").length } });
  } catch (e) { sendError(res, e); }
});

router.post("/import/:accountId", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const client = getSnapClient();
    const now = new Date().toISOString();
    const acctId = req.params.accountId;
    const resolutions = req.body?.resolutions || {};
    const brokerageName = req.body?.brokerage_name || "SnapTrade";
    const memberId = req.body?.member_id || null;
    const [posResp, balResp, existingResp] = await Promise.all([
      client.accountInformation.getUserAccountPositions({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: acctId }),
      client.accountInformation.getUserAccountBalance({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret, accountId: acctId }),
      supabase.from("holdings").select("id, ticker, units, name, type, source, current_price, purchase_price").eq("user_id", req.user.id),
    ]);
    const existingMap = {};
    for (const h of existingResp.data || []) { if (h.ticker) existingMap[h.ticker.toUpperCase()] = h; }
    const newRows = [], updateOps = [];
    let skipped = 0, merged = 0, replaced = 0;
    const unresolved = [];
    for (const p of posResp.data || []) {
      const ticker = p.symbol?.symbol?.symbol || "UNKNOWN";
      const units = Number(p.units || 0), price = Number(p.price || 0), avg = Number(p.average_purchase_price || 0);
      if (units <= 0) continue;
      const descLow = (p.symbol?.symbol?.description || "").toLowerCase();
      const typeCode = _extractTypeCode(p.symbol?.symbol?.type);
      const isCashSweep = CASH_SWEEP_TICKERS.has(ticker.toUpperCase()) || (typeCode === "oef" && (descLow.includes("money market") || descLow.includes("cash") || descLow.includes("sweep")));
      if (isCashSweep) { skipped++; continue; }
      const existing = existingMap[ticker.toUpperCase()];
      const resolution = resolutions[ticker] || resolutions[ticker.toUpperCase()];
      if (existing) {
        if (!resolution) { unresolved.push(ticker); skipped++; continue; }
        if (resolution === "skip") { skipped++; continue; }
        const existingUnits = Number(existing.units || 0);
        if (resolution === "merge") updateOps.push(supabase.from("holdings").update({ units: existingUnits + units, current_price: price, brokerage_name: brokerageName, source: "snaptrade", ...(memberId && { member_id: memberId }), price_fetched_at: now, last_synced: now }).eq("id", existing.id).then(r => { if (!r.error) merged++; }));
        else updateOps.push(supabase.from("holdings").update({ units, type: snapHoldingType(p.symbol?.symbol), name: p.symbol?.symbol?.description || ticker, purchase_price: avg || price, current_price: price, currency: p.symbol?.symbol?.currency?.code || "USD", source: "snaptrade", source_account: acctId, brokerage_name: brokerageName, ...(memberId && { member_id: memberId }), last_synced: now, price_fetched_at: now }).eq("id", existing.id).then(r => { if (!r.error) replaced++; }));
        continue;
      }
      newRows.push({ id: `snap_${acctId}_${ticker}`.replace(/[^a-zA-Z0-9_-]/g, "_"), user_id: req.user.id, type: snapHoldingType(p.symbol?.symbol), ticker, name: p.symbol?.symbol?.description || ticker, units, purchase_price: avg || price, current_price: price, currency: p.symbol?.symbol?.currency?.code || "USD", source: "snaptrade", source_account: acctId, brokerage_name: brokerageName, ...(memberId && { member_id: memberId }), last_synced: now, price_fetched_at: now, start_date: now.slice(0, 10) });
    }
    for (const b of balResp.data || []) {
      const cash = Number(b.cash || 0); if (cash <= 0) continue;
      const cur = b.currency?.code || "USD";
      newRows.push({ id: `snap_${acctId}_CASH_${cur}`, user_id: req.user.id, type: "CASH", ticker: `CASH-${cur}`, name: `Cash (${cur})`, units: 1, purchase_price: cash, current_price: cash, currency: cur, source: "snaptrade", source_account: acctId, brokerage_name: brokerageName, ...(memberId && { member_id: memberId }), last_synced: now, price_fetched_at: now, start_date: now.slice(0, 10) });
    }
    const bulkUpsertPromise = newRows.length > 0 ? supabase.from("holdings").upsert(newRows, { onConflict: "id" }) : Promise.resolve({ error: null });
    const [bulkResult] = await Promise.all([bulkUpsertPromise, ...updateOps, supabase.from("snaptrade_connections").update({ last_synced_at: now }).eq("owner_id", req.user.id)]);
    const imported = bulkResult.error ? 0 : newRows.length;
    if (bulkResult.error) console.error("SnapTrade bulk upsert error:", bulkResult.error.message);
    res.json({ status: "imported", assets_imported: imported, assets_skipped: skipped, assets_merged: merged, assets_replaced: replaced, unresolved_tickers: unresolved, account_id: acctId, brokerage_name: brokerageName });
  } catch (e) { sendError(res, e); }
});

router.get("/connections", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    const resp = await getSnapClient().connections.listBrokerageAuthorizations({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret });
    res.json({ connections: (resp.data || []).map(c => ({ authorization_id: c.id, brokerage: c.brokerage?.name || "", brokerage_slug: c.brokerage?.slug || "", status: c.disabled ? "disabled" : "active", created_at: c.createdDate || null })), count: (resp.data || []).length });
  } catch (e) { sendError(res, e); }
});

router.delete("/connections/:authId", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    await getSnapClient().connections.removeBrokerageAuthorization({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret, authorizationId: req.params.authId });
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "snaptrade");
    const remaining = await getSnapClient().connections.listBrokerageAuthorizations({ userId: conn.snaptrade_user_id, userSecret: conn.user_secret });
    res.json({ status: "disconnected", authorization_id: req.params.authId, remaining_connections: (remaining.data || []).length });
  } catch (e) { sendError(res, e); }
});

router.delete("/disconnect", auth, async (req, res) => {
  try {
    const conn = await getSnapConn(req.user.id);
    await getSnapClient().authentication.deleteSnapTradeUser({ userId: conn.snaptrade_user_id });
    await supabase.from("snaptrade_connections").delete().eq("owner_id", req.user.id);
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "snaptrade");
    res.json({ status: "disconnected" });
  } catch (e) { sendError(res, e); }
});

export default router;
