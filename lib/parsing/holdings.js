import { Papa } from "./runtime.js";
import { parseAngelOneHoldings, parseGrowwHoldings, parseHDFCSecHoldings, parseICICIDirectHoldings, parseMFExportHoldings, parseNativeCSVHoldings, parseUpstoxHoldings, parseZerodhaHoldings } from "./brokersIN.js";
import { parseAllyHoldings, parseBettermentHoldings, parseCoinbaseHoldings, parseETRADEHoldings, parseFidelityHoldings, parseFirstradeHoldings, parseGenericHoldings, parseIBKRHoldings, parseJPMorganHoldings, parseMerrillHoldings, parsePublicHoldings, parseRobinhoodHoldings, parseSchwabHoldings, parseSoFiHoldings, parseTastytradeHoldings, parseVanguardHoldings, parseWealthfrontHoldings, parseWebullHoldings } from "./brokersUS.js";
import { parseDate } from "./dates.js";
import { pNum } from "./shared.js";

// ── detectAndParseHoldings ─────────────────────────────────────────────────────
export function detectAndParseHoldings(text) {
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
