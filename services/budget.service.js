/**
 * services/budget.service.js — bank-statement import, transactions, categories,
 * and analytics. Descriptions/balances are encrypted at rest; decryption happens
 * only here when reading back.
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  xlsxBufferToCSV, autoCategorise, loadCategoriesForBulk, BANK_REGISTRY, parseCSV,
  extractPDFText, parseUSPDF, parseIndianPDF, parseDateForRegion, parseAmtBudget,
} from "../lib/parsers.js";
import { yahooFetch } from "../lib/prices.js";

const err = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, extra });
const stId = () => "bst_" + randomUUID().replace(/-/g, "").slice(0, 16);
const txId = () => "btx_" + randomUUID().replace(/-/g, "").slice(0, 16);

/**
 * Scan the full statement text (CSV/XLSX sheet text, including any preamble
 * rows like account-holder name/address, or extracted PDF text) for a family
 * member's name. Returns a confident single match, or the list of members
 * whose name appears (0 or 2+ — ambiguous) so the caller can ask the user.
 */
function detectMemberFromText(text, members) {
  if (!text || !members?.length) return { memberId: null, matches: [] };
  const lower = text.toLowerCase();
  const matches = members.filter(m => m.name && m.name.trim().length > 2 && lower.includes(m.name.trim().toLowerCase()));
  return { memberId: matches.length === 1 ? matches[0].id : null, matches };
}

/** Parse + persist a bank statement upload. Throws {status,extra} on bad input.
 *  If body.dry_run === "true", parses and reports diagnostics without writing
 *  anything to the DB — this is what the "Check this file first" debug tool uses,
 *  so a future statement that doesn't parse can be diagnosed (wrong header row
 *  detected, wrong bank, dates not recognized, etc.) without guesswork. */
export async function uploadStatement(userId, file, body, isProd) {
  const { source, statement_type, notes, bank_key, member_id: memberIdInput } = body;
  const dryRun = body.dry_run === "true" || body.dry_run === true;
  const id = stId();
  const ext = file.originalname.split(".").pop().toLowerCase();
  const bankInfo = BANK_REGISTRY[bank_key] || BANK_REGISTRY.auto;
  let region = bankInfo.region;

  let rawRows = [];
  let rawText = ""; // full statement text, used for member auto-detection below
  let detectedBankKey = null, headerRow = null, headerRowIdx = -1;
  try {
    if (ext === "csv" || ext === "txt") {
      rawText = file.buffer.toString("utf8");
      const { rows, detectedBank, headerRow: hr, headerRowIdx: hi } = parseCSV(rawText, bank_key, statement_type);
      rawRows = rows; detectedBankKey = detectedBank; headerRow = hr; headerRowIdx = hi;
      if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
    } else if (ext === "xlsx") {
      rawText = await xlsxBufferToCSV(file.buffer);
      const { rows, detectedBank, headerRow: hr, headerRowIdx: hi } = parseCSV(rawText, bank_key, statement_type);
      rawRows = rows; detectedBankKey = detectedBank; headerRow = hr; headerRowIdx = hi;
      if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
    } else if (ext === "xls") {
      throw err("Legacy .xls format is not supported. Please open in Excel and save as .xlsx, then retry.", 400);
    } else if (ext === "pdf") {
      const { text: pdfText } = await extractPDFText(file.buffer);
      rawText = pdfText;
      const usRows = parseUSPDF(pdfText), inRows = parseIndianPDF(pdfText);
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

  // Diagnostics returned by the dry-run debug tool (and attached to real failures
  // below) — the header row that was matched is the single most useful clue when
  // a statement doesn't parse, since a wrong header row silently corrupts every
  // column downstream (this is exactly what broke on Axis's credit-card export).
  const diag = () => ({
    detected_bank: detectedBankKey || bank_key || null, region,
    header_row_index: headerRowIdx, header_row: headerRow,
    rows_parsed: rawRows.length, sample_raw_rows: rawRows.slice(0, 5),
  });

  if (!rawRows.length && (!bank_key || bank_key === "auto")) {
    if (dryRun) return { ok: false, dry_run: true, error: "Could not auto-detect bank format.", ...diag() };
    throw err("Could not auto-detect bank format. Please select your bank from the dropdown and try again.", 400, { code: "BANK_DETECT_FAILED" });
  }
  if (!rawRows.length) {
    if (dryRun) return { ok: false, dry_run: true, error: "No transactions found.", ...diag() };
    throw err(`No transactions found (ext=${ext}, bank=${bank_key}, region=${region}).`, 400);
  }

  // Load categories once — avoids N+1 DB query (one per transaction)
  const catList = await loadCategoriesForBulk(userId);

  const txns = [];
  let periodStart = null, periodEnd = null, skippedNoDate = 0, skippedNoAmt = 0, skippedNoDesc = 0;
  for (const row of rawRows) {
    const date = parseDateForRegion(row.date, region);
    if (!date) { skippedNoDate++; continue; }
    const debit = Math.abs(parseAmtBudget(row.debit)), credit = Math.abs(parseAmtBudget(row.credit));
    if (debit === 0 && credit === 0) { skippedNoAmt++; continue; }
    const desc = String(row.desc || "").trim();
    if (!desc) { skippedNoDesc++; continue; }
    const category = autoCategorise(desc, catList);
    const amount   = debit > 0 ? debit : credit;
    const txnType  = debit > 0 ? "DEBIT" : "CREDIT";
    const currency = region === "US" ? "USD" : "INR";
    // fingerprint for dedup: date|amount|type|first-30-chars-of-desc
    const fingerprint = `${date}|${amount}|${txnType}|${desc.toLowerCase().slice(0, 30)}`;
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;
    txns.push({
      id: txId(), statement_id: id, user_id: userId, txn_date: date,
      description: encrypt(desc), raw_desc: encrypt(desc),
      search_text: desc.toLowerCase(),   // plaintext index for ilike search
      fingerprint,
      amount, txn_type: txnType, category,
      balance: row.balance ? encrypt(String(row.balance)) : null,
      ref_number: (row.ref || "").slice(0, 50),
      currency,
    });
  }
  if (!txns.length) {
    const extra = { rawSample: rawRows[0] || null, skipped_no_date: skippedNoDate, skipped_no_amt: skippedNoAmt, skipped_no_desc: skippedNoDesc, ...diag() };
    if (dryRun) return { ok: false, dry_run: true, error: "Parsed rows but none converted to transactions.", ...extra };
    throw err(`Parsed ${rawRows.length} rows but none converted to transactions. Skipped: ${skippedNoDate} bad dates, ${skippedNoAmt} zero amounts, ${skippedNoDesc} empty descriptions. Region: ${region}`, 400, extra);
  }

  if (dryRun) {
    // Report what WOULD happen — including duplicate-detection — without writing anything.
    const fingerprints = txns.map(t => t.fingerprint);
    const { data: existing } = await supabase.from("budget_transactions").select("fingerprint").eq("user_id", userId).in("fingerprint", fingerprints);
    const existingFps = new Set((existing || []).map(r => r.fingerprint));
    const wouldImport = txns.filter(t => !existingFps.has(t.fingerprint));
    return {
      ok: true, dry_run: true, ...diag(),
      would_import_count: wouldImport.length, would_skip_duplicate_count: txns.length - wouldImport.length,
      skipped_no_date: skippedNoDate, skipped_no_amt: skippedNoAmt, skipped_no_desc: skippedNoDesc,
      sample_transactions: wouldImport.slice(0, 8).map(t => ({ date: t.txn_date, amount: t.amount, type: t.txn_type, category: t.category })),
      period_start: periodStart, period_end: periodEnd,
    };
  }

  // ── Dedup: skip transactions already imported for this user ──
  const fingerprints = txns.map(t => t.fingerprint);
  const { data: existing } = await supabase
    .from("budget_transactions")
    .select("fingerprint")
    .eq("user_id", userId)
    .in("fingerprint", fingerprints);
  const existingFps = new Set((existing || []).map(r => r.fingerprint));
  const newTxns     = txns.filter(t => !existingFps.has(t.fingerprint));
  const skippedDups = txns.length - newTxns.length;

  // ── Member assignment: explicit choice wins; otherwise try to auto-detect the
  // account holder's name from the statement text; otherwise leave unassigned
  // and tell the caller so the UI can prompt.
  const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const members = portfolioRow?.members || [];
  let memberId = null, memberAutoDetected = false, memberCandidates = [];
  if (memberIdInput && members.some(m => m.id === memberIdInput)) {
    memberId = memberIdInput;
  } else if (members.length) {
    const detection = detectMemberFromText(rawText, members);
    if (detection.memberId) { memberId = detection.memberId; memberAutoDetected = true; }
    else if (members.length > 1) memberCandidates = (detection.matches.length ? detection.matches : members).map(m => ({ id: m.id, name: m.name }));
  }

  await supabase.from("budget_statements").delete().eq("user_id", userId).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());
  const { error: stErr } = await supabase.from("budget_statements").insert({
    user_id: userId, id, source: source || bankInfo.label || "Unknown",
    statement_type: statement_type || "BANK", filename: file.originalname, file_size: file.size,
    period_start: periodStart, period_end: periodEnd, txn_count: newTxns.length, notes: notes || "", region: region || "AUTO",
    member_id: memberId,
  });
  if (stErr) throw new Error(stErr.message);
  for (let i = 0; i < newTxns.length; i += 100) {
    const { error: txErr } = await supabase.from("budget_transactions").insert(newTxns.slice(i, i + 100));
    if (txErr) console.error("Batch insert error:", txErr.message);
  }
  return {
    ok: true, statement_id: id, txn_count: newTxns.length, skipped_duplicates: skippedDups,
    period_start: periodStart, period_end: periodEnd, region, bank: bank_key || "auto",
    member_id: memberId, member_auto_detected: memberAutoDetected,
    needs_member_assignment: !memberId && members.length > 1,
    member_candidates: memberCandidates,
  };
}

/** Assign (or reassign) which family member a statement belongs to. */
export async function updateStatementMember(userId, id, memberId) {
  const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const members = portfolioRow?.members || [];
  if (memberId && !members.some(m => m.id === memberId)) throw err("Unknown member_id", 400);
  const { error } = await supabase.from("budget_statements").update({ member_id: memberId || null }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Bank/region registry for the import form's dropdowns — single source of truth
 *  shared with the parser, so the UI can never offer a bank the parser doesn't know. */
export function listBanks() {
  return Object.entries(BANK_REGISTRY).map(([key, v]) => ({ key, ...v }));
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
  const { statement_id, category, month, search, from, limit } = query;
  let q = supabase.from("budget_transactions").select("*").eq("user_id", userId).order("txn_date", { ascending: false });
  if (statement_id) q = q.eq("statement_id", statement_id);
  if (category && category !== "All") q = q.eq("category", category);
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // correct last day for any month
    q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-${String(lastDay).padStart(2, "0")}`);
  } else if (from) {
    q = q.gte("txn_date", from);
  }
  // search_text is a plaintext index column; supports ilike without decrypting description
  if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);
  const maxRows = Math.min(Number(limit) || 500, 2000);
  q = q.limit(maxRows);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((t) => ({ ...t, description: decrypt(t.description), balance: t.balance ? decrypt(t.balance) : null }));
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
  // Returns system defaults (user_id IS NULL) + user's own categories (user_id = userId)
  const { data, error } = await supabase
    .from("budget_categories")
    .select("*")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("name");
  if (error) throw new Error(error.message);
  return data || [];
}
export async function createCategory(userId, name, keywords, icon, color, monthly_limit) {
  const id = "cat_" + Date.now().toString(36);
  const row = { id, user_id: userId, name, keywords: keywords || "" };
  if (icon          !== undefined) row.icon          = icon;
  if (color         !== undefined) row.color         = color;
  if (monthly_limit !== undefined) row.monthly_limit = Number(monthly_limit) || 0;
  const { error } = await supabase.from("budget_categories").insert(row);
  if (error) throw new Error(error.message);
  return { ok: true, id };
}
export async function updateCategory(userId, id, name, keywords, icon, color, monthly_limit) {
  const patch = {};
  if (name          !== undefined) patch.name          = name;
  if (keywords      !== undefined) patch.keywords      = keywords;
  if (icon          !== undefined) patch.icon          = icon;
  if (color         !== undefined) patch.color         = color;
  if (monthly_limit !== undefined) patch.monthly_limit = Number(monthly_limit) || 0;
  // Only allow editing user-owned categories (user_id = userId); system defaults (NULL) are read-only
  const { error } = await supabase
    .from("budget_categories")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
export async function deleteCategory(userId, id) {
  // Only allow deleting user-owned categories; system defaults are protected
  await supabase.from("budget_categories").delete().eq("id", id).eq("user_id", userId);
  return { ok: true };
}

export async function analytics(userId, month, { from: rangeFrom, to: rangeTo } = {}) {
  // Determine date range for KPI totals
  let qFrom, qTo;
  if (month) {
    qFrom = `${month}-01`;
    qTo   = `${month}-31`;
  } else if (rangeFrom) {
    qFrom = rangeFrom;
    qTo   = rangeTo || new Date().toISOString().slice(0, 10);
  } else if (rangeFrom === null && rangeTo === null) {
    // Explicit "all time" — no date filter
    qFrom = null;
    qTo   = null;
  } else {
    // Legacy default: last 30 days
    qFrom = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    qTo   = new Date().toISOString().slice(0, 10);
  }

  let kpiQuery = supabase.from("budget_transactions").select("amount, txn_type, category, txn_date").eq("user_id", userId);
  if (qFrom) kpiQuery = kpiQuery.gte("txn_date", qFrom);
  if (qTo)   kpiQuery = kpiQuery.lte("txn_date", qTo);
  const { data: txns } = await kpiQuery;

  const byCategory = {}; let totalDebit = 0, totalCredit = 0;
  for (const t of txns || []) {
    if (t.txn_type === "DEBIT") { totalDebit += t.amount; byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; }
    else totalCredit += t.amount;
  }

  // Monthly spending trend (last 6 months, debit only — for existing Budget tab)
  const { data: allTxns } = await supabase.from("budget_transactions").select("amount, txn_type, txn_date").eq("user_id", userId).gte("txn_date", new Date(Date.now() - 180 * 24 * 3600_000).toISOString().slice(0, 10)).eq("txn_type", "DEBIT");
  const monthly = {};
  for (const t of allTxns || []) { const mo = t.txn_date.slice(0, 7); monthly[mo] = (monthly[mo] || 0) + t.amount; }

  // Dual cashflow trend (last 12 months, both debit + credit — for Budget 2 chart)
  const { data: cfTxns } = await supabase.from("budget_transactions").select("amount, txn_type, txn_date").eq("user_id", userId).gte("txn_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString().slice(0, 10));
  const cashflow = {}; // { "YYYY-MM": { debit, credit } }
  for (const t of cfTxns || []) {
    const mo = t.txn_date.slice(0, 7);
    if (!cashflow[mo]) cashflow[mo] = { debit: 0, credit: 0 };
    if (t.txn_type === "DEBIT") cashflow[mo].debit += t.amount;
    else cashflow[mo].credit += t.amount;
  }

  return { byCategory, totalDebit, totalCredit, monthly, cashflow };
}

// ── Goals (Budget 2) ──────────────────────────────────────────────

export async function listGoals(userId) {
  const { data } = await supabase.from("budget_goals").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  return data || [];
}

export async function createGoal(userId, { name, target, saved, due_date, note, color, icon }) {
  const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabase.from("budget_goals").insert({
    id, user_id: userId, name: String(name).slice(0, 100),
    target: Number(target) || 0, saved: Number(saved) || 0,
    due_date: due_date || null, note: String(note || "").slice(0, 500),
    color: color || "#c9a84c", icon: icon || "🎯",
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateGoal(userId, id, patch) {
  const allowed = ["name", "target", "saved", "due_date", "note", "color", "icon"];
  const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if (safe.name)   safe.name   = String(safe.name).slice(0, 100);
  if (safe.target) safe.target = Number(safe.target) || 0;
  if (safe.saved)  safe.saved  = Number(safe.saved)  || 0;
  safe.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("budget_goals").update(safe).eq("id", id).eq("user_id", userId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteGoal(userId, id) {
  const { error } = await supabase.from("budget_goals").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
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
      const catList = await loadCategoriesForBulk(userId);
      const txns = []; let periodStart = null, periodEnd = null;
      for (const row of rawRows) {
        const date = parseDateForRegion(row.date, region);
        if (!date) continue;
        const debit = Math.abs(parseAmtBudget(row.debit)), credit = Math.abs(parseAmtBudget(row.credit));
        if (debit === 0 && credit === 0) continue;
        const desc = String(row.desc || "").trim(); if (!desc) continue;
        const category = autoCategorise(desc, catList);
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
