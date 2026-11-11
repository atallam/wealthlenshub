import { classifyUSAsset } from "./shared.js";

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
