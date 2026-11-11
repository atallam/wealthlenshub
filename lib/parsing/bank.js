import { parseAmtBudget } from "./dates.js";
import { Papa } from "./runtime.js";

// ── BANK_REGISTRY ──────────────────────────────────────────────────────────────
export const BANK_REGISTRY = {
  chase:       { region: "US", label: "Chase" },
  bofa:        { region: "US", label: "Bank of America" },
  wells_fargo: { region: "US", label: "Wells Fargo" },
  citi:        { region: "US", label: "Citi" },
  capital_one: { region: "US", label: "Capital One" },
  amex:        { region: "US", label: "Amex" },
  discover:    { region: "US", label: "Discover" },
  us_bank:     { region: "US", label: "US Bank" },
  other_us:    { region: "US", label: "Other US Bank" },
  hdfc:        { region: "IN", label: "HDFC" },
  icici:       { region: "IN", label: "ICICI" },
  axis:        { region: "IN", label: "Axis" },
  sbi:         { region: "IN", label: "SBI" },
  kotak:       { region: "IN", label: "Kotak" },
  // Broader Indian coverage — see the note above BANK_COLUMN_MAP's IN_STD_*
  // aliases: these use standard Indian bank-statement conventions but haven't
  // been validated against a real export from each bank yet.
  pnb:         { region: "IN", label: "Punjab National Bank" },
  bob:         { region: "IN", label: "Bank of Baroda" },
  canara:      { region: "IN", label: "Canara Bank" },
  union_bank:  { region: "IN", label: "Union Bank of India" },
  idfc_first:  { region: "IN", label: "IDFC First Bank" },
  indusind:    { region: "IN", label: "IndusInd Bank" },
  yes_bank:    { region: "IN", label: "Yes Bank" },
  rbl:         { region: "IN", label: "RBL Bank" },
  sc_india:    { region: "IN", label: "Standard Chartered India" },
  hsbc_india:  { region: "IN", label: "HSBC India" },
  idbi:        { region: "IN", label: "IDBI Bank" },
  federal_bank:{ region: "IN", label: "Federal Bank" },
  other_in:    { region: "IN", label: "Other Indian Bank" },
  auto:        { region: "AUTO", label: "Auto-detect" },
};

// ── BANK_COLUMN_MAP ────────────────────────────────────────────────────────────
// Single source of truth for how each bank's export maps to our row shape
// {date, desc, debit, credit, balance, ref}. Adding a new bank means adding a
// config entry here — no new parsing function required. `headerHints` also
// drives autoDetectBank() so detection and parsing never drift out of sync.
// Column lookup is by header-name alias (case-insensitive substring match),
// with `fallbackIdx` (fixed positions) used only when the header row can't be
// matched — this is what broke for Axis when a bank export reordered/added
// columns and the code silently read the wrong column as "date".
export const BANK_COLUMN_MAP = {
  // ── US banks ──
  chase: {
    label: "Chase", headerHints: ["post date", "category"],
    date: ["transaction date", "date"], desc: ["description"], amount: ["amount"],
    amountConvention: "auto", // 'auto' = negative→debit for BANK statements, positive→debit for CREDIT_CARD statements
  },
  bofa: {
    label: "Bank of America", headerHints: ["running bal"],
    date: ["date"], desc: ["description"], amount: ["amount"], balance: ["running bal", "balance"],
    amountConvention: "auto",
  },
  wells_fargo: {
    label: "Wells Fargo", headerHints: [],
    date: ["date"], desc: ["description", "memo", "name"], amount: ["amount"], balance: ["balance"],
    amountConvention: "auto", dateCol0: true, descLastCol: true,
  },
  citi: {
    label: "Citi", headerHints: ["status", "debit", "credit"],
    date: ["date"], desc: ["description"], debit: ["debit"], credit: ["credit"],
  },
  capital_one: {
    label: "Capital One", headerHints: ["card no", "posted date"],
    date: ["transaction date", "posted date", "date"], desc: ["description", "payee"], debit: ["debit"], credit: ["credit"],
  },
  amex: {
    label: "Amex", headerHints: ["reference"],
    date: ["date"], desc: ["description"], amount: ["amount"], ref: ["reference"],
    amountConvention: "card", dateCol0: true,
  },
  discover: {
    label: "Discover", headerHints: ["trans. date", "trans date"],
    date: ["trans. date", "trans date", "transaction date"], desc: ["description"], amount: ["amount"],
    amountConvention: "card",
  },
  us_bank: {
    label: "US Bank", headerHints: ["memo", "name"],
    date: ["date"], amount: ["amount"], descCols: ["name", "memo"],
    amountConvention: "auto",
  },
  // ── Indian banks ── (explicit debit/credit columns, so statement_type doesn't affect sign)
  hdfc: {
    label: "HDFC", headerHints: ["narration", "withdrawal amt"],
    date: ["date"], desc: ["narration"], debit: ["withdrawal amt"], credit: ["deposit amt"], balance: ["closing balance", "balance"], ref: ["chq", "ref"],
    fallbackIdx: { date: 0, desc: 1, ref: 2, debit: 4, credit: 5, balance: 6 },
  },
  icici: {
    label: "ICICI", headerHints: ["transaction remarks"],
    date: ["transaction date", "value date"], desc: ["transaction remarks"], debit: ["withdrawal", "debit"], credit: ["deposit", "credit"], balance: ["balance"], ref: ["ref", "cheque", "chq"],
    fallbackIdx: { date: 2, ref: 3, desc: 4, debit: 5, credit: 6, balance: 7 },
  },
  axis: {
    label: "Axis", headerHints: ["particulars"],
    // Axis bank-account exports have separate Debit/Withdrawal + Credit/Deposit
    // columns; Axis credit-card exports instead have one "Amount" column plus a
    // "Debit/Credit" text-label column (handled generically via `drCr` below —
    // see parseBankCSV's debI===credI collision check).
    date: ["tran date", "transaction date", "value date", "date"], desc: ["particular", "transaction details"],
    debit: ["debit", "withdrawal"], credit: ["credit", "deposit"], amount: ["amount"], drCr: ["debit/credit", "dr/cr", "cr/dr"],
    balance: ["balance"], ref: ["chq", "cheque", "ref"],
    fallbackIdx: { date: 0, ref: 1, desc: 2, debit: 3, credit: 4, balance: 5 },
  },
  sbi: {
    label: "SBI", headerHints: ["txn date"],
    date: ["txn date", "value date"], desc: ["description", "narration"], debit: ["debit", "withdrawal"], credit: ["credit", "deposit"], balance: ["balance"], ref: ["ref", "chq"],
    fallbackIdx: { date: 0, desc: 2, ref: 3, debit: 4, credit: 5, balance: 6 },
  },
  kotak: {
    label: "Kotak", headerHints: ["transaction date"],
    date: ["transaction date", "date"], desc: ["description", "particular", "narration"], debit: ["debit", "withdrawal"], credit: ["credit", "deposit"], balance: ["balance"],
  },

  // ── Broader Indian coverage (PNB, BoB, Canara, Union Bank, IDFC First,
  // IndusInd, Yes Bank, RBL, Standard Chartered, HSBC, IDBI, Federal Bank) ──
  // These share the same header-driven engine as the 5 banks above, using
  // generous aliases for the standard Indian bank-statement conventions
  // (Narration/Particulars/Description, Cheque/Ref No, Debit/Withdrawal,
  // Credit/Deposit, Balance). Deliberately NO fallbackIdx — we have no real
  // sample file for any of these yet, and a wrong fixed-position guess is
  // worse than a clean "no rows parsed" (which the debug tool can diagnose).
  // No autoDetectBank signature either, for the same reason: an unvalidated
  // guess at a distinguishing header risks false-positiving against a bank
  // we've already confirmed works. Select these explicitly from the Bank
  // dropdown; once someone confirms one works (or needs a fix) via "Check
  // This File First", promote it the same way Axis/HDFC were — add a
  // fallbackIdx/headerHints and lock it in with a regression test.
  ...(() => {
    const IN_STD_DATE = ["tran date", "transaction date", "txn date", "value date", "date"];
    const IN_STD_DESC = ["narration", "particulars", "transaction details", "remarks", "description"];
    const IN_STD_DEBIT = ["debit amount", "debit", "withdrawal amt", "withdrawal", "dr amount"];
    const IN_STD_CREDIT = ["credit amount", "credit", "deposit amt", "deposit", "cr amount"];
    const IN_STD_BALANCE = ["closing balance", "running balance", "balance"];
    const IN_STD_REF = ["cheque", "chq", "instrument", "ref no", "ref"];
    const std = () => ({ date: IN_STD_DATE, desc: IN_STD_DESC, debit: IN_STD_DEBIT, credit: IN_STD_CREDIT, balance: IN_STD_BALANCE, ref: IN_STD_REF });
    return {
      pnb:          { label: "Punjab National Bank", headerHints: [], ...std() },
      bob:          { label: "Bank of Baroda",        headerHints: [], ...std() },
      canara:       { label: "Canara Bank",           headerHints: [], ...std() },
      union_bank:   { label: "Union Bank of India",   headerHints: [], ...std() },
      idfc_first:   { label: "IDFC First Bank",       headerHints: [], ...std() },
      indusind:     { label: "IndusInd Bank",         headerHints: [], ...std() },
      yes_bank:     { label: "Yes Bank",              headerHints: [], ...std() },
      rbl:          { label: "RBL Bank",              headerHints: [], ...std() },
      sc_india:     { label: "Standard Chartered India", headerHints: [], ...std() },
      hsbc_india:   { label: "HSBC India",            headerHints: [], ...std() },
      idbi:         { label: "IDBI Bank",             headerHints: [], ...std() },
      federal_bank: { label: "Federal Bank",          headerHints: [], ...std() },
    };
  })(),
};

/** Header-alias lookup: first column whose (lowercased) header contains any of `aliases`. */
function findCol(h, aliases) {
  if (!aliases || !aliases.length) return -1;
  return h.findIndex(c => aliases.some(a => c.includes(a)));
}

// ── Generic, config-driven bank-statement parser ────────────────────────────────
// Replaces the old one-function-per-bank approach. Every bank in BANK_COLUMN_MAP
// is parsed by this single engine, so a bank's parsing behavior is fully defined
// by its config entry — no duplicated column-index logic to keep in sync.
export function parseBankCSV(rows, h, dataRows, bankKey, statementType) {
  const cfg = BANK_COLUMN_MAP[bankKey];
  if (!cfg) return genericCSV(rows, statementType);

  let di = findCol(h, cfg.date);
  if (di < 0 && cfg.dateCol0) di = 0;
  let descI = findCol(h, cfg.desc);
  if (descI < 0 && cfg.descLastCol) descI = h.length > 2 ? h.length - 1 : 1;
  let debI = findCol(h, cfg.debit);
  let credI = findCol(h, cfg.credit);
  // "amount" and the Dr/Cr label column (below) fall back to generic aliases
  // even for banks that don't declare them explicitly, so a bank we've only
  // ever seen in "separate debit/credit column" form still parses correctly
  // if it ships a single-amount-plus-label export in the future (as Axis did
  // for its credit-card statements) — no config change required.
  let amtI = findCol(h, cfg.amount || ["amount"]);
  let balI = findCol(h, cfg.balance);
  let refI = findCol(h, cfg.ref);
  // Some credit-card exports have a single "Debit/Credit" label column whose
  // header text itself contains both words — that column matches both the
  // debit and credit alias lists and resolves to the same index, which is not
  // two real numeric columns. Treat that as "no separate debit/credit columns"
  // so the amount+label branch below handles it instead.
  if (debI >= 0 && debI === credI) { debI = -1; credI = -1; }
  let drCrI = findCol(h, cfg.drCr || ["debit/credit", "dr/cr", "cr/dr"]);

  // Fixed fallback positions are only a safe guess when we have NO real header
  // row to read column names from at all. If a header row WAS found, a field
  // simply not matching any alias (e.g. no "Reference"/"Chq" column exists on
  // this particular export) means that field genuinely isn't present — guessing
  // a fixed position in that case tends to grab an unrelated column (this is
  // what silently mislabeled the description column as "ref" on Axis's
  // credit-card export, which has no header match for ref at all).
  const hasHeader = h.length > 0;
  const fb = hasHeader ? {} : (cfg.fallbackIdx || {});
  if (di < 0 && fb.date !== undefined) di = fb.date;
  if (descI < 0 && fb.desc !== undefined) descI = fb.desc;
  if (debI < 0 && cfg.debit && fb.debit !== undefined && drCrI < 0) debI = fb.debit;
  if (credI < 0 && cfg.credit && fb.credit !== undefined && drCrI < 0) credI = fb.credit;
  if (balI < 0 && fb.balance !== undefined) balI = fb.balance;
  if (refI < 0 && fb.ref !== undefined) refI = fb.ref;

  // Credit-card statements flip which sign of a single "Amount" column means a
  // spend vs. a payment/refund. Bank-account exports: negative = money out
  // (debit). Card exports: positive = a charge (debit). Amex/Discover only
  // ever export cards, so they're pinned to "card"; everything else follows
  // whichever statement_type the user picked on import.
  const cardConvention = cfg.amountConvention === "card" || (cfg.amountConvention === "auto" && statementType === "CREDIT_CARD");

  return dataRows.map(r => {
    const date = di >= 0 ? r[di] : r[0];
    const desc = cfg.descCols
      ? cfg.descCols.map(alias => { const i = findCol(h, [alias]); return i >= 0 ? r[i] : ""; }).filter(Boolean).join(" - ")
      : (descI >= 0 ? r[descI] : "");
    let debit = "", credit = "";
    if (debI >= 0 || credI >= 0) {
      debit = debI >= 0 ? r[debI] : "";
      credit = credI >= 0 ? r[credI] : "";
    } else if (amtI >= 0 && drCrI >= 0) {
      // Amount is always positive here; a separate text column says which side it's on.
      const amt = Math.abs(parseAmtBudget(r[amtI]));
      const label = String(r[drCrI] || "").toLowerCase();
      if (/credit|\bcr\b/.test(label)) credit = amt.toString();
      else debit = amt.toString();
    } else if (amtI >= 0) {
      const amt = parseAmtBudget(r[amtI]);
      if (cardConvention) { debit = amt > 0 ? amt.toString() : ""; credit = amt < 0 ? Math.abs(amt).toString() : ""; }
      else { debit = amt < 0 ? Math.abs(amt).toString() : ""; credit = amt > 0 ? amt.toString() : ""; }
    }
    return { date, desc, debit, credit, balance: balI >= 0 ? r[balI] : "", ref: refI >= 0 ? r[refI] : "" };
  }).filter(r => r.date && r.desc);
}

// Fallback parser for banks with no BANK_COLUMN_MAP entry (bank_key "other_us"/
// "other_in", or an auto-detect that didn't match a known signature). Uses the
// same header-alias approach as parseBankCSV, including the amount+Dr/Cr-label
// pattern, so an unrecognized bank still has a real shot at parsing correctly
// instead of only supporting the two "obvious" layouts.
function genericCSV(rows, statementType, headerIdx) {
  const idx = headerIdx ?? 0; // caller passes the real header row index when known (see findHeaderRow)
  const h=(rows[idx]||[]).map(c=>(c||"").toLowerCase());
  const di=h.findIndex(c=>/date/i.test(c)); const dsc=h.findIndex(c=>/desc|narr|particular|remark|transaction details/i.test(c));
  let deb=h.findIndex(c=>/debit|withdrawal/i.test(c)); let crd=h.findIndex(c=>/credit|deposit/i.test(c));
  const amt=h.findIndex(c=>/amount/i.test(c));
  // Same collision case as parseBankCSV: a single "Debit/Credit" label column
  // matches both patterns and resolves to the same index — that's one label
  // column, not two numeric ones.
  if (deb>=0 && deb===crd) { deb=-1; crd=-1; }
  const drCr = h.findIndex(c=>/debit\/credit|dr\/cr|cr\/dr/i.test(c));
  if(di<0||(dsc<0&&amt<0)) return [];
  const cardConvention = statementType === "CREDIT_CARD";
  return rows.slice(idx+1).map(r=>{
    let debit="", credit="";
    if (deb>=0 || crd>=0) { debit = deb>=0?r[deb]:""; credit = crd>=0?r[crd]:""; }
    else if (amt>=0 && drCr>=0) {
      const a = Math.abs(parseAmtBudget(r[amt]));
      const label = String(r[drCr]||"").toLowerCase();
      if (/credit|\bcr\b/.test(label)) credit = a.toString(); else debit = a.toString();
    } else if (amt>=0) {
      const a = parseAmtBudget(r[amt]);
      if (cardConvention) { debit = a>0?a.toString():""; credit = a<0?Math.abs(a).toString():""; }
      else { debit = a<0?Math.abs(a).toString():""; credit = a>0?a.toString():""; }
    }
    return {date:r[di],desc:dsc>=0?r[dsc]:r[1],debit,credit,balance:"",ref:""};
  }).filter(r=>r.date&&r.desc);
}

export function autoDetectBank(h) {
  // Deliberately kept as explicit, ordered rules rather than deriving purely
  // from BANK_COLUMN_MAP.headerHints: several banks need combined AND/OR
  // conditions (e.g. Citi needs status+debit+credit together; BofA/Amex need
  // a negative condition too) that a single alias list can't express safely
  // without risking false-positive matches against other banks.
  if(h.some(c=>c.includes("post date"))&&h.some(c=>c.includes("category"))) return "chase";
  if(h.some(c=>c.includes("running bal"))||(h.length<=5&&h[0]==="date"&&h.includes("amount")&&h.includes("description"))) return "bofa";
  if(h.some(c=>c.includes("card no"))||(h.some(c=>c.includes("posted date"))&&h.some(c=>c.includes("debit")))) return "capital_one";
  if(h.includes("status")&&h.includes("debit")&&h.includes("credit")) return "citi";
  if(h[0]==="date"&&h.includes("amount")&&(h.includes("reference")||h.length<=4)&&!h.includes("balance")&&!h.includes("narration")) return "amex";
  if(h.some(c=>c.includes("trans. date")||c.includes("trans date"))&&h.includes("amount")) return "discover";
  if(h.some(c=>c==="memo")&&h.some(c=>c==="name")&&h.includes("amount")) return "us_bank";
  if(h.includes("narration")&&(h.includes("withdrawal amt.")||h.includes("withdrawal amt"))) return "hdfc";
  if(h.some(c=>c.includes("transaction remarks"))) return "icici";
  if(h.some(c=>c.includes("particulars"))) return "axis";
  if(h.some(c=>c.includes("txn date"))) return "sbi";
  if(h.some(c=>c.includes("transaction date"))&&(h.some(c=>c.includes("narration"))||h.some(c=>c.includes("description")))) return "kotak";
  return null;
}

// Header cell keywords, checked as substrings of each (short) cell. Column-header
// cells are short and single-purpose ("Date", "Debit/Credit"); a preamble/summary
// cell like "Payment Due Date\n02 Aug '26" also contains "date" but is long,
// free-text, and alone in its row — so a naive "first row containing the word
// date" match (the old approach) grabbed the wrong row on statements with a
// preamble block (e.g. credit-card summaries). Scoring by how many short,
// header-shaped cells match — and picking the best-scoring row over the whole
// sheet — finds the real table header even when it isn't the first match.
const HEADER_CELL_KEYWORDS = /date|narration|description|particular|transaction|remark|debit|credit|withdrawal|deposit|balance|amount|reference|\bchq\b|cheque|\bref\b/i;
function findHeaderRow(rows) {
  let bestIdx = -1, bestRow = null, bestScore = 0;
  rows.forEach((r, i) => {
    // A merged Excel cell spanning multiple columns (e.g. a "Transaction Summary"
    // section divider) gets its text repeated into every column when converted to
    // CSV/rows — counting each repeat as a separate match let a single repeated
    // section-header phrase outscore the real header row (which has N *distinct*
    // column names, not the same phrase N times). Dedupe per-row so a repeated
    // value only scores once, same as it would for a human scanning the row.
    const seen = new Set();
    let score = 0;
    for (const cell of r) {
      const c = (cell == null ? "" : String(cell)).trim();
      if (!c || c.length > 40) continue; // real header cells are short labels, not prose
      const key = c.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (HEADER_CELL_KEYWORDS.test(c)) score++;
    }
    if (score > bestScore) { bestScore = score; bestRow = r; bestIdx = i; }
  });
  return bestScore > 0 ? { row: bestRow, idx: bestIdx } : null;
}

export function parseCSV(text, bankKey, statementType) {
  const result = Papa.parse(text.trim(), { header:false, skipEmptyLines:true });
  const rows = result.data;
  // `headerRow`/`headerRowIdx` are echoed back in every branch below so the debug-import
  // tool can show exactly which row was treated as the column header — the single
  // most useful piece of diagnostic info when a future statement fails to parse.
  if(!rows.length) return {rows:[],detectedBank:null,headerRow:null,headerRowIdx:-1};
  const headerMatch = findHeaderRow(rows);
  const headerRow = headerMatch?.row || null;
  if(!headerRow&&!bankKey) return {rows:genericCSV(rows,statementType,0),detectedBank:null,headerRow:null,headerRowIdx:-1};
  const h = headerRow ? headerRow.map(c=>(c||"").toLowerCase().trim()) : [];
  // If no header row was found but a specific bank was chosen (e.g. Wells Fargo,
  // which never includes a header line), don't blindly drop row 0 assuming it
  // was an unrecognized header — every row is data. That "slice(1)" was dropping
  // real transactions whenever a headerless or oddly-worded export was used.
  const dataRows = headerRow ? rows.slice(headerMatch.idx+1) : rows;
  if(bankKey&&bankKey!=="auto"&&bankKey!=="other_us"&&bankKey!=="other_in"&&BANK_COLUMN_MAP[bankKey])
    return {rows:parseBankCSV(rows,h,dataRows,bankKey,statementType), detectedBank:bankKey, headerRow, headerRowIdx:headerMatch?.idx ?? -1};
  const detected = autoDetectBank(h);
  if(detected&&BANK_COLUMN_MAP[detected]) return {rows:parseBankCSV(rows,h,dataRows,detected,statementType), detectedBank:detected, headerRow, headerRowIdx:headerMatch?.idx ?? -1};
  // Unrecognized bank: still use the correctly-detected header row (if any) rather
  // than blindly assuming row 0, so statements with a preamble block still parse.
  return {rows:genericCSV(rows,statementType,headerMatch?.idx ?? 0), detectedBank:null, headerRow, headerRowIdx:headerMatch?.idx ?? -1};
}
