import { _pdfjsFontPath, pdfjsLib } from "./runtime.js";
import { parseAmtBudget } from "./dates.js";

// ── PDF text extraction ────────────────────────────────────────────────────────
// Most Indian bank/card statements are password-protected (DOB, PAN, or mobile
// number). `password` is optional — pdfjs will throw a PasswordException if the
// PDF is encrypted, which we turn into a recognizable PDF_PASSWORD_REQUIRED
// error so the caller (budget.service.js) can ask the user for one instead of
// reporting a generic "failed to parse" error.
export async function extractPDFText(buffer, password) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer), standardFontDataUrl: _pdfjsFontPath, useSystemFonts: true,
    ...(password ? { password } : {}),
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      // code 1 = NEED_PASSWORD (none supplied yet), code 2 = INCORRECT_PASSWORD (wrong one supplied)
      const incorrect = !!password;
      const pwErr = new Error(incorrect ? "Incorrect PDF password." : "This PDF is password-protected.");
      pwErr.code = "PDF_PASSWORD_REQUIRED";
      pwErr.incorrect = incorrect;
      throw pwErr;
    }
    throw e;
  }
  const pageTexts = [];
  for(let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lineMap = new Map();
    for(const item of content.items) {
      if(!item.str||!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if(!lineMap.has(y)) lineMap.set(y,[]);
      lineMap.get(y).push({x:item.transform[4],text:item.str});
    }
    const sortedYs = [...lineMap.keys()].sort((a,b)=>b-a);
    pageTexts.push(sortedYs.map(y=>lineMap.get(y).sort((a,b)=>a.x-b.x).map(i=>i.text).join("  ")).join("\n"));
  }
  return {text:pageTexts.join("\n"), pages:pdf.numPages};
}

// ── US PDF Parser ──────────────────────────────────────────────────────────────
export function parseUSPDF(rawText) {
  const rows = [];
  const amtPat = /\(?-?\$?[\d,]+\.\d{2}\)?/g;
  const yearMatch = rawText.match(/(?:statement|period|ending|through)[:\s]*.*?(20\d{2})/i)||rawText.match(/(20\d{2})/);
  const stmtYear = yearMatch?yearMatch[1]:new Date().getFullYear().toString();
  const normDate = d=>{const s=d.trim(); return /^\d{1,2}\/\d{1,2}$/.test(s)?s+"/"+stmtYear:s;};
  const isNoise = d=>!d||d.length<3||/^(page\b|total\b|balance\s*(forward|brought|carried)|opening|closing|statement|continued|beginning|ending|subtotal|daily\s*balance)/i.test(d);

  const isBofA = /bank\s*of\s*america|bofa|bankofamerica/i.test(rawText)||(/deposits?\s+and\s+other\s+(credits|additions)/i.test(rawText)&&/withdrawals?\s+and\s+other\s+(debits|subtractions)/i.test(rawText));
  if(isBofA) {
    let section = null;
    for(const line of rawText.split(/\n/)) {
      if(/deposits?\s+and\s+other\s+(credits|additions)/i.test(line)){section="credit";continue;}
      if(/withdrawals?\s+and\s+other\s+(debits|subtractions)/i.test(line)){section="debit";continue;}
      if(/ATM\s+and\s+debit\s+card\s+subtractions/i.test(line)){section="debit";continue;}
      if(/checks?\s+(paid|cleared)/i.test(line)){section="debit";continue;}
      if(/daily\s*balance|ending\s*balance|total\s*(deposits|withdrawals|subtractions|additions)/i.test(line)){section=null;continue;}
      if(!section) continue;
      const dateM=line.match(/^\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)/);
      if(!dateM) continue;
      const rest=dateM[2].trim();
      const amounts=[...rest.matchAll(amtPat)].map(m=>({val:Math.abs(parseAmtBudget(m[0])),idx:m.index})).filter(a=>a.val>0&&a.val<1e9);
      if(!amounts.length) continue;
      const desc=rest.substring(0,amounts[0].idx).replace(/\s+/g," ").trim();
      if(isNoise(desc)) continue;
      rows.push({date:normDate(dateM[1]),desc:desc.substring(0,120),debit:section==="debit"?amounts[0].val.toString():"",credit:section==="credit"?amounts[0].val.toString():"",balance:amounts.length>1?amounts[amounts.length-1].val.toString():"",ref:""});
    }
    if(rows.length>=1) return dedupeRows(rows);
  }

  for(const line of rawText.split(/\n/)) {
    const dateM=line.match(/^\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)/);
    if(!dateM) continue;
    const rest=dateM[2].trim();
    const amounts=[...rest.matchAll(amtPat)].map(m=>({val:parseAmtBudget(m[0]),idx:m.index})).filter(a=>Math.abs(a.val)>0&&Math.abs(a.val)<1e9);
    if(!amounts.length) continue;
    const desc=rest.substring(0,amounts[0].idx).replace(/\s+/g," ").trim();
    if(isNoise(desc)) continue;
    const amt=amounts[0].val;
    rows.push({date:normDate(dateM[1]),desc:desc.substring(0,120),debit:amt<0?Math.abs(amt).toString():(amounts.length>=2?Math.abs(amt).toString():""),credit:amt>0&&amounts.length<2?amt.toString():"",balance:amounts.length>2?Math.abs(amounts[amounts.length-1].val).toString():"",ref:""});
  }
  return dedupeRows(rows);
}

// ── Indian PDF Parser ──────────────────────────────────────────────────────────
export function parseIndianPDF(rawText) {
  const rows = [];
  const amtPat = /[\d,]+\.\d{2}/g;
  const months = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  // `'?` before the year tolerates the apostrophe-abbreviated year format common
  // on credit-card statements (e.g. "07 Jul '26") — same fix as parseDateIN.
  const inDatePat = new RegExp(`^\\s*(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4}|\\d{1,2}[\\s\\-]+(?:${months})[\\s\\-]+'?\\d{2,4})\\s+(.+)`,"i");
  // Broadened beyond plain statement boilerplate to also exclude credit-card
  // summary/section lines (reward points, GST, minimum due, section headers)
  // that otherwise look like transaction rows since they start with a date.
  const isNoise = d=>!d||d.length<3||/^(page|total|balance\s*(b\/f|c\/f|brought|carried)|opening|closing|statement|continued|subtotal|available\s*(credit\s*)?limit|minimum\s*(amount|payment)\s*due|total\s*(payment\s*)?due|reward\s*points?|finance\s*charge|late\s*(payment\s*)?(fee|charge)|gst|domestic\s*transactions?|international\s*transactions?|for\s*(any\s*)?(queries|questions)|customer\s*care|toll[\s-]*free)/i.test(d);
  for(const line of rawText.split(/\n/)) {
    const dateM=line.match(inDatePat);
    if(!dateM) continue;
    const rest=dateM[2].trim();
    const amounts=[...rest.matchAll(amtPat)].map(m=>({val:parseFloat(m[0].replace(/,/g,"")),idx:m.index,len:m[0].length})).filter(a=>a.val>0&&a.val<1e12);
    if(!amounts.length) continue;
    const desc=rest.substring(0,amounts[0].idx).replace(/\s+/g," ").trim();
    if(isNoise(desc)) continue;
    let debit="",credit="";
    // Indian credit-card PDF statements often print a single amount followed by
    // a "Debit"/"Credit" text label rather than two numeric columns (the same
    // pattern we handle for CSV/XLSX via drCr) — check the text right after the
    // last matched amount for that label before falling back to the older
    // "first amount = debit" positional guess.
    const lastAmt = amounts[amounts.length-1];
    const afterLastAmt = rest.slice(lastAmt.idx + lastAmt.len).toLowerCase();
    const labelMatch = /\b(debit|credit|dr|cr)\b/.exec(afterLastAmt);
    if (labelMatch && amounts.length <= 2) {
      const isCredit = /credit|^cr$/.test(labelMatch[1]);
      if (isCredit) credit = amounts[0].val.toString(); else debit = amounts[0].val.toString();
    } else if(amounts.length>=3){
      if(amounts[0].val>0&&amounts[1].val<0.01)debit=amounts[0].val.toString();
      else if(amounts[0].val<0.01&&amounts[1].val>0)credit=amounts[1].val.toString();
      else debit=amounts[0].val.toString();
    } else {
      debit=amounts[0].val.toString();
    }
    rows.push({date:dateM[1],desc:desc.substring(0,120),debit,credit,balance:amounts.length>1&&!labelMatch?amounts[amounts.length-1].val.toString():"",ref:""});
  }
  return dedupeRows(rows);
}

function dedupeRows(rows) {
  const seen=new Set();
  return rows.filter(r=>{const k=`${r.date}|${r.desc?.substring(0,30)}|${r.debit||r.credit}`;if(seen.has(k))return false;seen.add(k);return true;});
}
