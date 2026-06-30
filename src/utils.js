// Pure utility functions extracted from App.jsx
// Import this in App.jsx: import { calcFD, calcAccr, isUSDHolding, getVal, getInv, toINR, toINRCurrent, toUSD, fxFor, getValINR, getInvINR, xirr, getXIRR, fmtINR, fmtUSD, fmtCrINR, fmtCrUSD, fmtNative, fmtCrNative, fmt, fmtCr, fmtSec, fmtCrSec, fmtPct, uid, ago, fmtSize, setLiveUsdInr } from './utils.js'

// ── FX live rate — call setLiveUsdInr(rate) on app load ──────────
let _liveUsdInr = 94.5; // overwritten by /api/forex/usdinr on load
export function setLiveUsdInr(rate) { _liveUsdInr = rate; }
export function getLiveUsdInr() { return _liveUsdInr; }

const USD_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
const PPF_R=7.1, EPF_R=8.15;

// ── Math ─────────────────────────────────────────────────────────
export function calcFD(p,r,s,mat){const start=new Date(s),now=new Date(),m=new Date(mat);const end=now<m?now:m;const y=Math.max(0,(end-start)/(864e5*365.25));return p*Math.pow(1+r/400,y*4);}
export function calcAccr(p,rate,s){const y=Math.max(0,(new Date()-new Date(s))/(864e5*365.25));return p*Math.pow(1+rate/100,y);}

export function isUSDHolding(h) {
  if (USD_TYPES.has(h.type)) return true;
  if (h.currency && h.currency.toUpperCase() === "USD") return true;
  // CASH from SnapTrade is always USD (even if currency field is missing in DB)
  if (h.type === "CASH" && (h.source === "snaptrade" || (h.ticker||"").toUpperCase().includes("USD") || (h.name||"").includes("USD"))) return true;
  return false;
}

// getVal / getInv return NATIVE currency (₹ for Indian, $ for US)
export function getVal(h){
  const units = h.net_units!=null ? h.net_units : (h.units||0);
  switch(h.type){
    case"FD":          return calcFD(h.principal,h.interest_rate,h.start_date,h.maturity_date);
    case"PPF":         return calcAccr(h.principal,PPF_R,h.start_date);
    case"EPF":         return calcAccr(h.principal,EPF_R,h.start_date);
    case"MF":          return units*(h.current_nav||h.purchase_nav||0);
    case"IN_STOCK":
    case"IN_ETF":      return units*(h.current_price||h.purchase_price||0);
    case"US_STOCK":
    case"US_ETF":
    case"US_BOND":
    case"CRYPTO":      return units*(h.current_price||h.purchase_price||0);
    case"CASH":        return(h.current_price||h.current_value||h.purchase_price||0);
    case"REAL_ESTATE": return(h.current_value||h.purchase_value||0);
    default:           return(h.current_value||h.principal||0);
  }
}
export function getInv(h){
  // null purchase_price/purchase_value = cost basis unknown (e.g. CAS demat equity)
  if(h.avg_cost!=null && h.net_units!=null) return h.net_units * h.avg_cost;
  switch(h.type){
    case"MF":          return(h.units||0)*(h.purchase_nav||0)||(h.purchase_value||0);
    case"IN_STOCK":
    case"IN_ETF":
      if(h.purchase_price===null && h.purchase_value===null) return null;
      return(h.units||0)*(h.purchase_price||0)||(h.purchase_value||0);
    case"US_STOCK":
    case"US_ETF":
    case"US_BOND":
    case"CRYPTO":      return(h.units||0)*(h.purchase_price||0);
    case"CASH":        return(h.purchase_price||h.purchase_value||h.current_price||0);
    case"REAL_ESTATE": return(h.purchase_value||0);
    default:           return(h.purchase_value||h.principal||0);
  }
}
export function hasCostBasis(h) {
  const inv = getInv(h);
  return inv !== null && inv > 0;
}
// Convert native value → INR for unified portfolio totals
// toINR: uses purchase-time FX rate (h.usd_inr_rate) — for historical cost basis
export function toINR(val, h) { return isUSDHolding(h) ? val * (h.usd_inr_rate || _liveUsdInr) : val; }
// toINRCurrent: always uses live rate — correct for current market value and clean gain calc
export function toINRCurrent(val, h) { return isUSDHolding(h) ? val * _liveUsdInr : val; }
export function toUSD(val, h) { return isUSDHolding(h) ? val : val / _liveUsdInr; }
export function fxFor(h) { return isUSDHolding(h) ? (h.usd_inr_rate || _liveUsdInr) : 1; }
// getValINR: current value at live rate
export function getValINR(h) { return toINRCurrent(getVal(h), h); }
// getInvINR: invested at live rate — keeps gain = pure price gain (no FX distortion)
// Returns null when cost basis is unknown (CAS demat equity)
export function getInvINR(h) { const inv=getInv(h); return inv===null?null:toINRCurrent(inv, h); }
// getInvINRHist: invested at purchase-time rate — used only for FX impact calculation
export function getInvINRHist(h) { const inv=getInv(h); return inv===null?null:toINR(inv, h); }
export function xirr(cfs,dates){if(cfs.length<2)return null;const d0=dates[0],yrs=dates.map(d=>(d-d0)/(864e5*365.25));const npv=r=>cfs.reduce((s,c,i)=>s+c/Math.pow(1+r,yrs[i]),0);const dnpv=r=>cfs.reduce((s,c,i)=>s-yrs[i]*c/Math.pow(1+r,yrs[i]+1),0);let r=0.1;for(let i=0;i<100;i++){const f=npv(r),df=dnpv(r);if(Math.abs(df)<1e-12)break;const nr=r-f/df;if(Math.abs(nr-r)<1e-7){r=nr;break;}r=nr;if(r<-0.999)r=-0.999;}return isFinite(r)?r*100:null;}

// Returns { value: number|null, method: "xirr"|"cagr"|"simple"|null }
export function getXIRR(h){
  const cur = getVal(h);
  const inv = getInv(h);
  if(cur <= 0 || inv === null || inv <= 0) return { value: null, method: null };
  const txns = h.transactions || [];
  const fx = fxFor(h);

  // ── Path A: XIRR from actual transaction history (best) ──
  if(txns.length > 0) {
    const cfs = [], dates = [];
    for(const t of txns) {
      if(!t.txn_date) continue;
      const units = +t.units || 0;
      const price = +t.price || 0;
      if(!units || !price) continue;
      // Keep all cashflows in native currency (USD for USD holdings, INR for Indian).
      // Do NOT multiply by fx here — cur (added below) is also in native currency.
      const amt = units * price;
      cfs.push(t.txn_type === "BUY" ? -amt : amt);
      dates.push(new Date(t.txn_date));
    }
    if(cfs.length > 0) {
      cfs.push(cur); // native currency — consistent with the cashflows above
      dates.push(new Date());
      const earliest = Math.min(...dates.map(d => d.getTime()));
      const daySpan = (Date.now() - earliest) / 864e5;
      if(daySpan >= 30) {
        const val = xirr(cfs, dates);
        if(val !== null) return { value: val, method: "xirr" };
      }
    }
  }

  // ── Path B: CAGR from start_date (if known) ──
  if(h.start_date) {
    const s = new Date(h.start_date), n = new Date();
    const yrs = (n - s) / (864e5 * 365.25);
    if(yrs >= 0.08) { // ~1 month minimum
      const cagr = (Math.pow(cur / inv, 1 / yrs) - 1) * 100;
      if(isFinite(cagr)) return { value: cagr, method: "cagr" };
    }
  }

  // ── Path C: Simple return only (no time component) ──
  const simpleReturn = ((cur - inv) / inv) * 100;
  if(isFinite(simpleReturn)) return { value: simpleReturn, method: "simple" };

  return { value: null, method: null };
}

// ── Currency formatting ──────────────────────────────────────────
export const fmtINR = n => "₹" + Math.abs(n).toLocaleString("en-IN", {maximumFractionDigits:0});
export const fmtUSD = n => "$" + Math.abs(n).toLocaleString("en-US", {maximumFractionDigits:0});
export const fmtCrINR = n => { const a=Math.abs(n); return a>=1e7?`₹${(a/1e7).toFixed(2)}Cr`:a>=1e5?`₹${(a/1e5).toFixed(2)}L`:fmtINR(a); };
export const fmtCrUSD = n => { const a=Math.abs(n); return a>=1e6?`$${(a/1e6).toFixed(2)}M`:a>=1e3?`$${(a/1e3).toFixed(1)}K`:fmtUSD(a); };
export const fmtNative = (n, h) => isUSDHolding(h) ? fmtUSD(n) : fmtINR(n);
export const fmtCrNative = (n, h) => isUSDHolding(h) ? fmtCrUSD(n) : fmtCrINR(n);
// Portfolio totals: ₹ primary (NRI view — all combined totals shown in INR)
export const fmt = n => fmtINR(n);
export const fmtCr = n => fmtCrINR(n);
// Secondary line: $ equivalent (divide INR total by live rate)
export const fmtSec = n => fmtUSD(n / _liveUsdInr);
export const fmtCrSec = n => fmtCrUSD(n / _liveUsdInr);
export const fmtPct=n=>n==null?"—":`${n>=0?"+":""}${n.toFixed(2)}%`;
export const uid=()=>"x"+Date.now()+Math.random().toString(36).slice(2,6);
export const ago=d=>{if(!d)return"Never";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;};
export const fmtSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:b>1e3?`${(b/1e3).toFixed(0)}KB`:`${b}B`;
