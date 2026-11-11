import { BANK_REGISTRY, autoCategorise, extractPDFText, loadCategoriesForBulk, parseAmtBudget, parseCSV, parseDateForRegion, parseIndianPDF, parseUSPDF, xlsxBufferToCSV } from "../../lib/parsers.js";
import { describeDbError, supabase } from "../../lib/db.js";
import { encrypt } from "../../lib/crypto.js";
import { aliasId, err, stId, txId } from "./shared.js";

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
  const ending = text.match(/ending\s*(?:in|with)?\s*[:-]?\s*(\d{4})\b/i);
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
      const { error } = await supabase.from("budget_account_aliases").update({ member_id: memberId, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", userId);
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
