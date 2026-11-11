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
