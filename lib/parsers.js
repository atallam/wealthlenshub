import { createRequire } from "module";
import path from "path";
import { supabase } from "./db.js";

const _require = createRequire(import.meta.url);
const Papa = _require("papaparse");
const ExcelJS = _require("exceljs");
export const pdfjsLib = _require("pdfjs-dist/legacy/build/pdf.mjs");

// ── pdfjs font path ────────────────────────────────────────────────────────────
export const _pdfjsFontPath = path.join(
  path.dirname(_require.resolve("pdfjs-dist/package.json")),
  "standard_fonts"
) + "/";

// ── xlsx→CSV ───────────────────────────────────────────────────────────────────
export async function xlsxBufferToCSV(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return "";
  const csvRows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = (row.values || []).slice(1).map(v => {
      if (v == null) return "";
      if (typeof v === "object") {
        if (v.richText) return v.richText.map(r => r.text).join("");
        if (v.result != null) return String(v.result);
        if (v instanceof Date) return v.toISOString().split("T")[0];
        return String(v);
      }
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n"))
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    });
    csvRows.push(vals.join(","));
  });
  return csvRows.join("\n");
}

// ── autoCategorise ─────────────────────────────────────────────────────────────
export async function autoCategorise(description) {
  try {
    const { data: cats } = await supabase.from("budget_categories").select("id,name,keywords");
    const desc = description.toLowerCase();
    for (const cat of (cats || [])) {
      if (!cat.keywords) continue;
      for (const kw of cat.keywords.split(",").map(k => k.trim()).filter(Boolean)) {
        if (desc.includes(kw)) return cat.name;
      }
    }
  } catch { /* ignore */ }
  return "Other";
}

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
  other_in:    { region: "IN", label: "Other Indian Bank" },
  auto:        { region: "AUTO", label: "Auto-detect" },
};

// ── Date helpers ───────────────────────────────────────────────────────────────
export const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

export function parseDateUS(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) { const y = m1[3].length===2?"20"+m1[3]:m1[3]; return `${y}-${m1[1].padStart(2,"0")}-${m1[2].padStart(2,"0")}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m2 = s.match(/^([a-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m2) { const mo=MONTHS[m2[1].toLowerCase()]; if(mo) return `${m2[3]}-${String(mo).padStart(2,"0")}-${m2[2].padStart(2,"0")}`; }
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${new Date().getFullYear()}-${m3[1].padStart(2,"0")}-${m3[2].padStart(2,"0")}`;
  return null;
}

export function parseDateIN(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) { const y = m1[3].length===2?"20"+m1[3]:m1[3]; return `${y}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m2 = s.match(/^(\d{1,2})[\s\-]+([a-z]{3})[\s\-]+(\d{2,4})$/i);
  if (m2) { const mo=MONTHS[m2[2].toLowerCase()]; const y=m2[3].length===2?"20"+m2[3]:m2[3]; if(mo) return `${y}-${String(mo).padStart(2,"0")}-${m2[1].padStart(2,"0")}`; }
  return null;
}

export function parseDate(val) { return parseDateUS(val) || parseDateIN(val); }

export function parseAmtBudget(val) {
  if (!val) return 0;
  const s = String(val).trim();
  const neg = s.startsWith("(") || s.startsWith("-");
  const n = parseFloat(s.replace(/[₹$,()\s]/g, ""));
  return isNaN(n) ? 0 : Math.abs(n) * (neg ? -1 : 1);
}

export function parseDateForRegion(val, region) {
  if (region==="US") return parseDateUS(val);
  if (region==="IN") return parseDateIN(val);
  return parseDateUS(val) || parseDateIN(val);
}

// ── US Bank CSV Parsers ────────────────────────────────────────────────────────
function parseChaseCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c.includes("transaction date")||c==="date");
  const descI=h.findIndex(c=>c.includes("description"));
  const amtI=h.findIndex(c=>c.includes("amount"));
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[di],desc:r[descI],debit:amt<0?Math.abs(amt).toString():"",credit:amt>0?amt.toString():"",balance:"",ref:""};}).filter(r=>r.date&&r.desc);
}
function parseBofaCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c==="date"); const descI=h.findIndex(c=>c.includes("description")); const amtI=h.findIndex(c=>c==="amount"); const balI=h.findIndex(c=>c.includes("bal"));
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[di],desc:r[descI],debit:amt<0?Math.abs(amt).toString():"",credit:amt>0?amt.toString():"",balance:balI>=0?r[balI]:"",ref:""};}).filter(r=>r.date&&r.desc);
}
function parseWellsFargoCSV(rows, h, dataRows) {
  const amtI=h.findIndex(c=>c==="amount"); const descI=h.findIndex(c=>c.includes("description")||c.includes("memo")||c.includes("name")); const balI=h.findIndex(c=>c.includes("balance")); const actualDescI=descI>=0?descI:(h.length>2?h.length-1:1);
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[0],desc:r[actualDescI],debit:amt<0?Math.abs(amt).toString():"",credit:amt>0?amt.toString():"",balance:balI>=0?r[balI]:"",ref:""};}).filter(r=>r.date&&r.desc);
}
function parseCitiCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c==="date"); const descI=h.findIndex(c=>c.includes("description")); const debI=h.findIndex(c=>c==="debit"); const credI=h.findIndex(c=>c==="credit");
  return dataRows.map(r=>({date:r[di],desc:r[descI],debit:r[debI],credit:r[credI],balance:"",ref:""})).filter(r=>r.date&&r.desc);
}
function parseCapitalOneCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c.includes("transaction date")||c.includes("date")); const descI=h.findIndex(c=>c.includes("description")||c.includes("payee")); const debI=h.findIndex(c=>c.includes("debit")); const credI=h.findIndex(c=>c.includes("credit"));
  return dataRows.map(r=>({date:r[di],desc:r[descI],debit:r[debI],credit:r[credI],balance:"",ref:""})).filter(r=>r.date&&r.desc);
}
function parseAmexCSV(rows, h, dataRows) {
  const descI=h.findIndex(c=>c.includes("description")); const amtI=h.findIndex(c=>c==="amount"); const refI=h.findIndex(c=>c.includes("reference"));
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[0],desc:r[descI>=0?descI:1],debit:amt>0?amt.toString():"",credit:amt<0?Math.abs(amt).toString():"",balance:"",ref:refI>=0?r[refI]:""};}).filter(r=>r.date&&r.desc);
}
function parseDiscoverCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c.includes("trans")); const descI=h.findIndex(c=>c.includes("description")); const amtI=h.findIndex(c=>c==="amount");
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[di],desc:r[descI],debit:amt>0?amt.toString():"",credit:amt<0?Math.abs(amt).toString():"",balance:"",ref:""};}).filter(r=>r.date&&r.desc);
}
function parseUSBankCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c==="date"); const nameI=h.findIndex(c=>c==="name"); const memoI=h.findIndex(c=>c==="memo"); const amtI=h.findIndex(c=>c==="amount");
  return dataRows.map(r=>{const amt=parseAmtBudget(r[amtI]); return {date:r[di],desc:[r[nameI],r[memoI]].filter(Boolean).join(" - "),debit:amt<0?Math.abs(amt).toString():"",credit:amt>0?amt.toString():"",balance:"",ref:""};}).filter(r=>r.date&&r.desc);
}
function parseHDFCCSV(rows, h, dataRows) { return dataRows.map(r=>({date:r[0],desc:r[1],debit:r[4],credit:r[5],balance:r[6],ref:r[2]})).filter(r=>r.date&&r.desc); }
function parseICICICSV(rows, h, dataRows) { return dataRows.map(r=>({date:r[2]||r[1],desc:r[4],debit:r[5],credit:r[6],balance:r[7],ref:r[3]})).filter(r=>r.date&&r.desc); }
function parseAxisCSV(rows, h, dataRows) { return dataRows.map(r=>({date:r[0],desc:r[2],debit:r[3],credit:r[4],balance:r[5],ref:r[1]})).filter(r=>r.date&&r.desc); }
function parseSBICSV(rows, h, dataRows) { return dataRows.map(r=>({date:r[0],desc:r[2],debit:r[4],credit:r[5],balance:r[6],ref:r[3]})).filter(r=>r.date&&r.desc); }
function parseKotakCSV(rows, h, dataRows) {
  const di=h.findIndex(c=>c.includes("transaction date")||c.includes("date")); const descI=h.findIndex(c=>c.includes("description")||c.includes("particular")||c.includes("narration")); const debI=h.findIndex(c=>c.includes("debit")||c.includes("withdrawal")); const credI=h.findIndex(c=>c.includes("credit")||c.includes("deposit")); const balI=h.findIndex(c=>c.includes("balance"));
  return dataRows.map(r=>({date:r[di],desc:r[descI],debit:r[debI],credit:r[credI],balance:balI>=0?r[balI]:""})).filter(r=>r.date&&r.desc);
}

function genericCSV(rows) {
  const h=(rows[0]||[]).map(c=>(c||"").toLowerCase());
  const di=h.findIndex(c=>/date/i.test(c)); const dsc=h.findIndex(c=>/desc|narr|particular|remark/i.test(c)); const deb=h.findIndex(c=>/debit|withdrawal|dr/i.test(c)); const crd=h.findIndex(c=>/credit|deposit|cr/i.test(c)); const amt=h.findIndex(c=>/amount/i.test(c));
  if(di<0||(dsc<0&&amt<0)) return [];
  return rows.slice(1).map(r=>({date:r[di],desc:dsc>=0?r[dsc]:r[1],debit:deb>=0?r[deb]:(amt>=0?r[amt]:""),credit:crd>=0?r[crd]:"",balance:"",ref:""})).filter(r=>r.date&&r.desc);
}

export function autoDetectBank(h) {
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

export const CSV_PARSERS = {
  chase:parseChaseCSV, bofa:parseBofaCSV, wells_fargo:parseWellsFargoCSV,
  citi:parseCitiCSV, capital_one:parseCapitalOneCSV, amex:parseAmexCSV,
  discover:parseDiscoverCSV, us_bank:parseUSBankCSV,
  hdfc:parseHDFCCSV, icici:parseICICICSV, axis:parseAxisCSV, sbi:parseSBICSV, kotak:parseKotakCSV,
};

export function parseCSV(text, bankKey) {
  const result = Papa.parse(text.trim(), { header:false, skipEmptyLines:true });
  const rows = result.data;
  if(!rows.length) return {rows:[],detectedBank:null};
  const headerRow = rows.find(r=>r.some(c=>/date|narration|description|particulars|transaction/i.test(c)));
  if(!headerRow&&!bankKey) return {rows:genericCSV(rows),detectedBank:null};
  const h = headerRow ? headerRow.map(c=>(c||"").toLowerCase().trim()) : [];
  const dataRows = headerRow ? rows.slice(rows.indexOf(headerRow)+1) : rows.slice(1);
  if(bankKey&&bankKey!=="auto"&&bankKey!=="other_us"&&bankKey!=="other_in"&&CSV_PARSERS[bankKey])
    return {rows:CSV_PARSERS[bankKey](rows,h,dataRows), detectedBank:bankKey};
  const detected = autoDetectBank(h);
  if(detected&&CSV_PARSERS[detected]) return {rows:CSV_PARSERS[detected](rows,h,dataRows), detectedBank:detected};
  return {rows:genericCSV(rows), detectedBank:null};
}

// ── PDF text extraction ────────────────────────────────────────────────────────
export async function extractPDFText(buffer) {
  const loadingTask = pdfjsLib.getDocument({data:new Uint8Array(buffer), standardFontDataUrl:_pdfjsFontPath, useSystemFonts:true});
  const pdf = await loadingTask.promise;
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
  const inDatePat = new RegExp(`^\\s*(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4}|\\d{1,2}[\\s\\-]+(?:${months})[\\s\\-]+\\d{2,4})\\s+(.+)`,"i");
  const isNoise = d=>!d||d.length<3||/^(page|total|balance\s*(b\/f|c\/f|brought|carried)|opening|closing|statement|continued|subtotal)/i.test(d);
  for(const line of rawText.split(/\n/)) {
    const dateM=line.match(inDatePat);
    if(!dateM) continue;
    const rest=dateM[2].trim();
    const amounts=[...rest.matchAll(amtPat)].map(m=>({val:parseFloat(m[0].replace(/,/g,"")),idx:m.index})).filter(a=>a.val>0&&a.val<1e12);
    if(!amounts.length) continue;
    const desc=rest.substring(0,amounts[0].idx).replace(/\s+/g," ").trim();
    if(isNoise(desc)) continue;
    let debit="",credit="";
    if(amounts.length>=3){if(amounts[0].val>0&&amounts[1].val<0.01)debit=amounts[0].val.toString();else if(amounts[0].val<0.01&&amounts[1].val>0)credit=amounts[1].val.toString();else debit=amounts[0].val.toString();}
    else{debit=amounts[0].val.toString();}
    rows.push({date:dateM[1],desc:desc.substring(0,120),debit,credit,balance:amounts.length>1?amounts[amounts.length-1].val.toString():"",ref:""});
  }
  return dedupeRows(rows);
}

export function dedupeRows(rows) {
  const seen=new Set();
  return rows.filter(r=>{const k=`${r.date}|${r.desc?.substring(0,30)}|${r.debit||r.credit}`;if(seen.has(k))return false;seen.add(k);return true;});
}

// ── pNum ───────────────────────────────────────────────────────────────────────
export function pNum(val) {
  if(val===null||val===undefined||val==="") return 0;
  const n=parseFloat(String(val).replace(/[₹$,\s]/g,"").trim());
  return isNaN(n)?0:n;
}

// ── classifyUSAsset ────────────────────────────────────────────────────────────
export function classifyUSAsset(symbol, name, type) {
  const nm=(name||"").toLowerCase();
  const sym=(symbol||"").toUpperCase();
  if(/crypto|bitcoin|ethereum|btc|eth|sol|ada|doge|bnb/i.test(nm)||sym.includes("-USD")||sym.includes("-BTC")) return "CRYPTO";
  if(/\betf\b|ishares|spdr|\bindex\s*fund\b|vanguard.*index/i.test(nm)) return "US_ETF";
  const etfTickers=/\b(QQQ|VOO|VTI|SPY|IWM|ARKK|DIA|EEM|VXUS|BND|AGG|TLT|SCHD|VEA|VWO|VGT|XLF|XLK|XLE|XLV|GLD|SLV|IEMG|IVV|IJR|IJH|VIG|JEPI|JEPQ|HYG|LQD|VNQ|VCIT|VCSH|BSV|EMB)\b/i;
  if(etfTickers.test(sym)||etfTickers.test(nm)) return "US_ETF";
  if(/bond|treasury|t-bill|note|fixed.income|tips/i.test(nm)) return "US_BOND";
  if(type&&/etf/i.test(type)) return "US_ETF";
  return "US_STOCK";
}

// ── Individual broker parsers ──────────────────────────────────────────────────
function parseZerodhaHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>c==="instrument"),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\.?\s*cost/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/cur\.?\s*val/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]),ltp=pNum(r[col.ltp]);if(units===0&&avg===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.replace(/\s+/g,"").toUpperCase(),units,purchase_price:avg,current_price:ltp||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*(ltp||avg)});}
  return {format:"Zerodha Console",holdings,warnings};
}
function parseGrowwHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/company\s*name/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/avg\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||r[col.symbol]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:(r[col.symbol]||"").trim().toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.ltp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"Groww",holdings,warnings};
}
function parseICICIDirectHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>/stock\s*symbol/i.test(c)),name:h.findIndex(c=>/stock\s*name/i.test(c)),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\s*buy/i.test(c)),cmp:h.findIndex(c=>c==="cmp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||r[col.symbol]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:(r[col.symbol]||"").trim().toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.cmp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"ICICI Direct",holdings,warnings};
}
function parseHDFCSecHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>/scrip\s*name/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/avg\s*cost/i.test(c)),mp:h.findIndex(c=>/market\s*price/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.split(/\s+/)[0].toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.mp])||avg,purchase_value:units*avg,current_value:pNum(r[col.mv])||units*avg});}
  return {format:"HDFC Securities",holdings,warnings};
}
function parseUpstoxHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>/trading\s*symbol/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/average\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),close:h.findIndex(c=>/close\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]),ltp=pNum(r[col.ltp])||pNum(r[col.close])||avg;if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}holdings.push({name:symbol,type:"IN_STOCK",ticker:symbol.toUpperCase(),units,purchase_price:avg,current_price:ltp,purchase_value:units*avg,current_value:units*ltp});}
  return {format:"Upstox",holdings,warnings};
}
function parseAngelOneHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={scrip:h.findIndex(c=>c==="scrip"),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.scrip]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.ltp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"Angel One",holdings,warnings};
}
function parseMFExportHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={scheme:h.findIndex(c=>/scheme\s*name/i.test(c)),units:h.findIndex(c=>/unit/i.test(c)),nav:h.findIndex(c=>/nav/i.test(c)),cv:h.findIndex(c=>/current\s*value/i.test(c)),inv:h.findIndex(c=>/invest/i.test(c)),code:h.findIndex(c=>/amfi|scheme\s*code/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.scheme]||"").trim();if(!name)continue;const units=pNum(r[col.units]),nav=pNum(r[col.nav]);if(units===0){warnings.push(`Skipped "${name}": zero units`);continue;}holdings.push({name,type:"MF",ticker:"",scheme_code:col.code>=0?(r[col.code]||"").trim():"",units,purchase_nav:col.inv>=0?pNum(r[col.inv])/(units||1):nav,current_nav:nav,purchase_value:pNum(r[col.inv])||units*nav,current_value:pNum(r[col.cv])||units*nav});}
  return {format:"Mutual Fund Export",holdings,warnings};
}
function parseNativeCSVHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const ci=patterns=>h.findIndex(c=>patterns.some(p=>typeof p==="string"?c===p:p.test(c)));
  const col={name:ci(["name"]),type:ci(["type"]),ticker:ci(["ticker"]),code:ci(["schemecode",/scheme.?code/i]),units:ci(["units"]),pp:ci(["purchaseprice",/purchase.?price/i]),cp:ci(["currentprice",/current.?price/i]),pnav:ci(["purchasenav",/purchase.?nav/i]),cnav:ci(["currentnav",/current.?nav/i]),pv:ci(["purchasevalue",/purchase.?value/i,/invested/i]),cv:ci(["currentvalue",/current.?value/i]),principal:ci(["principal"]),rate:ci(["interestrate",/interest.?rate/i]),start:ci(["startdate",/start.?date/i]),maturity:ci(["maturitydate",/maturity.?date/i]),member:ci(["member"])};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=col.name>=0?(r[col.name]||"").trim():"";if(!name)continue;holdings.push({name,type:col.type>=0?(r[col.type]||"IN_STOCK").toUpperCase():"IN_STOCK",ticker:col.ticker>=0?(r[col.ticker]||"").trim():"",scheme_code:col.code>=0?(r[col.code]||"").trim():"",units:col.units>=0?pNum(r[col.units]):0,purchase_price:col.pp>=0?pNum(r[col.pp]):0,current_price:col.cp>=0?pNum(r[col.cp]):0,purchase_nav:col.pnav>=0?pNum(r[col.pnav]):0,current_nav:col.cnav>=0?pNum(r[col.cnav]):0,purchase_value:col.pv>=0?pNum(r[col.pv]):0,current_value:col.cv>=0?pNum(r[col.cv]):0,principal:col.principal>=0?pNum(r[col.principal]):0,interest_rate:col.rate>=0?pNum(r[col.rate]):0,start_date:col.start>=0?(r[col.start]||""):"",maturity_date:col.maturity>=0?(r[col.maturity]||""):"",_member_name:col.member>=0?(r[col.member]||"").trim():""});}
  return {format:"WealthLens CSV",holdings,warnings};
}
function parseSchwabHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"),qty:h.findIndex(c=>/quantity/i.test(c)),price:h.findIndex(c=>c==="price"),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||symbol==="Account Total"||symbol==="Cash & Cash Investments")continue;const name=(r[col.name]||symbol).trim(),units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const mv=pNum(r[col.mv]),cb=pNum(r[col.cb]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Charles Schwab",holdings,warnings};
}
function parseFidelityHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={account:h.findIndex(c=>/account/i.test(c)),symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/last\s*price|closing\s*price|price/i.test(c)),cv:h.findIndex(c=>/current\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis(?!\s*per)/i.test(c)),cbps:h.findIndex(c=>/cost\s*basis\s*per\s*share/i.test(c)),type:h.findIndex(c=>c==="type")};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/pending|cash|core|total|overall/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const cv=pNum(r[col.cv]),cb=pNum(r[col.cb]),cbps=col.cbps>=0?pNum(r[col.cbps]):(cb&&units?cb/units:0),acct=col.account>=0?(r[col.account]||"").trim():"",assetType=col.type>=0?(r[col.type]||"").trim():"",type=classifyUSAsset(symbol,name,assetType);if(acct)accounts.add(acct);holdings.push({name,type,ticker:symbol,units,purchase_price:cbps||price,current_price:price,purchase_value:cb||units*(cbps||price),current_value:cv||units*price,_account_name:acct});}
  return {format:"Fidelity",holdings,warnings,accounts:[...accounts]};
}
function parseRobinhoodHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>c==="instrument"),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/average\s*cost/i.test(c)),equity:h.findIndex(c=>/equity/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}const equity=pNum(r[col.equity]),ticker=name.length<=6&&/^[A-Z]+$/.test(name)?name:name.split(/\s*[-–]\s*/)[0].trim(),type=classifyUSAsset(ticker,name);holdings.push({name,type,ticker:ticker.toUpperCase(),units,purchase_price:avg,current_price:equity&&units?equity/units:avg,purchase_value:units*avg,current_value:equity||units*avg});}
  return {format:"Robinhood",holdings,warnings};
}
function parseVanguardHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>/investment\s*name/i.test(c)),symbol:h.findIndex(c=>c==="symbol"),shares:h.findIndex(c=>/shares/i.test(c)),price:h.findIndex(c=>/share\s*price/i.test(c)),value:h.findIndex(c=>/total\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim(),symbol=(r[col.symbol]||"").trim();if(!name&&!symbol)continue;const units=pNum(r[col.shares]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${name||symbol}": zero shares`);continue;}const value=pNum(r[col.value]),type=classifyUSAsset(symbol,name);holdings.push({name:name||symbol,type,ticker:symbol.toUpperCase(),units,purchase_price:price,current_price:price,purchase_value:units*price,current_value:value||units*price});}
  return {format:"Vanguard",holdings,warnings};
}
function parseIBKRHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"),asset:h.findIndex(c=>/asset\s*class/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),costP:h.findIndex(c=>/cost\s*price/i.test(c)||/cost\s*basis.*price/i.test(c)),closeP:h.findIndex(c=>/close\s*price/i.test(c)||/mark.*price/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/unrealized/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|^$/i.test(symbol))continue;const name=(r[col.name]||symbol).trim(),units=pNum(r[col.qty]),costP=pNum(r[col.costP]),closeP=pNum(r[col.closeP]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const assetClass=(r[col.asset]||"").toUpperCase();let type=classifyUSAsset(symbol,name);if(assetClass==="OPT"||assetClass==="FOP"){warnings.push(`Skipped "${symbol}": options not supported`);continue;}if(assetClass==="BOND")type="US_BOND";if(assetClass==="CRYPTO")type="CRYPTO";holdings.push({name,type,ticker:symbol,units,purchase_price:costP,current_price:closeP||costP,purchase_value:units*costP,current_value:pNum(r[col.value])||units*(closeP||costP)});}
  return {format:"Interactive Brokers",holdings,warnings};
}
function parseETRADEHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"||c==="name"),qty:h.findIndex(c=>/qty|quantity/i.test(c)),pp:h.findIndex(c=>/price\s*paid/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|current\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),pp=pNum(r[col.pp]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):pp,type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:pp,current_price:price,purchase_value:units*pp,current_value:pNum(r[col.mv])||units*price});}
  return {format:"E*TRADE / TD Ameritrade",holdings,warnings};
}
function parseCoinbaseHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={asset:h.findIndex(c=>c==="asset"),qty:h.findIndex(c=>/quantity/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/cost/i.test(c)),spot:h.findIndex(c=>/spot\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const asset=(r[col.asset]||"").trim();if(!asset)continue;const units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${asset}": zero quantity`);continue;}const cb=pNum(r[col.cb]),value=pNum(r[col.value]),spot=pNum(r[col.spot]);holdings.push({name:asset,type:"CRYPTO",ticker:`${asset.toUpperCase()}-USD`,units,purchase_price:cb&&units?cb/units:spot,current_price:spot||(value&&units?value/units:0),purchase_value:cb||units*spot,current_value:value||units*spot});}
  return {format:"Coinbase",holdings,warnings};
}
function parseMerrillHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|name|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/cost/i.test(c)&&!/gain/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash|money\s*market|pending/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const value=pNum(r[col.value]),cb=col.cb>=0?pNum(r[col.cb]):0,acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:value||units*price,_account_name:acct});}
  return {format:"Merrill Edge",holdings,warnings,accounts:[...accounts]};
}
function parseJPMorganHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|name|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/price/i.test(c)&&!/cost/i.test(c)&&!/paid/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash|money\s*market|pending|sweep/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=col.price>=0?pNum(r[col.price]):0;if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const mv=pNum(r[col.mv]),cb=col.cb>=0?pNum(r[col.cb]):0,acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price,_account_name:acct});}
  return {format:"J.P. Morgan",holdings,warnings,accounts:[...accounts]};
}
function parseWebullHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),qty:h.findIndex(c=>/qty|quantity|shares/i.test(c)),avg:h.findIndex(c=>/avg\s*cost/i.test(c)),mv:h.findIndex(c=>/mkt\s*value|market\s*val/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:avg,current_price:price||avg,purchase_value:units*avg,current_value:mv||units*(price||avg)});}
  return {format:"Webull",holdings,warnings};
}
function parseSoFiHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),qty:h.findIndex(c=>/quantity|shares/i.test(c)),avg:h.findIndex(c=>/average\s*price/i.test(c)),price:h.findIndex(c=>/current\s*price|last\s*price/i.test(c)),mv:h.findIndex(c=>/market\s*value|value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),type:h.findIndex(c=>c==="type")};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=col.mv>=0?pNum(r[col.mv]):0,cb=col.cb>=0?pNum(r[col.cb]):0,assetType=col.type>=0?(r[col.type]||"").trim():"",type=classifyUSAsset(symbol,name,assetType);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:avg,current_price:price,purchase_value:cb||units*avg,current_value:mv||units*price});}
  return {format:"SoFi Invest",holdings,warnings};
}
function parseWealthfrontHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={ticker:h.findIndex(c=>/ticker|symbol/i.test(c)),name:h.findIndex(c=>/description|name/i.test(c)),shares:h.findIndex(c=>/shares|quantity/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const ticker=(r[col.ticker]||"").trim();if(!ticker||/total|cash/i.test(ticker))continue;const name=col.name>=0?(r[col.name]||ticker).trim():ticker,units=pNum(r[col.shares]);if(units===0){warnings.push(`Skipped "${ticker}": zero shares`);continue;}const cb=pNum(r[col.cb]),mv=pNum(r[col.mv]),price=mv&&units?mv/units:(cb&&units?cb/units:0),acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(ticker,name);holdings.push({name,type,ticker,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price,_account_name:acct});}
  return {format:"Wealthfront",holdings,warnings,accounts:[...accounts]};
}
function parseBettermentHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),asset:h.findIndex(c=>/asset\s*class/i.test(c)),shares:h.findIndex(c=>/shares|quantity/i.test(c)),price:h.findIndex(c=>/^price$/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.shares]),price=col.price>=0?pNum(r[col.price]):0;if(units===0){warnings.push(`Skipped "${symbol}": zero shares`);continue;}const mv=pNum(r[col.mv]),cb=pNum(r[col.cb]),assetClass=col.asset>=0?(r[col.asset]||"").trim():"";let type=classifyUSAsset(symbol,name);if(/bond|fixed/i.test(assetClass))type="US_BOND";holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Betterment",holdings,warnings};
}
function parseFirstradeHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),cps:h.findIndex(c=>/cost\s*per\s*share/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|current\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),cps=pNum(r[col.cps]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):cps,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cps,current_price:price||cps,purchase_value:units*cps,current_value:mv||units*(price||cps)});}
  return {format:"Firstrade",holdings,warnings};
}
function parseAllyHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description/i.test(c)),qty:h.findIndex(c=>/qty|quantity|shares/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const cb=pNum(r[col.cb]),mv=pNum(r[col.mv]),price=col.price>=0?pNum(r[col.price]):(mv&&units?mv/units:0),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Ally Invest",holdings,warnings};
}
function parsePublicHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"),shares:h.findIndex(c=>/shares|quantity/i.test(c)),avg:h.findIndex(c=>/average\s*cost/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/current\s*price|last\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.shares]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero shares`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:avg,current_price:price||avg,purchase_value:units*avg,current_value:mv||units*(price||avg)});}
  return {format:"Public.com",holdings,warnings};
}
function parseTastytradeHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),itype:h.findIndex(c=>/instrument\s*type/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),tp:h.findIndex(c=>/trade\s*price|avg\s*price/i.test(c)),mark:h.findIndex(c=>/mark/i.test(c)),netliq:h.findIndex(c=>/net\s*liq/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const itype=col.itype>=0?(r[col.itype]||"").trim():"";if(/option|put|call|future/i.test(itype)){warnings.push(`Skipped "${symbol}": ${itype} not supported`);continue;}const units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const tp=pNum(r[col.tp]),mark=pNum(r[col.mark]),netliq=pNum(r[col.netliq]),cb=col.cb>=0?pNum(r[col.cb]):0,type=/crypto/i.test(itype)?"CRYPTO":classifyUSAsset(symbol,symbol);holdings.push({name:symbol,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:tp,current_price:mark||tp,purchase_value:cb||units*tp,current_value:netliq||units*(mark||tp)});}
  return {format:"Tastytrade",holdings,warnings};
}
function parseGenericHoldings(rows,headerIdx){
  const h=(rows[headerIdx]||[]).map(c=>(c||"").toLowerCase().trim());
  const ci=patterns=>h.findIndex(c=>patterns.some(p=>c.includes(p)));
  const nameI=ci(["name","instrument","scrip","stock","symbol","fund","scheme"]),qtyI=ci(["qty","quantity","units","shares"]),priceI=ci(["avg","cost","buy price","purchase"]),ltpI=ci(["ltp","market price","current price","cmp","close"]),valI=ci(["current value","market value","value"]),acctI=ci(["account"]);
  const holdings=[],warnings=[],accounts=new Set();
  if(nameI<0){warnings.push("Could not identify a Name/Instrument column.");return {format:"Unknown",holdings,warnings};}
  const allText=rows.slice(headerIdx+1).flat().join(" ").toLowerCase();
  const isIndian=/\.ns\b|\.bo\b|\bnse\b|\bbse\b|\binr\b|\bnifty\b|\bsensex\b|\bamfi\b/i.test(allText)||h.some(c=>/narration|scrip|scheme.?code|nse|bse/i.test(c));
  for(const r of rows.slice(headerIdx+1)){const name=(r[nameI]||"").trim();if(!name)continue;const units=qtyI>=0?pNum(r[qtyI]):0,avg=priceI>=0?pNum(r[priceI]):0,ltp=ltpI>=0?pNum(r[ltpI]):avg,acct=acctI>=0?(r[acctI]||"").trim():"";if(acct)accounts.add(acct);const type=isIndian?"IN_STOCK":classifyUSAsset(name.split(/\s+/)[0],name);holdings.push({name,type,ticker:name.split(/\s+/)[0].toUpperCase(),units,purchase_price:avg,current_price:ltp,purchase_value:units*avg,current_value:valI>=0?pNum(r[valI]):units*ltp,_account_name:acct});}
  return {format:`Generic CSV (${isIndian?"Indian":"US"})`,holdings,warnings,accounts:[...accounts]};
}

// ── detectAndParseHoldings ─────────────────────────────────────────────────────
export function detectAndParseHoldings(text, fileName="") {
  const result = Papa.parse(text.trim(), {header:false, skipEmptyLines:true});
  const rows = result.data;
  if(!rows.length) return {format:"unknown",holdings:[],warnings:["Empty file"]};
  const headerIdx = rows.findIndex(r=>r.some(c=>/instrument|stock|symbol|scrip|isin|scheme|fund|name|ticker/i.test(c||"")));
  if(headerIdx>=0) {
    const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
    if(h.some(c=>c==="instrument")&&h.some(c=>/avg\.?\s*cost/i.test(c))) return parseZerodhaHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/company\s*name/i.test(c))&&h.some(c=>/avg\s*price/i.test(c))) return parseGrowwHoldings(rows,headerIdx);
    if(h.some(c=>/stock\s*symbol/i.test(c))&&h.some(c=>/avg\s*buy/i.test(c))) return parseICICIDirectHoldings(rows,headerIdx);
    if(h.some(c=>/scrip\s*name/i.test(c))&&h.some(c=>/avg\s*cost/i.test(c))) return parseHDFCSecHoldings(rows,headerIdx);
    if(h.some(c=>/trading\s*symbol/i.test(c))&&h.some(c=>/average\s*price/i.test(c))) return parseUpstoxHoldings(rows,headerIdx);
    if(h.some(c=>c==="scrip")&&h.some(c=>/avg\s*price/i.test(c))&&h.some(c=>/overall/i.test(c))) return parseAngelOneHoldings(rows,headerIdx);
    if(h.some(c=>/scheme\s*name/i.test(c))&&h.some(c=>/unit/i.test(c))&&h.some(c=>/nav/i.test(c))) return parseMFExportHoldings(rows,headerIdx);
    if(h.some(c=>c==="name")&&h.some(c=>c==="type")) return parseNativeCSVHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>c==="description")&&h.some(c=>/market\s*value/i.test(c))) return parseSchwabHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/last\s*price|closing\s*price/i.test(c))&&h.some(c=>/current\s*value|total\s*gain/i.test(c))) return parseFidelityHoldings(rows,headerIdx);
    if(h.some(c=>c==="instrument")&&h.some(c=>/average\s*cost/i.test(c))&&h.some(c=>/equity/i.test(c))) return parseRobinhoodHoldings(rows,headerIdx);
    if(h.some(c=>/investment\s*name/i.test(c))&&h.some(c=>/share\s*price/i.test(c))) return parseVanguardHoldings(rows,headerIdx);
    if(h.some(c=>/asset\s*class/i.test(c))&&h.some(c=>/cost\s*price/i.test(c)||/cost\s*basis/i.test(c))) return parseIBKRHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/price\s*paid/i.test(c))) return parseETRADEHoldings(rows,headerIdx);
    if(h.some(c=>c==="asset")&&h.some(c=>/cost\s*basis/i.test(c))&&h.some(c=>/spot\s*price|value/i.test(c))) return parseCoinbaseHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/quantity/i.test(c))&&h.some(c=>/last\s*price/i.test(c))&&h.some(c=>/value/i.test(c))&&!h.some(c=>/current\s*value|total\s*gain/i.test(c))) return parseMerrillHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/avg\s*cost/i.test(c))&&h.some(c=>/mkt\s*value|market\s*val/i.test(c))&&h.some(c=>/unrealized/i.test(c))) return parseWebullHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/average\s*price/i.test(c))&&h.some(c=>/current\s*price/i.test(c))&&h.some(c=>/total\s*return/i.test(c))) return parseSoFiHoldings(rows,headerIdx);
    if(h.some(c=>/ticker/i.test(c))&&h.some(c=>/shares/i.test(c))&&h.some(c=>/cost\s*basis/i.test(c))&&h.some(c=>/market\s*value/i.test(c))) return parseWealthfrontHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/asset\s*class/i.test(c))&&h.some(c=>/market\s*value/i.test(c))&&h.some(c=>/cost\s*basis/i.test(c))&&!h.some(c=>/cost\s*price/i.test(c))) return parseBettermentHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/cost\s*per\s*share/i.test(c))) return parseFirstradeHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/description/i.test(c))&&h.some(c=>/quantity/i.test(c))&&h.some(c=>/gain|loss|g\/l/i.test(c))&&h.some(c=>/market\s*value/i.test(c))&&!h.some(c=>/asset\s*class/i.test(c))) return parseJPMorganHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/description/i.test(c))&&h.some(c=>/cost\s*basis/i.test(c))&&h.some(c=>/market\s*value/i.test(c))&&!h.some(c=>/asset\s*class/i.test(c))&&!h.some(c=>/price\s*paid/i.test(c))) return parseAllyHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>c==="name")&&h.some(c=>/average\s*cost/i.test(c))&&h.some(c=>/market\s*value/i.test(c))) return parsePublicHoldings(rows,headerIdx);
    if(h.some(c=>c==="symbol")&&h.some(c=>/instrument\s*type/i.test(c))&&h.some(c=>/net\s*liq/i.test(c))) return parseTastytradeHoldings(rows,headerIdx);
  }
  return parseGenericHoldings(rows, headerIdx>=0?headerIdx:0);
}

// ── parseTransactionCSV ────────────────────────────────────────────────────────
export function parseTransactionCSV(text) {
  const result = Papa.parse(text.trim(), {header:false, skipEmptyLines:true});
  const rows = result.data;
  if(!rows.length) return {format:"unknown",transactions:[],warnings:["Empty file"]};
  const headerIdx = rows.findIndex(r=>r.some(c=>/date|trade|type|buy|sell|units|quantity|price|amount/i.test(c||"")));
  if(headerIdx<0) return {format:"unknown",transactions:[],warnings:["No recognizable header row"]};
  const h = rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const dataRows = rows.slice(headerIdx+1);

  // Zerodha Tradebook
  if(h.some(c=>/trade\s*date/i.test(c))&&h.some(c=>/trade\s*type/i.test(c))) {
    const col={date:h.findIndex(c=>/trade\s*date/i.test(c)),symbol:h.findIndex(c=>/symbol/i.test(c)),type:h.findIndex(c=>/trade\s*type/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),price:h.findIndex(c=>/price/i.test(c))};
    const transactions=[],warnings=[];
    for(const r of dataRows){const symbol=(r[col.symbol]||"").trim();if(!symbol)continue;const date=parseDate(r[col.date]);if(!date){warnings.push(`Skipped: invalid date "${r[col.date]}"`);continue;}transactions.push({_symbol:symbol,txn_type:(r[col.type]||"").toUpperCase().includes("SELL")?"SELL":"BUY",units:pNum(r[col.qty]),price:pNum(r[col.price]),txn_date:date,notes:"Zerodha tradebook import"});}
    return {format:"Zerodha Tradebook",transactions,warnings};
  }

  // Groww Transactions
  if(h.some(c=>c==="symbol")&&h.some(c=>/type/i.test(c))&&h.some(c=>/quantity/i.test(c))) {
    const col={date:h.findIndex(c=>/date/i.test(c)),symbol:h.findIndex(c=>/symbol/i.test(c)),type:h.findIndex(c=>/type/i.test(c)),qty:h.findIndex(c=>/quantity|units/i.test(c)),price:h.findIndex(c=>/price/i.test(c))};
    const transactions=[],warnings=[];
    for(const r of dataRows){const symbol=(r[col.symbol]||"").trim();if(!symbol)continue;const date=parseDate(r[col.date]);if(!date){warnings.push(`Skipped: invalid date "${r[col.date]}"`);continue;}transactions.push({_symbol:symbol,txn_type:(r[col.type]||"").toUpperCase().includes("SELL")?"SELL":"BUY",units:pNum(r[col.qty]),price:pNum(r[col.price]),txn_date:date,notes:"Groww import"});}
    return {format:"Groww Transactions",transactions,warnings};
  }

  // Generic
  const ci=patterns=>h.findIndex(c=>patterns.some(p=>c.includes(p)));
  const col={date:ci(["date"]),symbol:ci(["symbol","ticker","name","instrument","scrip"]),type:ci(["type","buy","sell","side","action"]),qty:ci(["qty","quantity","units","shares"]),price:ci(["price","rate","nav"]),notes:ci(["notes","remark","narration"])};
  const transactions=[],warnings=[];
  for(const r of dataRows){const symbol=col.symbol>=0?(r[col.symbol]||"").trim():"";if(!symbol)continue;const date=col.date>=0?parseDate(r[col.date]):null;if(!date){warnings.push(`Skipped "${symbol}": missing date`);continue;}transactions.push({_symbol:symbol,txn_type:col.type>=0&&((r[col.type]||"").toUpperCase().includes("SELL")||(r[col.type]||"").toUpperCase().includes("REDEEM"))?"SELL":"BUY",units:col.qty>=0?pNum(r[col.qty]):0,price:col.price>=0?pNum(r[col.price]):0,txn_date:date,notes:col.notes>=0?(r[col.notes]||"").trim():"CSV import"});}
  return {format:"Generic Transactions",transactions,warnings};
}

// ── scoreHoldings / scoreTransactions ─────────────────────────────────────────
export function scoreHoldings(result, text) {
  let score=0;
  if(result.holdings.length===0) return -10;
  score+=result.holdings.length*2;
  if(result.format!=="Unknown"&&result.format!=="Generic CSV (best-effort)") score+=20;
  const lower=text.toLowerCase();
  if(/avg\.?\s*(cost|price)|average\s*price|purchase\s*price/i.test(lower)) score+=15;
  if(/ltp|market\s*value|current\s*value|close\s*price|cmp/i.test(lower)) score+=10;
  const symbols=result.holdings.map(h=>(h.ticker||h.name).toLowerCase());
  const uniqueRatio=new Set(symbols).size/(symbols.length||1);
  if(uniqueRatio>0.8) score+=15;
  if(/trade\s*date|txn\s*date|transaction\s*date/i.test(lower)) score-=10;
  if(/trade\s*type|buy|sell|side|action/i.test(lower)&&/date/i.test(lower)) score-=15;
  return score;
}
export function scoreTransactions(result, text) {
  let score=0;
  if(result.transactions.length===0) return -10;
  score+=result.transactions.length;
  if(result.format!=="unknown"&&result.format!=="Generic Transactions") score+=20;
  const lower=text.toLowerCase();
  if(/trade\s*date|transaction\s*date/i.test(lower)) score+=15;
  if(/trade\s*type/i.test(lower)) score+=15;
  if(/buy|sell/i.test(lower)&&/date/i.test(lower)) score+=10;
  if(/tradebook|trade\s*book|order\s*book|order\s*history/i.test(lower)) score+=20;
  const symbols=result.transactions.map(t=>(t._symbol||"").toLowerCase());
  const uniqueRatio=new Set(symbols).size/(symbols.length||1);
  if(uniqueRatio<0.5) score+=15;
  const withDates=result.transactions.filter(t=>t.txn_date).length;
  if(withDates>10) score+=10;
  if(/avg\.?\s*(cost|price)|average\s*price|market\s*value|current\s*value/i.test(lower)) score-=10;
  if(/ltp|cmp/i.test(lower)) score-=10;
  return score;
}

// ── parseNSDLCASStatement ──────────────────────────────────────────────────────
export function parseNSDLCASStatement(rawText) {
  const holdings=[], warnings=[];
  const isCAS=/consolidated\s*account\s*statement|nsdl\s*cas|cdsl\s*cas|nsdl\s*e-cas/i.test(rawText);
  if(!isCAS) return {holdings:[],warnings:["Not a CAS statement"],format:null};

  // ── Normalize split decimal numbers (PDF extraction artifact) ─────────────────
  // pdfjs can split a single number like "81,963.607" into separate text items that
  // get joined with a space or tab: "81,963. 607" or "81,963.6 07" or "81,963.\t607".
  // The numRe regex then reads them as two separate numbers (e.g. 81963.0 and 607),
  // producing wrong units. This pass merges them back before any parsing runs.
  //   "81,963. 607"   → "81,963.607"   (trailing 3-digit decimal fragment)
  //   "81,963.6 07"   → "81,963.607"   (1-digit + 2-digit split at decimal)
  //   "81,963.\t607"  → "81,963.607"   (tab-separated decimal)
  rawText = rawText
    // Case 1: decimal point with nothing after it, then whitespace, then 1–3 digits
    .replace(/(\d[\d,]*\.)\s+(\d{1,3})(?=[\s\t\n,]|$)/g, (_, p1, p2) => p1 + p2)
    // Case 2: already has some decimal digits, then whitespace, then remaining digits (total dp ≤ 4)
    .replace(/(\d[\d,]*\.\d{1,2})[ \t](\d{1,2})(?=[\s\t\n,]|$)/g, (_, p1, p2) => {
      const dp = (p1.split('.')[1]||'').length + p2.length;
      return dp <= 4 ? p1 + p2 : _ ;
    });
  const isNSDL=/nsdl/i.test(rawText), isCDSL=/cdsl/i.test(rawText);
  const depository=isNSDL&&isCDSL?"NSDL/CDSL":isNSDL?"NSDL":isCDSL?"CDSL":"CAS";
  const _source="cas", _brokerage=`${depository} CAS`;
  const seen=new Set();

  // Extract holder names and PANs
  const holderNames=[], holderPANs=[];
  const namePatterns=[
    /(?:Statement\s+for|First\s+Holder|Holder\s+Name|Name\s+of\s+(?:the\s+)?(?:First\s+)?Holder|Account\s+Holder)\s*[:\-]?\s*([A-Z][A-Z\s.'-]{2,60}?)(?:\s{2,}|\s*PAN|\s*$)/gim,
    /(?:^|\n)\s*(?:Name|Investor)\s*[:\-]\s*([A-Z][A-Z\s.'-]{2,60}?)(?:\s{2,}|\s*PAN|\s*$)/gim,
  ];
  for(const pat of namePatterns){let hm;while((hm=pat.exec(rawText))!==null){const name=hm[1].replace(/\s+/g," ").trim();if(name.length>=3&&!/consolidated|statement|account|depository|securities/i.test(name)&&!holderNames.includes(name))holderNames.push(name);}}
  const panRe=/PAN\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])/gi; let panM;
  while((panM=panRe.exec(rawText))!==null){const pan=panM[1].toUpperCase();if(!holderPANs.includes(pan))holderPANs.push(pan);}
  if(holderNames.length>0) console.log(`CAS: holder names: [${holderNames.join(", ")}]`);
  if(holderPANs.length>0) console.log(`CAS: PANs: [${holderPANs.join(", ")}]`);

  // Statement date
  let statementDate=null, periodStart=null, periodEnd=null;
  function _parseCASDate(ds){if(!ds)return null;const d=ds.replace(/[\-\/]/g,"-");const mm=d.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})$/);if(mm){const mos={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};const mi=mos[mm[2].toLowerCase().slice(0,3)];if(mi!==undefined){let y=parseInt(mm[3]);if(y<100)y+=2000;return new Date(y,mi,parseInt(mm[1])).toISOString().slice(0,10);}}const nm=d.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);if(nm){let y=parseInt(nm[3]);if(y<100)y+=2000;return new Date(y,parseInt(nm[2])-1,parseInt(nm[1])).toISOString().slice(0,10);}return null;}
  const _rangeDatePats=[/Statement\s*Period\s*[:\-]?\s*(\d{1,2}[\-\/]\w{3,9}[\-\/]\d{2,4})\s*(?:to|[-–])\s*(\d{1,2}[\-\/]\w{3,9}[\-\/]\d{2,4})/i,/Period\s*[:\-]?\s*(?:From\s+)?(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})\s*(?:to|[-–])\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i];
  const _singleDatePats=[/Statement\s*(?:as\s*on|dated?)\s*[:\-]?\s*(\d{1,2}[\-\/]\w{3,9}[\-\/]\d{2,4})/i,/Valuation\s*(?:Date|as\s*on)\s*[:\-]?\s*(\d{1,2}[\-\/]\w{3,9}[\-\/]\d{2,4})/i,/as\s*on\s*[:\-]?\s*(\d{1,2}[\-\/]\w{3,9}[\-\/]\d{2,4})/i,/Statement\s*Date\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i];
  for(const pat of _rangeDatePats){const m=rawText.match(pat);if(m){periodStart=_parseCASDate(m[1]);periodEnd=_parseCASDate(m[2]);statementDate=periodEnd;break;}}
  if(!statementDate){for(const pat of _singleDatePats){const m=rawText.match(pat);if(m){statementDate=_parseCASDate(m[1]);periodEnd=statementDate;break;}}}

  function cleanCASName(rawName){let name=rawName;name=name.replace(/^NOT\s+AVAILABLE\s+/i,"").trim();name=name.replace(/^MF[A-Z0-9]{4,10}\s+/i,"").trim();name=name.replace(/^[A-Z0-9]+\.(NSE|BSE)\s+/i,"").trim();return name;}
  function extractExchangeTicker(rawName){const m=rawName.match(/^([A-Z0-9]+)\.(NSE|BSE)\s/i);return m?m[1].toUpperCase():"";}

  // ── MF (INF ISINs) ────────────────────────────────────────────────────────────
  const infRe=/\b(INF[A-Z0-9]{9})\b/g; let infMatch;
  const bestByIsin=new Map();
  // ── Dedicated NSDL MF Folios (F) section parser ─────────────────────────────
  // Handles the 9-column folio-held MF format (not demat) before the generic INF
  // loop.  Column order after fund name: [folio?] units avg_cost total_cost nav
  // curr_value unrealised_pl.  Folio refs (large whole integers) are detected by
  // trying skip=0..3 and accepting the first ordering where units×nav≈curr_value.
  {const _fsM=rawText.match(/Mutual\s+Fund\s+Folios?\s*\(?F\)?/i);if(_fsM){
  // Stop only at Grand Total or the next major section heading — NOT Sub Total,
  // because NSDL CAS emits per-AMC Sub Totals *inside* the Folios section.
  const _fsS=_fsM.index;
  const _fsRemain=rawText.substring(_fsS);
  const _fsEm=_fsRemain.match(/\bGrand[\s-]*Total\b/i)||_fsRemain.match(/\b(?:Equit(?:y|ies)|Debentures?|Bonds?|Government\s+Securities|ETF|Debt\s+Instrument|Commercial\s+Paper)\b/i);
  const _fsT=rawText.substring(_fsS,_fsEm?_fsS+_fsEm.index:Math.min(_fsS+200000,rawText.length));
  const _fRe=/\b(INF[A-Z0-9]{9})\b/g;
  const _fNRE=/^[\s\S]*?([A-Z][A-Za-z\s&().'-]{5,120}(?:Fund|Growth|IDCW|Plan|Option|Savings|Dividend|Bonus|Direct|Regular|Flexi|Equity|Debt|Liquid|Hybrid|Balanced|Cap|Index|ETF|ELSS|Nifty|Sensex|Gilt|Arbitrage|Value|Contra|Multi|Large|Small|Mid|Bluechip|Focused|Dynamic|Overnight|Ultra|Corporate|Banking|Money\s*Market|Credit\s*Risk|Low\s*Duration|Medium|Long|Short)[A-Za-z\s()'-]{0,40})/i;
  const _fNFB=/^[\s\S]*?([A-Z][A-Za-z\s&().'-]{5,120}?)(?=\s+\d)/i;
  let _fm;while((_fm=_fRe.exec(_fsT))!==null){
    const _fi=_fm[1];const _fa=_fm.index+_fm[0].length;
    const _fn2=_fsT.substring(_fa).match(/\b(INF[A-Z0-9]{9})\b/);
    const _fb=_fsT.substring(_fa,_fn2?_fa+_fn2.index:Math.min(_fa+600,_fsT.length));
    const _nm=_fb.match(_fNRE)||_fb.match(_fNFB);if(!_nm)continue;
    const _rn=_nm[1].replace(/\s+/g," ").trim();const _fn=cleanCASName(_rn);
    if(/Scheme\s*Name/i.test(_fn)||/Mutual\s*Fund\s*-\s*Scheme/i.test(_rn))continue;
    const _nr=_fb.substring(_nm[0].length);const _all=[];let _m2;const _r2=/-?[\d,]+\.?\d*/g;
    while((_m2=_r2.exec(_nr))!==null){const v=pNum(_m2[0]);if(v&&!isNaN(v))_all.push(v);}
    let _fh=null;
    for(let sk=0;sk<Math.min(4,_all.length);sk++){
      const[u,ac,tc,nav,cv]=_all.slice(sk);
      if(u>0&&nav>0&&cv>=1&&Math.abs(u*nav-cv)/Math.max(cv,1)<0.15){
        const _fFolio=_all.slice(0,sk).find(n=>n>1e5&&n===Math.floor(n))||"";
        _fh={name:_fn,type:"MF",ticker:_fi,scheme_code:"",units:u,purchase_nav:ac||0,current_nav:nav,purchase_price:ac||0,current_price:nav,purchase_value:tc||cv,current_value:cv,source:_source,brokerage_name:_brokerage,currency:"INR",_folio:String(_fFolio),_needs_price:true};
        break;
      }
    }
    if(!_fh)continue;
    const _ex=bestByIsin.get(_fi);
    if(!_ex)bestByIsin.set(_fi,[_fh]);
    else if(!_ex.some(h=>Math.abs(h.units-_fh.units)/Math.max(h.units,0.001)<0.01))_ex.push(_fh);
  }}}
  while((infMatch=infRe.exec(rawText))!==null) {
    const isin=infMatch[1];
    // If the dedicated MF Folios (F) parser already captured this ISIN, trust it and skip
    // the generic loop — avoids the tabular fast-path misreading 9-column folio rows.
    if(bestByIsin.has(isin))continue;
    const afterStart=infMatch.index+infMatch[0].length;
    const nextIsin=rawText.substring(afterStart).match(/\b(IN[FE][A-Z0-9]{9})\b/);
    const blockEnd=nextIsin?afterStart+nextIsin.index:afterStart+1500;
    const block=rawText.substring(afterStart,Math.min(blockEnd,afterStart+1500));
    // ── NSDL CAS tabular MF: first line has ≥4 tab-delimited cols ──────────────
    // Two known column layouts in NSDL CAS MF section:
    //   Layout A (new/zero-cost funds): cols[1]=units, cols[2]=0, cols[3]=0, cols[4]="nav value"
    //   Layout B (older funds with cost basis): cols[1]=units, cols[2]=avg_cost_nav, cols[3]=current_nav, cols[4]=current_value
    {const _bl1=block.split("\n")[0]||"";const _bCols=_bl1.split("\t");
    if(_bCols.length>=4){const _units=pNum(_bCols[1]);
    if(_units>0){let _rn=_bCols[0].trim();
    const _bl2c0=((block.split("\n")[1]||"").split("\t")[0]||"").replace(/\s*[\d,]+\.?\d*\s*$/,"").trim();
    if(_bl2c0&&/^[A-Z]/i.test(_bl2c0))_rn+=" "+_bl2c0;
    const _pvNums=[...(_bCols[4]||"").matchAll(/-?[\d,]+\.?\d*/g)].map(m=>pNum(m[0])).filter(n=>n>0);
    let _nav=0,_val=0,_purchaseNav=0;
    if(_pvNums.length>=2){// Layout A: cols[4] = "nav value" (or concatenation of two)
      _nav=_pvNums[0];_val=_pvNums[1];
      // Validate: units × nav ≈ val. If not, PDF may have concatenated "NAV" + "Value"
      // e.g. gap ≤ 2px merges "9.65" and "7,90,784.88" into "9.657,90,784.88".
      // Try splitting raw col[4] at every 2–4 digit decimal boundary and pick the valid split.
      if(_units>0&&_val>0&&Math.abs(_nav*_units-_val)/Math.max(_val,1)>0.1){
        const _raw=(_bCols[4]||"").replace(/\s/g,"");
        // Try: group1=NAV with 2/3/4 decimals, group2=Indian-format value starting with digit
        const _sm=_raw.match(/^(\d+\.\d{2,4})(\d[\d,]*\.\d{2,4})$/);
        if(_sm){const _n2=pNum(_sm[1]),_v2=pNum(_sm[2]);
          if(_v2>0&&Math.abs(_n2*_units-_v2)/Math.max(_v2,1)<0.05){_nav=_n2;_val=_v2;}}}
      _purchaseNav=_nav;}
    else if(_pvNums.length===1){// Layout B: cols[4]=value, cols[3]=current_nav, cols[2]=avg_cost
      _val=_pvNums[0];const _c3=pNum(_bCols[3]||"");const _c2=pNum(_bCols[2]||"");
      if(_c3>0&&_c3<_val){_nav=_c3;_purchaseNav=(_c2>0&&_c2<_c3)?_c2:_c3;}
      else if(_c2>0&&_c2<_val){_nav=_c2;_purchaseNav=_c2;}}
    if(_rn&&_val>0&&_nav>0){const _name=cleanCASName(_rn);
    const _h={name:_name,type:"MF",ticker:isin,scheme_code:"",units:_units,purchase_nav:_purchaseNav,current_nav:_nav,purchase_price:_purchaseNav,current_price:_nav,purchase_value:_purchaseNav>0?_purchaseNav*_units:_val,current_value:_val,source:_source,brokerage_name:_brokerage,currency:"INR",_folio:"",_needs_price:true};
    const _ex=bestByIsin.get(isin);
    if(!_ex)bestByIsin.set(isin,[_h]);
    else if(!_ex.some(h=>Math.abs(h.units-_units)/Math.max(h.units,0.001)<0.01))_ex.push(_h);
    continue;}}}}
    const MF_NAME_RE=/^[\s\S]*?([A-Z][A-Za-z\s&().'-]{5,120}(?:Fund|Growth|IDCW|Plan|Option|Savings|Dividend|Bonus|Direct|Regular|Flexi|Equity|Debt|Liquid|Hybrid|Balanced|Cap|Index|ETF|ELSS|Nifty|Sensex|Gilt|Arbitrage|Value|Contra|Multi|Large|Small|Mid|Bluechip|Focused|Dynamic|Overnight|Ultra|Corporate|Banking|Money\s*Market|Credit\s*Risk|Low\s*Duration|Medium|Long|Short)[A-Za-z\s()'-]{0,40})/i;
    const MF_NAME_FALLBACK=/^[\s\S]*?([A-Z][A-Za-z\s&().'-]{5,120}?)(?=\s+\d)/i;
    const MF_KEYWORD=/(?:Fund|Growth|IDCW|Plan|Option|Savings|Dividend|Bonus|Direct|Regular|Flexi|Equity|Debt|Liquid|Hybrid|Balanced|Cap|Index|ETF|ELSS|Nifty|Sensex|Gilt|Arbitrage|Value|Contra|Multi|Large|Small|Mid|Bluechip|Focused|Dynamic|Overnight|Ultra|Corporate|Banking|Credit|Duration|Medium|Long|Short)/i;
    let nameMatch=block.match(MF_NAME_RE)||block.match(MF_NAME_FALLBACK);
    let numRegionOverride=null;
    // Fallback: name may appear BEFORE the ISIN (common in some CAS layouts)
    if(!nameMatch) {
      const priorText=rawText.substring(Math.max(0,infMatch.index-600),infMatch.index);
      const priorLines=priorText.split(/\n/).map(l=>l.trim()).filter(Boolean);
      for(let pi=priorLines.length-1;pi>=Math.max(0,priorLines.length-8);pi--) {
        const ln=priorLines[pi];
        if(ln.length>5&&MF_KEYWORD.test(ln)&&!/total|sub.?total|isin|folio|depository|securities\s+limited|consolidated|statement|mutual\s+fund\s+-\s+scheme/i.test(ln)&&/^[A-Za-z]/i.test(ln)) {
          nameMatch={ 1: ln.replace(/\s+/g," ").trim(), 0: "" };
          numRegionOverride=block; // numbers come after the ISIN
          break;
        }
      }
    }
    if(!nameMatch) continue;
    const rawName=nameMatch[1].replace(/\s+/g," ").trim();
    const name=cleanCASName(rawName);
    if(/Scheme\s*Name/i.test(name)||/Mutual\s*Fund\s*-\s*Scheme/i.test(rawName)) continue;
    const numRegion=numRegionOverride!==null?numRegionOverride:block.substring(nameMatch[0].length);
    // Narrow the number extraction region to avoid cross-fund bleed:
    // 1) Stop before any "Sub Total" / "Grand Total" line (portfolio aggregates)
    // 2) If a "Closing Balance" label is present, prefer only numbers after it
    let activeNumRegion=numRegion;
    const stopMatch=activeNumRegion.match(/\b(?:Sub[\s-]*Total|Grand[\s-]*Total|Total\s+(?:Value|Holding|Amount))\b/i);
    if(stopMatch)activeNumRegion=activeNumRegion.substring(0,stopMatch.index);
    const closingLabelMatch=activeNumRegion.match(/Closing\s+Bal(?:ance)?|Balance\s+as\s*on/i);
    if(closingLabelMatch)activeNumRegion=activeNumRegion.substring(closingLabelMatch.index);
    const numRe=/-?[\d,]+\.?\d*/g; const allNums=[]; let nm;
    while((nm=numRe.exec(activeNumRegion))!==null){const val=pNum(nm[0]);if(!isNaN(val)&&val!==0)allNums.push(val);}
    if(allNums.length<3) { if(allNums.some(n=>Math.abs(n)>=2020&&Math.abs(n)<=2030)&&allNums.some(n=>n>1e9)) continue; else continue; }
    const hasDateNums=allNums.some(n=>Math.abs(n)>=2020&&Math.abs(n)<=2030);
    const hasHugeRef=allNums.some(n=>n>1e9&&n===Math.floor(n)); // only whole-number large values are folio refs
    if(hasDateNums&&hasHugeRef) continue;
    const matches=[];
    for(let i=0;i<Math.min(allNums.length,15);i++){for(let j=i+1;j<Math.min(allNums.length,15);j++){const product=allNums[i]*allNums[j];for(let k=0;k<Math.min(allNums.length,18);k++){if(k===i||k===j)continue;if(allNums[k]<=0)continue;const err=Math.abs(product-allNums[k])/allNums[k];if(err<0.05)matches.push({a:allNums[i],b:allNums[j],val:allNums[k],err,indices:[i,j,k]});}}}
    if(!matches.length) {
      // No valid triplet found — try a 2-number fallback (units + value, or just value)
      const positives=allNums.filter(n=>n>0&&n<1e8);
      if(positives.length>=1&&positives.some(n=>n>=10)) {
        const inferredValue=Math.max(...positives);
        const potentialUnits=positives.find(n=>n!==inferredValue&&n>0&&n<inferredValue);
        const u=potentialUnits||0;
        const pNav=u>0?inferredValue/u:0;
        if(inferredValue>=10) {
          const h={name,type:"MF",ticker:isin,scheme_code:"",units:u,purchase_nav:pNav,current_nav:pNav,purchase_price:pNav,current_price:pNav,purchase_value:inferredValue,current_value:inferredValue,source:_source,brokerage_name:_brokerage,currency:"INR",_folio:"",_needs_price:true};
          if(!bestByIsin.has(isin))bestByIsin.set(isin,[h]);
        }
      }
      continue;
    }
    const factorCounts=new Map();
    for(const m of matches){for(const f of[m.a,m.b]){const key=f.toFixed(4);factorCounts.set(key,(factorCounts.get(key)||0)+1);}}
    let bestFactor=null,bestCount=0;
    for(const [key,count] of factorCounts){if(count>bestCount){bestCount=count;bestFactor=parseFloat(key);}}
    const unitsTriplets=bestFactor!==null?matches.filter(m=>Math.abs(m.a-bestFactor)/Math.max(bestFactor,0.001)<0.01||Math.abs(m.b-bestFactor)/Math.max(bestFactor,0.001)<0.01):matches;
    // Sort by position of the VALUE in the number stream (descending), not by size.
    // Closing balance always appears LAST in a CAS block regardless of whether the
    // fund went up or down — so the triplet whose product appears at the highest
    // index is the closing balance, which is what we want as current_value.
    unitsTriplets.sort((a,b)=>b.indices[2]-a.indices[2]||a.err-b.err);
    const distinctValues=[];
    for(const t of unitsTriplets){if(!distinctValues.some(dv=>Math.abs(dv.val-t.val)/Math.max(t.val,1)<0.005)){const best=unitsTriplets.filter(m=>Math.abs(m.val-t.val)/Math.max(t.val,1)<0.005).sort((a,b)=>a.err-b.err)[0];distinctValues.push(best);}}
    // ── Filter outlier triplet values before balance selection ───────────────────
    // Portfolio totals and cross-fund aggregates can bleed into a fund's number
    // region (e.g. ₹4.99 crore for the whole CAS appearing with 1,10,682 units →
    // spurious triplet [1,10,682 × 451.74 = 4.99 crore]).  These outliers are
    // always >> any individual fund balance.  Drop anything > 30× the minimum
    // distinct value; if that leaves < 2 candidates keep the original list.
    const minDV=Math.min(...distinctValues.map(dv=>dv.val));
    const trimmedDVs=distinctValues.filter(dv=>dv.val<=minDV*30);
    const workDVs=trimmedDVs.length>=2?trimmedDVs:distinctValues;

    let currentValueMatch, investedMatch;
    if(workDVs.length>=3){const gainCandidates=[];for(let i=0;i<workDVs.length;i++){for(let j=i+1;j<workDVs.length;j++){const diff=Math.abs(workDVs[i].val-workDVs[j].val);for(let k=0;k<workDVs.length;k++){if(k===i||k===j)continue;if(diff>0&&Math.abs(diff-workDVs[k].val)/Math.max(workDVs[k].val,1)<0.05)gainCandidates.push(k);}}}let gainIdx=-1;if(gainCandidates.length>0)gainIdx=gainCandidates.reduce((best,idx)=>workDVs[idx].val<workDVs[best].val?idx:best,gainCandidates[0]);const candidates=gainIdx>=0?workDVs.filter((_,idx)=>idx!==gainIdx):workDVs.slice(0,2);candidates.sort((a,b)=>b.indices[2]-a.indices[2]);currentValueMatch=candidates[0];investedMatch=candidates[1]||null;}
    else if(workDVs.length===2){workDVs.sort((a,b)=>b.indices[2]-a.indices[2]);currentValueMatch=workDVs[0];investedMatch=workDVs[1];}
    else{currentValueMatch=workDVs[0]||unitsTriplets[0];investedMatch=null;}
    let nav,units;
    const cvFactors=[currentValueMatch.a,currentValueMatch.b];
    // Helper: decimal places — CAS units are typically 3dp (e.g. 123.456), NAV is 2-4dp.
    const dp=n=>{const s=String(Math.abs(n));const i=s.indexOf(".");return i<0?0:s.length-i-1;};
    // Only trust bestFactor if it's one of THIS triplet's factors (the closing balance).
    // SIP transactions can make a monthly-lot unit count dominate bestFactor even
    // though the closing balance has a completely different cumulative unit count.
    const factorInClosing=bestFactor!==null&&cvFactors.some(f=>Math.abs(f-bestFactor)/Math.max(bestFactor,0.001)<0.01);
    if(factorInClosing&&bestCount>=2){units=bestFactor;nav=cvFactors.find(f=>Math.abs(f-bestFactor)/Math.max(bestFactor,0.001)>0.01)??cvFactors[0];}
    else if(investedMatch){const invFactors=[investedMatch.a,investedMatch.b];const common=cvFactors.find(f=>invFactors.some(o=>Math.abs(f-o)/Math.max(f,0.001)<0.01));if(common){units=common;nav=cvFactors.find(f=>Math.abs(f-common)/Math.max(f,0.001)>0.01)??cvFactors[0];}else{const[iA,iB]=[currentValueMatch.indices[0],currentValueMatch.indices[1]];if(iA<iB){units=currentValueMatch.a;nav=currentValueMatch.b;}else{units=currentValueMatch.b;nav=currentValueMatch.a;}}}
    else{const[f1,f2]=cvFactors;const[iA,iB]=[currentValueMatch.indices[0],currentValueMatch.indices[1]];const f1IsNav=f1>=5&&f1<=50000,f2IsNav=f2>=5&&f2<=50000;if(f1IsNav&&!f2IsNav){nav=f1;units=f2;}else if(f2IsNav&&!f1IsNav){nav=f2;units=f1;}else{// Both in NAV range — use decimal places: 3dp = units, other = NAV
    const f1dp=dp(f1),f2dp=dp(f2);if(f1dp===3&&f2dp!==3){units=f1;nav=f2;}else if(f2dp===3&&f1dp!==3){units=f2;nav=f1;}else{if(iA<iB){units=currentValueMatch.a;nav=currentValueMatch.b;}else{units=currentValueMatch.b;nav=currentValueMatch.a;}}}}
    const currentValue=currentValueMatch.val;
    if(currentValue<10||currentValue>5e9) continue;  // 500 Cr upper bound (was 100 Cr)
    if(nav<1||nav>100000) continue;                  // some index/growth funds exceed 50k NAV
    const usedIndices=new Set(currentValueMatch.indices);
    // Second-pass guard: reject investedMatch that is > 10× current value.
    // Outlier filter above handles most cases; this catches stragglers where the
    // portfolio total only slightly exceeds the 30× threshold.
    if(investedMatch && investedMatch.val > currentValue * 10) investedMatch=null;
    // Lower-bound guard: a single SIP instalment can bleed into the number region as a
    // valid triplet (e.g. "6,250 units × ₹9.89 NAV = ₹61,812").  If investedMatch.val
    // is less than units × minReasonableNav (5), it represents one instalment, not the
    // total invested.  Using it would make purchaseNav = sip_amount / closing_units ≈ 0,
    // then the fallback extracts the SIP NAV (e.g. 9.89) as the purchase nav — wrong.
    if(investedMatch && investedMatch.val < units * 5) investedMatch=null;
    let invested=0,purchaseNav=0;
    if(investedMatch){invested=investedMatch.val;
      // Weighted-average cost NAV = total_invested / closing_units.
      // Do NOT pull a factor from investedMatch directly — the triplet may be a SIP row or
      // opening-balance row whose factors have nothing to do with the closing unit count,
      // causing e.g. "1000 × ₹451.74" to mistakenly set purchaseNav=₹451.74 when closing
      // units are 1,10,682.  Dividing by closing units always gives the correct avg cost.
      purchaseNav=units>0?invested/units:0;
      // Guard: if the result is implausible fall back to factor extraction
      if(purchaseNav<0.5||purchaseNav>100000){const invFactors=[investedMatch.a,investedMatch.b];purchaseNav=invFactors.find(f=>Math.abs(f-units)/Math.max(units,0.001)>0.01)??invFactors[0];if(Math.abs(purchaseNav-units)/Math.max(units,0.001)<0.01)purchaseNav=invFactors[1]||0;}
    }
    if(!invested){for(let i=0;i<Math.min(allNums.length,12);i++){if(usedIndices.has(i))continue;const n=allNums[i];if(Math.abs(n-units)/Math.max(units,0.001)<0.01)continue;if(Math.abs(n-nav)/Math.max(nav,0.001)<0.01)continue;if(Math.abs(n-currentValue)/Math.max(currentValue,0.001)<0.01)continue;if(n>100&&n<currentValue*3){const impliedNav=units>0?n/units:0;if(impliedNav>=3&&impliedNav<=50000){invested=n;purchaseNav=impliedNav;break;}}}}
    if(!invested){const cvIdx=currentValueMatch.indices[2];for(let i=cvIdx+1;i<Math.min(allNums.length,cvIdx+3);i++){const gain=allNums[i];if(Math.abs(gain)<currentValue*0.8&&Math.abs(gain)>0.5){const derivedInvested=currentValue-gain;if(derivedInvested>0){invested=derivedInvested;purchaseNav=units>0?invested/units:nav;break;}}}}
    if(!invested){invested=currentValue;purchaseNav=nav;}
    const folio=allNums.find((n,idx)=>n>100000&&n<1e12&&n===Math.floor(n)&&!usedIndices.has(idx))?.toString()||"";
    // _needs_price:true so that the post-import ISIN→scheme_code resolution and
    // "Refresh Prices" always overwrites the CAS NAV (which may be days old or
    // slightly off due to triplet-math approximation).
    const holding={name,type:"MF",ticker:isin,scheme_code:"",units,purchase_nav:purchaseNav,current_nav:nav,purchase_price:purchaseNav,current_price:nav,purchase_value:invested,current_value:currentValue,source:_source,brokerage_name:_brokerage,currency:"INR",_folio:folio,_needs_price:true};
    const existingForIsin=bestByIsin.get(isin);
    if(!existingForIsin){bestByIsin.set(isin,[holding]);}
    else{const isDuplicate=existingForIsin.some(h=>Math.abs(h.units-units)/Math.max(h.units,0.001)<0.01);if(!isDuplicate)existingForIsin.push(holding);}
  }
  for(const [isin,hList] of bestByIsin){for(const h of hList){seen.add(isin);holdings.push(h);}}

  // ── Demat (INE ISINs) ─────────────────────────────────────────────────────────
  const ineRe=/\b(INE[A-Z0-9]{9})\b/g; let ineMatch;
  while((ineMatch=ineRe.exec(rawText))!==null) {
    const isin=ineMatch[1];
    if(seen.has(isin)) continue;
    const after=rawText.substring(ineMatch.index,ineMatch.index+600);
    const before=rawText.substring(Math.max(0,ineMatch.index-300),ineMatch.index);
    let rawName="",qty=0,marketPrice=0,totalValue=0;
    const firstLine=after.split("\n")[0]||"";
    const secondLine=(after.split("\n")[1]||"").trim();
    const cols=firstLine.split("\t").map(c=>c.trim());
    if(cols.length>=4){
      // NSDL CAS: cols[0]="[ISIN] [Company Name Part 1]" concatenated (no tab between ISIN and name)
      // cols[1] = Current Balance (actual share quantity, e.g., "75.000" = 75 shares)
      // cols[2] = Safekeep Bal ("0.000"), cols[3] = Pledged Bal ("0.000")
      // cols[4] = "MarketPrice Value" space-separated (no tab), e.g., "885.85 66,438.75"
      rawName=cols[0].replace(/^INE[A-Z0-9]{9}\s*/,"").trim();
      qty=pNum(cols[1]);
      // Use numRe to correctly split space-separated price+value pair in cols[4]
      const pvNums=[...(cols[4]||"").matchAll(/-?[\d,]+\.?\d*/g)].map(m=>pNum(m[0])).filter(n=>n>0);
      if(pvNums.length>=2){marketPrice=pvNums[0];totalValue=pvNums[1];}
      else if(pvNums.length===1){if(pvNums[0]>qty){totalValue=pvNums[0];marketPrice=qty>0?totalValue/qty:0;}else{marketPrice=pvNums[0];totalValue=qty*marketPrice;}}
      // Row 2 may continue the company name; skip equity share type descriptions
      const shareDescRe=/^(?:EQUITY|ORDINARY|PREFERENCE|CUMULATIVE)\s+SHARES?|^SHARES?\s+[\d#(]|^SHARES?\s+(?:WITH|OF|FACE|HAVING)|^VALUE\s+(?:RS|RE|INR)|^AFTER\s+(?:SPLIT|SUB|DIVISION)|^RS\.?\s*\d|^OF\s+RS\.|^FACE\s+VALUE|^SHARE\s+WITH|^NEW\s+(?:EQUITY|ORDINARY)/i;
      if(secondLine&&!/^INE[A-Z0-9]{9}/.test(secondLine)&&!/^\d/.test(secondLine)){
        const namePart2=secondLine.split("\t")[0]?.trim();
        if(namePart2&&/^[A-Z]/.test(namePart2)&&!shareDescRe.test(namePart2)&&!/^INE|^INF|^Sub\s*Total|^Total/i.test(namePart2))
          rawName+=" "+namePart2;
      }
      // Row 3 may also contain name continuation (e.g., MAZAGON DOCK SHIPBUILDERS LIMITED)
      const thirdLine=(after.split("\n")[2]||"").trim();
      if(thirdLine&&!/^INE[A-Z0-9]{9}/.test(thirdLine)&&!/^\d/.test(thirdLine)){
        const namePart3=thirdLine.split("\t")[0]?.trim();
        if(namePart3&&/^[A-Z]/.test(namePart3)&&!shareDescRe.test(namePart3)&&!/^INE|^INF|^Sub\s*Total|^Total|^National|^NSDL|^CDSL|^Consolidated/i.test(namePart3)&&namePart3.length<40)
          rawName+=" "+namePart3;
      }
    }
    // CDSL strategy
    if(!rawName||qty<=0){const cdslMatch=after.match(/^INE[A-Z0-9]{9}\s{2,}(.+?)(?=\s+\d+\.\d{3}\s)/);if(cdslMatch){rawName=cdslMatch[1].replace(/\s+/g," ").trim();let numPartRaw=after.substring(cdslMatch.index+cdslMatch[0].length);const nlIdx=numPartRaw.indexOf("\n");if(nlIdx>0)numPartRaw=numPartRaw.substring(0,nlIdx);const boundaryMatch=numPartRaw.match(/\s+(?:Sub\s*Total|Consolidated|INE[A-Z0-9]{9}|Closing|Page\s+\d)/i);if(boundaryMatch)numPartRaw=numPartRaw.substring(0,boundaryMatch.index);const decNums=[];const dnRe=/([\d,]+\.\d+)/g;let dn;while((dn=dnRe.exec(numPartRaw))!==null)decNums.push(pNum(dn[1]));if(decNums.length>=2){qty=decNums[0];}const bigNums=decNums.filter(n=>n>0);if(bigNums.length>=2){totalValue=bigNums[bigNums.length-1];marketPrice=bigNums[bigNums.length-2];if(qty>0&&marketPrice>0){const expected=qty*marketPrice,err=Math.abs(expected-totalValue)/Math.max(totalValue,1);if(err>0.05){let found=false;for(let vi=bigNums.length-1;vi>=1&&!found;vi--){for(let pi=vi-1;pi>=0&&!found;pi--){const vCandidate=bigNums[vi],pCandidate=bigNums[pi];if(pCandidate>0&&qty>0&&Math.abs(qty*pCandidate-vCandidate)/Math.max(vCandidate,1)<0.05){marketPrice=pCandidate;totalValue=vCandidate;found=true;}}}}}}else if(bigNums.length===1){if(bigNums[0]>qty*2){totalValue=bigNums[0];marketPrice=qty>0?totalValue/qty:0;}else{marketPrice=bigNums[0];totalValue=qty*marketPrice;}}}}
    // Name from before ISIN
    if(!rawName||rawName.length<3){const beforeLines=before.split(/\n/).filter(l=>l.trim());for(let i=beforeLines.length-1;i>=Math.max(0,beforeLines.length-3);i--){const line=beforeLines[i].trim();if(/^[A-Z][A-Za-z\s&().'-]{2,80}/.test(line)&&!/total|sub.?total|header|page|folio|isin|depository|securities\s*limited/i.test(line)){rawName=line.replace(/\s+/g," ").trim();break;}}}
    // Qty labeled
    if(qty<=0){const afterWide=rawText.substring(ineMatch.index,ineMatch.index+800);const qtyLabelPatterns=[/(?:Closing|Free|Available|Total)\s*(?:Bal(?:ance)?|Holding|Qty|Quantity)[:\s]*(\d[\d,.]*)/i,/(?:Balance|Holding|Qty|Quantity)\s*[:\s]\s*(\d[\d,.]*)/i,/Free\s*(\d[\d,.]*)/i];for(const pat of qtyLabelPatterns){const qm=afterWide.match(pat);if(qm){const candidate=pNum(qm[1]);if(candidate>0){qty=candidate;break;}}}}
    // Qty Q2 face-value skip
    if(qty<=0){const firstLineAfter=after.split("\n")[0]||"";const fvMatch=firstLineAfter.match(/(?:Face\s*Value|FV)[:\s]*(?:Rs\.?|₹|INR|RE\.?)?\s*(\d[\d,.]*)/i);const faceValue=fvMatch?pNum(fvMatch[1]):0;const nameEnd=rawName?(firstLineAfter.indexOf(rawName)>=0?firstLineAfter.indexOf(rawName)+rawName.length:12):12;const numText=firstLineAfter.substring(nameEnd);const allNums=[...numText.matchAll(/([\d,]+\.?\d*)/g)].map(m=>pNum(m[1])).filter(n=>n>0);if(allNums.length>0){const commonFV=new Set([1,2,5,10]);const detectedFV=faceValue||(commonFV.has(allNums[0])?allNums[0]:0);const candidates=detectedFV>0?allNums.filter((n,idx)=>{if(idx===0&&n===detectedFV)return false;if(n<=detectedFV&&n<100)return false;return true;}):allNums.slice(1);if(candidates.length>0){const wholeQty=candidates.find(n=>Number.isInteger(n)||Math.abs(n-Math.round(n))<0.001);qty=wholeQty||candidates[0];}}}
    const afterLines=after.split("\n");
    const secondLineForTicker=(afterLines[1]||"").trim();
    const tickerFromSecondLine=secondLineForTicker.match(/^([A-Z][A-Z0-9]+)\.(?:NSE|BSE)/)?.[1]||"";
    const exchangeTicker=tickerFromSecondLine||extractExchangeTicker(rawName)||extractExchangeTicker(before.split(/\n/).pop()||"");
    let name=cleanCASName(rawName);
    name=name.replace(/#.*$/i,"").trim();
    name=name.replace(/\s*-\s*$/,"").trim();
    name=name.replace(/\s*#?\s*(?:NEW\s+)?EQUITY\s*SHARES?.*$/i,"").trim();
    if(!name||qty<=0||/total|sub.?total|header|page/i.test(name)) continue;
    seen.add(isin);
    let type="IN_STOCK";
    if(/sovereign\s*gold|sgb/i.test(name))type="IN_ETF";
    else if(/etf|bees|nifty.*etf|gold.*etf|liquid.*etf/i.test(name))type="IN_ETF";
    else if(/bond|debenture|ncd/i.test(name))type="FD";
    if(!totalValue){const afterWide=rawText.substring(ineMatch.index,ineMatch.index+600);const valMatch=afterWide.match(/(?:Value|Valuation|Market\s*Value|Current\s*Value)[:\s]*(?:INR|Rs\.?|₹)?\s*([\d,.]+)/i);if(valMatch)totalValue=pNum(valMatch[1]);if(!marketPrice&&totalValue&&qty)marketPrice=totalValue/qty;}
    const currentPricePerUnit=marketPrice||(totalValue&&qty?totalValue/qty:0);
    // CAS demat has no cost basis — purchase_price/purchase_value are unknown.
    // Set to null so the UI shows "—" for invested/gain rather than fake ₹0.
    holdings.push({name,type,ticker:exchangeTicker||isin,scheme_code:isin,units:qty,purchase_price:null,current_price:currentPricePerUnit,purchase_value:null,current_value:totalValue,source:_source,brokerage_name:_brokerage,currency:"INR",_needs_price:!totalValue,cost_basis:"unknown"});
  }

  const mfCount=holdings.filter(h=>h.type==="MF").length;
  const dematCount=holdings.filter(h=>h.type!=="MF").length;
  const allINF=[...rawText.matchAll(/\b(INF[A-Z0-9]{9})\b/g)].map(m=>m[1]);
  const allINE=[...rawText.matchAll(/\b(INE[A-Z0-9]{9})\b/g)].map(m=>m[1]);
  const uniqueINF=[...new Set(allINF)],uniqueINE=[...new Set(allINE)];
  const parsedISINs=new Set(holdings.map(h=>h.ticker).concat(holdings.map(h=>h.scheme_code)));
  const missedINF=uniqueINF.filter(i=>!parsedISINs.has(i));
  const missedINE=uniqueINE.filter(i=>!parsedISINs.has(i));
  if(mfCount)warnings.push("Found "+mfCount+" mutual fund(s)");
  if(dematCount)warnings.push("Found "+dematCount+" demat holding(s)");
  const noPriceCount=holdings.filter(h=>h._needs_price).length;
  if(noPriceCount)warnings.push(`${noPriceCount} demat holding(s) imported without price data — use "Refresh Prices" to fetch live prices`);
  for(const missedIsin of missedINF) {
    const mi=rawText.search(new RegExp(`\\b${missedIsin}\\b`));
    if(mi>=0) {
      const priorCtx=rawText.substring(Math.max(0,mi-300),mi).replace(/\n/g,"↵");
      const afterCtx=rawText.substring(mi,mi+400).replace(/\n/g,"↵");
      console.log(`[CAS parser] Missed MF ISIN ${missedIsin} — before: "${priorCtx.slice(-100)}" | after: "${afterCtx.slice(0,200)}"`);
    }
  }
  if(missedINF.length)warnings.push(`${missedINF.length} MF ISIN(s) detected but not parsed: ${missedINF.join(", ")}`);
  if(missedINE.length)warnings.push(`${missedINE.length} demat ISIN(s) detected but not parsed: ${missedINE.join(", ")}`);
  if(!mfCount&&!dematCount)warnings.push("No holdings detected - CAS format may differ from expected layout");
  return {format:"NSDL/CDSL CAS (PDF)",holdings,warnings,accounts:[],holder_names:holderNames,holder_pans:holderPANs,statement_date:statementDate,period_start:periodStart,period_end:periodEnd,depository};
}

// ── parseFidelityPDFStatement ──────────────────────────────────────────────────
export function parseFidelityPDFStatement(rawText) {
  const holdings=[], warnings=[];
  const acctMatch=rawText.match(/FIDELITY\s+ACCOUNT\s+(.+?)\s*-\s*(INDIVIDUAL|JOINT|TRUST)/i)||rawText.match(/Account\s*#\s*\S+\s+(.+?)\s*-\s*(INDIVIDUAL|JOINT|TRUST)/i);
  const accountName=acctMatch?acctMatch[1].trim():"";
  const tickerRe=/\(([A-Z]{1,6})\)/g; let tm;
  while((tm=tickerRe.exec(rawText))!==null){
    const ticker=tm[1];
    if(/SPAXX|FDRXX|FCASH/i.test(ticker)) continue;
    const before=rawText.substring(Math.max(0,tm.index-200),tm.index);
    const nameMatch=before.match(/(?:^|\s)M\s+(?:t\s+)?(.{5,80}?)\s*$/);
    if(!nameMatch) continue;
    const name=nameMatch[1].replace(/\s+/g," ").trim();
    const tickerEnd=tm.index+tm[0].length;
    const after=rawText.substring(tickerEnd,tickerEnd+300);
    const numRe=/-?[$]?[\d,]+\.?\d*/g; const nums=[]; let nm;
    while((nm=numRe.exec(after))!==null&&nums.length<6){const val=parseFloat(nm[0].replace(/[$,]/g,""));if(!isNaN(val))nums.push(val);}
    if(nums.length<4) continue;
    const qty=nums[1],price=nums[2],endMV=nums[3],costBasis=nums.length>=5?nums[4]:0;
    if(qty===0||/total|subtotal/i.test(name)) continue;
    const type=classifyUSAsset(ticker,name);
    const avgCost=costBasis&&qty?costBasis/qty:price;
    holdings.push({name,type,ticker,units:qty,purchase_price:avgCost,current_price:price,purchase_value:costBasis||qty*avgCost,current_value:endMV||qty*price,source:"pdf",brokerage_name:"Fidelity",currency:"USD",_account_name:accountName});
  }
  return {format:"Fidelity (PDF Statement)",holdings,warnings,accounts:accountName?[accountName]:[]};
}
