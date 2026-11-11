import { pNum } from "./shared.js";

// ── Individual broker parsers ──────────────────────────────────────────────────
export function parseZerodhaHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>c==="instrument"),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\.?\s*cost/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/cur\.?\s*val/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]),ltp=pNum(r[col.ltp]);if(units===0&&avg===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.replace(/\s+/g,"").toUpperCase(),units,purchase_price:avg,current_price:ltp||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*(ltp||avg)});}
  return {format:"Zerodha Console",holdings,warnings};
}
export function parseGrowwHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/company\s*name/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/avg\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||r[col.symbol]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:(r[col.symbol]||"").trim().toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.ltp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"Groww",holdings,warnings};
}
export function parseICICIDirectHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>/stock\s*symbol/i.test(c)),name:h.findIndex(c=>/stock\s*name/i.test(c)),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\s*buy/i.test(c)),cmp:h.findIndex(c=>c==="cmp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||r[col.symbol]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:(r[col.symbol]||"").trim().toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.cmp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"ICICI Direct",holdings,warnings};
}
export function parseHDFCSecHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>/scrip\s*name/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/avg\s*cost/i.test(c)),mp:h.findIndex(c=>/market\s*price/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.split(/\s+/)[0].toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.mp])||avg,purchase_value:units*avg,current_value:pNum(r[col.mv])||units*avg});}
  return {format:"HDFC Securities",holdings,warnings};
}
export function parseUpstoxHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>/trading\s*symbol/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/average\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),close:h.findIndex(c=>/close\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]),ltp=pNum(r[col.ltp])||pNum(r[col.close])||avg;if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}holdings.push({name:symbol,type:"IN_STOCK",ticker:symbol.toUpperCase(),units,purchase_price:avg,current_price:ltp,purchase_value:units*avg,current_value:units*ltp});}
  return {format:"Upstox",holdings,warnings};
}
export function parseAngelOneHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={scrip:h.findIndex(c=>c==="scrip"),qty:h.findIndex(c=>/^qty/i.test(c)),avg:h.findIndex(c=>/avg\s*price/i.test(c)),ltp:h.findIndex(c=>c==="ltp"),cv:h.findIndex(c=>/current\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.scrip]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}holdings.push({name,type:"IN_STOCK",ticker:name.toUpperCase(),units,purchase_price:avg,current_price:pNum(r[col.ltp])||avg,purchase_value:units*avg,current_value:pNum(r[col.cv])||units*avg});}
  return {format:"Angel One",holdings,warnings};
}
export function parseMFExportHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={scheme:h.findIndex(c=>/scheme\s*name/i.test(c)),units:h.findIndex(c=>/unit/i.test(c)),nav:h.findIndex(c=>/nav/i.test(c)),cv:h.findIndex(c=>/current\s*value/i.test(c)),inv:h.findIndex(c=>/invest/i.test(c)),code:h.findIndex(c=>/amfi|scheme\s*code/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.scheme]||"").trim();if(!name)continue;const units=pNum(r[col.units]),nav=pNum(r[col.nav]);if(units===0){warnings.push(`Skipped "${name}": zero units`);continue;}holdings.push({name,type:"MF",ticker:"",scheme_code:col.code>=0?(r[col.code]||"").trim():"",units,purchase_nav:col.inv>=0?pNum(r[col.inv])/(units||1):nav,current_nav:nav,purchase_value:pNum(r[col.inv])||units*nav,current_value:pNum(r[col.cv])||units*nav});}
  return {format:"Mutual Fund Export",holdings,warnings};
}
export function parseNativeCSVHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const ci=patterns=>h.findIndex(c=>patterns.some(p=>typeof p==="string"?c===p:p.test(c)));
  const col={name:ci(["name"]),type:ci(["type"]),ticker:ci(["ticker"]),code:ci(["schemecode",/scheme.?code/i]),units:ci(["units"]),pp:ci(["purchaseprice",/purchase.?price/i]),cp:ci(["currentprice",/current.?price/i]),pnav:ci(["purchasenav",/purchase.?nav/i]),cnav:ci(["currentnav",/current.?nav/i]),pv:ci(["purchasevalue",/purchase.?value/i,/invested/i]),cv:ci(["currentvalue",/current.?value/i]),principal:ci(["principal"]),rate:ci(["interestrate",/interest.?rate/i]),start:ci(["startdate",/start.?date/i]),maturity:ci(["maturitydate",/maturity.?date/i]),member:ci(["member"])};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=col.name>=0?(r[col.name]||"").trim():"";if(!name)continue;holdings.push({name,type:col.type>=0?(r[col.type]||"IN_STOCK").toUpperCase():"IN_STOCK",ticker:col.ticker>=0?(r[col.ticker]||"").trim():"",scheme_code:col.code>=0?(r[col.code]||"").trim():"",units:col.units>=0?pNum(r[col.units]):0,purchase_price:col.pp>=0?pNum(r[col.pp]):0,current_price:col.cp>=0?pNum(r[col.cp]):0,purchase_nav:col.pnav>=0?pNum(r[col.pnav]):0,current_nav:col.cnav>=0?pNum(r[col.cnav]):0,purchase_value:col.pv>=0?pNum(r[col.pv]):0,current_value:col.cv>=0?pNum(r[col.cv]):0,principal:col.principal>=0?pNum(r[col.principal]):0,interest_rate:col.rate>=0?pNum(r[col.rate]):0,start_date:col.start>=0?(r[col.start]||""):"",maturity_date:col.maturity>=0?(r[col.maturity]||""):"",_member_name:col.member>=0?(r[col.member]||"").trim():""});}
  return {format:"WealthLens CSV",holdings,warnings};
}
