import { classifyUSAsset, pNum } from "./shared.js";

export function parseSchwabHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"),qty:h.findIndex(c=>/quantity/i.test(c)),price:h.findIndex(c=>c==="price"),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||symbol==="Account Total"||symbol==="Cash & Cash Investments")continue;const name=(r[col.name]||symbol).trim(),units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const mv=pNum(r[col.mv]),cb=pNum(r[col.cb]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Charles Schwab",holdings,warnings};
}
export function parseFidelityHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={account:h.findIndex(c=>/account/i.test(c)),symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/last\s*price|closing\s*price|price/i.test(c)),cv:h.findIndex(c=>/current\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis(?!\s*per)/i.test(c)),cbps:h.findIndex(c=>/cost\s*basis\s*per\s*share/i.test(c)),type:h.findIndex(c=>c==="type")};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/pending|cash|core|total|overall/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const cv=pNum(r[col.cv]),cb=pNum(r[col.cb]),cbps=col.cbps>=0?pNum(r[col.cbps]):(cb&&units?cb/units:0),acct=col.account>=0?(r[col.account]||"").trim():"",assetType=col.type>=0?(r[col.type]||"").trim():"",type=classifyUSAsset(symbol,name,assetType);if(acct)accounts.add(acct);holdings.push({name,type,ticker:symbol,units,purchase_price:cbps||price,current_price:price,purchase_value:cb||units*(cbps||price),current_value:cv||units*price,_account_name:acct});}
  return {format:"Fidelity",holdings,warnings,accounts:[...accounts]};
}
export function parseRobinhoodHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>c==="instrument"),qty:h.findIndex(c=>/quantity/i.test(c)),avg:h.findIndex(c=>/average\s*cost/i.test(c)),equity:h.findIndex(c=>/equity/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim();if(!name)continue;const units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${name}": zero quantity`);continue;}const equity=pNum(r[col.equity]),ticker=name.length<=6&&/^[A-Z]+$/.test(name)?name:name.split(/\s*[-–]\s*/)[0].trim(),type=classifyUSAsset(ticker,name);holdings.push({name,type,ticker:ticker.toUpperCase(),units,purchase_price:avg,current_price:equity&&units?equity/units:avg,purchase_value:units*avg,current_value:equity||units*avg});}
  return {format:"Robinhood",holdings,warnings};
}
export function parseVanguardHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={name:h.findIndex(c=>/investment\s*name/i.test(c)),symbol:h.findIndex(c=>c==="symbol"),shares:h.findIndex(c=>/shares/i.test(c)),price:h.findIndex(c=>/share\s*price/i.test(c)),value:h.findIndex(c=>/total\s*value/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const name=(r[col.name]||"").trim(),symbol=(r[col.symbol]||"").trim();if(!name&&!symbol)continue;const units=pNum(r[col.shares]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${name||symbol}": zero shares`);continue;}const value=pNum(r[col.value]),type=classifyUSAsset(symbol,name);holdings.push({name:name||symbol,type,ticker:symbol.toUpperCase(),units,purchase_price:price,current_price:price,purchase_value:units*price,current_value:value||units*price});}
  return {format:"Vanguard",holdings,warnings};
}
export function parseIBKRHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"),asset:h.findIndex(c=>/asset\s*class/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),costP:h.findIndex(c=>/cost\s*price/i.test(c)||/cost\s*basis.*price/i.test(c)),closeP:h.findIndex(c=>/close\s*price/i.test(c)||/mark.*price/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/unrealized/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|^$/i.test(symbol))continue;const name=(r[col.name]||symbol).trim(),units=pNum(r[col.qty]),costP=pNum(r[col.costP]),closeP=pNum(r[col.closeP]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const assetClass=(r[col.asset]||"").toUpperCase();let type=classifyUSAsset(symbol,name);if(assetClass==="OPT"||assetClass==="FOP"){warnings.push(`Skipped "${symbol}": options not supported`);continue;}if(assetClass==="BOND")type="US_BOND";if(assetClass==="CRYPTO")type="CRYPTO";holdings.push({name,type,ticker:symbol,units,purchase_price:costP,current_price:closeP||costP,purchase_value:units*costP,current_value:pNum(r[col.value])||units*(closeP||costP)});}
  return {format:"Interactive Brokers",holdings,warnings};
}
export function parseETRADEHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="description"||c==="name"),qty:h.findIndex(c=>/qty|quantity/i.test(c)),pp:h.findIndex(c=>/price\s*paid/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|current\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),pp=pNum(r[col.pp]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):pp,type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:pp,current_price:price,purchase_value:units*pp,current_value:pNum(r[col.mv])||units*price});}
  return {format:"E*TRADE / TD Ameritrade",holdings,warnings};
}
export function parseCoinbaseHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={asset:h.findIndex(c=>c==="asset"),qty:h.findIndex(c=>/quantity/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/cost/i.test(c)),spot:h.findIndex(c=>/spot\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const asset=(r[col.asset]||"").trim();if(!asset)continue;const units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${asset}": zero quantity`);continue;}const cb=pNum(r[col.cb]),value=pNum(r[col.value]),spot=pNum(r[col.spot]);holdings.push({name:asset,type:"CRYPTO",ticker:`${asset.toUpperCase()}-USD`,units,purchase_price:cb&&units?cb/units:spot,current_price:spot||(value&&units?value/units:0),purchase_value:cb||units*spot,current_value:value||units*spot});}
  return {format:"Coinbase",holdings,warnings};
}
export function parseMerrillHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|name|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c)),value:h.findIndex(c=>/value/i.test(c)&&!/cost/i.test(c)&&!/gain/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash|money\s*market|pending/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=pNum(r[col.price]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const value=pNum(r[col.value]),cb=col.cb>=0?pNum(r[col.cb]):0,acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:value||units*price,_account_name:acct});}
  return {format:"Merrill Edge",holdings,warnings,accounts:[...accounts]};
}
export function parseJPMorganHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description|name|security/i.test(c)),qty:h.findIndex(c=>/quantity|shares/i.test(c)),price:h.findIndex(c=>/price/i.test(c)&&!/cost/i.test(c)&&!/paid/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash|money\s*market|pending|sweep/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),price=col.price>=0?pNum(r[col.price]):0;if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const mv=pNum(r[col.mv]),cb=col.cb>=0?pNum(r[col.cb]):0,acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price,_account_name:acct});}
  return {format:"J.P. Morgan",holdings,warnings,accounts:[...accounts]};
}
export function parseWebullHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),qty:h.findIndex(c=>/qty|quantity|shares/i.test(c)),avg:h.findIndex(c=>/avg\s*cost/i.test(c)),mv:h.findIndex(c=>/mkt\s*value|market\s*val/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:avg,current_price:price||avg,purchase_value:units*avg,current_value:mv||units*(price||avg)});}
  return {format:"Webull",holdings,warnings};
}
export function parseSoFiHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),qty:h.findIndex(c=>/quantity|shares/i.test(c)),avg:h.findIndex(c=>/average\s*price/i.test(c)),price:h.findIndex(c=>/current\s*price|last\s*price/i.test(c)),mv:h.findIndex(c=>/market\s*value|value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),type:h.findIndex(c=>c==="type")};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=col.mv>=0?pNum(r[col.mv]):0,cb=col.cb>=0?pNum(r[col.cb]):0,assetType=col.type>=0?(r[col.type]||"").trim():"",type=classifyUSAsset(symbol,name,assetType);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:avg,current_price:price,purchase_value:cb||units*avg,current_value:mv||units*price});}
  return {format:"SoFi Invest",holdings,warnings};
}
export function parseWealthfrontHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={ticker:h.findIndex(c=>/ticker|symbol/i.test(c)),name:h.findIndex(c=>/description|name/i.test(c)),shares:h.findIndex(c=>/shares|quantity/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),acct:h.findIndex(c=>/account/i.test(c))};
  const holdings=[],warnings=[],accounts=new Set();
  for(const r of rows.slice(headerIdx+1)){const ticker=(r[col.ticker]||"").trim();if(!ticker||/total|cash/i.test(ticker))continue;const name=col.name>=0?(r[col.name]||ticker).trim():ticker,units=pNum(r[col.shares]);if(units===0){warnings.push(`Skipped "${ticker}": zero shares`);continue;}const cb=pNum(r[col.cb]),mv=pNum(r[col.mv]),price=mv&&units?mv/units:(cb&&units?cb/units:0),acct=col.acct>=0?(r[col.acct]||"").trim():"";if(acct)accounts.add(acct);const type=classifyUSAsset(ticker,name);holdings.push({name,type,ticker,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price,_account_name:acct});}
  return {format:"Wealthfront",holdings,warnings,accounts:[...accounts]};
}
export function parseBettermentHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"||c==="description"),asset:h.findIndex(c=>/asset\s*class/i.test(c)),shares:h.findIndex(c=>/shares|quantity/i.test(c)),price:h.findIndex(c=>/^price$/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.shares]),price=col.price>=0?pNum(r[col.price]):0;if(units===0){warnings.push(`Skipped "${symbol}": zero shares`);continue;}const mv=pNum(r[col.mv]),cb=pNum(r[col.cb]),assetClass=col.asset>=0?(r[col.asset]||"").trim():"";let type=classifyUSAsset(symbol,name);if(/bond|fixed/i.test(assetClass))type="US_BOND";holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Betterment",holdings,warnings};
}
export function parseFirstradeHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),cps:h.findIndex(c=>/cost\s*per\s*share/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|current\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]),cps=pNum(r[col.cps]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const price=col.price>=0?pNum(r[col.price]):cps,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cps,current_price:price||cps,purchase_value:units*cps,current_value:mv||units*(price||cps)});}
  return {format:"Firstrade",holdings,warnings};
}
export function parseAllyHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>/description/i.test(c)),qty:h.findIndex(c=>/qty|quantity|shares/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/last\s*price|price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const cb=pNum(r[col.cb]),mv=pNum(r[col.mv]),price=col.price>=0?pNum(r[col.price]):(mv&&units?mv/units:0),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:price,current_price:price,purchase_value:cb||units*price,current_value:mv||units*price});}
  return {format:"Ally Invest",holdings,warnings};
}
export function parsePublicHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),name:h.findIndex(c=>c==="name"),shares:h.findIndex(c=>/shares|quantity/i.test(c)),avg:h.findIndex(c=>/average\s*cost/i.test(c)),mv:h.findIndex(c=>/market\s*value/i.test(c)),price:h.findIndex(c=>/current\s*price|last\s*price/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const name=col.name>=0?(r[col.name]||symbol).trim():symbol,units=pNum(r[col.shares]),avg=pNum(r[col.avg]);if(units===0){warnings.push(`Skipped "${symbol}": zero shares`);continue;}const price=col.price>=0?pNum(r[col.price]):avg,mv=pNum(r[col.mv]),type=classifyUSAsset(symbol,name);holdings.push({name,type,ticker:symbol,units,purchase_price:avg,current_price:price||avg,purchase_value:units*avg,current_value:mv||units*(price||avg)});}
  return {format:"Public.com",holdings,warnings};
}
export function parseTastytradeHoldings(rows,headerIdx){
  const h=rows[headerIdx].map(c=>(c||"").toLowerCase().trim());
  const col={symbol:h.findIndex(c=>c==="symbol"),itype:h.findIndex(c=>/instrument\s*type/i.test(c)),qty:h.findIndex(c=>/quantity/i.test(c)),tp:h.findIndex(c=>/trade\s*price|avg\s*price/i.test(c)),mark:h.findIndex(c=>/mark/i.test(c)),netliq:h.findIndex(c=>/net\s*liq/i.test(c)),cb:h.findIndex(c=>/cost\s*basis/i.test(c))};
  const holdings=[],warnings=[];
  for(const r of rows.slice(headerIdx+1)){const symbol=(r[col.symbol]||"").trim();if(!symbol||/total|cash/i.test(symbol))continue;const itype=col.itype>=0?(r[col.itype]||"").trim():"";if(/option|put|call|future/i.test(itype)){warnings.push(`Skipped "${symbol}": ${itype} not supported`);continue;}const units=pNum(r[col.qty]);if(units===0){warnings.push(`Skipped "${symbol}": zero quantity`);continue;}const tp=pNum(r[col.tp]),mark=pNum(r[col.mark]),netliq=pNum(r[col.netliq]),cb=col.cb>=0?pNum(r[col.cb]):0,type=/crypto/i.test(itype)?"CRYPTO":classifyUSAsset(symbol,symbol);holdings.push({name:symbol,type,ticker:symbol,units,purchase_price:cb&&units?cb/units:tp,current_price:mark||tp,purchase_value:cb||units*tp,current_value:netliq||units*(mark||tp)});}
  return {format:"Tastytrade",holdings,warnings};
}
export function parseGenericHoldings(rows,headerIdx){
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
