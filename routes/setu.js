import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";

const SETU_ENABLED = process.env.SETU_ENABLED === "true";
const router = Router();

if (!SETU_ENABLED) {
  router.get("/status", auth, (_req, res) => res.json({ configured: false, sandbox: false, disabled: true }));
  router.all("/*", auth, (_req, res) => res.status(404).json({ error: "Account Aggregator not enabled. Set SETU_ENABLED=true to activate." }));
} else {
  const SETU_BASE    = process.env.SETU_BASE_URL || "https://fiu-sandbox.setu.co";
  const SETU_CLIENT  = process.env.SETU_CLIENT_ID;
  const SETU_SECRET  = process.env.SETU_CLIENT_SECRET;
  const SETU_PRODUCT = process.env.SETU_PRODUCT_INSTANCE_ID;

  let _setuToken = null, _setuTokenExp = 0;
  async function getSetuToken() {
    if (_setuToken && Date.now() < _setuTokenExp - 30000) return _setuToken;
    const resp = await fetch("https://orgservice.setu.co/v1/users/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientID: SETU_CLIENT, secret: SETU_SECRET }) });
    if (!resp.ok) throw new Error("Setu OAuth failed: " + resp.status);
    const data = await resp.json();
    _setuToken = data.access_token || data.token;
    _setuTokenExp = Date.now() + (data.expiresIn || 1800) * 1000;
    return _setuToken;
  }
  const setuHeaders = () => ({ "Content-Type": "application/json", "x-product-instance-id": SETU_PRODUCT });

  function _setuDate(d) { if (!d) return null; if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,10); const m = d.match(/^(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : d; }

  function parseSetuFIData(sessionData) {
    const holdings = [];
    for (const fip of (sessionData.fips || [])) {
      const fipName = fip.fipID || "";
      for (const account of (fip.accounts || [])) {
        if (!["DELIVERED","READY"].includes(account.status || account.FIstatus)) continue;
        const d = account.data?.account; if (!d) continue;
        const fiType = (d.type || "").toLowerCase();
        const summary = d.summary || {};
        const masked = d.maskedAccNumber || account.maskedAccNumber || "";
        try {
          if (fiType === "deposit") { holdings.push({ name: `Bank Account ${masked}`, type: "CASH", purchase_value: +summary.currentBalance || 0, current_value: +summary.currentBalance || 0, fip_name: fipName, source_account: masked }); }
          else if (fiType === "term_deposit" || fiType === "recurring_deposit") { holdings.push({ name: `${fiType==="term_deposit"?"FD":"RD"} ${masked}`, type: "FD", principal: +summary.principalAmount || 0, purchase_value: +summary.principalAmount || 0, current_value: +summary.currentValue || 0, interest_rate: +summary.interestRate || 0, start_date: _setuDate(summary.openingDate), maturity_date: _setuDate(summary.maturityDate), fip_name: fipName, source_account: masked }); }
          else if (fiType === "mutual_funds") { for (const mf of [].concat(summary.investment?.holdings?.holding || [])) { const u = +mf.closingUnits || +mf.units || 0, r = +mf.rate || 0, n = +mf.nav || 0; holdings.push({ name: `${mf.amc||"MF"} · ${mf.schemeCode||""}`, type: "MF", scheme_code: mf.amfiCode||mf.schemeCode||"", units: u, purchase_nav: r, current_nav: n, purchase_value: r*u, current_value: n*u, fip_name: fipName, source_account: masked }); } }
          else if (fiType === "equities") { for (const eq of [].concat(summary.investment?.holdings?.holding || [])) { const u = +eq.units || 0, r = +eq.rate || 0, p = +eq.lastTradedPrice || r; holdings.push({ name: eq.issuerName||`Stock ${eq.isin||""}`, type: "IN_STOCK", ticker: eq.symbol||"", units: u, purchase_price: r, current_price: p, purchase_value: r*u, current_value: p*u, fip_name: fipName, source_account: masked }); } }
          else if (fiType === "epf") { holdings.push({ name: `EPF · ${summary.establishmentName||""}`, type: "EPF", principal: +summary.employeeBalance || 0, purchase_value: +summary.totalBalance || 0, current_value: +summary.totalBalance || 0, start_date: _setuDate(summary.openingDate), fip_name: fipName, source_account: summary.establishmentId||masked }); }
          else if (fiType === "ppf") { holdings.push({ name: `PPF Account ${masked}`, type: "PPF", principal: +summary.currentBalance || 0, purchase_value: +summary.currentBalance || 0, current_value: +summary.currentBalance || 0, start_date: _setuDate(summary.openingDate), maturity_date: _setuDate(summary.maturityDate), fip_name: fipName, source_account: masked }); }
          else { holdings.push({ name: `${fiType} · ${masked}`, type: "OTHER", purchase_value: +summary.currentBalance || +summary.currentValue || 0, current_value: +summary.currentValue || +summary.currentBalance || 0, fip_name: fipName, source_account: masked }); }
        } catch (pe) { console.warn(`Setu parse ${fiType}:`, pe.message); }
      }
    }
    return holdings;
  }

  router.get("/status", auth, (_req, res) => res.json({ configured: !!(SETU_CLIENT && SETU_SECRET && SETU_PRODUCT), sandbox: SETU_BASE.includes("sandbox") }));

  router.post("/consent", auth, async (req, res) => {
    try {
      if (!SETU_CLIENT || !SETU_SECRET || !SETU_PRODUCT) return res.status(400).json({ error: "Setu AA not configured" });
      const { mobile } = req.body;
      if (!mobile) return res.status(400).json({ error: "Mobile number is required" });
      const token = await getSetuToken();
      const from = new Date(Date.now() - 3*365*86400000).toISOString();
      const to = new Date().toISOString();
      const cr = await fetch(`${SETU_BASE}/consents`, { method: "POST", headers: { ...setuHeaders(), Authorization: `Bearer ${token}` }, body: JSON.stringify({ consentDuration: { unit: "MONTH", value: "6" }, vua: mobile, dataRange: { from, to }, context: [] }) });
      const cd = await cr.json();
      if (!cr.ok) return res.status(cr.status).json({ error: cd.errorMsg || "Consent creation failed" });
      await supabase.from("setu_consents").insert({ user_id: req.user.id, consent_id: cd.id, status: cd.status || "PENDING", fi_types: ["DEPOSIT","TERM_DEPOSIT","MUTUAL_FUNDS","EQUITIES","ETF","EPF","PPF"], data_range_from: from, data_range_to: to, redirect_url: cd.url });
      res.json({ consent_id: cd.id, url: cd.url, status: cd.status });
    } catch (e) { sendError(res, e); }
  });

  router.get("/consent/:consentId", auth, async (req, res) => {
    try {
      const token = await getSetuToken();
      const r = await fetch(`${SETU_BASE}/consents/${req.params.consentId}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.errorMsg || "Failed" });
      await supabase.from("setu_consents").update({ status: d.status, updated_at: new Date().toISOString() }).eq("consent_id", req.params.consentId).eq("user_id", req.user.id);
      res.json({ status: d.status, accounts_linked: d.accountsLinked || [] });
    } catch (e) { sendError(res, e); }
  });

  router.post("/fetch/:consentId", auth, async (req, res) => {
    try {
      const token = await getSetuToken();
      const cid = req.params.consentId;
      const { data: cr } = await supabase.from("setu_consents").select("*").eq("consent_id", cid).eq("user_id", req.user.id).single();
      if (!cr) return res.status(404).json({ error: "Consent not found" });
      const sr = await fetch(`${SETU_BASE}/sessions`, { method: "POST", headers: { ...setuHeaders(), Authorization: `Bearer ${token}` }, body: JSON.stringify({ consentId: cid, dataRange: { from: cr.data_range_from, to: cr.data_range_to }, format: "json" }) });
      const sd = await sr.json();
      if (!sr.ok) return res.status(sr.status).json({ error: sd.errorMsg || "Data session failed" });
      await supabase.from("setu_consents").update({ session_id: sd.id, fi_data_status: "PENDING", updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
      let fiData = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const fr = await fetch(`${SETU_BASE}/sessions/${sd.id}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
        const fd = await fr.json();
        if (fd.status === "COMPLETED" || fd.status === "PARTIAL") { fiData = fd; break; }
        if (fd.status === "FAILED" || fd.status === "EXPIRED") return res.status(500).json({ error: `Data session ${fd.status}` });
      }
      if (!fiData) return res.status(408).json({ error: "Data not ready. Try again shortly." });
      const holdings = parseSetuFIData(fiData);
      await supabase.from("setu_consents").update({ fi_data_status: fiData.status, last_fetched_at: new Date().toISOString(), holdings_count: holdings.length, updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
      res.json({ status: fiData.status, holdings, session_id: sd.id });
    } catch (e) { sendError(res, e); }
  });

  router.post("/import", auth, async (req, res) => {
    try {
      const { holdings, member_id, consent_id } = req.body;
      if (!holdings?.length) return res.status(400).json({ error: "No holdings to import" });
      const rows = holdings.map(h => ({ ...h, id: h.id || crypto.randomUUID(), user_id: req.user.id, member_id: member_id || "", source: "setu_aa", brokerage_name: h.fip_name || "", created_at: new Date().toISOString() }));
      const { error } = await supabase.from("holdings").upsert(rows, { onConflict: "id" });
      if (error) return res.status(500).json({ error: error.message });
      if (consent_id) await supabase.from("setu_consents").update({ holdings_count: rows.length, updated_at: new Date().toISOString() }).eq("consent_id", consent_id).eq("user_id", req.user.id);
      res.json({ imported: rows.length });
    } catch (e) { sendError(res, e); }
  });

  router.get("/consents", auth, async (req, res) => {
    const { data, error } = await supabase.from("setu_consents").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ consents: data || [] });
  });

  router.post("/webhook", async (req, res) => {
    const webhookSecret = req.headers["x-webhook-secret"] || req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && webhookSecret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized webhook" });
    const { type, consentId, status } = req.body;
    if (type === "CONSENT_STATUS_UPDATE" && consentId) await supabase.from("setu_consents").update({ status, updated_at: new Date().toISOString() }).eq("consent_id", consentId);
    if (type === "FI_DATA_READY" && consentId) await supabase.from("setu_consents").update({ fi_data_status: status, last_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("consent_id", consentId);
    res.json({ ok: true });
  });
}

export default router;
