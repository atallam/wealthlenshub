import { Router } from "express";
import multer from "multer";
import { supabase } from "../lib/db.js";
import { auth, sendError, IS_PROD } from "../lib/auth.js";
import {
  pdfjsLib, _pdfjsFontPath, xlsxBufferToCSV,
  detectAndParseHoldings, parseTransactionCSV,
  scoreHoldings, scoreTransactions,
  parseNSDLCASStatement, parseFidelityPDFStatement,
} from "../lib/parsers.js";
import { getAmfiList, yahooSearch, yahooPrice } from "../lib/prices.js";
import { auditImport } from "../lib/importLogger.js";
import { decrypt } from "../lib/crypto.js";

/**
 * Build the CAS-unlock context for this request. All PAN decryption happens
 * SERVER-SIDE — plaintext PANs never travel to the browser (P1-2).
 *
 * candidates: passwords to try against a protected CAS PDF, in order:
 *   1. A password the user typed for THIS request (transient, user-supplied).
 *   2. The user's own stored PAN (profiles.encrypted_pan).
 *   3. Each family member's stored PAN (portfolio.members[].encrypted_pan) —
 *      lets one account import CAS statements for every family member.
 * panToMember: PAN → member_id map, used to auto-assign parsed holders.
 */
async function casUnlockContext(req) {
  const typed = (req.body?.password || "").trim();
  const candidates = typed ? [typed] : [];
  const panToMember = new Map();
  const [{ data: prof }, { data: port }] = await Promise.all([
    supabase.from("profiles").select("encrypted_pan").eq("id", req.user.id).single(),
    supabase.from("portfolio").select("members").eq("user_id", req.user.id).single(),
  ]);
  const safeDecrypt = (enc) => {
    try { const p = decrypt(enc); return p && p !== "[encrypted]" ? p.toUpperCase().trim() : ""; }
    catch { return ""; }
  };
  if (prof?.encrypted_pan) {
    const pan = safeDecrypt(prof.encrypted_pan);
    if (pan) candidates.push(pan);
  }
  for (const m of port?.members || []) {
    if (!m?.encrypted_pan) continue;
    const pan = safeDecrypt(m.encrypted_pan);
    if (pan) { panToMember.set(pan, m.id); candidates.push(pan); }
  }
  return { candidates: [...new Set(candidates)], typed: !!typed, panToMember };
}

/** Match CAS holders to members by PAN (index-aligned with holder_names). */
function mapHoldersByPan(holderNames = [], holderPans = [], panToMember) {
  const map = {};
  holderNames.forEach((name, i) => {
    const pan = (holderPans[i] || "").toUpperCase().trim();
    const memberId = pan && panToMember.get(pan);
    if (memberId) map[name] = memberId;
  });
  // Fallback: if counts don't align, match any extracted PAN to any member.
  if (Object.keys(map).length === 0 && holderNames.length === 1 && holderPans.length >= 1) {
    for (const rawPan of holderPans) {
      const memberId = panToMember.get((rawPan || "").toUpperCase().trim());
      if (memberId) { map[holderNames[0]] = memberId; break; }
    }
  }
  return map;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/detect", auth, auditImport("FILE_DETECT"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const ext = req.file.originalname.split(".").pop().toLowerCase();

  let text = "";
  try {
    if (ext === "csv" || ext === "txt") {
      text = req.file.buffer.toString("utf8");
    } else if (ext === "xlsx") {
      text = await xlsxBufferToCSV(req.file.buffer);
    } else if (ext === "xls") {
      return res.status(400).json({ error: "Legacy .xls format is not supported. Please open in Excel and save as .xlsx, then retry." });
    } else if (ext === "pdf") {
      try {
        // Server-side unlock: tries the typed password, then the stored profile
        // PAN, then each member's stored PAN — none of which reach the client.
        const { candidates, typed, panToMember } = await casUnlockContext(req);
        const isPasswordErr = (err) => {
          const msg = (err?.message || "").toLowerCase();
          return msg.includes("password") || msg.includes("encrypted") || err?.code === 1 || err?.code === 2;
        };
        let pdf = null;
        // "" first — opens unprotected PDFs without burning a candidate.
        for (const pw of ["", ...candidates]) {
          try {
            const loadingTask = pdfjsLib.getDocument({
              data: new Uint8Array(req.file.buffer),   // fresh copy per attempt
              standardFontDataUrl: _pdfjsFontPath,
              useSystemFonts: true,
              ...(pw ? { password: pw } : {}),
            });
            pdf = await loadingTask.promise;
            break;
          } catch (pdfOpenErr) {
            if (!isPasswordErr(pdfOpenErr)) throw pdfOpenErr;
          }
        }
        if (!pdf) {
          if (typed) return res.status(400).json({ error: "password_incorrect", message: "Incorrect password. Check the PAN number (uppercase).", needs_password: true });
          if (candidates.length) return res.status(400).json({ error: "password_required", message: "None of your saved PANs unlock this PDF. Enter the holder's PAN.", needs_password: true });
          return res.status(400).json({ error: "password_required", message: "This PDF is password-protected. Enter your PAN to unlock.", needs_password: true });
        }

        const pagePromises = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          pagePromises.push(pdf.getPage(i).then(page => page.getTextContent()).then(content => {
            if (!content.items.length) return "";
            const rows = new Map();
            for (const item of content.items) {
              // Round Y to nearest 1pt for row grouping. Using 0.5 was too strict —
              // adjacent glyphs of the same number can land on slightly different Y values
              // causing digits to be split across rows and produce wrong numbers (e.g. 81,963.607 → 81,963.07).
              const y = Math.round(item.transform?.[5] ?? 0);
              if (!rows.has(y)) rows.set(y, []);
              // Use item.width (actual rendered width from pdfjs) instead of str.length*5 estimate.
              rows.get(y).push({ x: item.transform?.[4] ?? 0, str: item.str, w: item.width ?? item.str.length * 6 });
            }
            const sortedRows = [...rows.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([, items]) => {
                items.sort((a, b) => a.x - b.x);
                let line = "";
                for (let j = 0; j < items.length; j++) {
                  if (j > 0) {
                    // Use actual rendered width (w) for accurate gap detection.
                    // gap ≤ 2: same token, concatenate directly (handles split digit groups)
                    // gap ≤ 15: same word, single space
                    // gap > 15: different column, tab separator
                    const gap = items[j].x - items[j-1].x - items[j-1].w;
                    if (gap > 15) line += "\t";
                    else if (gap > 2) line += " ";
                    // else: adjacent glyphs — concatenate with no separator
                  }
                  line += items[j].str;
                }
                return line;
              });
            return sortedRows.join("\n");
          }));
        }
        const pages = await Promise.all(pagePromises);
        const rawPdfText = pages.join("\n");
        console.log(`PDF: extracted ${rawPdfText.length} chars from ${pages.length} pages`);

        if (req.query.debug === "1" || req.body?.debug === "1") {
          const ineContexts = [...rawPdfText.matchAll(/\b(INE[A-Z0-9]{9})\b/g)].map(m => ({
            isin: m[1], position: m.index,
            before100: rawPdfText.substring(Math.max(0, m.index - 100), m.index).replace(/\n/g, "\\n"),
            after400: rawPdfText.substring(m.index, m.index + 400).replace(/\n/g, "\\n"),
          }));
          return res.json({ debug: true, totalLength: rawPdfText.length, pageCount: pages.length, rawText: rawPdfText.substring(0, 12000), ineContexts });
        }

        if (/consolidated\s*account\s*statement|nsdl|cdsl/i.test(rawPdfText) && /mutual\s*fund|demat|folio/i.test(rawPdfText)) {
          const result = parseNSDLCASStatement(rawPdfText);
          // If CAS format was detected but holdings array is empty, return early with
          // the parser warnings so the CAS modal can show them (don't fall through to
          // generic CSV parsing which would return a confusing empty result).
          if (result.holdings.length === 0) {
            return res.json({
              holdings: [], warnings: result.warnings || ["No holdings could be parsed from this CAS statement."],
              detected_type: "holdings", format: result.format || "CAS",
              holder_names: result.holder_names || [], holder_pans: result.holder_pans || [],
              holder_member_map: mapHoldersByPan(result.holder_names, result.holder_pans, panToMember),
              accounts: [], statement_date: result.statement_date || null,
              period_start: result.period_start || null, period_end: result.period_end || null,
              depository: result.depository || "",
            });
          }
          if (result.holdings.length > 0) {
            try {
              const amfiList = await getAmfiList();
              const amfiByIsin = new Map();
              for (const f of amfiList) { if (f.isin1) amfiByIsin.set(f.isin1, f); if (f.isin2) amfiByIsin.set(f.isin2, f); }
              for (const h of result.holdings) {
                if (h.type === "MF" && h.ticker?.startsWith("INF")) {
                  const entry = amfiByIsin.get(h.ticker);
                  if (entry) { h.name = entry.name; if (entry.scheme_code) h.scheme_code = entry.scheme_code; }
                }
                if (h.type === "MF" && h.units > 0 && h.purchase_value > 0 && (!h.purchase_nav || h.purchase_nav === 0)) {
                  h.purchase_nav = h.purchase_value / h.units;
                  h.purchase_price = h.purchase_nav;
                  h.avg_cost = h.purchase_nav;
                }
              }
            } catch (e) { console.log(`AMFI enrichment error: ${e.message}`); }

            const dematHoldings = result.holdings.filter(h => h.type !== "MF" && h.ticker === h.scheme_code && h.scheme_code?.startsWith("INE"));
            for (const h of dematHoldings) {
              try {
                let quotes = [];
                for (let attempt = 0; attempt < 2 && !quotes.length; attempt++) {
                  if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
                  quotes = await yahooSearch(h.scheme_code);
                }
                if (!quotes.length && h.name) {
                  const nameQuery = h.name.split(/\s+/).slice(0, 2).join(" ");
                  for (let attempt = 0; attempt < 2 && !quotes.length; attempt++) {
                    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
                    quotes = await yahooSearch(nameQuery);
                  }
                }
                const nse = quotes.find(q => q.symbol?.endsWith(".NS"));
                const bse = quotes.find(q => q.symbol?.endsWith(".BO"));
                const match = nse || bse;
                if (match) {
                  const resolved = match.symbol.replace(/\.(NS|BO)$/, "");
                  h.ticker = resolved;
                  await new Promise(r => setTimeout(r, 1500));
                  for (let priceAttempt = 0; priceAttempt < 2; priceAttempt++) {
                    try {
                      if (priceAttempt > 0) await new Promise(r => setTimeout(r, 2000));
                      const price = await yahooPrice(match.symbol);
                      if (price && price > 0) { h.current_price = price; h.current_value = h.units * price; h._needs_price = false; break; }
                    } catch {}
                  }
                }
              } catch (e) { console.log(`ISIN->Ticker error: ${e.message}`); }
              await new Promise(r => setTimeout(r, 2000));
            }

            const needsPriceHoldings = result.holdings.filter(h => h.type !== "MF" && h._needs_price && h.ticker && h.ticker !== h.scheme_code);
            for (const h of needsPriceHoldings) {
              try {
                const sym = `${h.ticker.toUpperCase()}.NS`;
                let price = await yahooPrice(sym);
                if (!price) price = await yahooPrice(`${h.ticker.toUpperCase()}.BO`);
                if (price && price > 0) { h.current_price = price; h.current_value = h.units * price; h._needs_price = false; }
              } catch {}
              await new Promise(r => setTimeout(r, 1500));
            }

            // CAS is flush-and-fill: count existing CAS holdings that will be replaced,
            // but do NOT mark them as _duplicate (which would trigger the dup-review UI).
            const { data: existingCAS } = await supabase.from("holdings").select("id").eq("user_id", req.user.id).eq("source", "cas");
            const replaceCount = (existingCAS || []).length;
            if (replaceCount > 0) result.warnings.push(`${replaceCount} existing CAS holding(s) will be replaced (flush & fill)`);
            return res.json({ ...result, detected_type: "holdings", accounts: result.accounts || [], holder_names: result.holder_names || [], holder_pans: result.holder_pans || [], holder_member_map: mapHoldersByPan(result.holder_names, result.holder_pans, panToMember), statement_date: result.statement_date || null, period_start: result.period_start || null, period_end: result.period_end || null, depository: result.depository || "" });
          }
        }

        if (/fidelity/i.test(rawPdfText) && /account\s*#/i.test(rawPdfText)) {
          const result = parseFidelityPDFStatement(rawPdfText);
          if (result.holdings.length > 0) {
            const { data: existing } = await supabase.from("holdings").select("name, ticker, scheme_code, type").eq("user_id", req.user.id);
            const existingSet = new Set((existing || []).map(h => `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`));
            result.holdings = result.holdings.map(h => ({ ...h, _duplicate: existingSet.has(`${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`) }));
            const dupCount = result.holdings.filter(h => h._duplicate).length;
            if (dupCount > 0) result.warnings.push(`${dupCount} holding(s) already exist (marked as duplicates)`);
            return res.json({ ...result, detected_type: "holdings", accounts: result.accounts || [] });
          }
        }

        text = pages.map(l => l.replace(/\s{2,}/g, "\t")).join("\n");
      } catch (pdfErr) {
        return res.status(400).json({ error: "Could not extract data from PDF: " + pdfErr.message });
      }
    } else {
      return res.status(400).json({ error: "Unsupported format. Use CSV, XLSX, or PDF." });
    }
  } catch (e) {
    return res.status(400).json({ error: IS_PROD ? "Failed to parse file" : "Parse error: " + e.message });
  }

  const holdingsResult = detectAndParseHoldings(text, req.file.originalname);
  const txnResult = parseTransactionCSV(text);
  const hScore = scoreHoldings(holdingsResult, text);
  const tScore = scoreTransactions(txnResult, text);
  const detectedType = tScore > hScore ? "transactions" : "holdings";

  if (detectedType === "transactions") return res.json({ ...txnResult, detected_type: "transactions" });

  const { data: existing } = await supabase.from("holdings")
    .select("name, ticker, scheme_code, type, units, purchase_price, current_price, purchase_value, current_value").eq("user_id", req.user.id);
  const existingMap = {};
  for (const h of (existing || [])) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    existingMap[key] = h;
  }
  holdingsResult.holdings = holdingsResult.holdings.map(h => {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    const ex = existingMap[key];
    return { ...h, _duplicate: !!ex, _existing: ex ? { units: ex.units, purchase_price: ex.purchase_price, current_price: ex.current_price, purchase_value: ex.purchase_value, current_value: ex.current_value } : null };
  });
  const dupCount = holdingsResult.holdings.filter(h => h._duplicate).length;
  if (dupCount > 0) holdingsResult.warnings.push(`${dupCount} holding(s) already exist in your portfolio`);
  res.json({ ...holdingsResult, detected_type: "holdings", accounts: holdingsResult.accounts || [] });
});

export default router;
