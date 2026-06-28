import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router = Router();

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET    = process.env.PLAID_SECRET;
const PLAID_ENV       = process.env.PLAID_ENV || "sandbox";
const PLAID_ENABLED   = !!(PLAID_CLIENT_ID && PLAID_SECRET);

let _plaidClient = null;
async function getPlaidClient() {
  if (_plaidClient) return _plaidClient;
  if (!PLAID_ENABLED) throw new Error("Plaid not configured");
  const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");
  const envMap = { sandbox: PlaidEnvironments.sandbox, development: PlaidEnvironments.development, production: PlaidEnvironments.production };
  _plaidClient = new PlaidApi(new Configuration({ basePath: envMap[PLAID_ENV] || PlaidEnvironments.sandbox, baseOptions: { headers: { "PLAID-CLIENT-ID": PLAID_CLIENT_ID, "PLAID-SECRET": PLAID_SECRET } } }));
  return _plaidClient;
}

function mapPlaidCategory(pfc) {
  if (!pfc) return "Uncategorised";
  const primary = (pfc.primary || "").toUpperCase();
  const map = { "FOOD_AND_DRINK": "Food & Dining", "TRANSPORTATION": "Transport", "SHOPPING": "Shopping", "ENTERTAINMENT": "Entertainment", "HEALTH_AND_FITNESS": "Health", "PERSONAL_CARE": "Personal Care", "RENT_AND_UTILITIES": "Housing & Bills", "HOME_IMPROVEMENT": "Housing & Bills", "TRAVEL": "Travel", "EDUCATION": "Education", "MEDICAL": "Health", "TRANSFER_IN": "Income", "TRANSFER_OUT": "Transfer", "INCOME": "Income", "BANK_FEES": "Other", "LOAN_PAYMENTS": "EMI / Loans", "GENERAL_MERCHANDISE": "Shopping", "GENERAL_SERVICES": "Other" };
  return map[primary] || "Uncategorised";
}

router.get("/status", auth, async (req, res) => {
  if (!PLAID_ENABLED) return res.json({ configured: false, env: PLAID_ENV });
  try {
    const { data: connections, error } = await supabase.from("plaid_connections").select("id, institution_name, accounts, last_synced, status, error_code").eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (error) return res.json({ configured: true, env: PLAID_ENV, connections: [], error: error.message });
    res.json({ configured: true, env: PLAID_ENV, connections: connections || [] });
  } catch (e) { res.json({ configured: false, env: PLAID_ENV, connections: [], error: e.message }); }
});

router.post("/link-token", auth, async (req, res) => {
  try {
    const plaid = await getPlaidClient();
    const response = await plaid.linkTokenCreate({ user: { client_user_id: req.user.id }, client_name: "WealthLens Hub", products: ["transactions"], country_codes: ["US"], language: "en" });
    res.json({ link_token: response.data.link_token, expiration: response.data.expiration });
  } catch (e) { res.status(500).json({ error: e?.response?.data?.error_message || e.message }); }
});

router.post("/exchange", auth, async (req, res) => {
  try {
    const { public_token, metadata } = req.body;
    if (!public_token) return res.status(400).json({ error: "public_token required" });
    const plaid = await getPlaidClient();
    const tokenResp = await plaid.itemPublicTokenExchange({ public_token });
    const access_token = tokenResp.data.access_token, item_id = tokenResp.data.item_id;
    const acctResp = await plaid.accountsGet({ access_token });
    const accounts = (acctResp.data.accounts || []).map(a => ({ account_id: a.account_id, name: a.name || a.official_name || "Account", type: a.type, subtype: a.subtype, mask: a.mask }));
    const connId = "plaid_" + Date.now().toString(36);
    const institution_name = metadata?.institution?.name || "US Bank";
    await supabase.from("plaid_connections").upsert({ id: connId, user_id: req.user.id, item_id, access_token: encrypt(access_token), institution_id: metadata?.institution?.institution_id || "", institution_name, accounts, status: "active", updated_at: new Date().toISOString() }, { onConflict: "id" });
    res.json({ ok: true, connection_id: connId, institution_name, accounts: accounts.map(a => ({ name: a.name, type: a.type, mask: a.mask })) });
  } catch (e) { res.status(500).json({ error: e?.response?.data?.error_message || e.message }); }
});

router.post("/sync/:connectionId", auth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from("plaid_connections").select("*").eq("id", req.params.connectionId).eq("user_id", req.user.id).single();
    if (!conn) return res.status(404).json({ error: "Connection not found" });
    const access_token = decrypt(conn.access_token);
    const plaid = await getPlaidClient();
    let cursor = conn.cursor || "", added = [], modified = [], removed = [], hasMore = true;
    while (hasMore) {
      const syncResp = await plaid.transactionsSync({ access_token, cursor: cursor || undefined, count: 500 });
      added = added.concat(syncResp.data.added || []);
      modified = modified.concat(syncResp.data.modified || []);
      removed = removed.concat(syncResp.data.removed || []);
      hasMore = syncResp.data.has_more;
      cursor = syncResp.data.next_cursor;
    }
    const now = new Date().toISOString();
    if (added.length > 0) {
      const stmtId = "plaid_stmt_" + Date.now().toString(36);
      const dates = added.map(t => t.date).filter(Boolean).sort();
      await supabase.from("budget_statements").insert({ id: stmtId, user_id: req.user.id, source: conn.institution_name || "Plaid", statement_type: "BANK", filename: `plaid_sync_${now.slice(0, 10)}`, file_size: 0, period_start: dates[0] || now.slice(0, 10), period_end: dates[dates.length - 1] || now.slice(0, 10), txn_count: added.length, notes: `Auto-synced via Plaid · ${added.length} new transactions` });
      const txns = added.map(t => ({ id: "ptxn_" + t.transaction_id, statement_id: stmtId, user_id: req.user.id, txn_date: t.date, description: encrypt(t.name || t.merchant_name || "Transaction"), amount: Math.abs(t.amount), txn_type: t.amount > 0 ? "DEBIT" : "CREDIT", category: mapPlaidCategory(t.personal_finance_category), raw_desc: encrypt(JSON.stringify({ merchant: t.merchant_name, plaid_category: t.personal_finance_category, payment_channel: t.payment_channel, account_id: t.account_id })), ref_number: t.transaction_id, currency: "USD" }));
      for (let i = 0; i < txns.length; i += 100) { const { error } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100)); if (error) console.error("Plaid txn insert batch error:", error.message); }
    }
    if (removed.length > 0) await supabase.from("budget_transactions").delete().in("id", removed.map(r => "ptxn_" + r.transaction_id));
    await supabase.from("plaid_connections").update({ cursor, last_synced: now, status: "active", error_code: null, updated_at: now }).eq("id", conn.id);
    res.json({ ok: true, added: added.length, modified: modified.length, removed: removed.length });
  } catch (e) {
    await supabase.from("plaid_connections").update({ status: "error", error_code: e?.response?.data?.error_code || e.message, updated_at: new Date().toISOString() }).eq("id", req.params.connectionId).eq("user_id", req.user.id);
    res.status(500).json({ error: e?.response?.data?.error_message || e.message });
  }
});

router.delete("/connections/:connectionId", auth, async (req, res) => {
  try {
    const { data: conn } = await supabase.from("plaid_connections").select("*").eq("id", req.params.connectionId).eq("user_id", req.user.id).single();
    if (!conn) return res.status(404).json({ error: "Connection not found" });
    try { const plaid = await getPlaidClient(); await plaid.itemRemove({ access_token: decrypt(conn.access_token) }); } catch { /* best effort */ }
    await supabase.from("plaid_connections").delete().eq("id", conn.id);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

if (PLAID_ENABLED) console.log(`Plaid: enabled (${PLAID_ENV})`);
else console.log("Plaid: disabled");

export default router;
