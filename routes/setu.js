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
  const SETU_AUTH_URL = process.env.SETU_AUTH_URL || "https://orgservice-prod.setu.co/v1/users/login";
  // Sandbox uses the OneMoney AA handle; prod handle is configurable.
  const SETU_VUA_HANDLE = process.env.SETU_VUA_HANDLE || "onemoney";
  const toVua = (mobile) => { const m = String(mobile || "").replace(/\D/g, "").slice(-10); return m.includes("@") ? m : `${m}@${SETU_VUA_HANDLE}`; };
  // Setu returns HTML/text on some errors (gateway 404s, 5xx) — never let .json() blow up into a bare 500.
  async function readJson(resp) { const t = await resp.text(); try { return JSON.parse(t); } catch { return { errorMsg: t.slice(0, 200) || `HTTP ${resp.status}` }; } }

  let _setuToken = null, _setuTokenExp = 0;
  async function getSetuToken() {
    if (_setuToken && Date.now() < _setuTokenExp - 30000) return _setuToken;
    // Per Setu AA API spec: POST https://orgservice-prod.setu.co/v1/users/login
    // (same host for sandbox + prod), header `client: bridge`, body must include grant_type.
    const resp = await fetch(SETU_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", client: "bridge" },
      body: JSON.stringify({ clientID: SETU_CLIENT, secret: SETU_SECRET, grant_type: "client_credentials" }),
    });
    const data = await readJson(resp);
    if (!resp.ok || !(data.access_token || data.token)) {
      console.error("Setu auth response:", resp.status, JSON.stringify(data).slice(0, 300));
      const err = new Error(`Setu auth failed (${resp.status}): ${data.errorMsg || data.error || "check SETU_CLIENT_ID / SETU_CLIENT_SECRET"}`);
      err.code = "SETU_AUTH"; throw err;
    }
    _setuToken = data.access_token || data.token;
    _setuTokenExp = Date.now() + (data.expiresIn || 1500) * 1000; // spec returns no expiry; tokens last ~30 min
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
      const cr = await fetch(`${SETU_BASE}/v2/consents`, { method: "POST", headers: { ...setuHeaders(), Authorization: `Bearer ${token}` }, body: JSON.stringify({ consentDuration: { unit: "MONTH", value: "6" }, vua: toVua(mobile), dataRange: { from, to }, context: [], consentTypes: ["PROFILE","SUMMARY","TRANSACTIONS"], fiTypes: ["DEPOSIT","TERM_DEPOSIT","RECURRING_DEPOSIT","MUTUAL_FUNDS","EQUITIES","ETF"] }) });
      const cd = await readJson(cr);
      if (!cr.ok) { console.error("Setu consent error:", cr.status, JSON.stringify(cd).slice(0, 300)); return res.status(cr.status >= 500 ? 502 : cr.status).json({ error: cd.errorMsg || cd.error || "Consent creation failed" }); }
      await supabase.from("setu_consents").insert({ user_id: req.user.id, consent_id: cd.id, status: cd.status || "PENDING", fi_types: ["DEPOSIT","TERM_DEPOSIT","MUTUAL_FUNDS","EQUITIES","ETF","EPF","PPF"], data_range_from: from, data_range_to: to, redirect_url: cd.url });
      res.json({ consent_id: cd.id, url: cd.url, status: cd.status });
    } catch (e) { if (e.code === "SETU_AUTH") return res.status(502).json({ error: e.message }); sendError(res, e); }
  });

  router.get("/consent/:consentId", auth, async (req, res) => {
    try {
      const token = await getSetuToken();
      const r = await fetch(`${SETU_BASE}/v2/consents/${req.params.consentId}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
      const d = await readJson(r);
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
      const sr = await fetch(`${SETU_BASE}/v2/sessions`, { method: "POST", headers: { ...setuHeaders(), Authorization: `Bearer ${token}` }, body: JSON.stringify({ consentId: cid, dataRange: { from: cr.data_range_from, to: cr.data_range_to }, format: "json" }) });
      const sd = await readJson(sr);
      if (!sr.ok) return res.status(sr.status).json({ error: sd.errorMsg || "Data session failed" });
      await supabase.from("setu_consents").update({ session_id: sd.id, fi_data_status: "PENDING", updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
      let fiData = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const fr = await fetch(`${SETU_BASE}/v2/sessions/${sd.id}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
        const fd = await readJson(fr);
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
    // Require the shared secret unconditionally. Previously, if CRON_SECRET was
    // unset the webhook accepted unauthenticated consent-status writes.
    const expected = process.env.SETU_WEBHOOK_SECRET || process.env.CRON_SECRET;
    if (!expected) return res.status(503).json({ error: "Webhook secret not configured" });
    const webhookSecret = req.headers["x-webhook-secret"] || req.headers["x-cron-secret"];
    if (webhookSecret !== expected) return res.status(401).json({ error: "Unauthorized webhook" });
    const { type, consentId, status } = req.body;
    if (type === "CONSENT_STATUS_UPDATE" && consentId) await supabase.from("setu_consents").update({ status, updated_at: new Date().toISOString() }).eq("consent_id", consentId);
    if (type === "FI_DATA_READY" && consentId) await supabase.from("setu_consents").update({ fi_data_status: status, last_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("consent_id", consentId);
    res.json({ ok: true });
  });
}

export default router;

// ── Budget Transaction Routes ─────────────────────────────────────────────────
// These endpoints are ADDITIVE — existing wealth endpoints above are untouched.
// They reuse the same Setu consent/session infrastructure but parse individual
// transactions (not account summaries) and write to budget tables.

if (SETU_ENABLED) {
  // Helper: map Setu transaction type to budget txn_type
  function _setuTxnType(t) { return (t || "").toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT"; }

  // Helper: auto-categorise Indian bank transactions
  function _categorise(narration) {
    const n = (narration || "").toLowerCase();
    if (/swiggy|zomato|dunzo|blinkit|bigbasket|zepto/.test(n)) return "Food & Dining";
    if (/uber|ola|rapido|metro|irctc|train|flight|airline|spice|indigo/.test(n)) return "Transport";
    if (/netflix|hotstar|spotify|amazon prime|zee5/.test(n)) return "Entertainment";
    if (/amazon|flipkart|myntra|meesho|nykaa/.test(n)) return "Shopping";
    if (/hospital|pharmacy|medplus|apollo|practo|netmeds/.test(n)) return "Health";
    if (/school|tuition|byju|unacademy|coursera|udemy/.test(n)) return "Education";
    if (/electricity|bescom|msedcl|torrent|water|gas|bsnl|airtel|jio|vodafone/.test(n)) return "Housing & Bills";
    if (/emi|loan|hdfc loan|icici loan|home loan|car loan/.test(n)) return "EMI / Loans";
    if (/salary|sal cr|payroll/.test(n)) return "Income";
    if (/neft|imps|upi|transfer/.test(n)) return "Transfer";
    if (/atm|cash withdrawal/.test(n)) return "Cash";
    return "Uncategorised";
  }

  // Helper: fingerprint for dedup (matches budget service pattern)
  function _fingerprint(date, amount, txnType, desc) {
    const prefix = (desc || "").slice(0, 30).toLowerCase().replace(/\s+/g, "");
    return `${date}|${amount}|${txnType}|${prefix}`;
  }

  // Parse individual transactions from Setu FI session data
  function parseSetuTransactions(sessionData) {
    const transactions = [];
    for (const fip of (sessionData.fips || [])) {
      const fipName = fip.fipID || "";
      for (const account of (fip.accounts || [])) {
        if (!["DELIVERED", "READY"].includes(account.status || account.FIstatus)) continue;
        const d = account.data?.account;
        if (!d) continue;
        const fiType = (d.type || "").toLowerCase();
        if (!["deposit", "credit_card"].includes(fiType)) continue; // budget-relevant only
        const masked = d.maskedAccNumber || account.maskedAccNumber || "";
        const source = `${fipName} ····${masked.slice(-4)}`;
        const txns = [].concat(d.transactions?.transaction || []);
        for (const t of txns) {
          const amount = Math.abs(parseFloat(t.amount || t.transactionAmount || 0));
          if (!amount) continue;
          const narration = t.narration || t.transactionRemarks || t.description || "";
          const date = (t.valueDate || t.txnDate || t.transactionDate || "").slice(0, 10);
          if (!date) continue;
          const txnType = _setuTxnType(t.type || t.transactionType);
          transactions.push({
            txn_date: date,
            description: narration,
            search_text: narration.toLowerCase(),
            amount,
            txn_type: txnType,
            category: _categorise(narration),
            balance: parseFloat(t.currentBalance || t.balance || 0) || null,
            ref_number: t.reference || t.referenceNumber || null,
            currency: "INR",
            source_name: source,
            fip_name: fipName,
            masked_account: masked,
          });
        }
      }
    }
    return transactions;
  }

  // POST /api/setu/consent-budget
  // Create a budget-focused consent (DEPOSIT + CREDIT_CARD, requesting transactions)
  router.post("/consent-budget", auth, async (req, res) => {
    try {
      if (!SETU_CLIENT || !SETU_SECRET || !SETU_PRODUCT) return res.status(400).json({ error: "Setu AA not configured" });
      const { mobile } = req.body;
      if (!mobile) return res.status(400).json({ error: "Mobile number is required" });
      const token = await getSetuToken();
      const from = new Date(Date.now() - 2 * 365 * 86400000).toISOString(); // 2 years back
      const to = new Date().toISOString();
      const cr = await fetch(`${SETU_BASE}/v2/consents`, {
        method: "POST",
        headers: { ...setuHeaders(), Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          consentDuration: { unit: "MONTH", value: "6" },
          vua: toVua(mobile),
          dataRange: { from, to },
          context: [],
          consentTypes: ["PROFILE", "SUMMARY", "TRANSACTIONS"],
          // CREDIT_CARD is not a valid AA fiType in Setu's spec; DEPOSIT covers savings/current
          fiTypes: ["DEPOSIT"],
        }),
      });
      const cd = await readJson(cr);
      if (!cr.ok) { console.error("Setu consent error:", cr.status, JSON.stringify(cd).slice(0, 300)); return res.status(cr.status >= 500 ? 502 : cr.status).json({ error: cd.errorMsg || cd.error || "Consent creation failed" }); }
      await supabase.from("setu_consents").insert({
        user_id: req.user.id,
        consent_id: cd.id,
        status: cd.status || "PENDING",
        fi_types: ["DEPOSIT", "CREDIT_CARD"],
        purpose: "budget",
        data_range_from: from,
        data_range_to: to,
        redirect_url: cd.url,
      });
      res.json({ consent_id: cd.id, url: cd.url, status: cd.status });
    } catch (e) { if (e.code === "SETU_AUTH") return res.status(502).json({ error: e.message }); sendError(res, e); }
  });

  // POST /api/setu/fetch-transactions/:consentId
  // Fetch and return individual bank/CC transactions for budget import (preview)
  router.post("/fetch-transactions/:consentId", auth, async (req, res) => {
    try {
      const token = await getSetuToken();
      const cid = req.params.consentId;
      const { data: cr } = await supabase.from("setu_consents").select("*").eq("consent_id", cid).eq("user_id", req.user.id).single();
      if (!cr) return res.status(404).json({ error: "Consent not found" });
      const sr = await fetch(`${SETU_BASE}/v2/sessions`, {
        method: "POST",
        headers: { ...setuHeaders(), Authorization: `Bearer ${token}` },
        body: JSON.stringify({ consentId: cid, dataRange: { from: cr.data_range_from, to: cr.data_range_to }, format: "json" }),
      });
      const sd = await readJson(sr);
      if (!sr.ok) return res.status(sr.status).json({ error: sd.errorMsg || "Data session failed" });
      await supabase.from("setu_consents").update({ session_id: sd.id, fi_data_status: "PENDING", updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
      let fiData = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const fr = await fetch(`${SETU_BASE}/v2/sessions/${sd.id}`, { headers: { ...setuHeaders(), Authorization: `Bearer ${token}` } });
        const fd = await readJson(fr);
        if (fd.status === "COMPLETED" || fd.status === "PARTIAL") { fiData = fd; break; }
        if (fd.status === "FAILED" || fd.status === "EXPIRED") return res.status(500).json({ error: `Data session ${fd.status}` });
      }
      if (!fiData) return res.status(408).json({ error: "Data not ready. Try again shortly." });
      const transactions = parseSetuTransactions(fiData);
      await supabase.from("setu_consents").update({ fi_data_status: fiData.status, last_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("consent_id", cid).eq("user_id", req.user.id);
      res.json({ status: fiData.status, transactions, count: transactions.length, session_id: sd.id });
    } catch (e) { sendError(res, e); }
  });

  // POST /api/setu/import-budget
  // Save transactions to budget_statements + budget_transactions (Family Budget tab only)
  router.post("/import-budget", auth, async (req, res) => {
    try {
      const { transactions, consent_id, member_id } = req.body;
      if (!transactions?.length) return res.status(400).json({ error: "No transactions to import" });

      // Group by source account → one budget_statement per account
      const bySource = {};
      for (const t of transactions) {
        const key = t.source_name || t.fip_name || "Setu AA";
        if (!bySource[key]) bySource[key] = [];
        bySource[key].push(t);
      }

      let totalImported = 0;
      let totalDupes = 0;
      const crypto = await import("crypto");

      for (const [source, txns] of Object.entries(bySource)) {
        const stmtId = "setu_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        const dates = txns.map(t => t.txn_date).sort();
        const periodStart = dates[0];
        const periodEnd = dates[dates.length - 1];

        // Create statement row
        await supabase.from("budget_statements").insert({
          id: stmtId,
          user_id: req.user.id,
          member_id: member_id || null,
          source,
          statement_type: source.toLowerCase().includes("credit") ? "CREDIT_CARD" : "BANK",
          filename: `setu_aa_${source.replace(/\s+/g, "_").toLowerCase()}.json`,
          file_size: 0,
          period_start: periodStart,
          period_end: periodEnd,
          txn_count: txns.length,
          notes: `Auto-imported via Setu Account Aggregator. Consent: ${consent_id || "N/A"}`,
        });

        // Build transaction rows with dedup fingerprint
        const rows = txns.map(t => ({
          id: crypto.default.randomUUID(),
          statement_id: stmtId,
          user_id: req.user.id,
          txn_date: t.txn_date,
          description: t.description,
          search_text: t.search_text || t.description.toLowerCase(),
          fingerprint: _fingerprint(t.txn_date, t.amount, t.txn_type, t.description),
          amount: t.amount,
          txn_type: t.txn_type,
          category: t.category || "Uncategorised",
          balance: t.balance || null,
          ref_number: t.ref_number || null,
          currency: "INR",
          created_at: new Date().toISOString(),
        }));

        // Upsert with fingerprint dedup (skip duplicates)
        for (const row of rows) {
          const { data: existing } = await supabase.from("budget_transactions").select("id").eq("user_id", req.user.id).eq("fingerprint", row.fingerprint).maybeSingle();
          if (existing) { totalDupes++; continue; }
          await supabase.from("budget_transactions").insert(row);
          totalImported++;
        }
      }

      // Update consent record
      if (consent_id) {
        await supabase.from("setu_consents").update({ txn_count: totalImported, last_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("consent_id", consent_id).eq("user_id", req.user.id);
      }

      // Upsert connection record for future re-sync
      if (consent_id) {
        const connId = "setuconn_" + consent_id.slice(0, 8);
        await supabase.from("setu_connections").upsert({
          id: connId,
          user_id: req.user.id,
          consent_id,
          purpose: "budget",
          member_id: member_id || "",
          status: "active",
          txn_count: totalImported,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
      }

      res.json({ imported: totalImported, duplicates: totalDupes, statements: Object.keys(bySource).length });
    } catch (e) { sendError(res, e); }
  });

  // GET /api/setu/connections
  // List saved connections (wealth + budget) for the current user
  router.get("/connections", auth, async (req, res) => {
    const { data, error } = await supabase
      .from("setu_connections")
      .select("*, setu_consents(status, data_range_from, data_range_to)")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connections: data || [] });
  });

  // DELETE /api/setu/connections/:id
  // Remove a saved connection (does NOT revoke the consent at Setu)
  router.delete("/connections/:id", auth, async (req, res) => {
    const { error } = await supabase.from("setu_connections").delete().eq("id", req.params.id).eq("user_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
}
