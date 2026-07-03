/**
 * services/budget.service.js — bank-statement import, transactions, categories,
 * and analytics. Descriptions/balances are encrypted at rest; decryption happens
 * only here when reading back.
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  xlsxBufferToCSV, autoCategorise, BANK_REGISTRY, parseCSV,
  extractPDFText, parseUSPDF, parseIndianPDF, parseDateForRegion, parseAmtBudget,
} from "../lib/parsers.js";
import { yahooFetch } from "../lib/prices.js";

const err = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, extra });
const stId = () => "bst_" + randomUUID().replace(/-/g, "").slice(0, 16);
const txId = () => "btx_" + randomUUID().replace(/-/g, "").slice(0, 16);

/** Parse + persist a bank statement upload. Throws {status,extra} on bad input. */
export async function uploadStatement(userId, file, body, isProd) {
  const { source, statement_type, notes, bank_key } = body;
  const id = stId();
  const ext = file.originalname.split(".").pop().toLowerCase();
  const bankInfo = BANK_REGISTRY[bank_key] || BANK_REGISTRY.auto;
  let region = bankInfo.region;

  let rawRows = [];
  try {
    if (ext === "csv" || ext === "txt") {
      const { rows, detectedBank } = parseCSV(file.buffer.toString("utf8"), bank_key);
      rawRows = rows;
      if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
    } else if (ext === "xlsx") {
      const { rows, detectedBank } = parseCSV(await xlsxBufferToCSV(file.buffer), bank_key);
      rawRows = rows;
      if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
    } else if (ext === "xls") {
      throw err("Legacy .xls format is not supported. Please open in Excel and save as .xlsx, then retry.", 400);
    } else if (ext === "pdf") {
      const { text: rawText } = await extractPDFText(file.buffer);
      const usRows = parseUSPDF(rawText), inRows = parseIndianPDF(rawText);
      if (region === "US") rawRows = usRows.length ? usRows : inRows;
      else if (region === "IN") rawRows = inRows.length ? inRows : usRows;
      else { rawRows = usRows.length >= inRows.length ? usRows : inRows; region = usRows.length >= inRows.length ? "US" : "IN"; }
      if (rawRows.length === 0) throw err(`PDF parsed 0 rows (ext=${ext}, bank=${bank_key}, region=${region}). Debug: US=${usRows.length}, IN=${inRows.length}.`, 400, { usRows: usRows.length, inRows: inRows.length });
    } else {
      throw err("Unsupported format. Use CSV, XLSX, or PDF.", 400);
    }
  } catch (e) {
    if (e.status) throw e;
    throw err(isProd ? "Failed to parse file" : "Parse error: " + e.message, 400);
  }

  if (!rawRows.length && (!bank_key || bank_key === "auto")) throw err("Could not auto-detect bank format. Please select your bank from the dropdown and try again.", 400, { code: "BANK_DETECT_FAILED" });
  if (!rawRows.length) throw err(`No transactions found (ext=${ext}, bank=${bank_key}, region=${region}).`, 400);

  const txns = [];
  let periodStart = null, periodEnd = null, skippedNoDate = 0, skippedNoAmt = 0, skippedNoDesc = 0;
  for (const row of rawRows) {
    const date = parseDateForRegion(row.date, region);
    if (!date) { skippedNoDate++; continue; }
    const debit = Math.abs(parseAmtBudget(row.debit)), credit = Math.abs(parseAmtBudget(row.credit));
    if (debit === 0 && credit === 0) { skippedNoAmt++; continue; }
    const desc = String(row.desc || "").trim();
    if (!desc) { skippedNoDesc++; continue; }
    const category = await autoCategorise(desc);
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;
    txns.push({
      id: txId(), statement_id: id, user_id: userId, txn_date: date,
      description: encrypt(desc), raw_desc: encrypt(desc),
      amount: debit > 0 ? debit : credit, txn_type: debit > 0 ? "DEBIT" : "CREDIT", category,
      balance: row.balance ? encrypt(String(row.balance)) : null,
      ref_number: (row.ref || "").slice(0, 50),
      currency: region === "US" ? "USD" : region === "IN" ? "INR" : "USD",
    });
  }
  if (!txns.length) throw err(`Parsed ${rawRows.length} rows but none converted to transactions. Skipped: ${skippedNoDate} bad dates, ${skippedNoAmt} zero amounts, ${skippedNoDesc} empty descriptions. Region: ${region}`, 400, { rawSample: rawRows[0] || null });

  await supabase.from("budget_statements").delete().eq("user_id", userId).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());
  const { error: stErr } = await supabase.from("budget_statements").insert({
    user_id: userId, id, source: source || bankInfo.label || "Unknown",
    statement_type: statement_type || "BANK", filename: file.originalname, file_size: file.size,
    period_start: periodStart, period_end: periodEnd, txn_count: txns.length, notes: notes || "", region: region || "AUTO",
  });
  if (stErr) throw new Error(stErr.message);
  for (let i = 0; i < txns.length; i += 100) {
    const { error: txErr } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100));
    if (txErr) console.error("Batch insert error:", txErr.message);
  }
  return { ok: true, statement_id: id, txn_count: txns.length, period_start: periodStart, period_end: periodEnd, region, bank: bank_key || "auto" };
}

export async function listStatements(userId) {
  const { data, error } = await supabase.from("budget_statements").select("*").eq("user_id", userId).order("upload_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function deleteStatement(userId, id) {
  await supabase.from("budget_statements").delete().eq("id", id).eq("user_id", userId);
  return { ok: true };
}

export async function listTransactions(userId, query) {
  const { statement_id, category, month, search } = query;
  let q = supabase.from("budget_transactions").select("*").eq("user_id", userId).order("txn_date", { ascending: false });
  if (statement_id) q = q.eq("statement_id", statement_id);
  if (category && category !== "All") q = q.eq("category", category);
  if (month) q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-31`);
  q = q.limit(1000);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const decrypted = (data || []).map((t) => ({ ...t, description: decrypt(t.description), balance: t.balance ? decrypt(t.balance) : null }));
  return search ? decrypted.filter((t) => t.description.toLowerCase().includes(search.toLowerCase())) : decrypted;
}
export async function setTxnCategory(userId, id, category) {
  const { error } = await supabase.from("budget_transactions").update({ category }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
export async function recategorise(userId, ids, category) {
  const { error } = await supabase.from("budget_transactions").update({ category }).in("id", ids).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true, updated: ids.length };
}

export async function listCategories(userId) {
  const { data, error } = await supabase.from("budget_categories").select("*").eq("user_id", userId).order("name");
  if (error) throw new Error(error.message);
  return data || [];
}
export async function createCategory(userId, name, keywords) {
  const id = "cat_" + Date.now().toString(36);
  const { error } = await supabase.from("budget_categories").insert({ id, user_id: userId, name, keywords: keywords || "" });
  if (error) throw new Error(error.message);
  return { ok: true, id };
}
export async function updateCategory(userId, id, name, keywords) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (keywords !== undefined) patch.keywords = keywords;
  const { error } = await supabase.from("budget_categories").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
export async function deleteCategory(userId, id) {
  await supabase.from("budget_categories").delete().eq("id", id).eq("user_id", userId);
  return { ok: true };
}

export async function analytics(userId, month) {
  const from = month ? `${month}-01` : new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const to = month ? `${month}-31` : new Date().toISOString().slice(0, 10);
  const { data: txns } = await supabase.from("budget_transactions").select("amount, txn_type, category, txn_date").eq("user_id", userId).gte("txn_date", from).lte("txn_date", to);
  const byCategory = {}; let totalDebit = 0, totalCredit = 0;
  for (const t of txns || []) {
    if (t.txn_type === "DEBIT") { totalDebit += t.amount; byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; }
    else totalCredit += t.amount;
  }
  const { data: allTxns } = await supabase.from("budget_transactions").select("amount, txn_type, txn_date").eq("user_id", userId).gte("txn_date", new Date(Date.now() - 180 * 24 * 3600_000).toISOString().slice(0, 10)).eq("txn_type", "DEBIT");
  const monthly = {};
  for (const t of allTxns || []) { const mo = t.txn_date.slice(0, 7); monthly[mo] = (monthly[mo] || 0) + t.amount; }
  return { byCategory, totalDebit, totalCredit, monthly };
}

export async function benchmark(period = "1Y") {
  const range = ({ "1Y": "1y", "3Y": "3y", "5Y": "5y", ALL: "10y" })[period] || "1y";
  const fetchSeries = async (symbol) => {
    const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1mo&range=${range}`);
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const ts = result.timestamp || [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 7), value: closes[i] })).filter((p) => p.value != null);
  };
  const [nifty, sp500] = await Promise.all([fetchSeries("^NSEI"), fetchSeries("^GSPC")]);
  const normalize = (s) => { if (!s.length) return []; const base = s[0].value; return s.map((p) => ({ date: p.date, value: p.value, pct: +(((p.value - base) / base) * 100).toFixed(2) })); };
  return { nifty50: normalize(nifty), sp500: normalize(sp500), period, fetchedAt: new Date().toISOString() };
}

/** Developer diagnostic: inspect PDF parsing, optionally importing the rows. */
export async function debugPdf(userId, file, body) {
  const { text: rawText } = await extractPDFText(file.buffer);
  const usRows = parseUSPDF(rawText), inRows = parseIndianPDF(rawText);
  const lines = rawText.split("\n");
  const sampleLines = lines.slice(0, 80);
  const sectionHeaders = lines.filter((l) => /deposits?\s+and|withdrawals?\s+and|checks?\s+paid|daily\s*balance|ending\s*balance|beginning\s*balance/i.test(l));
  const dateLines = lines.filter((l) => /^\s*\d{1,2}\/\d{1,2}/.test(l)).slice(0, 20);
  const rawRows = usRows.length >= inRows.length ? usRows : inRows;
  const region = usRows.length >= inRows.length ? "US" : "IN";
  let imported = 0, importError = null;
  if (rawRows.length > 0 && body && body !== "debug_only") {
    try {
      const id = stId();
      const txns = []; let periodStart = null, periodEnd = null;
      for (const row of rawRows) {
        const date = parseDateForRegion(row.date, region);
        if (!date) continue;
        const debit = Math.abs(parseAmtBudget(row.debit)), credit = Math.abs(parseAmtBudget(row.credit));
        if (debit === 0 && credit === 0) continue;
        const desc = String(row.desc || "").trim(); if (!desc) continue;
        const category = await autoCategorise(desc);
        if (!periodStart || date < periodStart) periodStart = date;
        if (!periodEnd || date > periodEnd) periodEnd = date;
        txns.push({ id: txId(), statement_id: id, user_id: userId, txn_date: date, description: encrypt(desc), raw_desc: encrypt(desc), amount: debit > 0 ? debit : credit, txn_type: debit > 0 ? "DEBIT" : "CREDIT", category, balance: row.balance ? encrypt(String(row.balance)) : null, ref_number: (row.ref || "").slice(0, 50), currency: "USD" });
      }
      if (txns.length > 0) {
        await supabase.from("budget_statements").delete().eq("user_id", userId).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());
        await supabase.from("budget_statements").insert({ user_id: userId, id, source: "Bank of America (debug)", statement_type: "BANK", filename: file.originalname, file_size: file.size, period_start: periodStart, period_end: periodEnd, txn_count: txns.length, notes: "Imported via debug endpoint", region: "US" });
        for (let i = 0; i < txns.length; i += 100) { const { error } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100)); if (error) importError = error.message; }
        imported = txns.length;
      }
    } catch (ie) { importError = ie.message; }
  }
  return { pages: undefined, totalChars: rawText.length, totalLines: lines.length, usRowsParsed: usRows.length, inRowsParsed: inRows.length, sectionHeaders, dateLines, first80Lines: sampleLines, usRowsSample: usRows.slice(0, 5), inRowsSample: inRows.slice(0, 5), imported, importError };
}
