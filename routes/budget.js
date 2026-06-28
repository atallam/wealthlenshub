import { Router } from "express";
import multer from "multer";
import { supabase } from "../lib/db.js";
import { auth, sendError, IS_PROD } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  xlsxBufferToCSV, autoCategorise,
  BANK_REGISTRY, parseCSV, extractPDFText, parseUSPDF, parseIndianPDF,
  parseDateForRegion, parseAmtBudget,
} from "../lib/parsers.js";
import { yahooFetch } from "../lib/prices.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const { source, statement_type, notes, bank_key } = req.body;
    const id = "bst_" + Date.now() + Math.random().toString(36).slice(2, 6);
    const ext = req.file.originalname.split(".").pop().toLowerCase();
    const bankInfo = BANK_REGISTRY[bank_key] || BANK_REGISTRY.auto;
    let region = bankInfo.region;

    let rawRows = [];
    try {
      if (ext === "csv" || ext === "txt") {
        const { rows, detectedBank } = parseCSV(req.file.buffer.toString("utf8"), bank_key);
        rawRows = rows;
        if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
      } else if (ext === "xlsx") {
        const csvText = await xlsxBufferToCSV(req.file.buffer);
        const { rows, detectedBank } = parseCSV(csvText, bank_key);
        rawRows = rows;
        if (detectedBank && BANK_REGISTRY[detectedBank]) region = BANK_REGISTRY[detectedBank].region;
      } else if (ext === "xls") {
        return res.status(400).json({ error: "Legacy .xls format is not supported. Please open in Excel and save as .xlsx, then retry." });
      } else if (ext === "pdf") {
        try {
          const { text: rawText, pages } = await extractPDFText(req.file.buffer);
          const usRows = parseUSPDF(rawText);
          const inRows = parseIndianPDF(rawText);
          if (region === "US") { rawRows = usRows.length > 0 ? usRows : inRows; }
          else if (region === "IN") { rawRows = inRows.length > 0 ? inRows : usRows; }
          else { rawRows = usRows.length >= inRows.length ? usRows : inRows; region = usRows.length >= inRows.length ? "US" : "IN"; }
          if (rawRows.length === 0) {
            try {
              const { text: rawText2 } = await extractPDFText(req.file.buffer);
              const usTest = parseUSPDF(rawText2); const inTest = parseIndianPDF(rawText2);
              return res.status(400).json({ error: `PDF parsed 0 rows (ext=${ext}, bank=${bank_key}, region=${region}). Debug: US=${usTest.length}, IN=${inTest.length}.`, usRows: usTest.length, inRows: inTest.length });
            } catch (dbgErr) { return res.status(400).json({ error: `PDF 0 rows + debug failed: ${dbgErr.message}` }); }
          }
        } catch (pdfErr) { return res.status(400).json({ error: "PDF parse error: " + pdfErr.message }); }
      } else {
        return res.status(400).json({ error: "Unsupported format. Use CSV, XLSX, or PDF." });
      }
    } catch (e) {
      return res.status(400).json({ error: IS_PROD ? "Failed to parse file" : "Parse error: " + e.message });
    }

    if (!rawRows.length && (!bank_key || bank_key === "auto")) {
      return res.status(400).json({ error: "Could not auto-detect bank format. Please select your bank from the dropdown and try again.", code: "BANK_DETECT_FAILED" });
    }
    if (!rawRows.length) return res.status(400).json({ error: `No transactions found (ext=${ext}, bank=${bank_key}, region=${region}).` });

    const txns = [];
    let periodStart = null, periodEnd = null;
    let skippedNoDate = 0, skippedNoAmt = 0, skippedNoDesc = 0;
    for (const row of rawRows) {
      const date = parseDateForRegion(row.date, region);
      if (!date) { skippedNoDate++; continue; }
      const debit = Math.abs(parseAmtBudget(row.debit));
      const credit = Math.abs(parseAmtBudget(row.credit));
      if (debit === 0 && credit === 0) { skippedNoAmt++; continue; }
      const amount = debit > 0 ? debit : credit;
      const type = debit > 0 ? "DEBIT" : "CREDIT";
      const desc = String(row.desc || "").trim();
      if (!desc) { skippedNoDesc++; continue; }
      const category = await autoCategorise(desc);
      if (!periodStart || date < periodStart) periodStart = date;
      if (!periodEnd || date > periodEnd) periodEnd = date;
      txns.push({
        id: "btx_" + Date.now() + Math.random().toString(36).slice(2, 8),
        statement_id: id, user_id: req.user.id, txn_date: date,
        description: encrypt(desc), raw_desc: encrypt(desc),
        amount, txn_type: type, category,
        balance: row.balance ? encrypt(String(row.balance)) : null,
        ref_number: (row.ref || "").slice(0, 50),
        currency: region === "US" ? "USD" : region === "IN" ? "INR" : "USD",
      });
    }
    if (!txns.length) return res.status(400).json({ error: `Parsed ${rawRows.length} rows but none converted to transactions. Skipped: ${skippedNoDate} bad dates, ${skippedNoAmt} zero amounts, ${skippedNoDesc} empty descriptions. Region: ${region}`, rawSample: rawRows.length > 0 ? rawRows[0] : null });

    await supabase.from("budget_statements").delete().eq("user_id", req.user.id).lt("upload_date", new Date(Date.now() - 365 * 24 * 3600_000).toISOString());
    const { error: stErr } = await supabase.from("budget_statements").insert({
      user_id: req.user.id, id, source: source || bankInfo.label || "Unknown",
      statement_type: statement_type || "BANK", filename: req.file.originalname, file_size: req.file.size,
      period_start: periodStart, period_end: periodEnd, txn_count: txns.length, notes: notes || "", region: region || "AUTO",
    });
    if (stErr) return res.status(500).json({ error: stErr.message });

    for (let i = 0; i < txns.length; i += 100) {
      const { error: txErr } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100));
      if (txErr) console.error("Batch insert error:", txErr.message);
    }
    res.json({ ok: true, statement_id: id, txn_count: txns.length, period_start: periodStart, period_end: periodEnd, region, bank: bank_key || "auto" });
  } catch (e) { console.error("Budget upload error:", e.message, e.stack); sendError(res, e); }
});

router.post("/debug-pdf", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const ext = req.file.originalname.split(".").pop().toLowerCase();
    if (ext !== "pdf") return res.status(400).json({ error: "PDF only" });
    const { text: rawText, pages } = await extractPDFText(req.file.buffer);
    const usRows = parseUSPDF(rawText);
    const inRows = parseIndianPDF(rawText);
    const lines = rawText.split("\n");
    const sampleLines = lines.slice(0, 80);
    const sectionHeaders = lines.filter(l => /deposits?\s+and|withdrawals?\s+and|checks?\s+paid|daily\s*balance|ending\s*balance|beginning\s*balance/i.test(l));
    const dateLines = lines.filter(l => /^\s*\d{1,2}\/\d{1,2}/.test(l)).slice(0, 20);
    const rawRows = usRows.length >= inRows.length ? usRows : inRows;
    const region = usRows.length >= inRows.length ? "US" : "IN";
    let imported = 0, importError = null;
    if (rawRows.length > 0 && req.body && req.body !== "debug_only") {
      try {
        const id = "bst_" + Date.now() + Math.random().toString(36).slice(2, 6);
        const txns = []; let periodStart = null, periodEnd = null;
        for (const row of rawRows) {
          const date = parseDateForRegion(row.date, region);
          if (!date) continue;
          const debit = Math.abs(parseAmtBudget(row.debit)); const credit = Math.abs(parseAmtBudget(row.credit));
          if (debit === 0 && credit === 0) continue;
          const amount = debit > 0 ? debit : credit; const type = debit > 0 ? "DEBIT" : "CREDIT";
          const desc = String(row.desc || "").trim(); if (!desc) continue;
          const category = await autoCategorise(desc);
          if (!periodStart || date < periodStart) periodStart = date; if (!periodEnd || date > periodEnd) periodEnd = date;
          txns.push({ id: "btx_" + Date.now() + Math.random().toString(36).slice(2, 8), statement_id: id, user_id: req.user.id, txn_date: date, description: encrypt(desc), raw_desc: encrypt(desc), amount, txn_type: type, category, balance: row.balance ? encrypt(String(row.balance)) : null, ref_number: (row.ref || "").slice(0, 50), currency: "USD" });
        }
        if (txns.length > 0) {
          await supabase.from("budget_statements").delete().eq("user_id", req.user.id).lt("upload_date", new Date(Date.now() - 365*24*3600_000).toISOString());
          await supabase.from("budget_statements").insert({ user_id: req.user.id, id, source: "Bank of America (debug)", statement_type: "BANK", filename: req.file.originalname, file_size: req.file.size, period_start: periodStart, period_end: periodEnd, txn_count: txns.length, notes: "Imported via debug endpoint", region: "US" });
          for (let i = 0; i < txns.length; i += 100) { const { error: txErr } = await supabase.from("budget_transactions").insert(txns.slice(i, i + 100)); if (txErr) importError = txErr.message; }
          imported = txns.length;
        }
      } catch (ie) { importError = ie.message; }
    }
    res.json({ pages, totalChars: rawText.length, totalLines: lines.length, usRowsParsed: usRows.length, inRowsParsed: inRows.length, sectionHeaders, dateLines, first80Lines: sampleLines, usRowsSample: usRows.slice(0, 5), inRowsSample: inRows.slice(0, 5), imported, importError });
  } catch (e) { sendError(res, e); }
});

router.get("/statements", auth, async (req, res) => {
  const { data, error } = await supabase.from("budget_statements").select("*").eq("user_id", req.user.id).order("upload_date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete("/statements/:id", auth, async (req, res) => {
  await supabase.from("budget_statements").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

router.get("/transactions", auth, async (req, res) => {
  const { statement_id, category, month, search } = req.query;
  let q = supabase.from("budget_transactions").select("*").eq("user_id", req.user.id).order("txn_date", { ascending: false });
  if (statement_id) q = q.eq("statement_id", statement_id);
  if (category && category !== "All") q = q.eq("category", category);
  if (month) { q = q.gte("txn_date", `${month}-01`).lte("txn_date", `${month}-31`); }
  q = q.limit(1000);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const decrypted = (data || []).map(t => ({ ...t, description: decrypt(t.description), balance: t.balance ? decrypt(t.balance) : null }));
  const filtered = search ? decrypted.filter(t => t.description.toLowerCase().includes(search.toLowerCase())) : decrypted;
  res.json(filtered);
});

router.patch("/transactions/:id", auth, async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: "category required" });
  const { error } = await supabase.from("budget_transactions").update({ category }).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post("/recategorise", auth, async (req, res) => {
  const { ids, category } = req.body;
  if (!ids?.length || !category) return res.status(400).json({ error: "ids and category required" });
  if (ids.length > 500) return res.status(400).json({ error: "Too many IDs (max 500)" });
  const { error } = await supabase.from("budget_transactions").update({ category }).in("id", ids).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, updated: ids.length });
});

router.get("/categories", auth, async (req, res) => {
  const { data, error } = await supabase.from("budget_categories").select("*").eq("user_id", req.user.id).order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/categories", auth, async (req, res) => {
  const id = "cat_" + Date.now().toString(36);
  const { name, keywords } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const { error } = await supabase.from("budget_categories").insert({ id, user_id: req.user.id, name, keywords: keywords || "" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id });
});

router.put("/categories/:id", auth, async (req, res) => {
  const { name, keywords } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (keywords !== undefined) update.keywords = keywords;
  const { error } = await supabase.from("budget_categories").update(update).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/categories/:id", auth, async (req, res) => {
  await supabase.from("budget_categories").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

router.get("/analytics", auth, async (req, res) => {
  const { month } = req.query;
  const from = month ? `${month}-01` : new Date(Date.now() - 30*24*3600_000).toISOString().slice(0,10);
  const to   = month ? `${month}-31` : new Date().toISOString().slice(0,10);
  const { data: txns } = await supabase.from("budget_transactions").select("amount, txn_type, category, txn_date").eq("user_id", req.user.id).gte("txn_date", from).lte("txn_date", to);
  const byCategory = {}; let totalDebit = 0, totalCredit = 0;
  for (const t of (txns || [])) {
    if (t.txn_type === "DEBIT") { totalDebit += t.amount; byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; }
    else { totalCredit += t.amount; }
  }
  const { data: allTxns } = await supabase.from("budget_transactions").select("amount, txn_type, txn_date").eq("user_id", req.user.id).gte("txn_date", new Date(Date.now() - 180*24*3600_000).toISOString().slice(0,10)).eq("txn_type", "DEBIT");
  const monthly = {};
  for (const t of (allTxns || [])) { const mo = t.txn_date.slice(0, 7); monthly[mo] = (monthly[mo] || 0) + t.amount; }
  res.json({ byCategory, totalDebit, totalCredit, monthly });
});

router.get("/benchmark", auth, async (req, res) => {
  const { period = "1Y" } = req.query;
  const ranges = { "1Y": "1y", "3Y": "3y", "5Y": "5y", "ALL": "10y" };
  const range = ranges[period] || "1y";
  const fetchSeries = async (symbol) => {
    const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1mo&range=${range}`);
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    return timestamps.map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 7), value: closes[i] })).filter(p => p.value != null);
  };
  try {
    const [nifty, sp500] = await Promise.all([fetchSeries("^NSEI"), fetchSeries("^GSPC")]);
    const normalize = (series) => { if (!series.length) return []; const base = series[0].value; return series.map(p => ({ date: p.date, value: p.value, pct: +((p.value - base) / base * 100).toFixed(2) })); };
    res.json({ nifty50: normalize(nifty), sp500: normalize(sp500), period, fetchedAt: new Date().toISOString() });
  } catch (e) { sendError(res, e); }
});

export default router;
