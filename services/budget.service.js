/**
 * services/budget.service.js — bank-statement import, transactions, categories,
 * and analytics. Descriptions/balances are encrypted at rest; decryption happens
 * only here when reading back.
 */
import { randomUUID } from "crypto";
import { supabase, describeDbError } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  xlsxBufferToCSV, autoCategorise, loadCategoriesForBulk, BANK_REGISTRY, parseCSV,
  extractPDFText, parseUSPDF, parseIndianPDF, parseDateForRegion, parseAmtBudget,
} from "../lib/parsers.js";
import { yahooFetch } from "../lib/prices.js";

const err = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, extra });
const stId = () => "bst_" + randomUUID().replace(/-/g, "").slice(0, 16);
const txId = () => "btx_" + randomUUID().replace(/-/g, "").slice(0, 16);
const aliasId = () => "baa_" + randomUUID().replace(/-/g, "").slice(0, 16);

/** True if `name` appears in `lower` at least once WITHOUT being immediately
 *  preceded by a "C/O"/"Care Of" address marker. A name that only shows up as
 *  "C O <name>" in a mailing address (e.g. "KOLISETTY PRIYANKA C O TALLAM
 *  AVINASH") is someone else's statement being routed via that person, not
 *  proof they're the account holder — counting it as a match would silently
 *  mis-assign the statement. */
export function nameAppearsAsHolder(lower, name) {
  let idx = -1;
  while ((idx = lower.indexOf(name, idx + 1)) !== -1) {
    const before = lower.slice(Math.max(0, idx - 15), idx);
    if (!/\bc\s*\/?\s*o\s*$|care\s+of\s*$/i.test(before)) return true;
  }
  return false;
}

/**
 * Scan the full statement text (CSV/XLSX sheet text, including any preamble
 * rows like account-holder name/address, or extracted PDF text) for a family
 * member's name. Returns a confident single match, or the list of members
 * whose name appears (0 or 2+ — ambiguous) so the caller can ask the user.
 * This is a fallback signal only — lookupAccountAlias (last-4-digits →
 * member) is tried first and is far more reliable once it's been confirmed
 * once for a given card/account.
 */
export function detectMemberFromText(text, members) {
  if (!text || !members?.length) return { memberId: null, matches: [] };
  const lower = text.toLowerCase();
  const matches = members.filter(m => m.name && m.name.trim().length > 2 && nameAppearsAsHolder(lower, m.name.trim().toLowerCase()));
  return { memberId: matches.length === 1 ? matches[0].id : null, matches };
}

/** Pull the last 4 digits of a masked card/account number out of statement
 *  text, e.g. "5305XXXXXXXX4371" → "4371", "A/c No. XXXXXXXX1234" → "1234",
 *  "...ending in 4371" → "4371". Returns null if nothing recognizable is found
 *  (very common for plain bank-account exports with no card number at all). */
export function extractLast4(text) {
  if (!text) return null;
  const masked = text.match(/[Xx*]{4,}\s*(\d{4})\b/);
  if (masked) return masked[1];
  const ending = text.match(/ending\s*(?:in|with)?\s*[:\-]?\s*(\d{4})\b/i);
  if (ending) return ending[1];
  return null;
}

/** Look up a previously-confirmed card/account → member mapping. Degrades
 *  gracefully (returns null, falls through to text-based detection) if
 *  budget_account_aliases doesn't exist yet — but logs clearly so a missing
 *  migration shows up in the server log instead of silently never firing. */
async function lookupAccountAlias(userId, bankKey, last4) {
  if (!last4) return null;
  const { data, error } = await supabase.from("budget_account_aliases").select("member_id")
    .eq("user_id", userId).eq("bank_key", bankKey || "").eq("last4", last4).maybeSingle();
  if (error) { console.error("lookupAccountAlias:", describeDbError(error).friendly); return null; }
  return data?.member_id || null;
}

/** Save (or refresh) a card/account → member mapping so future imports from
 *  the same card/account auto-assign without needing to re-detect anything. */
async function saveAccountAlias(userId, bankKey, last4, memberId) {
  if (!last4 || !memberId) return;
  const { data: existing, error: selErr } = await supabase.from("budget_account_aliases").select("id,member_id")
    .eq("user_id", userId).eq("bank_key", bankKey || "").eq("last4", last4).maybeSingle();
  if (selErr) { console.error("saveAccountAlias (select):", describeDbError(selErr).friendly); return; }
  if (existing) {
    if (existing.member_id !== memberId) {
      const { error } = await supabase.from("budget_account_aliases").update({ member_id: memberId, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) console.error("saveAccountAlias (update):", describeDbError(error).friendly);
    }
    return;
  }
  const { error } = await supabase.from("budget_account_aliases").insert({ id: aliasId(), user_id: userId, bank_key: bankKey || "", last4, member_id: memberId });
  if (error) console.error("saveAccountAlias (insert):", describeDbError(error).friendly);
}

/** Parse + persist a bank statement upload. Throws {status,extra} on bad input.
 *  If body.dry_run === "true", parses and reports diagnostics without writing
 *  anything to the DB — this is what the "Check this file first" debug tool uses,
 *  so a future statement that doesn't parse can be diagnosed (wrong header row
 *  detected, wrong bank, dates not recognized, etc.) without guesswork. */
export async function uploadStatement(userId, file, body, isProd) {
  const { source, statement_type, notes, bank_key, member_id: memberIdInput, pdf_password: pdfPassword } = body;
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
      const { text: pdfText } = await extractPDFText(file.buffer, pdfPassword);
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
    if (e.code === "PDF_PASSWORD_REQUIRED") throw err(e.message, 400, { code: "PDF_PASSWORD_REQUIRED", incorrect: !!e.incorrect });
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

  // ── Member assignment ──
  // Priority: (1) explicit choice from the user always wins, (2) a previously-
  // confirmed card/account fingerprint (last 4 digits) — far more reliable than
  // text matching since it can't be fooled by a "C/O" address line or a joint
  // holder's name, (3) name-substring matching over the statement text as a
  // last resort. Whichever way we land on a member, if this statement has a
  // last-4-digits we can extract and don't already have on file for them, save
  // it — so the NEXT statement from this same card/account auto-assigns via
  // (2) without needing (3) again.
  const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const members = portfolioRow?.members || [];
  const last4 = extractLast4(rawText);
  const effectiveBankKey = detectedBankKey || bank_key || "";
  let memberId = null, memberAutoDetected = false, memberCandidates = [];
  if (memberIdInput && members.some(m => m.id === memberIdInput)) {
    memberId = memberIdInput;
  } else if (members.length) {
    const aliasMemberId = await lookupAccountAlias(userId, effectiveBankKey, last4);
    if (aliasMemberId && members.some(m => m.id === aliasMemberId)) {
      memberId = aliasMemberId; memberAutoDetected = true;
    } else {
      const detection = detectMemberFromText(rawText, members);
      if (detection.memberId) { memberId = detection.memberId; memberAutoDetected = true; }
      else if (members.length > 1) memberCandidates = (detection.matches.length ? detection.matches : members).map(m => ({ id: m.id, name: m.name }));
    }
  }
  if (memberId && last4 && !dryRun) await saveAccountAlias(userId, effectiveBankKey, last4, memberId);

  await supabase.from("budget_statements").delete().eq("user_id", userId).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());
  const { error: stErr } = await supabase.from("budget_statements").insert({
    user_id: userId, id, source: source || bankInfo.label || "Unknown",
    statement_type: statement_type || "BANK", filename: file.originalname, file_size: file.size,
    period_start: periodStart, period_end: periodEnd, txn_count: newTxns.length, notes: notes || "", region: region || "AUTO",
    member_id: memberId, account_last4: last4 || null, bank_key: effectiveBankKey || null,
  });
  if (stErr) {
    const { isSchemaDrift, friendly } = describeDbError(stErr);
    const e2 = new Error(friendly);
    if (isSchemaDrift) e2.code = "SCHEMA_DRIFT";
    throw e2;
  }
  for (let i = 0; i < newTxns.length; i += 100) {
    const { error: txErr } = await supabase.from("budget_transactions").insert(newTxns.slice(i, i + 100));
    if (txErr) console.error("Batch insert error:", describeDbError(txErr).friendly);
  }
  return {
    ok: true, statement_id: id, txn_count: newTxns.length, skipped_duplicates: skippedDups,
    period_start: periodStart, period_end: periodEnd, region, bank: bank_key || "auto",
    member_id: memberId, member_auto_detected: memberAutoDetected,
    needs_member_assignment: !memberId && members.length > 1,
    member_candidates: memberCandidates,
  };
}

/** Assign (or reassign) which family member a statement belongs to. Manually
 *  fixing an unassigned/misassigned statement is exactly the "confirm once"
 *  moment budget_account_aliases exists for — if this statement has a card/
 *  account last-4 on file, seed (or correct) the alias so future imports from
 *  the same card/account auto-assign without needing to be fixed again. */
export async function updateStatementMember(userId, id, memberId) {
  const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const members = portfolioRow?.members || [];
  if (memberId && !members.some(m => m.id === memberId)) throw err("Unknown member_id", 400);
  const { data: stmt, error } = await supabase.from("budget_statements")
    .update({ member_id: memberId || null }).eq("id", id).eq("user_id", userId)
    .select("bank_key, account_last4").single();
  if (error) {
    const { isSchemaDrift, friendly } = describeDbError(error);
    const e2 = new Error(friendly);
    if (isSchemaDrift) e2.code = "SCHEMA_DRIFT";
    throw e2;
  }
  if (memberId && stmt?.account_last4) await saveAccountAlias(userId, stmt.bank_key || "", stmt.account_last4, memberId);
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

/** Re-run keyword-based auto-categorisation against a user's existing transactions.
 *  Needed for a common gap: transactions imported before any budget_categories rows
 *  existed (e.g. the default-category seed insert was never run against this
 *  Supabase project) all landed in "Other" — autoCategorise() has nothing to match
 *  against with 0 categories loaded. Seeding categories afterward only fixes *future*
 *  imports; this fixes the ones already sitting in the database. Only touches rows
 *  whose category is exactly "Other" by default, so manual recategorisations a user
 *  already made are never overwritten (pass onlyOther=false to re-run over every
 *  transaction, e.g. after adding new keywords to an existing category).
 *  Uses the plaintext `search_text` column (already stored for ilike search) instead
 *  of decrypting `description` for every row — much cheaper for a bulk pass. */
export async function recategoriseAll(userId, { onlyOther = true } = {}) {
  const catList = await loadCategoriesForBulk(userId);
  if (!catList.length) return { ok: false, error: "No categories found — seed default categories first.", updated: 0, scanned: 0 };

  let q = supabase.from("budget_transactions").select("id, search_text, category").eq("user_id", userId);
  if (onlyOther) q = q.eq("category", "Other");
  const { data: txns, error } = await q;
  if (error) throw new Error(error.message);

  const changes = [];
  for (const t of txns || []) {
    const newCat = autoCategorise(t.search_text || "", catList);
    if (newCat !== t.category) changes.push({ id: t.id, category: newCat });
  }

  // Group by target category so each batch is a single UPDATE ... WHERE id IN (...)
  // rather than one round-trip per transaction.
  const byCategory = {};
  for (const c of changes) (byCategory[c.category] ||= []).push(c.id);
  for (const [category, ids] of Object.entries(byCategory)) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: upErr } = await supabase.from("budget_transactions").update({ category }).in("id", ids.slice(i, i + 200)).eq("user_id", userId);
      if (upErr) throw new Error(upErr.message);
    }
  }
  return { ok: true, scanned: (txns || []).length, updated: changes.length };
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
export async function createCategory(userId, name, keywords, icon, color, monthly_limit, is_essential) {
  const id = "cat_" + Date.now().toString(36);
  const row = { id, user_id: userId, name, keywords: keywords || "" };
  if (icon          !== undefined) row.icon          = icon;
  if (color         !== undefined) row.color         = color;
  if (monthly_limit !== undefined) row.monthly_limit = Number(monthly_limit) || 0;
  if (is_essential !== undefined) row.is_essential = Boolean(is_essential);
  const { error } = await supabase.from("budget_categories").insert(row);
  if (error) throw new Error(error.message);
  return { ok: true, id };
}
export async function updateCategory(userId, id, name, keywords, icon, color, monthly_limit, is_essential) {
  const patch = {};
  if (name          !== undefined) patch.name          = name;
  if (keywords      !== undefined) patch.keywords      = keywords;
  if (icon          !== undefined) patch.icon          = icon;
  if (color         !== undefined) patch.color         = color;
  if (monthly_limit !== undefined) patch.monthly_limit = Number(monthly_limit) || 0;
  if (is_essential !== undefined) patch.is_essential = Boolean(is_essential);
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

// ── Family Budget — new service functions ─────────────────────────────────────
// These power the FamilyBudgetTab (Phases 1-5). They extend the existing budget
// service by adding member_id filtering (via statement join), merchant rollup,
// and recurring-transaction detection.

/** Resolve statement IDs that belong to a given member (or all statements for
 *  the user when memberId is falsy). Used to scope analytics + transactions to
 *  a specific family member without duplicating filter logic. */
async function resolveStatementIds(userId, memberId) {
  const q = supabase.from("budget_statements").select("id").eq("user_id", userId);
  if (memberId) {
    // Explicit member filter — only their statements
    const { data } = await q.eq("member_id", memberId);
    return (data || []).map(r => r.id);
  }
  // No filter — all statements; return null to signal "don't filter"
  return null;
}

/** Full analytics for FamilyBudget — supports member_id, custom date range,
 *  and returns both KPIs (totalDebit, totalCredit, savingsRate, byCategory)
 *  and trend data (monthly cashflow for 12 months, per-member comparison).
 *  The `memberId` param scopes everything through the statements join. */
export async function familyAnalytics(userId, memberId, month, { from: rangeFrom, to: rangeTo } = {}) {
  // Determine date window
  let qFrom, qTo;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    qFrom = `${month}-01`;
    qTo   = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else if (rangeFrom) {
    qFrom = rangeFrom;
    qTo   = rangeTo || new Date().toISOString().slice(0, 10);
  } else {
    // Default: current calendar month
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    qFrom = `${y}-${m}-01`;
    qTo   = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  }

  const stmtIds = await resolveStatementIds(userId, memberId);
  // If member has no statements yet, return empty result
  if (Array.isArray(stmtIds) && stmtIds.length === 0) {
    return { byCategory: {}, totalDebit: 0, totalCredit: 0, savingsRate: 0,
             monthly: {}, cashflow: {}, memberBreakdown: [], qFrom, qTo };
  }

  // KPI query for current window
  let kpiQ = supabase.from("budget_transactions").select("amount,txn_type,category").eq("user_id", userId);
  if (Array.isArray(stmtIds)) kpiQ = kpiQ.in("statement_id", stmtIds);
  if (qFrom) kpiQ = kpiQ.gte("txn_date", qFrom);
  if (qTo)   kpiQ = kpiQ.lte("txn_date", qTo);
  const { data: kpiTxns } = await kpiQ;

  const byCategory = {}; let totalDebit = 0, totalCredit = 0;
  for (const t of kpiTxns || []) {
    if (t.txn_type === "DEBIT") {
      totalDebit += t.amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    } else {
      totalCredit += t.amount;
    }
  }
  const savingsRate = totalCredit > 0 ? Math.max(0, ((totalCredit - totalDebit) / totalCredit) * 100) : 0;

  // 12-month cashflow trend
  const cfFrom = new Date(Date.now() - 365 * 24 * 3600_000).toISOString().slice(0, 10);
  let cfQ = supabase.from("budget_transactions").select("amount,txn_type,txn_date").eq("user_id", userId).gte("txn_date", cfFrom);
  if (Array.isArray(stmtIds)) cfQ = cfQ.in("statement_id", stmtIds);
  const { data: cfTxns } = await cfQ;
  const cashflow = {}, monthly = {};
  for (const t of cfTxns || []) {
    const mo = t.txn_date.slice(0, 7);
    if (!cashflow[mo]) cashflow[mo] = { debit: 0, credit: 0 };
    if (t.txn_type === "DEBIT") { cashflow[mo].debit += t.amount; monthly[mo] = (monthly[mo] || 0) + t.amount; }
    else cashflow[mo].credit += t.amount;
  }

  // Per-member breakdown (only when viewing "All")
  let memberBreakdown = [];
  if (!memberId) {
    const { data: portfolioRow } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
    const members = portfolioRow?.members || [];
    for (const mem of members) {
      const mIds = await resolveStatementIds(userId, mem.id);
      if (!mIds || mIds.length === 0) continue;
      let mQ = supabase.from("budget_transactions").select("amount,txn_type").eq("user_id", userId).in("statement_id", mIds);
      if (qFrom) mQ = mQ.gte("txn_date", qFrom);
      if (qTo)   mQ = mQ.lte("txn_date", qTo);
      const { data: mTxns } = await mQ;
      let mDebit = 0, mCredit = 0;
      for (const t of mTxns || []) { if (t.txn_type === "DEBIT") mDebit += t.amount; else mCredit += t.amount; }
      if (mDebit > 0 || mCredit > 0) memberBreakdown.push({ id: mem.id, name: mem.name, avatar: mem.avatar, debit: mDebit, credit: mCredit });
    }
  }

  return { byCategory, totalDebit, totalCredit, savingsRate, monthly, cashflow, memberBreakdown, qFrom, qTo };
}

/** Transactions endpoint for FamilyBudget — same as listTransactions but adds
 *  member_id filtering via statement join, and accepts an `offset` for pagination. */
export async function familyTransactions(userId, query) {
  const { member_id, category, month, search, from, limit, offset } = query;
  const stmtIds = await resolveStatementIds(userId, member_id || null);
  if (Array.isArray(stmtIds) && stmtIds.length === 0) return [];

  let q = supabase.from("budget_transactions").select("*").eq("user_id", userId).order("txn_date", { ascending: false });
  if (Array.isArray(stmtIds)) q = q.in("statement_id", stmtIds);
  if (category && category !== "All") q = q.eq("category", category);
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-${String(lastDay).padStart(2, "0")}`);
  } else if (from) {
    q = q.gte("txn_date", from);
  }
  if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);
  const maxRows = Math.min(Number(limit) || 500, 2000);
  const startRow = Number(offset) || 0;
  q = q.range(startRow, startRow + maxRows - 1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(t => ({ ...t, description: decrypt(t.description), balance: t.balance ? decrypt(t.balance) : null }));
}

/** Normalize a transaction description to extract the core merchant name.
 *  Handles common Indian + US bank description patterns:
 *  - UPI: "UPI/CR/123456789012/SWIGGY FOOD" → "SWIGGY FOOD"
 *  - NEFT/RTGS/IMPS: "NEFT/HDFC123/AMAZON PAY" → "AMAZON PAY"
 *  - POS: "POS/TXN/BIGBASKET" → "BIGBASKET"
 *  - Generic: strips trailing dates, ref numbers, slashes */
function normalizeMerchant(desc) {
  if (!desc) return "Unknown";
  let s = String(desc).toUpperCase().trim();
  // Strip leading UPI/NEFT/IMPS/RTGS/POS markers + slash-delimited codes
  s = s.replace(/^(UPI|NEFT|RTGS|IMPS|POS|ACH|ECS|EMI|ENQ|CLG|TFR|NACH|ATM|INB|MOB|CHQ|DD|DEBIT CARD|CREDIT CARD|PURCHASE)\b[\s/\-]*/i, "");
  // Strip slash-delimited ref codes (all-numeric or alphanumeric >=6 chars) that appear in UPI refs
  s = s.replace(/\/[A-Z0-9]{6,}(?=\/|$)/g, "");
  // Strip trailing date patterns like 07-08, 2024-08-07
  s = s.replace(/\s*\d{2}[-/]\d{2}(?:[-/]\d{2,4})?\s*$/, "");
  // Strip trailing transaction IDs (long numeric strings)
  s = s.replace(/\s+\d{8,}\s*$/, "");
  // Remove leading/trailing slashes and trim
  s = s.replace(/^[\/\s]+|[\/\s]+$/g, "").trim();
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ");
  // Title-case
  return s.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ") || "Unknown";
}

/** Top merchants by spend. Groups by normalized description and sums amounts.
 *  Only considers DEBIT transactions. Returns top 20 by amount. */
export async function merchantRollup(userId, memberId, month, { from: rangeFrom, to: rangeTo } = {}) {
  let qFrom, qTo;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    qFrom = `${month}-01`;
    qTo   = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else if (rangeFrom) {
    qFrom = rangeFrom; qTo = rangeTo || new Date().toISOString().slice(0, 10);
  } else {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    qFrom = `${y}-${m}-01`; qTo = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  }

  const stmtIds = await resolveStatementIds(userId, memberId || null);
  if (Array.isArray(stmtIds) && stmtIds.length === 0) return [];

  let q = supabase.from("budget_transactions")
    .select("amount, description, search_text, category").eq("user_id", userId).eq("txn_type", "DEBIT");
  if (Array.isArray(stmtIds)) q = q.in("statement_id", stmtIds);
  if (qFrom) q = q.gte("txn_date", qFrom);
  if (qTo)   q = q.lte("txn_date", qTo);
  q = q.limit(5000);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const grouped = {};
  for (const t of data || []) {
    const rawDesc = decrypt(t.description) || t.search_text || "";
    const merchant = normalizeMerchant(rawDesc);
    if (!grouped[merchant]) grouped[merchant] = { merchant, total: 0, count: 0, category: t.category };
    grouped[merchant].total += t.amount;
    grouped[merchant].count += 1;
  }
  return Object.values(grouped)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

/** Detect recurring transactions — transactions with the same normalized merchant
 *  appearing in 2+ distinct calendar months at a broadly similar amount (within ±30%).
 *  Returns a list of suspected recurring entries sorted by typical monthly cost desc. */
export async function detectRecurring(userId, memberId) {
  const stmtIds = await resolveStatementIds(userId, memberId || null);
  if (Array.isArray(stmtIds) && stmtIds.length === 0) return [];

  const cutoff = new Date(Date.now() - 365 * 24 * 3600_000).toISOString().slice(0, 10);
  let q = supabase.from("budget_transactions")
    .select("amount, description, search_text, category, txn_date")
    .eq("user_id", userId).eq("txn_type", "DEBIT").gte("txn_date", cutoff).limit(5000);
  if (Array.isArray(stmtIds)) q = q.in("statement_id", stmtIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Group by merchant → month → list of amounts
  const byMerchant = {};
  for (const t of data || []) {
    const rawDesc = decrypt(t.description) || t.search_text || "";
    const merchant = normalizeMerchant(rawDesc);
    const mo = t.txn_date.slice(0, 7);
    if (!byMerchant[merchant]) byMerchant[merchant] = {};
    if (!byMerchant[merchant][mo]) byMerchant[merchant][mo] = [];
    byMerchant[merchant][mo].push({ amount: t.amount, category: t.category });
  }

  const results = [];
  for (const [merchant, months] of Object.entries(byMerchant)) {
    const moKeys = Object.keys(months).sort();
    if (moKeys.length < 2) continue; // must appear in at least 2 months

    // Representative amount per month = sum (usually just 1 transaction)
    const monthAmounts = moKeys.map(mo => months[mo].reduce((s, t) => s + t.amount, 0));
    const avg = monthAmounts.reduce((s, v) => s + v, 0) / monthAmounts.length;
    const allInRange = monthAmounts.every(a => Math.abs(a - avg) / avg <= 0.30); // within ±30%
    if (!allInRange) continue;

    const latestCategory = months[moKeys[moKeys.length - 1]][0].category;
    results.push({
      merchant,
      typicalAmount: Math.round(avg),
      monthCount: moKeys.length,
      months: moKeys,
      category: latestCategory,
      isSubscription: avg < 5000, // heuristic: <₹5000 = likely subscription
    });
  }
  return results.sort((a, b) => b.typicalAmount - a.typicalAmount).slice(0, 30);
}
