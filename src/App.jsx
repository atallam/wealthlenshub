import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword, signOut } from "./supabase.js";
import SnapTradeImport from "./SnapTradeImport";
import KiteImport from "./KiteImport";
import BreezeImport from "./BreezeImport";
// SetuAAImport — disabled until Setu integration is ready
// import SetuAAImport from "./SetuAAImport";

const GF = `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');`;

const AT = {
  US_STOCK:    { label:"US Stocks",     color:"#5a9ce0", icon:"$",  cat:"US Market" },
  US_ETF:      { label:"US ETF",        color:"#4a8cd8", icon:"🔵", cat:"US Market" },
  CRYPTO:      { label:"Crypto",        color:"#f7931a", icon:"₿",  cat:"US Market" },
  US_BOND:     { label:"US Bonds",      color:"#7095b0", icon:"📜", cat:"US Market" },
  CASH:        { label:"Cash",          color:"#8cb8c9", icon:"💵", cat:"US Market" },
  IN_STOCK:    { label:"Indian Stocks", color:"#e07c5a", icon:"📈", cat:"Indian Market" },
  IN_ETF:      { label:"Indian ETF",   color:"#f0a050", icon:"🔷", cat:"Indian Market" },
  MF:          { label:"Mutual Fund",   color:"#a084ca", icon:"📊", cat:"Indian Market" },
  FD:          { label:"Fixed Deposit", color:"#c9a84c", icon:"🏦", cat:"Debt" },
  PPF:         { label:"PPF",           color:"#4caf9a", icon:"📗", cat:"Debt" },
  EPF:         { label:"EPF",           color:"#6ec0c9", icon:"🏛️", cat:"Debt" },
  REAL_ESTATE: { label:"Real Estate",  color:"#7cb87c", icon:"🏠", cat:"Physical" },
  OTHER:       { label:"Other",         color:"#999999", icon:"📁", cat:"Other" },
};
const USD_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
const PPF_R=7.1, EPF_R=8.15;

// ── Math ─────────────────────────────────────────────────────────
function calcFD(p,r,s,mat){const start=new Date(s),now=new Date(),m=new Date(mat);const end=now<m?now:m;const y=Math.max(0,(end-start)/(864e5*365.25));return p*Math.pow(1+r/400,y*4);}
function calcAccr(p,rate,s){const y=Math.max(0,(new Date()-new Date(s))/(864e5*365.25));return p*Math.pow(1+rate/100,y);}
// FX: live rate updated on app load; used only for portfolio-level INR↔USD conversion
let _liveUsdInr = 94.5; // overwritten by /api/forex/usdinr on load

function isUSDHolding(h) {
  if (USD_TYPES.has(h.type)) return true;
  if (h.currency && h.currency.toUpperCase() === "USD") return true;
  // CASH from SnapTrade is always USD (even if currency field is missing in DB)
  if (h.type === "CASH" && (h.source === "snaptrade" || (h.ticker||"").toUpperCase().includes("USD") || (h.name||"").includes("USD"))) return true;
  return false;
}

// getVal / getInv return NATIVE currency (₹ for Indian, $ for US)
function getVal(h){
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
function getInv(h){
  if(h.avg_cost!=null && h.net_units!=null) return h.net_units * h.avg_cost;
  switch(h.type){
    case"MF":          return(h.units||0)*(h.purchase_nav||0)||(h.purchase_value||0);
    case"IN_STOCK":
    case"IN_ETF":      return(h.units||0)*(h.purchase_price||0);
    case"US_STOCK":
    case"US_ETF":
    case"US_BOND":
    case"CRYPTO":      return(h.units||0)*(h.purchase_price||0);
    case"CASH":        return(h.purchase_price||h.purchase_value||h.current_price||0);
    case"REAL_ESTATE": return(h.purchase_value||0);
    default:           return(h.purchase_value||h.principal||0);
  }
}
// Convert native value → INR for unified portfolio totals
function toINR(val, h) { return isUSDHolding(h) ? val * (h.usd_inr_rate || _liveUsdInr) : val; }
function toUSD(val, h) { return isUSDHolding(h) ? val : val / _liveUsdInr; }
function fxFor(h) { return isUSDHolding(h) ? (h.usd_inr_rate || _liveUsdInr) : 1; }
function getValINR(h) { return toINR(getVal(h), h); }
function getInvINR(h) { return toINR(getInv(h), h); }
function xirr(cfs,dates){if(cfs.length<2)return null;const d0=dates[0],yrs=dates.map(d=>(d-d0)/(864e5*365.25));const npv=r=>cfs.reduce((s,c,i)=>s+c/Math.pow(1+r,yrs[i]),0);const dnpv=r=>cfs.reduce((s,c,i)=>s-yrs[i]*c/Math.pow(1+r,yrs[i]+1),0);let r=0.1;for(let i=0;i<100;i++){const f=npv(r),df=dnpv(r);if(Math.abs(df)<1e-12)break;const nr=r-f/df;if(Math.abs(nr-r)<1e-7){r=nr;break;}r=nr;if(r<-0.999)r=-0.999;}return isFinite(r)?r*100:null;}

// Returns { value: number|null, method: "xirr"|"cagr"|"simple"|null }
function getXIRR(h){
  const cur = getVal(h);
  const inv = getInv(h);
  if(cur <= 0 || inv <= 0) return { value: null, method: null };
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
      const amt = units * price * fx;
      cfs.push(t.txn_type === "BUY" ? -amt : amt);
      dates.push(new Date(t.txn_date));
    }
    if(cfs.length > 0) {
      cfs.push(cur);
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

// ── Currency formatting: $ primary, ₹ secondary ─────────────────
const fmtINR = n => "₹" + Math.abs(n).toLocaleString("en-IN", {maximumFractionDigits:0});
const fmtUSD = n => "$" + Math.abs(n).toLocaleString("en-US", {maximumFractionDigits:0});
const fmtCrINR = n => { const a=Math.abs(n); return a>=1e7?`₹${(a/1e7).toFixed(2)}Cr`:a>=1e5?`₹${(a/1e5).toFixed(2)}L`:fmtINR(a); };
const fmtCrUSD = n => { const a=Math.abs(n); return a>=1e6?`$${(a/1e6).toFixed(2)}M`:a>=1e3?`$${(a/1e3).toFixed(1)}K`:fmtUSD(a); };
const fmtNative = (n, h) => isUSDHolding(h) ? fmtUSD(n) : fmtINR(n);
const fmtCrNative = (n, h) => isUSDHolding(h) ? fmtCrUSD(n) : fmtCrINR(n);
// Portfolio totals: $ primary (convert INR totals to USD for display)
const fmt = n => fmtUSD(n / _liveUsdInr);
const fmtCr = n => fmtCrUSD(n / _liveUsdInr);
// Secondary line: ₹ equivalent
const fmtSec = n => fmtINR(n);
const fmtCrSec = n => fmtCrINR(n);
const fmtPct=n=>`${n>=0?"+":""}${n.toFixed(2)}%`;
const uid=()=>"x"+Date.now()+Math.random().toString(36).slice(2,6);
const ago=d=>{if(!d)return"Never";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;};
const fmtSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:b>1e3?`${(b/1e3).toFixed(0)}KB`:`${b}B`;

// Holding form — instrument details only, no transaction data
const BF={member_id:"",type:"US_STOCK",name:"",ticker:"",scheme_code:"",interest_rate:"",start_date:"",maturity_date:"",purchase_value:"",current_value:"",principal:"",usd_inr_rate:""};
// Transaction form
const BT={holding_id:"",txn_type:"BUY",units:"",price:"",price_usd:"",txn_date:new Date().toISOString().slice(0,10),notes:""};

// ── Demo seed data (used on first login) ─────────────────────────
const m1="mbr_demo1", m2="mbr_demo2";
const SEED = {
  members: [
    { id:m1, name:"Rahul",   relation:"Self"   },
    { id:m2, name:"Priya",   relation:"Spouse" },
  ],
  goals: [
    { id:"g1", name:"Retirement Corpus",    targetAmount:30000000, targetDate:"2040-03-31", category:"Retirement",    color:"#c9a84c", priority:1, linkedMembers:["all"],  linkedTypes:["IN_STOCK","IN_ETF","US_STOCK","US_ETF","CRYPTO"], monthlyContribution:50000, notes:"Target 3Cr by 55 — all equity exposure" },
    { id:"g2", name:"Daughter's Education", targetAmount:5000000,  targetDate:"2032-06-01", category:"Education",     color:"#a084ca", priority:2, linkedMembers:[m1,m2], linkedTypes:["MF"], monthlyContribution:15000, notes:"Engineering + Masters — funded by mutual funds" },
    { id:"g3", name:"Dream Home Upgrade",   targetAmount:8000000,  targetDate:"2028-12-31", category:"Real Estate",   color:"#5a9ce0", priority:3, linkedMembers:["all"],  linkedTypes:["FD","PPF","EPF"], monthlyContribution:25000, notes:"Upgrade to 3BHK — funded by debt instruments" },
    { id:"g4", name:"Emergency Fund",       targetAmount:1500000,  targetDate:"2025-12-31", category:"Emergency Fund",color:"#4caf9a", priority:4, linkedMembers:["all"],  linkedTypes:["CASH","FD"], monthlyContribution:20000, notes:"6 months expenses — cash + FD" },
  ],
  alerts: [
    { id:"al1", type:"ALLOCATION_DRIFT",   assetType:"IN_STOCK", threshold:60, label:"Equity over 60% — allocation review needed", active:true },
    { id:"al2", type:"CONCENTRATION",      assetType:"FD",       threshold:10, label:"FD below 10% — add fixed income",    active:true },
    { id:"al3", type:"RETURN_TARGET",      assetType:"",         threshold:10, label:"Portfolio return below 10%",          active:true },
  ],
  holdings: [
    // Rahul's holdings
    { id:"h1",  user_id:"",member_id:m1, type:"MF",       name:"Mirae Asset Large Cap Fund - Direct Plan - Growth",          scheme_code:"118834", ticker:"",           purchase_value:250000,  current_value:347500 },
    { id:"h2",  user_id:"",member_id:m1, type:"MF",       name:"Axis Midcap Fund - Direct Plan - Growth",                    scheme_code:"120843", ticker:"",           purchase_value:180000,  current_value:267300 },
    { id:"h3",  user_id:"",member_id:m1, type:"MF",       name:"Parag Parikh Flexi Cap Fund - Direct Plan - Growth",         scheme_code:"122639", ticker:"",           purchase_value:300000,  current_value:498000 },
    { id:"h4",  user_id:"",member_id:m1, type:"IN_STOCK", name:"Reliance Industries Ltd",                                    ticker:"RELIANCE",    scheme_code:"",      purchase_value:150000,  current_value:189000 },
    { id:"h5",  user_id:"",member_id:m1, type:"IN_STOCK", name:"HDFC Bank Ltd",                                              ticker:"HDFCBANK",    scheme_code:"",      purchase_value:120000,  current_value:138000 },
    { id:"h6",  user_id:"",member_id:m1, type:"IN_STOCK", name:"Infosys Ltd",                                                ticker:"INFY",        scheme_code:"",      purchase_value:95000,   current_value:121600 },
    { id:"h7",  user_id:"",member_id:m1, type:"US_STOCK", name:"NVIDIA Corporation",                                         ticker:"NVDA",        scheme_code:"",      purchase_value:210000,  current_value:378000,  usd_inr_rate:94.5 },
    { id:"h8",  user_id:"",member_id:m1, type:"US_STOCK", name:"Apple Inc",                                                  ticker:"AAPL",        scheme_code:"",      purchase_value:125000,  current_value:148750,  usd_inr_rate:94.5 },
    { id:"h8a", user_id:"",member_id:m1, type:"US_ETF",   name:"Vanguard S&P 500 ETF",                                       ticker:"VOO",         scheme_code:"",      purchase_value:180000,  current_value:215000,  usd_inr_rate:94.5 },
    { id:"h8b", user_id:"",member_id:m1, type:"CRYPTO",   name:"Bitcoin",                                                    ticker:"BTC-USD",     scheme_code:"",      purchase_value:100000,  current_value:165000,  usd_inr_rate:94.5 },
    { id:"h9",  user_id:"",member_id:m1, type:"IN_ETF",   name:"Nippon India ETF Nifty 50 BeES",                             ticker:"NIFTYBEES",   scheme_code:"",      purchase_value:80000,   current_value:103200 },
    { id:"h10", user_id:"",member_id:m1, type:"FD",       name:"HDFC Bank FD - 7.25% p.a.",                                  ticker:"",            scheme_code:"",      principal:500000,       current_value:537500,  interest_rate:7.25, start_date:"2024-04-01", maturity_date:"2025-04-01" },
    { id:"h11", user_id:"",member_id:m1, type:"PPF",      name:"PPF Account - SBI",                                          ticker:"",            scheme_code:"",      principal:150000,       current_value:162000,  start_date:"2020-04-01" },
    // Priya's holdings
    { id:"h12", user_id:"",member_id:m2, type:"MF",       name:"SBI Bluechip Fund - Direct Plan - Growth",                   scheme_code:"119598", ticker:"",           purchase_value:200000,  current_value:278000 },
    { id:"h13", user_id:"",member_id:m2, type:"MF",       name:"Kotak Emerging Equity Fund - Direct Plan - Growth",          scheme_code:"120505", ticker:"",           purchase_value:160000,  current_value:227200 },
    { id:"h14", user_id:"",member_id:m2, type:"IN_STOCK", name:"Tata Consultancy Services Ltd",                              ticker:"TCS",         scheme_code:"",      purchase_value:175000,  current_value:224000 },
    { id:"h15", user_id:"",member_id:m2, type:"IN_ETF",   name:"ICICI Prudential Gold ETF",                                  ticker:"ICICIGOLD",   scheme_code:"",      purchase_value:90000,   current_value:121500 },
    { id:"h16", user_id:"",member_id:m2, type:"FD",       name:"ICICI Bank FD - 7.10% p.a.",                                 ticker:"",            scheme_code:"",      principal:300000,       current_value:321300,  interest_rate:7.10, start_date:"2024-06-01", maturity_date:"2025-06-01" },
    { id:"h17", user_id:"",member_id:m2, type:"EPF",      name:"EPF Account",                                                ticker:"",            scheme_code:"",      principal:280000,       current_value:302400,  start_date:"2018-07-01" },
    { id:"h18", user_id:"",member_id:m1, type:"REAL_ESTATE",name:"2BHK Apartment - Hyderabad",                               ticker:"",            scheme_code:"",      purchase_value:4500000, current_value:5850000 },
  ],
  transactions: {
    // scheme_code → [{date, amount}] for MFs; ticker → [{date,units,price}] for stocks
    "h1":  [{date:"2022-04-05",units:3245.8,price:77.02,type:"BUY"},{date:"2022-10-05",units:2891.3,price:86.48,type:"BUY"},{date:"2023-04-05",units:2445.2,price:102.24,type:"BUY"},{date:"2023-10-05",units:2187.4,price:114.28,type:"BUY"}],
    "h2":  [{date:"2022-06-10",units:1456.2,price:61.82,type:"BUY"},{date:"2023-01-10",units:1123.5,price:80.12,type:"BUY"},{date:"2023-09-10",units:892.4,price:100.87,type:"BUY"}],
    "h3":  [{date:"2021-12-01",units:2145.6,price:46.61,type:"BUY"},{date:"2022-06-01",units:1876.3,price:53.19,type:"BUY"},{date:"2023-01-01",units:1543.2,price:64.82,type:"BUY"},{date:"2023-07-01",units:1234.5,price:80.19,type:"BUY"}],
    "h4":  [{date:"2022-03-15",units:62,price:2419.35,type:"BUY"},{date:"2023-08-15",units:40,price:2450.00,type:"BUY"}],
    "h5":  [{date:"2022-05-20",units:85,price:1411.76,type:"BUY"},{date:"2023-11-20",units:55,price:1445.45,type:"BUY"}],
    "h6":  [{date:"2022-07-10",units:65,price:1461.54,type:"BUY"},{date:"2023-05-10",units:45,price:1311.11,type:"BUY"}],
    "h7":  [{date:"2023-01-20",units:18,price:462.78,type:"BUY"},{date:"2023-09-20",units:14,price:434.86,type:"BUY"}],
    "h8":  [{date:"2022-11-15",units:55,price:748.18,type:"BUY"},{date:"2023-08-15",units:40,price:756.25,type:"BUY"}],
    "h9":  [{date:"2022-08-01",units:420,price:190.48,type:"BUY"}],
    "h12": [{date:"2022-04-08",units:2341.2,price:42.46,type:"BUY"},{date:"2022-10-08",units:1987.6,price:50.31,type:"BUY"},{date:"2023-04-08",units:1654.3,price:60.45,type:"BUY"},{date:"2023-10-08",units:1342.1,price:74.50,type:"BUY"}],
    "h13": [{date:"2022-05-15",units:1876.5,price:42.63,type:"BUY"},{date:"2023-02-15",units:1432.8,price:55.84,type:"BUY"},{date:"2023-11-15",units:1123.4,price:71.21,type:"BUY"}],
    "h14": [{date:"2022-02-28",units:45,price:3888.89,type:"BUY"},{date:"2023-06-28",units:30,price:3733.33,type:"BUY"}],
    "h15": [{date:"2022-09-01",units:210,price:428.57,type:"BUY"}],
  }
};
const BG={name:"",targetAmount:"",targetDate:"",linkedMembers:["all"],linkedTypes:[],category:"Retirement",color:"#c9a84c",notes:"",priority:1,monthlyContribution:""};
const BA={type:"ALLOCATION_DRIFT",assetType:"IN_STOCK",threshold:"",label:"",active:true};

// ── API helper (attaches Supabase JWT) ───────────────────────────
async function api(path, opts={}) {
  const { data:{ session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization:`Bearer ${token}`, ...(isForm?{}:{"Content-Type":"application/json"}), ...(opts.headers||{}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||res.statusText); }
  return res.json();
}

/* ══════════════════════════════════════════════
   LOGIN SCREEN
══════════════════════════════════════════════ */
function LoginScreen({ error: initError }) {
  const [mode,setMode]=useState("signin");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [name,setName]=useState(""); const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(initError||""); const [msg,setMsg]=useState("");
  async function handleGoogle(){ setLoading(true); setErr(""); await signInWithGoogle().catch(e=>{setErr(e.message||"Failed");setLoading(false);}); }
  async function handleGitHub(){ setLoading(true); setErr(""); await signInWithGitHub().catch(e=>{setErr(e.message||"Failed");setLoading(false);}); }
  async function handleSubmit(e){
    e.preventDefault(); setLoading(true); setErr(""); setMsg("");
    try{
      if(mode==="signin"){ const{error}=await signInWithEmail(email,password); if(error)setErr(error.message); }
      else if(mode==="signup"){ if(!name.trim()){setErr("Enter your name");setLoading(false);return;} const{error}=await signUpWithEmail(email,password,name); if(error)setErr(error.message); else setMsg("Check email for confirmation link, then sign in."); }
      else { const{error}=await resetPassword(email); if(error)setErr(error.message); else setMsg("Reset email sent — check your inbox."); }
    }catch(ex){setErr(ex.message);} setLoading(false);
  }

  // ── Inline styles as objects for cleanliness ──
  const S = {
    page: {minHeight:"100vh",background:"#070d1a",color:"#e8e0d0",overflowX:"hidden"},
    // Nav
    nav: {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.4rem 4%",borderBottom:"1px solid rgba(201,168,76,.06)"},
    navLinks: {display:"flex",gap:"2rem",alignItems:"center",fontSize:".8rem",color:"rgba(232,224,208,.4)"},
    // Sections
    section: {padding:"0 4%",maxWidth:1200,margin:"0 auto"},
  };

  return(
    <div style={S.page}>

      {/* ═══ HERO + LOGIN ═══ */}
      <div style={{...S.section,display:"flex",flexWrap:"wrap",gap:"2rem",alignItems:"start",paddingTop:"2.5rem",paddingBottom:".5rem"}}>

        {/* Left: Value proposition */}
        <div style={{flex:"1 1 340px",minWidth:0}}>
          <div className="logo" style={{fontSize:"1.35rem",marginBottom:"1.2rem"}}>Wealth<span>Lens</span></div>
          <div style={{fontSize:".65rem",letterSpacing:".2em",textTransform:"uppercase",color:"#c9a84c",marginBottom:"1rem",display:"flex",alignItems:"center",gap:".5rem"}}>
            <span style={{width:24,height:1,background:"#c9a84c",display:"inline-block"}}/>
            Portfolio Intelligence
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"2.8rem",fontWeight:400,lineHeight:1.15,letterSpacing:"-.02em",marginBottom:"1rem"}}>
            Your family's net worth<br/>
            <span style={{color:"rgba(232,224,208,.35)"}}>across</span>{" "}
            <span style={{color:"#c9a84c"}}>India</span>{" "}
            <span style={{color:"rgba(232,224,208,.35)"}}>and the</span>{" "}
            <span style={{color:"#5a9ce0"}}>US</span>
          </h1>
          <p style={{fontSize:".95rem",color:"rgba(232,224,208,.45)",lineHeight:1.8,maxWidth:520,marginBottom:"1.5rem"}}>
            Track individual and family portfolios in one place — stocks, mutual funds, ETFs, fixed deposits, crypto. Per-member breakdown, combined net worth, live prices, and dual-currency display. Auto-import from 25+ brokerages. Free and private.
          </p>

          {/* Compact stats */}
          <div style={{display:"flex",gap:"2.5rem",flexWrap:"wrap"}}>
            {[["25+","US brokerages"],["14","bank parsers"],["4-layer","security"]].map(([n,l])=>(
              <div key={l}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1.3rem",fontWeight:500,color:"#c9a84c"}}>{n}</div>
                <div style={{fontSize:".68rem",color:"rgba(232,224,208,.3)",marginTop:".15rem"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Login — blended into the page */}
        <div style={{flex:"0 1 420px",width:"100%",background:"rgba(255,255,255,.02)",border:"1px solid rgba(232,224,208,.06)",borderRadius:20,padding:"2.2rem 2rem"}}>
          <div style={{fontSize:"1.15rem",fontWeight:500,marginBottom:".2rem",textAlign:"center"}}>Get started</div>
          <div style={{fontSize:".78rem",color:"rgba(232,224,208,.35)",marginBottom:"1.4rem",textAlign:"center"}}>Free account — no credit card required</div>

          {err&&<div style={{color:"#e07c5a",fontSize:".73rem",marginBottom:".7rem",padding:".45rem .7rem",background:"rgba(224,124,90,.06)",borderRadius:8,border:"1px solid rgba(224,124,90,.1)"}}>{err}</div>}
          {msg&&<div style={{color:"#4caf9a",fontSize:".73rem",marginBottom:".7rem",padding:".45rem .7rem",background:"rgba(76,175,154,.06)",borderRadius:8,border:"1px solid rgba(76,175,154,.1)"}}>{msg}</div>}

          <div style={{display:"flex",gap:".5rem",marginBottom:".5rem"}}>
            <button className="google-btn" onClick={handleGoogle} disabled={loading} style={{flex:1,padding:".7rem",fontSize:".82rem",borderRadius:10}}>
              {!loading&&<svg width="16" height="16" viewBox="0 0 18 18" style={{marginRight:".4rem",flexShrink:0}}><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>}
              {loading?"…":"Google"}
            </button>
            <button className="google-btn" onClick={handleGitHub} disabled={loading} style={{flex:1,padding:".7rem",fontSize:".82rem",borderRadius:10}}>
              {!loading&&<svg width="16" height="16" viewBox="0 0 24 24" style={{marginRight:".4rem",flexShrink:0}} fill="#ffffff"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.929.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>}
              {loading?"…":"GitHub"}
            </button>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:".7rem",margin:"0 0 .9rem"}}><div style={{flex:1,height:1,background:"rgba(255,255,255,.05)"}}/><div style={{fontSize:".58rem",color:"rgba(255,255,255,.2)",letterSpacing:".06em"}}>or use email</div><div style={{flex:1,height:1,background:"rgba(255,255,255,.05)"}}/></div>

          {mode!=="forgot"&&<div style={{display:"flex",gap:".25rem",marginBottom:".8rem",borderRadius:8,background:"rgba(255,255,255,.025)",padding:"3px"}}>
            {["signin","signup"].map(m=><div key={m} onClick={()=>{setMode(m);setErr("");setMsg("");}} style={{flex:1,textAlign:"center",padding:".4rem",borderRadius:6,cursor:"pointer",fontSize:".72rem",fontWeight:mode===m?500:400,background:mode===m?"rgba(201,168,76,.1)":"transparent",color:mode===m?"#c9a84c":"rgba(255,255,255,.35)",transition:"all .2s"}}>{m==="signin"?"Sign In":"Create Account"}</div>)}
          </div>}

          <form onSubmit={handleSubmit}>
            {mode==="signup"&&<input className="fi" type="text" placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} style={{marginBottom:".45rem",fontSize:".84rem",borderRadius:10}} required/>}
            <input className="fi" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} style={{marginBottom:".45rem",fontSize:".84rem",borderRadius:10}} required/>
            {mode!=="forgot"&&<input className="fi" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} style={{marginBottom:".7rem",fontSize:".84rem",borderRadius:10}} required minLength={6}/>}
            <button type="submit" className="btns" disabled={loading} style={{width:"100%",padding:".65rem",fontSize:".85rem",borderRadius:10}}>{loading?"Please wait…":mode==="signin"?"Sign In":mode==="signup"?"Create Account":"Send Reset Link"}</button>
          </form>

          <div style={{display:"flex",justifyContent:"space-between",marginTop:".6rem",fontSize:".65rem",color:"rgba(255,255,255,.25)"}}>
            {mode==="signin"&&<span onClick={()=>{setMode("forgot");setErr("");setMsg("");}} style={{cursor:"pointer"}}>Forgot password?</span>}
            {mode==="forgot"&&<span onClick={()=>setMode("signin")} style={{cursor:"pointer"}}>← Back</span>}
            <span style={{marginLeft:"auto"}}>🔒 Encrypted & Private</span>
          </div>
        </div>
      </div>

      {/* ═══ SECTION NAV ═══ */}
      <div style={{...S.section,paddingTop:"1.5rem",paddingBottom:"1.5rem",display:"flex",justifyContent:"center",gap:"1rem",flexWrap:"wrap",borderTop:"1px solid rgba(232,224,208,.04)",borderBottom:"1px solid rgba(232,224,208,.04)"}}>
        {[
          {label:"Features",href:"#features",color:"#c9a84c",desc:"What you get"},
          {label:"Security",href:"#security",color:"#4caf9a",desc:"How we protect you"},
          {label:"Platforms",href:"#platforms",color:"#5a9ce0",desc:"Where it works"},
        ].map(item=>(
          <a key={item.label} href={item.href} style={{textDecoration:"none",textAlign:"center",padding:".8rem 1.5rem",borderRadius:12,border:`1px solid ${item.color}15`,background:`${item.color}06`,transition:"all .3s",cursor:"pointer",flex:"1 1 auto",minWidth:0,maxWidth:200}}
            onMouseOver={e=>{e.currentTarget.style.background=`${item.color}12`;e.currentTarget.style.borderColor=`${item.color}30`;e.currentTarget.style.transform="translateY(-2px)"}}
            onMouseOut={e=>{e.currentTarget.style.background=`${item.color}06`;e.currentTarget.style.borderColor=`${item.color}15`;e.currentTarget.style.transform="none"}}>
            <div style={{fontSize:"1.15rem",fontWeight:600,color:item.color,marginBottom:".25rem",letterSpacing:".01em"}}>{item.label}</div>
            <div style={{fontSize:".72rem",color:"rgba(232,224,208,.35)"}}>{item.desc}</div>
          </a>
        ))}
      </div>

      {/* ═══ FEATURES ═══ */}
      <div id="features" style={{...S.section,paddingTop:"5rem",paddingBottom:"5rem",borderTop:"1px solid rgba(232,224,208,.04)"}}>
        <div style={{marginBottom:"2.5rem",maxWidth:520}}>
          <div style={{fontSize:".62rem",letterSpacing:".2em",textTransform:"uppercase",color:"#c9a84c",marginBottom:".8rem",display:"flex",alignItems:"center",gap:".5rem"}}>
            <span style={{width:20,height:1,background:"#c9a84c",display:"inline-block"}}/>
            Features
          </div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",lineHeight:1.2,marginBottom:".8rem"}}>
            Everything your portfolio needs.
          </div>
          <p style={{fontSize:".82rem",color:"rgba(232,224,208,.35)",lineHeight:1.7}}>From auto-import to AI-powered goal planning — built for investors who hold assets across borders.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))",gap:"1rem"}}>
            {[
              {icon:"🔗",t:"US Brokerage Sync",d:"Fidelity, Schwab, Robinhood, Vanguard, E*TRADE and 20+ more. One OAuth flow, holdings sync automatically.",tag:"SnapTrade",c:"#5a9ce0"},
              {icon:"🇮🇳",t:"Indian MF & Stock Import",d:"Upload your NSDL/CDSL CAS statement. Extracts all mutual funds and demat stocks with NAV, units, cost basis.",tag:"CAS Auto-Parse",c:"#c9a84c"},
              {icon:"💱",t:"Dual Currency",d:"₹ for Indian holdings, $ for US. Portfolio totals in dollars with rupee equivalent. Live exchange rate, always current.",tag:"10 Currencies",c:"#c9a84c"},
              {icon:"🎯",t:"Goal Planning",d:"Link asset types to financial goals. Track progress. AI analyses your portfolio and suggests a specific plan to reach each goal.",tag:"Claude AI",c:"#a084ca"},
              {icon:"💰",t:"Budget Tracker",d:"Upload bank statements from Chase, BofA, HDFC, ICICI and 10 more. CSV, Excel, or PDF. Auto-categorised spending analytics.",tag:"14 Banks",c:"#e07c5a"},
              {icon:"🏦",t:"US Bank Auto-Sync",d:"Connect your bank via Plaid. Transactions flow in automatically. Smart categorisation maps to your budget. No uploads needed.",tag:"Plaid",c:"#5a9ce0"},
            ].map(f=>(
              <div key={f.t} style={{padding:"1.4rem",borderRadius:14,border:"1px solid rgba(232,224,208,.05)",background:"rgba(255,255,255,.015)",transition:"border-color .3s"}}>
                <div style={{fontSize:"1.2rem",marginBottom:".8rem"}}>{f.icon}</div>
                <div style={{fontSize:".88rem",fontWeight:600,marginBottom:".35rem"}}>{f.t}</div>
                <div style={{fontSize:".78rem",color:"rgba(232,224,208,.4)",lineHeight:1.7,marginBottom:".6rem"}}>{f.d}</div>
                <span style={{fontSize:".58rem",letterSpacing:".08em",textTransform:"uppercase",color:f.c,opacity:.7}}>{f.tag}</span>
              </div>
            ))}
        </div>
      </div>

      {/* ═══ SECURITY ═══ */}
      <div id="security" style={{...S.section,paddingTop:"5rem",paddingBottom:"5rem",borderTop:"1px solid rgba(232,224,208,.04)"}}>
        <div style={{marginBottom:"2.5rem",maxWidth:520}}>
          <div style={{fontSize:".62rem",letterSpacing:".2em",textTransform:"uppercase",color:"#4caf9a",marginBottom:".8rem",display:"flex",alignItems:"center",gap:".5rem"}}>
            <span style={{width:20,height:1,background:"#4caf9a",display:"inline-block"}}/>
            Security
          </div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",lineHeight:1.2,marginBottom:".8rem"}}>
            Your data stays yours.
          </div>
          <p style={{fontSize:".82rem",color:"rgba(232,224,208,.35)",lineHeight:1.7}}>Four layers of protection. Even if one fails, the others hold. We built this so you can trust it with real money.</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:".8rem"}}>
            {[
              {n:"01",t:"You control access",d:"Sign in with Google or email. Every request carries a secure token that's verified server-side. Without a valid login, nothing loads — no exceptions, no guest mode.",icon:"🔐"},
              {n:"02",t:"The database guards your data",d:"Each table has its own security policy: only show rows that belong to the logged-in user. This is enforced by the database engine itself — even a bug in our code can't leak your data to someone else. Think of it like a bank vault with your name on the lock.",icon:"🏛️"},
              {n:"03",t:"Every action is double-checked",d:"On top of the database protection, our code independently verifies that every read, write, and delete belongs to you. Before removing a document, we confirm the parent holding is yours. Two independent systems, same answer.",icon:"🛡️"},
              {n:"04",t:"Sensitive data is encrypted",d:"Bank transactions are scrambled with AES-256 encryption before storage. Even with direct database access, the data is unreadable. The encryption key lives on the server and never reaches your browser.",icon:"🔒"},
            ].map(s=>(
              <div key={s.n} style={{display:"flex",gap:"1.2rem",padding:"1.3rem 1.4rem",borderRadius:14,border:"1px solid rgba(76,175,154,.06)",background:"rgba(76,175,154,.015)"}}>
                <div style={{fontSize:"1.5rem",flexShrink:0,marginTop:2}}>{s.icon}</div>
                <div>
                  <div style={{display:"flex",alignItems:"baseline",gap:".6rem",marginBottom:".3rem"}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:".65rem",color:"rgba(76,175,154,.3)"}}>{s.n}</span>
                    <span style={{fontSize:".88rem",fontWeight:600,color:"#4caf9a"}}>{s.t}</span>
                  </div>
                  <div style={{fontSize:".78rem",color:"rgba(232,224,208,.4)",lineHeight:1.75}}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
      </div>

      {/* ═══ PLATFORMS ═══ */}
      <div id="platforms" style={{...S.section,paddingTop:"4rem",paddingBottom:"4rem",borderTop:"1px solid rgba(232,224,208,.04)"}}>
        <div style={{textAlign:"center",marginBottom:"2.5rem"}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.6rem",marginBottom:".5rem"}}>Works with your accounts</div>
          <p style={{fontSize:".82rem",color:"rgba(232,224,208,.3)"}}>Auto-import from brokerages and bank statement parsers across both markets.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:"2rem",maxWidth:900,margin:"0 auto"}}>
          <div>
            <div style={{fontSize:".68rem",fontWeight:600,color:"#5a9ce0",letterSpacing:".08em",marginBottom:".7rem"}}>🇺🇸 United States</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:".3rem"}}>
              {["Fidelity","Schwab","Robinhood","Vanguard","E*TRADE","Interactive Brokers","Merrill","Webull","SoFi","Chase","Bank of America","Wells Fargo","Citi","Capital One","Amex"].map(n=>(
                <span key={n} style={{fontSize:".65rem",color:"rgba(232,224,208,.35)",padding:".3rem .55rem",borderRadius:6,border:"1px solid rgba(90,156,224,.08)",background:"rgba(90,156,224,.02)"}}>{n}</span>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:".68rem",fontWeight:600,color:"#c9a84c",letterSpacing:".08em",marginBottom:".7rem"}}>🇮🇳 India</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:".3rem"}}>
              {["Zerodha","Groww","ICICI Direct","HDFC Securities","Upstox","Angel One","NSDL CAS","CDSL CAS","HDFC Bank","ICICI Bank","Axis Bank","SBI","Kotak"].map(n=>(
                <span key={n} style={{fontSize:".65rem",color:"rgba(232,224,208,.35)",padding:".3rem .55rem",borderRadius:6,border:"1px solid rgba(201,168,76,.08)",background:"rgba(201,168,76,.02)"}}>{n}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div style={{borderTop:"1px solid rgba(232,224,208,.04)",padding:"2rem 4%",display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:".5rem",fontSize:".72rem",color:"rgba(232,224,208,.25)"}}>
        <span>© 2026 WealthLens Pro</span>
        <span>Contact: <a href="mailto:support@wealthlens.pro" style={{color:"#c9a84c",textDecoration:"none"}}>support@wealthlens.pro</a></span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   TRANSACTION PANEL (per holding)
══════════════════════════════════════════════ */
function TransactionPanel({ holding, onAddTxn, onReload, onDeleteTxn, txnForm, setTxnForm, onClose, onFetchFx, fxRate, fxLoading }) {
  const txns = (holding.transactions || []).slice().sort((a,b)=>new Date(a.txn_date)-new Date(b.txn_date));
  const buys  = txns.filter(t=>t.txn_type==="BUY");
  const sells = txns.filter(t=>t.txn_type==="SELL");
  const netUnits = buys.reduce((s,t)=>s+Number(t.units),0) - sells.reduce((s,t)=>s+Number(t.units),0);
  const avgCost  = buys.length>0 ? buys.reduce((s,t)=>s+Number(t.units)*Number(t.price),0)/buys.reduce((s,t)=>s+Number(t.units),0) : 0;
  const isUS   = USD_TYPES.has(holding.type);
  const isMF   = holding.type==="MF";
  const priceLabel = isMF ? "NAV" : isUS ? "Price $" : "Price ₹";
  const fx = +(holding.usd_inr_rate||fxRate||_liveUsdInr);

  // SIP state
  const [sipMode,       setSipMode]       = useState(false);
  const [sipAmount,     setSipAmount]     = useState("");
  const [sipDay,        setSipDay]        = useState("5");
  const [sipStartMonth, setSipStartMonth] = useState(() => { const d=new Date(); d.setMonth(d.getMonth()-11); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [sipEndMonth,   setSipEndMonth]   = useState(() => { const d=new Date(); const next=new Date(d.getFullYear(), d.getMonth()+3, 1); return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`; });
  const [sipPreview,    setSipPreview]    = useState([]);
  const [sipFetching,   setSipFetching]   = useState(false);
  const [sipImporting,  setSipImporting]  = useState(false);
  const [sipError,      setSipError]      = useState("");

  async function fetchSipNavs(){
    if(!sipAmount||!sipDay||!sipStartMonth||!sipEndMonth){ setSipError("Fill in all fields"); return; }
    setSipError(""); setSipFetching(true); setSipPreview([]);
    // Build months array
    const [sy,sm] = sipStartMonth.split("-").map(Number);
    const [ey,em] = sipEndMonth.split("-").map(Number);
    const months = [];
    let y=sy, m=sm;
    while(y<ey||(y===ey&&m<=em)){
      months.push({year:y, month:m, sip_date:+sipDay});
      m++; if(m>12){m=1;y++;}
      if(months.length>120) break; // safety cap 10 years
    }
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      const res = await fetch("/api/mf/sip-navs",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({scheme_code:holding.scheme_code, months})});
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      // Enrich with units = amount / nav
      const preview = data.results.map(r=>({
        ...r,
        units: r.nav ? (+sipAmount/r.nav) : null,
        amount: +sipAmount,
      }));
      setSipPreview(preview);
    }catch(e){ setSipError(e.message); }
    setSipFetching(false);
  }

  async function importSip(){
    const valid = sipPreview.filter(r=>r.nav&&r.txn_date&&r.units);
    if(!valid.length){ setSipError("No valid transactions to import"); return; }
    setSipImporting(true);
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      for(const r of valid){
        await fetch("/api/transactions",{method:"POST",
          headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
          body:JSON.stringify({
            holding_id: holding.id,
            txn_type:   "BUY",
            units:      +r.units.toFixed(4),
            price:      +r.nav.toFixed(4),
            txn_date:   r.txn_date,
            notes:      `SIP ₹${r.amount.toLocaleString("en-IN")}${r.is_future?" (scheduled)":r.is_estimated?" (est. NAV)":""}`,
          })});
      }
      // Reload holdings via parent
      await onReload(holding.id);
      setSipMode(false); setSipPreview([]);
    }catch(e){ setSipError(e.message); }
    setSipImporting(false);
  }

  // SIP summary stats
  const validRows    = sipPreview.filter(r=>r.nav&&r.units);
  const futureRows   = sipPreview.filter(r=>r.is_future);
  const pastRows     = sipPreview.filter(r=>!r.is_future&&r.nav);
  const totalInvested= validRows.reduce((s,r)=>s+r.amount,0);
  const totalUnits   = validRows.reduce((s,r)=>s+(r.units||0),0);
  const avgNav       = totalUnits>0 ? totalInvested/totalUnits : 0;

  return (
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:660}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>📋 Transactions</div>
            <div style={{fontSize:".73rem",color:"rgba(255,255,255,.5)"}}>{holding.name} {isUS&&<span style={{fontSize:".65rem",color:"#5a9ce0",marginLeft:4}}>{holding.type==="CRYPTO"?"₿":"$"} USD input</span>}</div>
          </div>
          <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
            {isMF&&holding.scheme_code&&(
              <button onClick={()=>{setSipMode(p=>!p);setSipPreview([]);setSipError("");}}
                style={{background:sipMode?"rgba(160,132,202,.2)":"rgba(160,132,202,.1)",border:`1px solid rgba(160,132,202,${sipMode?".5":".25"})`,color:"#a084ca",borderRadius:5,padding:".28rem .65rem",cursor:"pointer",fontSize:".68rem",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>
                {sipMode?"✕ Cancel SIP":"📅 Add SIP History"}
              </button>
            )}
            <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── SIP BULK ENTRY MODE ── */}
        {sipMode&&(
          <div style={{background:"rgba(160,132,202,.06)",border:"1px solid rgba(160,132,202,.2)",borderRadius:10,padding:"1.1rem",marginBottom:"1.2rem"}}>
            <div style={{fontSize:".7rem",letterSpacing:".1em",textTransform:"uppercase",color:"#a084ca",marginBottom:".9rem",fontWeight:600}}>📅 SIP Bulk Import</div>

            <div className="frow" style={{marginBottom:".7rem"}}>
              <FG label="Monthly SIP ₹">
                <input type="number" className="fi" placeholder="e.g. 10000" value={sipAmount} onChange={e=>setSipAmount(e.target.value)}/>
              </FG>
              <FG label="SIP Date (day of month)">
                <select className="fi fs" value={sipDay} onChange={e=>setSipDay(e.target.value)}>
                  {Array.from({length:31},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}{d===1?"st":d===2?"nd":d===3?"rd":"th"}</option>)}
                </select>
              </FG>
            </div>
            <div className="frow" style={{marginBottom:".9rem"}}>
              <FG label="Start Month">
                <input type="month" className="fi" value={sipStartMonth} onChange={e=>setSipStartMonth(e.target.value)}/>
              </FG>
              <FG label="End Month (can be future)">
                <input type="month" className="fi" value={sipEndMonth} onChange={e=>setSipEndMonth(e.target.value)}/>
              </FG>
            </div>

            {sipError&&<div style={{fontSize:".75rem",color:"#e07c5a",marginBottom:".7rem"}}>⚠ {sipError}</div>}

            <button onClick={fetchSipNavs} disabled={sipFetching||!sipAmount}
              style={{width:"100%",background:"rgba(160,132,202,.15)",border:"1px solid rgba(160,132,202,.35)",color:"#a084ca",borderRadius:6,padding:".55rem",cursor:"pointer",fontSize:".8rem",fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:sipPreview.length?".9rem":"0"}}>
              {sipFetching?"⟳ Fetching NAVs from MFAPI…":"🔍 Fetch NAVs & Preview"}
            </button>

            {/* Preview table */}
            {sipPreview.length>0&&(
              <>
                {/* Summary stats */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:".5rem",marginBottom:".85rem"}}>
                  {[
                    {label:"Months",     val:sipPreview.length},
                    {label:"Past SIPs",  val:pastRows.length},
                    {label:"Future SIPs",val:futureRows.length, note:"estimated NAV"},
                    {label:"Avg NAV",    val:`₹${avgNav.toFixed(4)}`},
                  ].map(s=>(
                    <div key={s.label} style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:7,padding:".55rem .7rem",textAlign:"center"}}>
                      <div style={{fontSize:".58rem",letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".2rem"}}>{s.label}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:".82rem",color:s.label==="Future SIPs"?"#5a9ce0":"#c9a84c"}}>{s.val}</div>
                      {s.note&&<div style={{fontSize:".58rem",color:"rgba(255,255,255,.38)",marginTop:".1rem"}}>{s.note}</div>}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".5rem"}}>
                  <div style={{fontSize:".72rem",color:"rgba(255,255,255,.55)"}}>
                    Total invested: <span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>₹{totalInvested.toLocaleString("en-IN")}</span>
                    <span style={{marginLeft:".75rem"}}>Total units: <span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{totalUnits.toFixed(4)}</span></span>
                  </div>
                </div>

                {/* Scrollable preview */}
                <div style={{maxHeight:220,overflowY:"auto",marginBottom:".85rem",border:"1px solid rgba(255,255,255,.07)",borderRadius:7}}>
                  <table className="ht" style={{fontSize:".72rem"}}>
                    <thead style={{position:"sticky",top:0,background:"#0c1526",zIndex:1}}>
                      <tr>
                        <th>Month</th><th>Txn Date</th><th className="r">NAV ₹</th>
                        <th className="r">Units</th><th className="r">Amount</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sipPreview.map((r,i)=>(
                        <tr key={i} style={{opacity:r.nav?1:.5}}>
                          <td className="mono">{String(r.month).padStart(2,'0')}/{r.year}</td>
                          <td className="mono dim">{r.txn_date||"—"}</td>
                          <td className="r mono">{r.nav?`₹${r.nav.toFixed(4)}`:"—"}</td>
                          <td className="r mono">{r.units?r.units.toFixed(4):"—"}</td>
                          <td className="r mono dim">₹{r.amount.toLocaleString("en-IN")}</td>
                          <td>
                            {r.is_future
                              ? <span style={{fontSize:".62rem",color:"#5a9ce0",background:"rgba(90,156,224,.12)",padding:"1px 6px",borderRadius:3}}>Scheduled</span>
                              : r.is_estimated
                                ? <span style={{fontSize:".62rem",color:"#c9a84c",background:"rgba(201,168,76,.1)",padding:"1px 6px",borderRadius:3}}>Est. NAV</span>
                                : r.nav
                                  ? <span style={{fontSize:".62rem",color:"#4caf9a",background:"rgba(76,175,154,.1)",padding:"1px 6px",borderRadius:3}}>✓ Exact</span>
                                  : <span style={{fontSize:".62rem",color:"#e07c5a"}}>No NAV</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {futureRows.length>0&&(
                  <div style={{fontSize:".7rem",color:"rgba(90,156,224,.7)",marginBottom:".7rem",padding:".5rem .7rem",background:"rgba(90,156,224,.06)",borderRadius:6,border:"1px solid rgba(90,156,224,.15)"}}>
                    ℹ {futureRows.length} future SIP{futureRows.length>1?"s":""} will use today's NAV as a placeholder and be marked as scheduled. Update them after each actual investment.
                  </div>
                )}

                <button onClick={importSip} disabled={sipImporting||validRows.length===0}
                  style={{width:"100%",background:"rgba(76,175,154,.15)",border:"1px solid rgba(76,175,154,.35)",color:"#4caf9a",borderRadius:6,padding:".6rem",cursor:"pointer",fontSize:".82rem",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
                  {sipImporting?`⟳ Importing ${validRows.length} transactions…`:`⇩ Import ${validRows.length} SIP Transactions`}
                </button>
              </>
            )}
          </div>
        )}

        {/* Summary bar — shown when not in SIP mode */}
        {!sipMode&&txns.length>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:".6rem",marginBottom:"1.2rem"}}>
            {[
              {label:"Net Units", val:netUnits.toFixed(4)},
              {label:"Avg Cost (INR)", val:`₹${avgCost.toLocaleString("en-IN",{maximumFractionDigits:2})}`},
              {label:"Transactions", val:txns.length},
            ].map(s=>(
              <div key={s.label} style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:8,padding:".7rem .9rem",textAlign:"center"}}>
                <div style={{fontSize:".62rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".3rem"}}>{s.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:".95rem",color:"#c9a84c"}}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Transaction list */}
        {!sipMode&&(txns.length===0
          ? <div className="empty" style={{padding:"1.5rem"}}>No transactions yet — add one below or use 📅 Add SIP History</div>
          : <div style={{maxHeight:220,overflowY:"auto",marginBottom:"1.2rem"}}>
              <table className="ht" style={{fontSize:".75rem"}}>
                <thead><tr>
                  <th>Date</th><th>Type</th><th className="r">Units</th>
                  <th className="r">{isUS?"Price $":"Price ₹"}</th>
                  {isUS&&<th className="r">Price ₹</th>}
                  <th className="r">Total ₹</th>
                  <th>Notes</th><th/>
                </tr></thead>
                <tbody>
                  {txns.map(t=>(
                    <tr key={t.id}>
                      <td className="mono dim">{t.txn_date}</td>
                      <td><span style={{fontSize:".65rem",padding:"2px 7px",borderRadius:3,fontWeight:600,background:t.txn_type==="BUY"?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)",color:t.txn_type==="BUY"?"#4caf9a":"#e07c5a"}}>{t.txn_type}</span></td>
                      <td className="r mono">{Number(t.units).toFixed(4)}</td>
                      {isUS
                        ? <><td className="r mono dim">${t.price_usd!=null?Number(t.price_usd).toFixed(2):(Number(t.price)/fx).toFixed(2)}</td><td className="r mono dim">₹{Number(t.price).toLocaleString("en-IN",{maximumFractionDigits:0})}</td></>
                        : <td className="r mono dim">₹{Number(t.price).toLocaleString("en-IN",{maximumFractionDigits:2})}</td>
                      }
                      <td className="r mono" style={{color:"#ffffff"}}>₹{(Number(t.units)*Number(t.price)).toLocaleString("en-IN",{maximumFractionDigits:0})}</td>
                      <td className="dim" style={{maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.notes||"—"}</td>
                      <td><button className="delbtn" onClick={()=>onDeleteTxn(t.id, holding.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}

        {/* Add single transaction form — hidden in SIP mode */}
        {!sipMode&&(
        <MFTransactionForm
          holding={holding} isMF={isMF} isUS={isUS} fx={fx}
          txnForm={txnForm} setTxnForm={setTxnForm}
          onAddTxn={onAddTxn} onClose={onClose}
          onFetchFx={onFetchFx} fxLoading={fxLoading}
        />
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MF TRANSACTION FORM
══════════════════════════════════════════════ */
function MFTransactionForm({ holding, isMF, isUS, fx, txnForm, setTxnForm, onAddTxn, onClose, onFetchFx, fxLoading }) {
  const [mfAmount,   setMfAmount]   = useState("");
  const [navFetched, setNavFetched] = useState(null);
  const [navLoading, setNavLoading] = useState(false);
  const [navError,   setNavError]   = useState("");

  async function fetchNavForDate(){
    if(!txnForm.txn_date||!holding.scheme_code){ setNavError("Select a date first"); return; }
    setNavLoading(true); setNavError(""); setNavFetched(null);
    try{
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token||"";
      const d = new Date(txnForm.txn_date);
      const res = await fetch("/api/mf/sip-navs",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({scheme_code:holding.scheme_code,months:[{year:d.getFullYear(),month:d.getMonth()+1,sip_date:d.getDate()}]})});
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      const r = data.results?.[0];
      if(!r?.nav) throw new Error("NAV not found for this date");
      setNavFetched({nav:r.nav,date:r.nav_date,estimated:r.is_estimated,future:r.is_future});
      const nav4 = r.nav.toFixed(4);
      if(mfAmount){
        const units = (+mfAmount/r.nav).toFixed(4);
        setTxnForm(p=>({...p,price:nav4,units}));
      } else {
        setTxnForm(p=>({...p,price:nav4}));
      }
    }catch(e){ setNavError(e.message); }
    setNavLoading(false);
  }

  function handleAmountChange(val){
    setMfAmount(val);
    if(val&&navFetched?.nav){
      setTxnForm(p=>({...p,units:(+val/navFetched.nav).toFixed(4)}));
    } else {
      setTxnForm(p=>({...p,units:""}));
    }
  }

  const canSubmit = txnForm.units&&txnForm.price&&txnForm.txn_date;

  return (
    <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.07)",borderRadius:9,padding:"1rem"}}>
      <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".8rem"}}>Add Transaction</div>
      <div className="frow">
        <FG label="Type">
          <select className="fi fs" value={txnForm.txn_type} onChange={e=>setTxnForm(p=>({...p,txn_type:e.target.value}))}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </FG>
        {isMF?(<>
          <FG label="Amount Invested ₹">
            <input type="number" className="fi" placeholder="e.g. 5000" value={mfAmount} onChange={e=>handleAmountChange(e.target.value)}/>
          </FG>
          <FG label="Date">
            <input type="date" className="fi" value={txnForm.txn_date} onChange={e=>{
              setNavFetched(null); setNavError("");
              setTxnForm(p=>({...p,txn_date:e.target.value,price:"",units:""}));
              setMfAmount(prev=>prev);
            }}/>
          </FG>
        </>):isUS?(<>
          <FG label="Units"><input type="number" className="fi" placeholder="e.g. 5" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/></FG>
          <FG label="Price $ per unit">
            <input type="number" className="fi" placeholder="e.g. 189.50" value={txnForm.price_usd||""} onChange={e=>{const usd=e.target.value;setTxnForm(p=>({...p,price_usd:usd,price:usd?(+usd*fx).toFixed(2):""}));}}/>
          </FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>):(<>
          <FG label="Units"><input type="number" className="fi" placeholder="e.g. 100" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/></FG>
          <FG label="Price ₹ per unit"><input type="number" className="fi" placeholder="per unit" value={txnForm.price} onChange={e=>setTxnForm(p=>({...p,price:e.target.value}))}/></FG>
          <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
        </>)}
      </div>

      {/* MF: NAV info bar */}
      {isMF&&(
        <div style={{marginBottom:".8rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".65rem",padding:".55rem .8rem",
            background:navFetched?"rgba(76,175,154,.06)":"rgba(255,255,255,.02)",
            border:`1px solid ${navFetched?"rgba(76,175,154,.25)":"rgba(255,255,255,.07)"}`,borderRadius:7}}>
            <div style={{flex:1}}>
              {navFetched?(<div style={{display:"flex",gap:"1.2rem",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".18rem"}}>NAV {navFetched.estimated?"(Est.)":navFetched.future?"(Today)":"(Exact)"}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#c9a84c"}}>₹{Number(navFetched.nav).toFixed(4)}</div>
                </div>
                {mfAmount&&txnForm.units&&(<>
                  <div>
                    <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".18rem"}}>Units Allotted</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#ffffff"}}>{Number(txnForm.units).toFixed(4)}</div>
                  </div>
                  <div>
                    <div style={{fontSize:".6rem",letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".18rem"}}>Total</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#ffffff"}}>₹{(+mfAmount).toLocaleString("en-IN")}</div>
                  </div>
                </>)}
                {navFetched.estimated&&<div style={{fontSize:".65rem",color:"rgba(201,168,76,.55)",width:"100%",marginTop:".2rem"}}>Nearest available NAV used</div>}
              </div>):(
                <div style={{fontSize:".75rem",color:"rgba(255,255,255,.42)"}}>
                  {txnForm.txn_date?"Click Fetch NAV to get the NAV for this date":"Select a date, then fetch NAV"}
                </div>
              )}
              {navError&&<div style={{fontSize:".72rem",color:"#e07c5a",marginTop:".25rem"}}>⚠ {navError}</div>}
            </div>
            <button onClick={fetchNavForDate} disabled={navLoading||!txnForm.txn_date}
              style={{background:"rgba(201,168,76,.13)",border:"1px solid rgba(201,168,76,.32)",color:"#c9a84c",
                borderRadius:5,padding:".35rem .8rem",cursor:"pointer",fontSize:".72rem",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0,opacity:(!txnForm.txn_date||navLoading)?.5:1}}>
              {navLoading?"⧐ Fetching…":"⟳ Fetch NAV"}
            </button>
          </div>
        </div>
      )}

      {/* US FX bar */}
      {isUS&&(
        <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".7rem",padding:".5rem .8rem",background:"rgba(90,156,224,.06)",border:"1px solid rgba(90,156,224,.18)",borderRadius:6}}>
          <div style={{flex:1,fontSize:".75rem"}}>
            <span style={{color:"rgba(255,255,255,.5)"}}>1 USD = </span>
            <span style={{fontFamily:"'DM Mono',monospace",color:"#5a9ce0"}}>₹{fx.toFixed(2)}</span>
            {txnForm.price_usd&&<span style={{marginLeft:".75rem",color:"rgba(255,255,255,.5)"}}>→ ₹<span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{(+txnForm.price_usd*fx).toLocaleString("en-IN",{maximumFractionDigits:0})}</span> per unit</span>}
          </div>
          <button onClick={onFetchFx} disabled={fxLoading} style={{background:"rgba(90,156,224,.15)",border:"1px solid rgba(90,156,224,.3)",color:"#5a9ce0",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:".65rem",fontFamily:"'DM Sans',sans-serif"}}>
            {fxLoading?"…":"⟳ Rate"}
          </button>
        </div>
      )}

      <FG label="Notes (optional)"><input className="fi" placeholder="e.g. SIP, bonus units, tax harvesting" value={txnForm.notes} onChange={e=>setTxnForm(p=>({...p,notes:e.target.value}))}/></FG>
      <MA>
        <button className="btnc" onClick={onClose}>Close</button>
        <button className="btns" onClick={()=>onAddTxn()} disabled={!canSubmit}>+ Add Transaction</button>
      </MA>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ARTIFACT PANEL (per holding)
══════════════════════════════════════════════ */
function ArtifactPanel({ holding, token, onClose }) {
  const [artifacts, setArtifacts] = useState(holding.artifacts || []);
  const [uploading, setUploading] = useState(false);
  const [desc, setDesc]   = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("holdingId", holding.id);
    fd.append("description", desc);
    try {
      const result = await api("/api/artifacts/upload", { method:"POST", body:fd });
      setArtifacts(p => [{
        id: result.id, file_name: result.file_name, description: desc,
        file_size: file.size, file_type: file.type,
        uploaded_at: new Date().toISOString()
      }, ...p]);
      setDesc("");
    } catch(e) { alert("Upload failed: " + e.message); }
    setUploading(false);
  }

  async function download(art) {
    try {
      const { url } = await api(`/api/artifacts/download/${art.id}`);
      window.open(url, "_blank");
    } catch(e) { alert("Download failed: " + e.message); }
  }

  async function remove(id) {
    if (!confirm("Delete this file?")) return;
    await api(`/api/artifacts/${id}`, { method:"DELETE" });
    setArtifacts(p => p.filter(a => a.id !== id));
  }

  const fileIcon = t => t?.includes("pdf")?"📄":t?.includes("image")?"🖼️":t?.includes("excel")||t?.includes("sheet")?"📊":"📎";

  return (
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:560}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>📎 Documents</div>
            <div style={{fontSize:".73rem",color:"rgba(255,255,255,.5)"}}>{holding.name}</div>
          </div>
          <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);upload(e.dataTransfer.files[0]);}}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"rgba(201,168,76,.6)":"rgba(255,255,255,.12)"}`,borderRadius:10,padding:"1.4rem",textAlign:"center",cursor:"pointer",transition:"all .2s",background:dragOver?"rgba(201,168,76,.05)":"transparent",marginBottom:"1rem"}}
        >
          <div style={{fontSize:"1.6rem",marginBottom:".4rem"}}>☁</div>
          <div style={{fontSize:".8rem",color:"rgba(255,255,255,.6)"}}>Drag & drop or click to upload</div>
          <div style={{fontSize:".68rem",color:"rgba(255,255,255,.38)",marginTop:".25rem"}}>PDF, images, Excel, Word — up to 15 MB</div>
          <input ref={fileRef} type="file" style={{display:"none"}} onChange={e=>upload(e.target.files[0])}/>
        </div>
        <div className="frow" style={{marginBottom:"1rem"}}>
          <FG label="Description (optional)"><input className="fi" placeholder="e.g. Q3 contract note, FD receipt" value={desc} onChange={e=>setDesc(e.target.value)}/></FG>
        </div>
        {uploading&&<div style={{textAlign:"center",padding:".8rem",fontSize:".78rem",color:"#c9a84c"}}>Uploading…</div>}

        {/* File list */}
        {artifacts.length===0
          ? <div className="empty" style={{padding:"1.5rem"}}>No documents attached yet</div>
          : <div style={{display:"flex",flexDirection:"column",gap:".5rem",maxHeight:280,overflowY:"auto"}}>
              {artifacts.map(a=>(
                <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".75rem .9rem",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:8}}>
                  <div style={{fontSize:"1.2rem",flexShrink:0}}>{fileIcon(a.file_type)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:".82rem",color:"#ffffff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.file_name}</div>
                    <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",marginTop:2}}>{a.description?`${a.description} · `:""}{fmtSize(a.file_size||0)} · {ago(a.uploaded_at)}</div>
                  </div>
                  <button className="btn-o" style={{padding:".26rem .6rem",fontSize:".65rem"}} onClick={()=>download(a)}>↓ View</button>
                  <button className="delbtn" onClick={()=>remove(a.id)}>✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════ */
// ── Formatted INR input — shows live comma-formatted preview ──────
function FmtInput({value, onChange, placeholder, className, style}){
  const num = value !== "" && !isNaN(+value) ? +value : null;
  const display = num !== null ? "₹"+num.toLocaleString("en-IN",{maximumFractionDigits:2}) : "";
  return(
    <div style={{position:"relative",paddingBottom:display?"1.1rem":0}}>
      <input type="number" className={className||"fi"} placeholder={placeholder} value={value}
        onChange={onChange} style={style}/>
      {display&&<div style={{position:"absolute",bottom:0,left:0,fontSize:".63rem",color:"rgba(201,168,76,.65)",fontFamily:"'DM Mono',monospace",pointerEvents:"none",letterSpacing:".02em"}}>
        {display}
      </div>}
    </div>
  );
}

export default function App() {
  const [user,      setUser]      = useState(null);
  const [authErr,   setAuthErr]   = useState("");
  const [authLoading, setAuthLoading] = useState(true);

  const [members,  setMembers]  = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [goals,    setGoals]    = useState([]);
  const [alerts,   setAlerts]   = useState([]);
  const [loaded,   setLoaded]   = useState(false);

  // ── Hub: profile, currency, asset types, settings ───────────────
  const [profile,       setProfile]       = useState(null);
  // userCurrency removed — native currency display (₹ for Indian, $ for US)
  const [assetTypes,    setAssetTypes]    = useState([]);
  const [showSettings,  setShowSettings]  = useState(false);
  const [shares,        setShares]        = useState([]);      // shares I've granted
  const [sharedWithMe,  setSharedWithMe]  = useState([]);      // portfolios shared to me
  const [viewingShared, setViewingShared] = useState(null);    // { owner_id, owner_name, role } or null
  const [sharedHoldings, setSharedHoldings] = useState([]);   // holdings from shared portfolios (tagged with _shared)
  const [sharedMembers,  setSharedMembers]  = useState([]);   // members from shared portfolios
  const [shareEmail,    setShareEmail]    = useState("");
  const [shareRole,     setShareRole]     = useState("viewer");
  const [shareLoading,  setShareLoading]  = useState(false);
  const [shareError,    setShareError]    = useState("");

  const [syncSt,   setSyncSt]   = useState("idle");
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [lastPriceRefresh, setLastPriceRefresh] = useState(null);
  const [priceCount, setPriceCount] = useState(0);

  const [tab,            setTab]            = useState("overview");
  const [selMember,      setSelMember]      = useState("all");
  const [filterType,     setFilterType]     = useState("ALL");
  const [sortCol,        setSortCol]        = useState(null);   // holdings table sort column key
  const [sortDir,        setSortDir]        = useState("asc");  // "asc" | "desc"
  const [modal,          setModal]          = useState(null);
  const [form,           setForm]           = useState(BF);
  const [editHolding,    setEditHolding]    = useState(null);
  const [newMember,      setNewMember]      = useState({name:"",relation:""});
  const [shareWithFamily, setShareWithFamily] = useState(true);  // cross-link new member with existing family
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [mergeCandidate,  setMergeCandidate]  = useState(null);
  const [memberAction,    setMemberAction]    = useState(null); // {type:"delete"|"merge", memberId, reassignTo:""}
  const [goalForm,       setGoalForm]       = useState(BG);
  const [editGoalId,     setEditGoalId]     = useState(null);
  const [alertForm,      setAlertForm]      = useState(BA);
  const [importState, setImportState] = useState({
    mode: null, step: "upload", format: "", holdings: [], transactions: [],
    warnings: [], progress: 0, result: null, dragOver: false,
    assignMember: "", accounts: [], accountMap: {},
    pendingFile: null, needsPassword: false, casPan: "", casDob: "", casRemember: false,
    dupAction: {},       // { holdingIndex: "skip"|"update" } per-holding duplicate decisions
    dupBulk: "ask",      // "ask" | "update_all" | "skip_all" | "pick"
    dupConfirmed: false,  // true once user confirms duplicate handling
  });
  const [pdfState,       setPdfState]       = useState({loading:false,summary:""});
  const [artifactHolding,setArtifactHolding]= useState(null);
  const [txnHolding,     setTxnHolding]     = useState(null);
  const [txnForm,        setTxnForm]        = useState(BT);
  const [globalTxnModal, setGlobalTxnModal] = useState(false);
  const [globalMfAmount,  setGlobalMfAmount]  = useState("");
  const [globalMfNav,     setGlobalMfNav]     = useState(null);   // {nav, date, is_estimated}
  const [globalNavLoading,setGlobalNavLoading]= useState(false);
  const [globalNavError,  setGlobalNavError]  = useState("");
  const [demoMode,        setDemoMode]        = useState(false);

  // ── Budget state ─────────────────────────────────────────────────
  const [budgetStatements,  setBudgetStatements]  = useState([]);
  const [budgetTxns,        setBudgetTxns]        = useState([]);
  const [budgetCategories,  setBudgetCategories]  = useState([]);
  const [budgetAnalytics,   setBudgetAnalytics]   = useState(null);
  const [budgetSelStmt,     setBudgetSelStmt]     = useState("all");
  const [budgetSelMonth,    setBudgetSelMonth]    = useState("");
  const [budgetSelCat,      setBudgetSelCat]      = useState("All");
  const [budgetSearch,      setBudgetSearch]      = useState("");
  const [budgetView,        setBudgetView]        = useState("overview"); // overview | transactions | categories | import
  const [budgetUploading,   setBudgetUploading]   = useState(false);
  const [budgetUploadForm,  setBudgetUploadForm]  = useState({region:"", bank_key:"", statement_type:"BANK", notes:"", custom_label:""});
  const [budgetUploadFile,  setBudgetUploadFile]  = useState(null);
  const [budgetUploadMsg,   setBudgetUploadMsg]   = useState("");
  const [budgetEditCat,     setBudgetEditCat]     = useState(null);
  const [budgetNewCat,      setBudgetNewCat]      = useState({name:"",color:"#c9a84c",icon:"📁",monthly_limit:0,keywords:""});
  const [selectedTxnIds,    setSelectedTxnIds]    = useState(new Set());
  const [bulkCatTarget,     setBulkCatTarget]     = useState("");

  // ── Plaid state ──────────────────────────────────────────────────
  const [plaidStatus,   setPlaidStatus]   = useState(null);
  const [plaidLoading,  setPlaidLoading]  = useState(false);
  const [plaidMsg,      setPlaidMsg]      = useState("");
  const [plaidSyncing,  setPlaidSyncing]  = useState("");

  // ── CAS Downloader state ──────────────────────────────────────
  const [casModal,         setCasModal]         = useState(false);    // show CAS downloader modal
  const [casStep,          setCasStep]          = useState("intro");  // "intro" | "upload" | "matching" | "importing" | "done"
  const [casHoldings,      setCasHoldings]      = useState([]);       // parsed holdings from CAS
  const [casHolderNames,   setCasHolderNames]   = useState([]);       // extracted holder names from CAS PDF
  const [casHolderPans,    setCasHolderPans]    = useState([]);       // extracted PANs
  const [casHolderMap,     setCasHolderMap]     = useState({});       // { holderName: memberId }
  const [casWarnings,      setCasWarnings]      = useState([]);
  const [casFormat,        setCasFormat]        = useState("");
  const [casUploading,     setCasUploading]     = useState(false);
  const [casResult,        setCasResult]        = useState(null);
  const [casDupAction,     setCasDupAction]     = useState({});       // per-holding: "update" | "skip"
  const [casPendingFile,   setCasPendingFile]   = useState(null);     // file awaiting PAN password
  const [casPanInput,      setCasPanInput]      = useState("");       // PAN entered by user for CAS decryption
  const [casQuickMemberName, setCasQuickMemberName] = useState("");  // inline new member name in CAS modal
  const [casSavePan,       setCasSavePan]       = useState(false);    // remember PAN checkbox
  const [casStatementDate, setCasStatementDate] = useState(null);     // "2025-03-31" from CAS
  const [casPeriodStart,   setCasPeriodStart]   = useState(null);     // "2024-04-01"
  const [casPeriodEnd,     setCasPeriodEnd]     = useState(null);     // "2025-03-31"
  const [casDepository,    setCasDepository]    = useState("");       // "NSDL" | "CDSL"
  const [wealthSnapshots,  setWealthSnapshots]  = useState([]);       // monthly snapshots
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // ── Net Worth Timeline + Calendar ─────────────────────────────
  const [nwMember,          setNwMember]          = useState("all");
  const [calMonth,          setCalMonth]          = useState(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;});

  // ── Asset Allocation state ─────────────────────────────────────
  const [targetAlloc, setTargetAlloc] = useState({IN_STOCK:35,MF:25,IN_ETF:5,US_STOCK:10,US_ETF:5,US_BOND:0,CRYPTO:3,CASH:0,FD:5,PPF:5,EPF:5,REAL_ESTATE:2,OTHER:0});
  const [rebalMember, setRebalMember] = useState("all");
  const [rebalCash,   setRebalCash]   = useState("");
  const [showQuietAlerts, setShowQuietAlerts] = useState(false);
  const [txnFilterMember, setTxnFilterMember] = useState("all");
  const [txnFilterType,   setTxnFilterType]   = useState("ALL");
  const [mfSearch,       setMfSearch]       = useState("");
  const [mfResults,      setMfResults]      = useState([]);
  const [mfSearching,    setMfSearching]    = useState(false);
  const [mfNav,          setMfNav]          = useState(null); // {nav, date, fund_house, scheme_category}
  const [stockInfo,      setStockInfo]      = useState(null); // {name, price, exchange, found}
  const [stockLooking,   setStockLooking]   = useState(false);
  const [usdInrRate,     setUsdInrRate]     = useState(_liveUsdInr);
  const [usdInrLoading,  setUsdInrLoading]  = useState(false);
  const [etfSearch,      setEtfSearch]      = useState("");
  const [etfResults,     setEtfResults]     = useState([]);
  const [etfSearching,   setEtfSearching]   = useState(false);
  const [etfInfo,        setEtfInfo]        = useState(null);
  const [stockSearch,    setStockSearch]    = useState("");
  const [stockResults,   setStockResults]   = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [usSearch,       setUsSearch]       = useState("");
  const [usResults,      setUsResults]      = useState([]);
  const [usSearching,    setUsSearching]    = useState(false);
  const stockSearchTimer = useRef();
  const usSearchTimer    = useRef();
  const mfSearchTimer  = useRef();
  const stockLookTimer = useRef();
  const etfSearchTimer = useRef();
  const [aiMessages,     setAiMessages]     = useState([]); // {role, content, ts}
  const [aiInput,        setAiInput]        = useState("");
  const [aiLoading,      setAiLoading]      = useState(false);
  const [showSnapTrade,  setShowSnapTrade]   = useState(false);
  const [showKite,       setShowKite]        = useState(false);
  const [showBreeze,     setShowBreeze]      = useState(false);
  const [showSharedDropdown, setShowSharedDropdown] = useState(false);
  // const [showSetuAA, setShowSetuAA] = useState(false); // Setu AA disabled
  const [moreSheetOpen,  setMoreSheetOpen]  = useState(false);
  const [expandedHolding,setExpandedHolding]= useState(null);
  const aiBottomRef = useRef();

  const importFileRef = useRef();
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);
  const txnSaving = useRef(false);

  // ── Auth listener ──
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user||null); setAuthLoading(false);
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user||null); setAuthLoading(false);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // ── Load data when signed in (fully parallelized) ──
  useEffect(()=>{
    if(!user)return;
    (async()=>{
      try{
        // Fire ALL 4 requests in parallel — saves ~200-400ms on Render cold starts
        const [portfolio, hlds, prof, ats] = await Promise.all([
          api("/api/portfolio"),
          api("/api/holdings"),
          api("/api/profile").catch(()=>null),
          api("/api/asset-types").catch(()=>[]),
        ]);
        if(portfolio){
          setMembers(portfolio.members||[]);
          setGoals(portfolio.goals||[]);
          setAlerts(portfolio.alerts||[]);
        } else {
          // First time — show empty state (no demo seeding to DB)
          setMembers([]);
          setGoals([]);
          setAlerts([]);
        }
        setHoldings(hlds||[]);
        // Compute last price refresh time from holdings
        const fetched = (hlds||[]).filter(h=>h.price_fetched_at).map(h=>new Date(h.price_fetched_at));
        if(fetched.length) setLastPriceRefresh(new Date(Math.max(...fetched)));
        // Profile & asset types — already resolved from parallel call
        if(prof){ setProfile(prof); }
        // Fetch live FX rate on login
        try { const fxData = await api("/api/forex/usdinr"); if(fxData?.rate) _liveUsdInr = fxData.rate; } catch{}
        if(ats?.length) setAssetTypes(ats);
      } catch(e){ console.error("Load error",e); }
      setLoaded(true);
      // Load sharing info + sync missing shares
      try {
        // First sync: create shares for any members whose emails now have accounts
        await api("/api/shares/sync", { method: "POST" }).catch(() => {});
        // Then load the share lists
        const [myShares, receivedShares] = await Promise.all([
          api("/api/shares").catch(() => ({ shares: [] })),
          api("/api/shares/received").catch(() => ({ shared_with_me: [] })),
        ]);
        setShares(myShares.shares || []);
        setSharedWithMe(receivedShares.shared_with_me || []);
        console.log("📤 Shares granted:", myShares.shares?.length || 0, "📥 Shared with me:", receivedShares.shared_with_me?.length || 0);
      } catch(e) { console.warn("Shares load:", e.message); }
      // Load wealth snapshots
      api("/api/snapshots?months=24").then(d => setWealthSnapshots(d?.snapshots || [])).catch(() => {});
    })();
  },[user]);

  // ── Share management helpers ──
  async function loadShares() {
    try {
      const [myShares, receivedShares] = await Promise.all([
        api("/api/shares"), api("/api/shares/received"),
      ]);
      setShares(myShares.shares || []);
      setSharedWithMe(receivedShares.shared_with_me || []);
    } catch {}
  }
  async function addShare() {
    if (!shareEmail.trim()) return;
    setShareLoading(true); setShareError("");
    try {
      await api("/api/shares", { method: "POST", body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }) });
      setShareEmail(""); await loadShares();
    } catch (e) { setShareError(e.message); }
    setShareLoading(false);
  }
  async function removeShare(shareId) {
    if (!confirm("Remove this portfolio share? This action cannot be undone.")) return;
    try { await api(`/api/shares/${shareId}`, { method: "DELETE" }); await loadShares(); } catch {}
  }
  async function updateShareRole(shareId, newRole) {
    try { await api(`/api/shares/${shareId}`, { method: "PUT", body: JSON.stringify({ role: newRole }) }); await loadShares(); } catch {}
  }
  async function viewSharedPortfolio(ownerId, ownerName, role) {
    try {
      const resp = await api(`/api/shared-portfolio/${ownerId}`);
      setViewingShared({ owner_id: ownerId, owner_name: resp.owner_name || ownerName, role: resp.role || role });
      // Tag each shared holding with _shared metadata so the UI can distinguish them
      const tagged = (resp.holdings || []).map(h => ({
        ...h,
        _shared: true,
        _shared_owner: resp.owner_name || ownerName,
        _shared_owner_id: ownerId,
      }));
      setSharedHoldings(tagged);
      setSharedMembers(resp.portfolio?.members || []);
    } catch (e) { console.error("Shared portfolio load:", e.message); }
  }
  async function exitSharedView() {
    setViewingShared(null);
    setSharedHoldings([]);
    setSharedMembers([]);
  }
  // Load all shared portfolios into the merged view (for "Family Portfolio" combined view)
  // Dedup logic: if a shared member's email matches the current user's email,
  // skip that member (avoid duplicate) and remap their holdings to the user's own SELF member.
  async function loadAllSharedHoldings() {
    if (sharedWithMe.length === 0) { setSharedHoldings([]); setSharedMembers([]); return; }
    console.log("🔄 Loading shared holdings from", sharedWithMe.length, "portfolios:", sharedWithMe.map(s => s.owner_name));
    const myEmail = user?.email?.toLowerCase();
    const mySelfMemberId = members.find(m => m.relation === "Self")?.id || members[0]?.id || null;
    // Build a map of email → local member id for all my members (for bidirectional dedup)
    const localMemberByEmail = new Map();
    for (const m of members) {
      if (m.email) localMemberByEmail.set(m.email.trim().toLowerCase(), m.id);
    }
    try {
      const results = await Promise.all(
        sharedWithMe.map(s =>
          api(`/api/shared-portfolio/${s.owner_id}`)
            .then(resp => {
              console.log(`📦 Shared portfolio from ${resp.owner_name}: ${resp.holdings?.length || 0} holdings`);
              const rawMembers = resp.portfolio?.members || [];
              // Build maps for dedup:
              // 1. Shared members whose email matches current user → remap to SELF
              // 2. Shared members whose email matches ANY local member → remap to that local member (skip the shared member)
              const skipMemberIds = new Map(); // shared member id → local member id to remap to
              for (const m of rawMembers) {
                if (!m.email) continue;
                const email = m.email.trim().toLowerCase();
                if (email === myEmail) {
                  skipMemberIds.set(m.id, mySelfMemberId);
                } else if (localMemberByEmail.has(email)) {
                  skipMemberIds.set(m.id, localMemberByEmail.get(email));
                }
              }
              if (skipMemberIds.size > 0) console.log(`🔗 Dedup: merging ${skipMemberIds.size} shared member(s) into local members from ${resp.owner_name}`);
              return {
              holdings: (resp.holdings || []).map(h => {
                const localId = h.member_id && skipMemberIds.get(h.member_id);
                return {
                  ...h,
                  _shared: true,
                  _shared_owner: resp.owner_name || s.owner_name,
                  _shared_owner_id: s.owner_id,
                  // Remap to local member if matched, otherwise namespace as shared
                  member_id: localId || (h.member_id ? `shared_${s.owner_id}_${h.member_id}` : null),
                };
              }),
              // Filter out shared members that matched a local member
              members: rawMembers
                .filter(m => !skipMemberIds.has(m.id))
                .map(m => ({
                  ...m,
                  _shared: true,
                  _shared_owner: resp.owner_name || s.owner_name,
                  _shared_owner_id: s.owner_id,
                  id: `shared_${s.owner_id}_${m.id}`,
                })),
            };})
            .catch(e => { console.error(`❌ Failed to load shared portfolio ${s.owner_id}:`, e.message); return { holdings: [], members: [] }; })
        )
      );
      const totalH = results.reduce((s, r) => s + r.holdings.length, 0);
      console.log(`✅ Loaded ${totalH} shared holdings total`);
      setSharedHoldings(results.flatMap(r => r.holdings));
      setSharedMembers(results.flatMap(r => r.members));
    } catch(e) { console.error("❌ loadAllSharedHoldings failed:", e.message); setSharedHoldings([]); setSharedMembers([]); }
  }

  // ── Persist portfolio config (debounced) ──
  const savePortfolio = useCallback((m,g,a)=>{
    setSyncSt("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async()=>{
      try{
        await api("/api/portfolio",{method:"POST",body:JSON.stringify({members:m,goals:g,alerts:a})});
        setSyncSt("saved");
      }catch{ setSyncSt("error"); }
    },1000);
  },[]);

  useEffect(()=>{
    if(loaded&&user) {
      if(!initialLoadDone.current) { initialLoadDone.current = true; return; }
      savePortfolio(members,goals,alerts);
    }
  },[members,goals,alerts,loaded,user,savePortfolio]);

  // Auto-load shared portfolio data when sharedWithMe list updates
  useEffect(()=>{ if(loaded && sharedWithMe.length > 0) loadAllSharedHoldings(); },[sharedWithMe,loaded]);
  useEffect(()=>{ setMoreSheetOpen(false); setExpandedHolding(null); },[tab]);

  // ── Real-time price refresh ──
  async function refreshPrices(){
    if(priceRefreshing) return;
    setPriceRefreshing(true);
    try{
      const result = await api("/api/prices/refresh",{method:"POST"});
      // Reload holdings with fresh prices
      const hlds = await api("/api/holdings");
      setHoldings(hlds||[]);
      setLastPriceRefresh(new Date());
      setPriceCount(result.updated||0);
    }catch(e){ alert("Price refresh failed: "+e.message); }
    setPriceRefreshing(false);
  }

  // ── CRUD ──
  async function saveHolding(){
    if(demoMode) exitDemoMode();
    const h={
      ...form,
      id: editHolding?.id||uid(),
      principal:      +form.principal||null,
      interest_rate:  +form.interest_rate||null,
      purchase_value: +form.purchase_value||null,
      current_value:  +form.current_value||null,
      usd_inr_rate:   +form.usd_inr_rate||_liveUsdInr,
    };
    try{
      if(editHolding){
        await api(`/api/holdings/${h.id}`,{method:"PUT",body:JSON.stringify(h)});
      } else {
        await api("/api/holdings",{method:"POST",body:JSON.stringify(h)});
      }
      const hlds = await api("/api/holdings");
      setHoldings(hlds||[]);
      setModal(null); setForm(BF); setEditHolding(null);
      // For stock/MF holdings — auto-open Add Transaction so user records first buy immediately
      if(!editHolding && ["IN_STOCK","IN_ETF","US_STOCK","US_ETF","US_BOND","CRYPTO","MF"].includes(h.type)){
        const newH = hlds.find(x=>x.id===h.id);
        if(newH){ setTxnForm({...BT,holding_id:newH.id}); setGlobalTxnModal(true); }
      }
    }catch(e){ alert("Save failed: "+e.message); }
  }

  async function addTransaction(){
    if(demoMode){ exitDemoMode(); return; }
    if(!txnForm.holding_id){ alert("Select a holding"); return; }
    const selH = holdings.find(h=>h.id===txnForm.holding_id);
    const isMFGlobal = selH?.type==="MF";

    // For MF: derive units from amount + fetched NAV
    let finalUnits = +txnForm.units;
    let finalPrice = +txnForm.price;
    if(isMFGlobal){
      if(!globalMfAmount||!globalMfNav?.nav){ alert("Enter amount and fetch NAV first"); return; }
      finalUnits = +(+globalMfAmount / globalMfNav.nav).toFixed(4);
      finalPrice = +globalMfNav.nav;
    } else {
      if(!txnForm.units||!txnForm.price){ alert("Fill in units and price"); return; }
    }
    if(!txnForm.txn_date){ alert("Select a date"); return; }
    if(txnSaving.current) return;
    txnSaving.current = true;
    try{
      await api("/api/transactions",{method:"POST",body:JSON.stringify({
        holding_id: txnForm.holding_id,
        txn_type:   txnForm.txn_type,
        units:      finalUnits,
        price:      finalPrice,
        price_usd:  txnForm.price_usd ? +txnForm.price_usd : undefined,
        txn_date:   txnForm.txn_date,
        notes:      txnForm.notes||"",
      })});
      const hlds = await api("/api/holdings");
      setHoldings(hlds||[]);
      if(txnHolding) setTxnHolding(hlds.find(h=>h.id===txnHolding.id)||null);
      // Reset MF amount state but keep holding_id for consecutive entries
      const savedHoldingId = txnForm.holding_id;
      setTxnForm({...BT, holding_id: savedHoldingId});
      setGlobalMfAmount(""); setGlobalMfNav(null); setGlobalNavError("");
      setGlobalTxnModal(false);
    }catch(e){ alert("Failed: "+e.message); }
    finally{ txnSaving.current = false; }
  }

  async function reloadHoldings(holdingId){
    const hlds = await api("/api/holdings");
    setHoldings(hlds||[]);
    const anchor = holdingId || txnHolding?.id;
    if(anchor) setTxnHolding(hlds.find(h=>h.id===anchor)||null);
  }

  async function deleteTransaction(txnId, holdingId){
    if(!confirm("Delete this transaction?"))return;
    await api(`/api/transactions/${txnId}`,{method:"DELETE"});
    const hlds = await api("/api/holdings");
    setHoldings(hlds||[]);
    if(txnHolding) setTxnHolding(hlds.find(h=>h.id===holdingId)||null);
  }

  async function deleteHolding(id){
    if(!confirm("Delete this holding?"))return;
    await api(`/api/holdings/${id}`,{method:"DELETE"});
    setHoldings(p=>p.filter(x=>x.id!==id));
  }

  function editH(h){ setEditHolding(h); setForm({...BF,...h,
    interest_rate:h.interest_rate||"", usd_inr_rate:h.usd_inr_rate||_liveUsdInr}); setModal("holding"); }

  // ── Fuzzy name match helper ──
  function fuzzyMemberMatch(name) {
    if (!name || name.length < 2) return null;
    const lower = name.toLowerCase().trim();
    for (const m of members) {
      const ml = m.name.toLowerCase().trim();
      if (ml === lower) return m; // exact match
      // Check if one name contains the other (partial match)
      if (ml.includes(lower) || lower.includes(ml)) return m;
      // Check first+last name overlap: "AVINASH TALLAM" vs "Avinash"
      const words = lower.split(/\s+/);
      const mWords = ml.split(/\s+/);
      const overlap = words.filter(w => w.length > 2 && mWords.some(mw => mw.includes(w) || w.includes(mw)));
      if (overlap.length > 0 && (overlap.length >= words.length * 0.5 || overlap.length >= mWords.length * 0.5)) return m;
    }
    return null;
  }

  // ── CAS holder → member matching (PAN-first, then fuzzy name) ──
  function matchCASHolderToMember(holderName, holderPans) {
    // Priority 1: PAN match — if we have stored PAN for any member's profile, check against CAS PANs
    // (PAN is stored on the profile level, not per-member, so this matches the logged-in user)
    // Priority 2: Fuzzy name match via existing fuzzyMemberMatch
    const match = fuzzyMemberMatch(holderName);
    if (match) return match;
    return null;
  }

  function autoMapCASHolders(holderNames, holderPans) {
    const map = {};
    for (const name of holderNames) {
      const match = matchCASHolderToMember(name, holderPans);
      if (match) map[name] = match.id;
    }
    return map;
  }

  // ── CAS Downloader: upload + parse CAS PDF ──
  async function handleCASUpload(file) {
    setCasUploading(true);
    setCasWarnings([]);
    setCasHoldings([]);
    setCasHolderNames([]);
    setCasHolderPans([]);
    setCasStep("uploading");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      // Check if user has stored PAN for auto-decryption
      let password = "";
      try {
        const creds = await api("/api/profile/cas-credentials");
        if (creds.has_credentials && creds._pan) password = creds._pan;
      } catch {}

      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);

      const res = await fetch("/api/import/detect", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();

      if (data.error === "password_required" || data.error === "password_incorrect") {
        // Show PAN entry inside the CAS modal itself
        setCasWarnings(data.error === "password_incorrect"
          ? ["Incorrect password — check your PAN (uppercase, 10 chars)"]
          : ["This CAS PDF is password-protected. Enter your PAN to unlock."]);
        setCasStep("password");
        setCasUploading(false);
        // Store the file for retry
        setCasPendingFile(file);
        return;
      }

      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("intro");
        setCasUploading(false);
        return;
      }

      // Store parsed results
      const holdings = data.holdings || [];
      const holderNames = data.holder_names || [];
      const holderPans = data.holder_pans || [];
      const warnings = data.warnings || [];
      const format = data.format || "";

      setCasHoldings(holdings);
      setCasHolderNames(holderNames);
      setCasHolderPans(holderPans);
      setCasWarnings(warnings);
      setCasFormat(format);
      setCasStatementDate(data.statement_date || null);
      setCasPeriodStart(data.period_start || null);
      setCasPeriodEnd(data.period_end || null);
      setCasDepository(data.depository || "");

      // Auto-map holders to members
      const autoMap = autoMapCASHolders(holderNames, holderPans);
      // If there are no holder names, pre-map all holdings to first member
      if (holderNames.length === 0 && members.length > 0) {
        // No holder names extracted — will use single-member assignment
      }
      setCasHolderMap(autoMap);
      setCasStep("matching");
    } catch (e) {
      setCasWarnings([`Upload failed: ${e.message}`]);
      setCasStep("intro");
    }
    setCasUploading(false);
  }

  // ── CAS Downloader: execute import ──
  async function executeCASImport() {
    setCasStep("importing");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      // Build account_map from holder→member mapping
      // Each holding gets the member_id of its matched holder
      const enriched = casHoldings.map(h => ({
        ...h,
        _dupAction: h._duplicate ? (casDupAction[h.name] || "update") : undefined,
      }));

      // Determine member_id: if single holder, use that mapping; otherwise use fallback
      const singleMember = casHolderNames.length <= 1 && members.length > 0
        ? (casHolderMap[casHolderNames[0]] || members[0]?.id)
        : members[0]?.id;

      const res = await fetch("/api/holdings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          holdings: enriched,
          member_id: singleMember || "",
          account_map: Object.keys(casHolderMap).length > 0 ? casHolderMap : undefined,
          cas_statement_date: casStatementDate,
          cas_period_start: casPeriodStart,
          cas_period_end: casPeriodEnd,
        }),
      });
      const result = await res.json();
      setCasResult(result);
      setCasStep("done");
      // Reload holdings
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
      // Reload wealth snapshots
      api("/api/snapshots?months=24").then(d => setWealthSnapshots(d?.snapshots || [])).catch(() => {});
      // Auto-trigger price refresh for newly imported holdings that may lack prices
      if ((result.inserted_count || 0) + (result.updated_count || 0) > 0) {
        setTimeout(() => {
          refreshPrices().then(() => {
            api("/api/holdings").then(h => setHoldings(h || [])).catch(() => {});
          }).catch(() => {});
        }, 1500);
      }
    } catch (e) {
      setCasWarnings([`Import failed: ${e.message}`]);
      setCasStep("matching");
    }
  }

  // ── CAS Downloader: retry with user-entered PAN ──
  async function retryCASWithPassword() {
    if (!casPendingFile || !casPanInput.trim()) return;
    const pan = casPanInput.trim().toUpperCase();
    setCasStep("uploading");
    setCasWarnings([]);
    setCasUploading(true);

    // Optionally save PAN to profile
    if (casSavePan) {
      api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const fd = new FormData();
      fd.append("file", casPendingFile);
      fd.append("password", pan);

      const res = await fetch("/api/import/detect", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();

      if (data.error === "password_incorrect") {
        setCasWarnings(["Incorrect password — check your PAN is correct (uppercase, e.g. ABCDE1234F)"]);
        setCasStep("password");
        setCasUploading(false);
        return;
      }

      if (data.error) {
        setCasWarnings([data.error]);
        setCasStep("password");
        setCasUploading(false);
        return;
      }

      // Success — store parsed results
      const holdings = data.holdings || [];
      setCasHoldings(holdings);
      setCasHolderNames(data.holder_names || []);
      setCasHolderPans(data.holder_pans || []);
      setCasWarnings(data.warnings || []);
      setCasFormat(data.format || "");
      const autoMap = autoMapCASHolders(data.holder_names || [], data.holder_pans || []);
      setCasHolderMap(autoMap);
      setCasStep("matching");
      setCasPendingFile(null);
    } catch (e) {
      setCasWarnings([`Upload failed: ${e.message}`]);
      setCasStep("password");
    }
    setCasUploading(false);
  }

  function resetCASDownloader() {
    setCasModal(false);
    setCasStep("intro");
    setCasHoldings([]);
    setCasHolderNames([]);
    setCasHolderPans([]);
    setCasHolderMap({});
    setCasWarnings([]);
    setCasFormat("");
    setCasResult(null);
    setCasDupAction({});
    setCasUploading(false);
    setCasPendingFile(null);
    setCasPanInput("");
    setCasSavePan(false);
    setCasQuickMemberName("");
    setCasStatementDate(null);
    setCasPeriodStart(null);
    setCasPeriodEnd(null);
    setCasDepository("");
  }

  function openMemberModal(memberId) {
    if (memberId) {
      const m = members.find(x => x.id === memberId);
      if (m) { setNewMember({ name: m.name, relation: m.relation || "", email: m.email || "" }); setEditingMemberId(m.id); }
    } else {
      setNewMember({ name: "", relation: "", email: "" }); setEditingMemberId(null);
    }
    setMergeCandidate(null);
    setModal("member");
  }

  function handleMemberNameChange(name) {
    setNewMember(p => ({ ...p, name }));
    // Check for fuzzy match (only when adding, not editing)
    if (!editingMemberId && name.length >= 2) {
      const match = fuzzyMemberMatch(name);
      setMergeCandidate(match || null);
    } else {
      setMergeCandidate(null);
    }
  }

  function saveMember() {
    if (!newMember.name.trim()) return;
    const email = (newMember.email || "").trim().toLowerCase();
    // Email is required for non-Self members (Self gets auto-populated from user.email)
    const isSelf = newMember.relation === "Self" || (editingMemberId && members.find(m => m.id === editingMemberId)?.relation === "Self");
    if (!isSelf && !email) return;
    if (editingMemberId) {
      // Update existing member
      setMembers(p => p.map(m => m.id === editingMemberId ? { ...m, name: newMember.name.trim(), relation: newMember.relation, email: email || m.email || "" } : m));
    } else {
      // Add new member
      setMembers(p => [...p, { id: uid(), name: newMember.name.trim(), relation: newMember.relation, email: email || "" }]);
    }
    // Auto-create portfolio share if email is provided
    if (email && email !== user?.email?.toLowerCase()) {
      api("/api/shares", { method: "POST", body: JSON.stringify({ email, role: "viewer" }) })
        .then(() => {
          // Cross-link: also share new member with all existing family members
          if (shareWithFamily && sharedWithMe.length > 0) {
            api("/api/shares/cross-link", { method: "POST", body: JSON.stringify({ email }) })
              .then(r => { if (r.linked > 0) console.log(`🔗 Cross-linked ${email} with ${r.family_size} family member(s)`); })
              .catch(e => console.warn("Cross-link failed:", e.message));
          }
          loadShares();
        })
        .catch(e => console.warn("Auto-share failed:", e.message));
    }
    setNewMember({ name: "", relation: "", email: "" }); setEditingMemberId(null); setMergeCandidate(null); setShareWithFamily(true); setModal(null);
  }

  async function mergeMember(targetId) {
    // Merge: reassign all holdings from mergeCandidate's match to existing member, don't create new
    // The user typed a name that matches an existing member — they're confirming it's the same person
    // Nothing to do except close the modal (the import flow will use the existing member)
    setNewMember({ name: "", relation: "" }); setMergeCandidate(null); setModal(null);
  }

  async function deleteMember(memberId, reassignToId) {
    if (!memberId) return;
    const m = members.find(x => x.id === memberId);
    if (!m) return;
    const memberHoldings = holdings.filter(h => h.member_id === memberId);
    if (memberHoldings.length > 0 && reassignToId) {
      // Reassign all holdings to the target member via API
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      for (const h of memberHoldings) {
        await fetch("/api/holdings/" + h.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ ...h, member_id: reassignToId }),
        }).catch(() => {});
      }
      // Refresh holdings
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
    }
    // Remove member
    setMembers(p => p.filter(x => x.id !== memberId));
  }

  async function mergeMembers(sourceId, targetId) {
    // Move all holdings from source → target, then delete source
    if (!sourceId || !targetId || sourceId === targetId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    const sourceHoldings = holdings.filter(h => h.member_id === sourceId);
    for (const h of sourceHoldings) {
      await fetch("/api/holdings/" + h.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ ...h, member_id: targetId }),
      }).catch(() => {});
    }
    setMembers(p => p.filter(x => x.id !== sourceId));
    const hlds = await api("/api/holdings");
    setHoldings(hlds || []);
  }
  // Check if any linkedType+member combo is already used by another goal
  function goalDuplicateTypes(form, excludeId){
    const lt=form.linkedTypes||[];
    if(lt.length===0) return [];
    const lm=form.linkedMembers||["all"];
    const conflicts=[];
    goals.forEach(g=>{
      if(g.id===excludeId) return;
      const glt=g.linkedTypes||[];
      const glm=g.linkedMembers||["all"];
      const memberOverlap=lm.includes("all")||glm.includes("all")||lm.some(m=>glm.includes(m));
      if(!memberOverlap) return;
      lt.forEach(t=>{if(glt.includes(t)) conflicts.push({type:t,goalName:g.name});});
    });
    return conflicts;
  }
  function addGoal(){
    const conflicts=goalDuplicateTypes(goalForm,editGoalId);
    if(conflicts.length>0) return; // blocked by UI
    if(editGoalId){
      setGoals(p=>p.map(g=>g.id===editGoalId?{...g,...goalForm,targetAmount:+goalForm.targetAmount,monthlyContribution:+goalForm.monthlyContribution||0}:g));
    } else {
      setGoals(p=>{const nextPri=p.length>0?Math.max(...p.map(x=>x.priority||1))+1:1;return[...p,{id:uid(),...goalForm,targetAmount:+goalForm.targetAmount,priority:goalForm.priority||nextPri,linkedMembers:goalForm.linkedMembers||["all"],linkedTypes:goalForm.linkedTypes||[],monthlyContribution:+goalForm.monthlyContribution||0}];});
    }
    setGoalForm(BG);setEditGoalId(null);setModal(null);
  }
  function addAlert(){setAlerts(p=>[...p,{id:uid(),...alertForm,threshold:+alertForm.threshold}]);setAlertForm(BA);setModal(null);}

  // ── MF Search ────────────────────────────────────────────────────
  function handleMfSearch(val){
    setMfSearch(val);
    setMfResults([]);
    setMfNav(null);
    clearTimeout(mfSearchTimer.current);
    if(val.length < 2){ setMfSearching(false); return; }
    setMfSearching(true);
    mfSearchTimer.current = setTimeout(async()=>{
      try{
        const results = await api(`/api/mf/search?q=${encodeURIComponent(val)}`);
        setMfResults(results||[]);
      }catch{ setMfResults([]); }
      setMfSearching(false);
    }, 400);
  }

  async function selectMfFund(fund){
    setMfSearch(fund.name);
    setMfResults([]);
    setForm(f=>({...f, name:fund.name, scheme_code:fund.scheme_code}));
    // Fetch current NAV and fund details
    try{
      const info = await api(`/api/mf/nav/${fund.scheme_code}`);
      setMfNav(info);
    }catch{ setMfNav(null); }
  }

  // ── Stock ticker lookup ──────────────────────────────────────────
  function handleTickerChange(ticker, market){
    setStockInfo(null);
    setForm(f=>({...f, ticker:ticker.toUpperCase()}));
    clearTimeout(stockLookTimer.current);
    if(ticker.length < 1){ setStockLooking(false); return; }
    setStockLooking(true);
    stockLookTimer.current = setTimeout(async()=>{
      try{
        const info = await api(`/api/stock/info?ticker=${encodeURIComponent(ticker)}&market=${market}`);
        setStockInfo(info);
        if(info.found && info.name){
          setForm(f=>({...f, name: f.name && f.name !== ticker.toUpperCase() ? f.name : info.name}));
        }
      }catch{ setStockInfo({found:false}); }
      setStockLooking(false);
    }, 600);
  }

  // ── Fetch live USD/INR rate ──────────────────────────────────────
  async function fetchUsdInr(){
    setUsdInrLoading(true);
    try{
      const data = await api("/api/forex/usdinr");
      const rate = data.rate;
      if(rate && rate > 50 && rate < 200) {
        _liveUsdInr = rate;   // update global live rate for all conversions
        setUsdInrRate(rate);
        setForm(f=>({...f, usd_inr_rate: rate.toFixed(2)}));
      }
    }catch{ /* keep existing rate */ }
    setUsdInrLoading(false);
  }

  // ── ETF Search ───────────────────────────────────────────────────
  function handleEtfSearch(val){
    setEtfSearch(val);
    setEtfResults([]);
    setEtfInfo(null);
    clearTimeout(etfSearchTimer.current);
    if(val.length < 2){ setEtfSearching(false); return; }
    setEtfSearching(true);
    etfSearchTimer.current = setTimeout(async()=>{
      try{
        const results = await api(`/api/etf/search?q=${encodeURIComponent(val)}`);
        setEtfResults(results||[]);
      }catch{ setEtfResults([]); }
      setEtfSearching(false);
    }, 400);
  }

  async function selectEtf(etf){
    setEtfSearch(etf.name);
    setEtfResults([]);
    setForm(f=>({...f, name: etf.name, ticker: etf.ticker}));
    // Fetch current price
    try{
      const info = await api(`/api/stock/info?ticker=${encodeURIComponent(etf.ticker)}&market=IN`);
      setEtfInfo(info);
    }catch{ setEtfInfo(null); }
  }
  function buildPortfolioContext(){
    const allCurCtx  = allCur;  // reuse memoized value
    const allInvCtx  = allInv;  // reuse memoized value
    const allGainCtx = allCurCtx - allInvCtx;
    const allPctCtx  = allInvCtx>0 ? (allGainCtx/allInvCtx)*100 : 0;

    const memberLines = members.map(m=>{
      const hs = holdings.filter(h=>h.member_id===m.id);
      const cur = hs.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
      const inv = hs.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
      return `  ${m.name} (${m.relation}): current=${fmtCr(cur)}, invested=${fmtCr(inv)}, return=${inv>0?((cur-inv)/inv*100).toFixed(1):0}%`;
    }).join("\n");

    const holdingLines = holdings.map(h=>{
      const cur=getVal(h), inv=getInv(h), g=cur-inv;
      const xr=xirrCache.get(h.id) || { value: null, method: null };
      const mn=members.find(m=>m.id===h.member_id)?.name||"";
      const txns=h.transactions||[];
      const txnSummary = txns.length>0
        ? `  transactions(${txns.length}): buys=${txns.filter(t=>t.txn_type==="BUY").length}, sells=${txns.filter(t=>t.txn_type==="SELL").length}, net_units=${h.net_units?.toFixed(4)||"?"}, avg_cost=₹${h.avg_cost?.toFixed(2)||"?"}`
        : "";
      return `  [${AT[h.type]?.label}] ${h.name} (${mn}): current=${fmtCr(cur)}, invested=${fmtCr(inv)}, gain=${g>=0?"+":""}${fmtCr(g)}, return=${inv>0?(g/inv*100).toFixed(1):0}%${xr.value!=null?`, ${xr.method}=${xr.value.toFixed(1)}%`:""}${h.ticker?`, ticker=${h.ticker}`:""}${h.scheme_code?`, scheme=${h.scheme_code}`:""}${txnSummary}`;
    }).join("\n");

    const allocationLines = Object.entries(AT).map(([t,a])=>{
      const val=holdings.filter(h=>h.type===t).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
      if(val===0) return null;
      return `  ${a.label}: ${fmtCr(val)} (${allCurCtx>0?(val/allCurCtx*100).toFixed(1):0}%)`;
    }).filter(Boolean).join("\n");

    const goalLines = goals.map(g=>{
      const prog=Math.min((allCurCtx/g.targetAmount)*100,100);
      const yLeft=((Math.max(0,new Date(g.targetDate)-new Date()))/(864e5*365.25)).toFixed(1);
      return `  ${g.name}: target=${fmtCr(g.targetAmount)}, by ${g.targetDate}, funded=${prog.toFixed(0)}%, years_left=${yLeft}`;
    }).join("\n");

    const alertLines = trigAlerts.map(a=>`  ⚠ ${a.label}`).join("\n");

    return `WEALTHLENS FAMILY PORTFOLIO — ${new Date().toLocaleDateString("en-IN")}

SUMMARY:
  Total value: ${fmtCr(allCurCtx)}
  Total invested: ${fmtCr(allInvCtx)}
  Total gain: ${allGainCtx>=0?"+":""}${fmtCr(allGainCtx)} (${allPctCtx.toFixed(2)}%)
  Holdings count: ${holdings.length}

MEMBERS:
${memberLines}

ASSET ALLOCATION:
${allocationLines}

HOLDINGS (all):
${holdingLines}

FINANCIAL GOALS:
${goalLines||"  None set"}

TRIGGERED ALERTS:
${alertLines||"  None"}`;
  }

  // ── Ask AI ────────────────────────────────────────────────────────
  async function askAI(){
    const q = aiInput.trim();
    if(!q || aiLoading) return;
    setAiInput("");
    const userMsg = {role:"user", content:q, ts:new Date()};
    setAiMessages(p=>[...p, userMsg]);
    setAiLoading(true);
    setTimeout(()=>aiBottomRef.current?.scrollIntoView({behavior:"smooth"}),50);

    const portfolioCtx = buildPortfolioContext();
    // Build conversation history for multi-turn context
    const history = [...aiMessages, userMsg].map(m=>({role:m.role, content:m.content}));

    try{
      const data = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a private wealth advisor assistant for WealthLens Pro, a personal portfolio intelligence platform. You have access to the family's complete, real portfolio data below. Answer questions about their portfolio directly and specifically — use actual numbers, names, and holdings from the data. Be concise and conversational. Use ₹ for values, Indian number formatting (Cr, L). Do not give generic financial advice — always refer to their specific holdings and numbers.\n\n${portfolioCtx}`,
          messages: history,
        })
      });
      const reply = data.content?.find(c=>c.type==="text")?.text || "Sorry, I couldn't process that.";
      setAiMessages(p=>[...p, {role:"assistant", content:reply, ts:new Date()}]);
    }catch(e){
      setAiMessages(p=>[...p, {role:"assistant", content:"Something went wrong: "+e.message, ts:new Date()}]);
    }
    setAiLoading(false);
    setTimeout(()=>aiBottomRef.current?.scrollIntoView({behavior:"smooth"}),50);
  }

  // ── Smart Import (auto-detect holdings vs transactions) ──
  async function handleImportFile(file, password) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls", "txt", "pdf"].includes(ext)) {
      setImportState(s => ({ ...s, warnings: ["Unsupported file type. Use CSV, XLSX, XLS, or PDF."] }));
      return;
    }
    setImportState(s => ({ ...s, step: "preview", warnings: [], format: "Detecting…", mode: null, needsPassword: false }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/import/detect", {
        method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      // Handle password-protected PDF
      if (data.needs_password || data.error === "password_required" || data.error === "password_incorrect") {
        if (data.error === "password_incorrect") {
          // Wrong password — show form again with error
          setImportState(s => ({ ...s, step: "cas_password", needsPassword: true,
            pendingFile: s.pendingFile || file,
            warnings: ["Incorrect PAN. Password is your PAN in uppercase."] }));
          return;
        }
        // Try loading saved credentials
        let savedPan = "", savedDob = "";
        try {
          const creds = await api("/api/profile/cas-credentials");
          if (creds.has_credentials) { savedPan = creds._pan || ""; savedDob = creds.dob || ""; }
        } catch {}
        setImportState(s => ({ ...s, step: "cas_password", needsPassword: true, pendingFile: file,
          casPan: savedPan, casDob: savedDob, format: "", warnings: [] }));
        return;
      }
      if (data.error) throw new Error(data.error);
      const detectedType = data.detected_type || "holdings";
      if (detectedType === "transactions") {
        setImportState(s => ({ ...s, step: "preview", mode: "transactions", format: data.format || "Unknown",
          transactions: data.transactions || [], warnings: data.warnings || [] }));
      } else {
        // Auto-map accounts to members via fuzzy matching
        const accts = data.accounts || [];
        const autoMap = {};
        for (const acct of accts) {
          const match = fuzzyMemberMatch(acct);
          if (match) autoMap[acct] = match.id;
        }
        const autoWarnings = [...(data.warnings || [])];
        const mappedAccts = Object.entries(autoMap);
        if (mappedAccts.length > 0) {
          autoWarnings.push(`Auto-matched: ${mappedAccts.map(([a,id]) => `"${a}" → ${members.find(m=>m.id===id)?.name}`).join(", ")}`);
        }
        setImportState(s => ({ ...s, step: "preview", mode: "holdings", format: data.format || "Unknown",
          holdings: data.holdings || [], warnings: autoWarnings,
          accounts: accts, accountMap: autoMap }));
      }
    } catch (e) {
      setImportState(s => ({ ...s, step: "upload", warnings: [`Error: ${e.message}`] }));
    }
  }

  async function submitCASPassword() {
    const { pendingFile, casPan, casRemember } = importState;
    if (!pendingFile || !casPan) return;
    // CAS PDF password is just PAN in uppercase
    const pan = casPan.toUpperCase().trim();
    const password = pan;
    // Save PAN if remember is checked
    if (casRemember) {
      api("/api/profile", { method: "PUT", body: JSON.stringify({ pan }) }).catch(() => {});
    }
    // Retry with password
    handleImportFile(pendingFile, password);
  }

  async function executeImport() {
    if(demoMode) exitDemoMode();
    const { mode, holdings: impHoldings, transactions: impTxns, assignMember, accountMap, format } = importState;
    setImportState(s => ({ ...s, step: "importing", progress: 0 }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      let result;
      if (mode === "transactions") {
        const res = await fetch("/api/transactions/import", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ transactions: impTxns }),
        });
        result = await res.json();
      } else {
        // Derive source and brokerage from detected format
        const fmtLower = (format || "").toLowerCase();
        const isCAS = fmtLower.includes("cas");
        const isPDF = fmtLower.includes("pdf");
        const derivedSource = isCAS ? "cas" : isPDF ? "pdf" : "csv";
        // Use format name as brokerage (clean up suffixes)
        const derivedBrokerage = (format || "CSV Import").replace(/\s*\(.*\)\s*$/, "").trim();

        // _dupAction is already set on each holding by the dup_review step
        // Defaults: new holdings → no action needed, duplicates → "update" unless user chose "skip"
        const enriched = impHoldings.map(h => ({
          ...h,
          source: h.source || derivedSource,
          brokerage_name: h.brokerage_name || derivedBrokerage,
          _dupAction: h._duplicate ? (h._dupAction || "update") : undefined,
        }));
        const res = await fetch("/api/holdings/import", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ holdings: enriched,
            member_id: assignMember || members[0]?.id || "",
            account_map: Object.keys(accountMap).length > 0 ? accountMap : undefined }),
        });
        result = await res.json();
      }
      setImportState(s => ({ ...s, step: "done", progress: 100, result }));
      const hlds = await api("/api/holdings");
      setHoldings(hlds || []);
    } catch (e) {
      setImportState(s => ({ ...s, step: "upload", warnings: [`Import failed: ${e.message}`] }));
    }
  }

  function resetImport() {
    setImportState({ mode: null, step: "upload", format: "", holdings: [], transactions: [],
      warnings: [], progress: 0, result: null, dragOver: false, assignMember: "",
      accounts: [], accountMap: {}, dupAction: {}, dupBulk: "ask", dupConfirmed: false,
      pendingFile: null, needsPassword: false, casPan: "", casDob: "", casRemember: false });
  }

  function openImportModal() {
    resetImport();
    setModal("import");
  }

  // ── PDF report ──
  async function generatePDF(){
    setPdfState({loading:true,summary:""}); setModal("pdf");
    // Reuse memoized allCur/allInv from derived data block
    const byTA=Object.keys(AT).map(t=>{const v=holdings.filter(h=>h.type===t).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);return{...AT[t],t,v,pct:allCur>0?(v/allCur)*100:0};}).filter(x=>x.v>0);
    const mSumPdf=members.map(m=>{const hs=holdings.filter(h=>h.member_id===m.id);const c=hs.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0),i=hs.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);return{...m,cur:c,inv:i,pct:i>0?((c-i)/i)*100:0};});
    const ctx=`Portfolio: ${fmtCr(allCur)} | Invested: ${fmtCr(allInv)} | Gain: ${fmtCr(allCur-allInv)} (${allCur>0?((allCur-allInv)/allInv*100).toFixed(1):0}%)\nMembers: ${mSumPdf.map(m=>`${m.name}: ${fmtCr(m.cur)} (${m.pct.toFixed(1)}%)`).join("; ")}\nAllocation: ${byTA.map(x=>`${x.label}: ${fmtCr(x.v)} (${x.pct.toFixed(1)}%)`).join(", ")}\nGoals: ${goals.map(g=>`${g.name}: target ${fmtCr(g.targetAmount)} by ${g.targetDate}`).join("; ")}`;
    try{
      const data = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 900,
          system: "You are a private wealth advisor. Write exactly 4 short paragraphs reviewing this Indian family portfolio: (1) overall health, (2) allocation quality, (3) goal progress, (4) recommendations. Use INR values. Plain text only.",
          messages: [{role:"user", content:ctx}]
        })
      });
      setPdfState({loading:false, summary:data.content?.find(c=>c.type==="text")?.text||""});
    }catch(e){ setPdfState({loading:false, summary:"AI summary unavailable: "+e.message}); }
  }

  // ── Demo mode (client-side only, no DB persistence) ──
  function loadDemoData() {
    // Build enriched holdings with computed fields for display
    const demoHoldings = SEED.holdings.map(h => {
      const txns = (SEED.transactions[h.id] || []).map(t => ({
        id: "dt_" + Math.random().toString(36).slice(2, 8),
        holding_id: h.id,
        txn_type: t.type || "BUY",
        units: t.units, price: t.price,
        txn_date: t.date, notes: "Demo",
      }));
      const buys = txns.filter(t => t.txn_type === "BUY");
      const sells = txns.filter(t => t.txn_type === "SELL");
      const buyU = buys.reduce((s, t) => s + Number(t.units), 0);
      const sellU = sells.reduce((s, t) => s + Number(t.units), 0);
      const netU = buyU - sellU;
      const avgC = buyU > 0 ? buys.reduce((s, t) => s + Number(t.units) * Number(t.price), 0) / buyU : 0;
      return {
        ...h, transactions: txns, artifacts: [],
        net_units: netU, avg_cost: avgC, units: netU,
        purchase_price: avgC, purchase_nav: avgC,
        purchase_value: h.purchase_value || avgC * netU,
        start_date: h.start_date || (txns.length ? txns.sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date))[0]?.txn_date : null),
      };
    });
    setHoldings(demoHoldings);
    setMembers(SEED.members);
    setGoals(SEED.goals);
    setAlerts(SEED.alerts);
    setDemoMode(true);
  }

  function exitDemoMode() {
    setDemoMode(false);
    setHoldings([]);
    setMembers([]);
    setGoals([]);
    setAlerts([]);
  }

  // ── Derived data (memoized — recomputes only when deps change) ──
  // Combine own holdings with shared holdings for Family Portfolio view
  const allHoldings = useMemo(() => [...holdings, ...sharedHoldings], [holdings, sharedHoldings]);
  const allMembers = useMemo(() => [...members, ...sharedMembers], [members, sharedMembers]);

  // ── Per-holding value caches: getValINR/getInvINR/getXIRR called ONCE per data change ──
  const valINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getValINR(h));
    return m;
  }, [allHoldings]);
  const invINRCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInvINR(h));
    return m;
  }, [allHoldings]);
  const xirrCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getXIRR(h));
    return m;
  }, [allHoldings]);
  // Native-currency caches (for per-row display in holdings table)
  const valNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getVal(h));
    return m;
  }, [allHoldings]);
  const invNativeCache = useMemo(() => {
    const m = new Map();
    for (const h of allHoldings) m.set(h.id, getInv(h));
    return m;
  }, [allHoldings]);

  // allCur/allInv represent the total across own + shared portfolios
  const allCur = useMemo(() => allHoldings.reduce((s,h) => s + (valINRCache.get(h.id)||0), 0), [allHoldings, valINRCache]);
  const allInv = useMemo(() => allHoldings.reduce((s,h) => s + (invINRCache.get(h.id)||0), 0), [allHoldings, invINRCache]);

  // Sort toggle: click same col flips direction, click new col sorts asc
  function toggleSort(col) {
    if (sortCol === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("asc"); }
  }

  // Sort comparator — extract value per column key (uses caches)
  function _sortVal(h, col) {
    switch (col) {
      case "name":    return (h.name || "").toLowerCase();
      case "ticker":  return (h.ticker || h.scheme_code || "").toLowerCase();
      case "type":    return (AT[h.type]?.label || h.type || "").toLowerCase();
      case "member":  return (allMembers.find(m => m.id === h.member_id)?.name || "").toLowerCase();
      case "brokerage": return (h.brokerage_name || h.source || "").toLowerCase();
      case "units":   return Number(h.net_units ?? h.units ?? 0);
      case "avg":     return Number(h.avg_cost ?? h.purchase_price ?? h.purchase_nav ?? 0);
      case "price":   return Number(h.type === "MF" ? (h.current_nav || 0) : (h.current_price || 0));
      case "invested": return invINRCache.get(h.id)||0;
      case "current":  return valINRCache.get(h.id)||0;
      case "gain":     return (valINRCache.get(h.id)||0) - (invINRCache.get(h.id)||0);
      case "return":   { const inv = invINRCache.get(h.id)||0; return inv > 0 ? (((valINRCache.get(h.id)||0) - inv) / inv) * 100 : 0; }
      default:         return 0;
    }
  }

  // Build member selector entries: own members + one entry per shared portfolio owner
  const sharedOwnerChips = useMemo(() => sharedWithMe.map(s => ({
    id: `_owner_${s.owner_id}`,
    name: `${s.owner_name}'s`,
    _shared: true,
    _shared_owner_id: s.owner_id,
  })), [sharedWithMe]);

  const filteredH = useMemo(() => (selMember === "all"
    ? allHoldings
    : selMember.startsWith("_owner_")
      ? allHoldings.filter(h => h._shared_owner_id === selMember.replace("_owner_", ""))
      : allHoldings.filter(h => h.member_id === selMember)
  ).filter(h => filterType === "ALL" || h.type === filterType), [allHoldings, selMember, filterType]);

  const visH = useMemo(() => sortCol
    ? [...filteredH].sort((a, b) => {
        const va = _sortVal(a, sortCol), vb = _sortVal(b, sortCol);
        const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filteredH, [filteredH, sortCol, sortDir, valINRCache, invINRCache]);
  const totCur = useMemo(() => visH.reduce((s,h) => s + (valINRCache.get(h.id)||0), 0), [visH, valINRCache]);
  const totInv = useMemo(() => visH.reduce((s,h) => s + (invINRCache.get(h.id)||0), 0), [visH, invINRCache]);
  const totGain=totCur-totInv, totPct=totInv>0?(totGain/totInv)*100:0;
  const byType = useMemo(() => Object.keys(AT).map(t=>{const hs=visH.filter(h=>h.type===t);const v=hs.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0),i=hs.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);return{t,v,i,count:hs.length,pct:totCur>0?(v/totCur)*100:0};}).filter(x=>x.v>0), [visH, valINRCache, invINRCache, totCur]);
  const mSum = useMemo(() => allMembers.map(m=>{const hs=allHoldings.filter(h=>h.member_id===m.id);const c=hs.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0),i=hs.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);return{...m,cur:c,inv:i,gain:c-i,pct:i>0?((c-i)/i)*100:0};}), [allHoldings, allMembers, valINRCache, invINRCache]);
  const trigAlerts = useMemo(() => alerts.filter(a=>{
    if(!a.active)return false;
    if(a.type==="ALLOCATION_DRIFT"||a.type==="CONCENTRATION"){const v=allHoldings.filter(h=>h.type===a.assetType).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);const p=allCur>0?(v/allCur)*100:0;return a.type==="CONCENTRATION"?p<a.threshold:p>a.threshold;}
    if(a.type==="RETURN_TARGET")return totPct<a.threshold;
    return false;
  }), [alerts, allHoldings, valINRCache, allCur, totPct]);

  const syncColor=syncSt==="saved"?"#4caf9a":syncSt==="saving"?"#c9a84c":syncSt==="error"?"#e07c5a":"rgba(255,255,255,.4)";

  // ── Early returns ──
  if(authLoading) return <><style>{GF}</style><style>{CSS}</style><div style={{minHeight:"100vh",background:"#070d1a",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:34,height:34,border:"2px solid rgba(201,168,76,.2)",borderTopColor:"#c9a84c",borderRadius:"50%",animation:"spin 1s linear infinite"}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div></>;
  if(!user) return <><style>{GF}</style><style>{CSS}</style><LoginScreen error={authErr}/></>;

  return (
    <><style>{GF}</style><style>{CSS}</style>
    <div className="app">

      {/* HEADER */}
      <header className="hdr">
        <div className="logo">Wealth<span>Lens</span> <span style={{fontSize:".6rem",letterSpacing:".1em",color:"rgba(201,168,76,.5)",verticalAlign:"middle"}}>PRO</span></div>
        <div className="hdr-r">
          {trigAlerts.length>0&&<div className="alert-pill" onClick={()=>setTab("strategy")}>⚠ {trigAlerts.length} alert{trigAlerts.length>1?"s":""}</div>}
          {/* Sync dot */}
          <div style={{display:"flex",alignItems:"center",gap:".32rem",padding:".26rem .6rem",borderRadius:4,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:syncColor,transition:"all .3s"}}/>
            <span style={{fontSize:".63rem",color:syncColor,fontFamily:"'DM Mono',monospace"}}>{syncSt==="saving"?"Saving…":syncSt==="error"?"Error":"Saved"}</span>
          </div>
          {/* Price refresh */}
          <button className="btn-o" onClick={refreshPrices} disabled={priceRefreshing} title="Fetch live prices from Yahoo Finance & MFAPI">
            {priceRefreshing?"⟳ Fetching…":"⟳ Live Prices"}
          </button>
          {lastPriceRefresh&&<span style={{fontSize:".62rem",color:"rgba(255,255,255,.38)",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{ago(lastPriceRefresh)}</span>}
          <button className="btn-g" onClick={generatePDF}>⤓ PDF</button>
          {!viewingShared && <button className="btn-p" onClick={()=>setModal("add")}>+ Add</button>}
          <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){handleImportFile(e.target.files[0]);e.target.value="";}}}/>

          {/* User */}
          <div style={{display:"flex",alignItems:"center",gap:".4rem",paddingLeft:".4rem",borderLeft:"1px solid rgba(255,255,255,.07)"}}>
            {user.user_metadata?.avatar_url
              ?<img src={user.user_metadata.avatar_url} alt="" style={{width:26,height:26,borderRadius:"50%",border:"1px solid rgba(201,168,76,.3)"}}/>
              :<div style={{width:26,height:26,borderRadius:"50%",background:"rgba(201,168,76,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".72rem",color:"#c9a84c",fontWeight:600}}>{user.email?.[0]?.toUpperCase()||"?"}</div>
            }
            <button className="btn-o" style={{padding:".26rem .6rem",fontSize:".62rem",opacity:.7}} onClick={()=>setShowSettings(true)}>Settings</button>
            <button className="btn-o" style={{padding:".26rem .6rem",fontSize:".62rem",opacity:.6}} onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      {/* Shared portfolio banner */}
      {viewingShared && (
        <div style={{display:"flex",alignItems:"center",gap:".6rem",padding:".55rem 1.2rem",background:"rgba(167,139,250,.08)",borderBottom:"1px solid rgba(167,139,250,.2)"}}>
          <span style={{fontSize:".8rem"}}>👁</span>
          <span style={{fontSize:".78rem",color:"#a78bfa",flex:1}}>
            Viewing <strong>{viewingShared.owner_name}'s</strong> portfolio
            <span style={{fontSize:".62rem",marginLeft:6,padding:".12rem .4rem",borderRadius:3,background:"rgba(167,139,250,.12)",color:"rgba(167,139,250,.7)"}}>{viewingShared.role}</span>
          </span>
          <button onClick={exitSharedView} style={{background:"rgba(167,139,250,.12)",border:"1px solid rgba(167,139,250,.35)",color:"#a78bfa",padding:".3rem .7rem",borderRadius:5,cursor:"pointer",fontSize:".72rem",fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(167,139,250,.2)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(167,139,250,.12)"}>← Back to my portfolio</button>
        </div>
      )}

      {/* Shared portfolios quick switcher (only shown when others have shared with me) */}
      {!viewingShared && sharedWithMe.length > 0 && (
        <div style={{display:"flex",alignItems:"center",gap:".5rem",padding:".4rem 1.2rem",background:"rgba(255,255,255,.02)",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
          <span style={{fontSize:".6rem",color:"rgba(255,255,255,.4)",whiteSpace:"nowrap"}}>Portfolios:</span>
          <div style={{display:"flex",gap:".35rem",alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:".68rem",padding:".2rem .55rem",borderRadius:4,background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.3)",color:"#c9a84c",fontWeight:500}}>My portfolio</span>
            {sharedWithMe.map(s=>(
              <span key={s.id} onClick={()=>viewSharedPortfolio(s.owner_id,s.owner_name,s.role)}
                style={{fontSize:".68rem",padding:".2rem .55rem",borderRadius:4,background:"rgba(167,139,250,.06)",border:"1px solid rgba(167,139,250,.15)",color:"rgba(167,139,250,.7)",cursor:"pointer",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(167,139,250,.12)";e.currentTarget.style.borderColor="rgba(167,139,250,.35)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(167,139,250,.06)";e.currentTarget.style.borderColor="rgba(167,139,250,.15)";}}>
                {s.owner_name}'s portfolio
              </span>
            ))}
          </div>
        </div>
      )}

      <main className="main">
        {priceCount>0&&<div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:"1rem",padding:".5rem .9rem",background:"rgba(76,175,154,.07)",border:"1px solid rgba(76,175,154,.2)",borderRadius:7,fontSize:".75rem",color:"#4caf9a"}}>✓ Updated {priceCount} prices from live market data</div>}

        {/* Member selector */}
        <div className="mbar">
          <span className="mlbl">View</span>
          {[{id:"all",name:"Family Portfolio"},...members].map(m=>(
            <div key={m.id} className={`mchip${selMember===m.id?" act":""}`} onClick={()=>setSelMember(m.id)}>{m.name}</div>
          ))}
          {sharedOwnerChips.length > 0 && <>
            <span style={{width:1,height:16,background:"rgba(255,255,255,.1)",margin:"0 .2rem"}}/>
            <div style={{position:"relative",display:"inline-block"}}>
              <div className={`mchip${selMember.startsWith("_owner_")?" act":""}`}
                onClick={()=>setShowSharedDropdown(p=>!p)}
                style={{borderColor:selMember.startsWith("_owner_")?"rgba(167,139,250,.5)":"rgba(167,139,250,.2)",
                  color:selMember.startsWith("_owner_")?"#a78bfa":"rgba(167,139,250,.6)",
                  background:selMember.startsWith("_owner_")?"rgba(167,139,250,.12)":"rgba(167,139,250,.04)",cursor:"pointer"}}>
                👁 Shared ({sharedOwnerChips.length}) {showSharedDropdown?"▴":"▾"}
              </div>
              {showSharedDropdown && (
                <div style={{position:"absolute",top:"100%",left:0,marginTop:4,zIndex:50,
                  background:"#0c1526",border:"1px solid rgba(167,139,250,.25)",borderRadius:8,
                  minWidth:220,boxShadow:"0 8px 24px rgba(0,0,0,.4)"}}>
                  {sharedOwnerChips.map(m=>(
                    <div key={m.id}
                      onClick={()=>{setSelMember(m.id);setShowSharedDropdown(false);}}
                      style={{padding:".55rem .75rem",cursor:"pointer",fontSize:".75rem",
                        color:selMember===m.id?"#a78bfa":"rgba(167,139,250,.7)",
                        background:selMember===m.id?"rgba(167,139,250,.1)":"transparent",
                        borderBottom:"1px solid rgba(255,255,255,.05)",transition:"background .15s"}}
                      onMouseEnter={e=>{if(selMember!==m.id)e.currentTarget.style.background="rgba(167,139,250,.08)";}}
                      onMouseLeave={e=>{if(selMember!==m.id)e.currentTarget.style.background="transparent";}}>
                      👁 {m.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>}
        </div>

        {/* Tabs */}
        <div className="tabs">
          {["overview","holdings","goals","strategy","members","budget","calendar","ask"].map(t=>{
            const isBudget=t==="budget";
            const isAsk=t==="ask";
            const isActive=tab===t;
            const lockedTabs=new Set(loaded&&holdings.length===0&&!demoMode?["goals","strategy","members","calendar","ask"]:[]);
            const isLocked=lockedTabs.has(t);
            return(
            <div key={t}
              className={`tab${isActive?" act":""}${isLocked?" dim":""}`}
              onClick={()=>{if(!isLocked)setTab(t);}}
              title={isLocked?"Add holdings to unlock this tab":undefined}
              style={{...(isBudget?{
                borderBottom:isActive?"2px solid #a084ca":undefined,
                color:isActive?"#a084ca":tab==="budget"?"#a084ca":"rgba(160,132,202,.55)",
                background:isActive?"rgba(160,132,202,.12)":"rgba(160,132,202,.04)",
                borderTop:"1px solid rgba(160,132,202,.15)",
                borderLeft:"1px solid rgba(160,132,202,.1)",
                borderRight:"1px solid rgba(160,132,202,.1)",
                borderRadius:"4px 4px 0 0",
                marginRight:2,
              }:{}),
              ...(isLocked?{opacity:.35,cursor:"default",pointerEvents:"none"}:{})
              }}>
              {t==="strategy"&&trigAlerts.length>0
                ?<span>Strategy <span className="tbadge">{trigAlerts.length}</span></span>
                :isAsk?<span style={{display:"flex",alignItems:"center",gap:".35rem"}}>✦ Advisor</span>
                :isBudget?<span style={{display:"flex",alignItems:"center",gap:".3rem"}}>
                    <span style={{fontSize:".7rem"}}>💰</span>
                    <span>Budget</span>
                    <span style={{fontSize:".55rem",padding:"1px 4px",borderRadius:3,background:"rgba(160,132,202,.25)",color:"rgba(160,132,202,.9)",letterSpacing:".04em"}}>SPEND</span>
                  </span>
                :t[0].toUpperCase()+t.slice(1)}
            </div>);
          })}
        </div>

        {/* ── OVERVIEW ── */}
        {tab==="overview"&&(<>
          {/* Demo data banner */}
          {demoMode&&(
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".6rem",
              padding:".7rem 1rem",marginBottom:"1rem",
              background:"rgba(160,132,202,.08)",border:"1px solid rgba(160,132,202,.25)",borderRadius:8}}>
              <div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                <span style={{fontSize:"1.1rem"}}>👋</span>
                <div>
                  <div style={{fontSize:".8rem",color:"rgba(160,132,202,.9)",fontWeight:500}}>You're viewing sample data (view only)</div>
                  <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)",marginTop:".1rem"}}>This is not saved anywhere. Add your own data to get started — sample data disappears automatically.</div>
                </div>
              </div>
              <button className="btn-sm" style={{borderColor:"rgba(160,132,202,.4)",color:"rgba(160,132,202,.8)",whiteSpace:"nowrap"}}
                onClick={exitDemoMode}>
                ✕ Exit Demo
              </button>
            </div>
          )}
          {/* Empty state — Welcome Card + Import Guide */}
          {loaded&&!demoMode&&holdings.length===0&&sharedHoldings.length===0&&(<>
            <div style={{background:"rgba(201,168,76,.03)",border:"1px solid rgba(201,168,76,.18)",borderRadius:12,padding:"1.3rem 1.5rem",marginBottom:"1rem"}}>
              <div style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:"1rem"}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:"rgba(201,168,76,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".85rem",color:"#c9a84c",fontWeight:600}}>W</div>
                <div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"#ffffff",fontWeight:500}}>Welcome to WealthLens Hub</div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)"}}>3 steps to see your complete portfolio</div>
                </div>
              </div>
              {/* Step 1: Done */}
              <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(76,175,154,.15)",border:"1.5px solid #4caf9a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"#4caf9a",flexShrink:0,marginTop:2}}>✓</div>
                <div>
                  <div style={{fontSize:".82rem",color:"rgba(255,255,255,.45)",textDecoration:"line-through"}}>Create your account</div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.3)"}}>Signed in — you're all set</div>
                </div>
              </div>
              {/* Step 2: Add holdings */}
              <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid #c9a84c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"#c9a84c",fontWeight:600,flexShrink:0,marginTop:2}}>2</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:".82rem",color:"#ffffff",fontWeight:500}}>Add your first holdings</div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",marginBottom:".5rem",lineHeight:1.5}}>Import from your broker, connect a US brokerage, or add manually.</div>
                  <div style={{display:"flex",gap:".35rem",flexWrap:"wrap"}}>
                    <button className="btns" style={{fontSize:".7rem",padding:".32rem .7rem"}} onClick={()=>setModal("quickadd")}>Add your first investment</button>
                    <button className="btn-o" style={{fontSize:".7rem",padding:".32rem .7rem"}} onClick={()=>setModal("add")}>Import CSV / Connect broker</button>
                  </div>
                </div>
              </div>
              {/* Step 3: Currency */}
              <div style={{display:"flex",alignItems:"flex-start",gap:".75rem",padding:".65rem 0"}}>
                <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"rgba(255,255,255,.25)",flexShrink:0,marginTop:2}}>3</div>
                <div>
                  <div style={{fontSize:".82rem",color:"rgba(255,255,255,.4)"}}>Set your base currency</div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.3)"}}>Open <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setShowSettings(true)}>⚙️ Settings</span> to choose USD, INR, or 8 other currencies.</div>
                </div>
              </div>
              {/* Explore with demo */}
              <div style={{borderTop:"1px solid rgba(255,255,255,.06)",marginTop:".4rem",paddingTop:".6rem",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:".7rem",color:"rgba(255,255,255,.3)"}}>Want to explore first?</span>
                <button className="btn-o" style={{fontSize:".68rem",padding:".3rem .65rem"}} onClick={loadDemoData}>Load sample portfolio</button>
              </div>
            </div>
            {/* Import guidance cards — US first */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".55rem",marginBottom:"1rem"}}>
              {[
                {title:"US Brokerages",desc:"Connect Fidelity, Schwab, Robinhood, Vanguard + 22 more via SnapTrade OAuth.",badge:"Auto-sync",badgeBg:"rgba(90,156,224,.12)",badgeC:"#5a9ce0"},
                {title:"US Broker CSV",desc:"Export from Fidelity, Schwab, E*TRADE, Merrill, Webull, SoFi etc. Drag & drop.",badge:"Supported",badgeBg:"rgba(76,175,154,.12)",badgeC:"#4caf9a"},
                {title:"CDSL / NSDL CAS",desc:"One PDF covers ALL Indian brokers. Request at cdslIndia.com. Password = PAN.",badge:"Best for India",badgeBg:"rgba(201,168,76,.12)",badgeC:"#c9a84c"},
                {title:"Indian Broker CSV",desc:"Zerodha Console, Groww, ICICI Direct, HDFC Sec, Upstox, Angel One exports.",badge:"Supported",badgeBg:"rgba(76,175,154,.12)",badgeC:"#4caf9a"},
              ].map(c=>(
                <div key={c.title} style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,padding:".75rem",cursor:"pointer",transition:"all .15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(201,168,76,.25)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,.06)"}
                  onClick={()=>c.title.includes("US Brokerage")?setModal("add"):setModal("add")}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".3rem"}}>
                    <span style={{fontSize:".8rem",color:"#ffffff",fontWeight:500}}>{c.title}</span>
                    <span style={{fontSize:".55rem",padding:"2px 6px",borderRadius:3,background:c.badgeBg,color:c.badgeC}}>{c.badge}</span>
                  </div>
                  <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",lineHeight:1.5}}>{c.desc}</div>
                </div>
              ))}
            </div>
          </>)}
          {/* User has no own holdings but has shared data */}
          {loaded&&!demoMode&&holdings.length===0&&sharedHoldings.length>0&&(
            <div style={{textAlign:"center",padding:"1.5rem 1rem",marginBottom:"1rem",background:"rgba(167,139,250,.04)",border:"1px solid rgba(167,139,250,.15)",borderRadius:12}}>
              <div style={{fontSize:".85rem",color:"rgba(167,139,250,.8)",marginBottom:".3rem"}}>You're viewing shared portfolios</div>
              <div style={{fontSize:".72rem",color:"rgba(255,255,255,.45)"}}>
                {sharedHoldings.length} holdings from {sharedWithMe.length} shared portfolio{sharedWithMe.length>1?"s":""}. Add your own holdings to see the combined family view.
              </div>
            </div>
          )}
          <div className="mg">
            {[
              {label:"Portfolio Value",val:fmtCr(totCur),sub2:fmtCrINR(totCur),sub:`${visH.length} holdings`},
              {label:"Amount Invested",val:fmtCr(totInv),sub2:fmtCrINR(totInv)},
              {label:"Total Gains",val:(totGain>=0?"+":"")+fmtCr(totGain),sub2:(totGain>=0?"+":"")+fmtCrINR(Math.abs(totGain)),sub:fmtPct(totPct),c:totGain>=0?"gain":"loss"},
              {label:"Return",val:fmtPct(totPct),c:totPct>=0?"gain":"loss",sub:"P&L %"}
            ].map(m=>(
              <div key={m.label} className="mc">
                <div className="mclbl">{m.label}</div>
                <div className={`mcval${m.c?" "+m.c:""}`}>{m.val}</div>
                {m.sub2&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:".82rem",color:"rgba(201,168,76,.85)",marginTop:".25rem",fontWeight:600}}>≈ {m.sub2}</div>}
                {m.sub&&<div className={`mcsub${m.c?" "+m.c:""}`}>{m.sub}</div>}
              </div>
            ))}
          </div>
          <div className="sg">
            <div className="card"><div className="ctitle">Asset Allocation</div>
              {byType.length===0&&<div className="empty">No holdings</div>}
              {byType.map(row=>{const a=AT[row.t],g=row.v-row.i;return(<div key={row.t} className="arow"><div className="aicon">{a.icon}</div><div className="ainfo"><div className="aname">{a.label}</div><div className="abg"><div className="afill" style={{width:`${row.pct}%`,background:a.color}}/></div></div><div className="argt"><div className="aval">{fmt(row.v)}</div><div className={`apct${g>=0?" gain":" loss"}`}>{row.pct.toFixed(1)}% · {fmtPct(row.i>0?(g/row.i)*100:0)}</div></div></div>);})}
            </div>
            <div className="card"><div className="ctitle">Member Breakdown</div>
              {mSum.map(m=>{const share=totCur>0?(m.cur/totCur)*100:0;return(<div key={m.id} className="msrow">
  <div className="av">{m.name[0]}</div>
  <div style={{flex:1}}>
    <div style={{fontSize:".88rem",color:"#ffffff"}}>{m.name}</div>
    <div style={{fontSize:".68rem",color:"rgba(255,255,255,.33)",textTransform:"uppercase",letterSpacing:".05em"}}>{m.relation}</div>
    <div style={{marginTop:".35rem",height:3,background:"rgba(255,255,255,.07)",borderRadius:2,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${share}%`,background:"rgba(201,168,76,.55)",borderRadius:2,transition:"width .8s ease"}}/>
    </div>
  </div>
  <div style={{marginLeft:".75rem",textAlign:"right",minWidth:90}}>
    <div style={{fontFamily:"'DM Mono',monospace",fontSize:".85rem",color:"#ffffff"}}>{fmt(m.cur)}</div>
    <div style={{display:"flex",gap:".4rem",justifyContent:"flex-end",marginTop:".18rem"}}>
      <span style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"#c9a84c",fontWeight:600}}>{share.toFixed(1)}%</span>
      <span style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"rgba(255,255,255,.42)"}}>|</span>
      <span className={m.gain>=0?"gain":"loss"} style={{fontSize:".68rem"}}>{fmtPct(m.pct)}</span>
    </div>
  </div>
</div>);})}
            </div>
          </div>
          <div className="card"><div className="ctitle">Category Distribution</div><DonutChart data={byType} total={totCur}/></div>

          {/* ── DATA FRESHNESS CARD ── */}
          {(()=>{
            const srcMap = {};
            for (const h of allHoldings) {
              const src = h.source === "cas" ? "CAS" : h.source === "snaptrade" ? "SnapTrade" : h.source === "csv" ? "CSV" : "Manual";
              const mem = allMembers.find(m => m.id === h.member_id)?.name || (h._shared_owner ? h._shared_owner : "Unassigned");
              const key = `${src}|${mem}`;
              if (!srcMap[key]) srcMap[key] = { src, member: mem, date: h.source_date || null, count: 0, hasLive: src === "SnapTrade", lastRefresh: null, casPeriodStart: null, casPeriodEnd: null, importDate: null };
              srcMap[key].count++;
              if (h.source_date && (!srcMap[key].date || h.source_date > srcMap[key].date)) srcMap[key].date = h.source_date;
              if (h.price_fetched_at && (!srcMap[key].lastRefresh || h.price_fetched_at > srcMap[key].lastRefresh)) srcMap[key].lastRefresh = h.price_fetched_at;
              if (h.cas_period_start && (!srcMap[key].casPeriodStart || h.cas_period_start < srcMap[key].casPeriodStart)) srcMap[key].casPeriodStart = h.cas_period_start;
              if (h.cas_period_end && (!srcMap[key].casPeriodEnd || h.cas_period_end > srcMap[key].casPeriodEnd)) srcMap[key].casPeriodEnd = h.cas_period_end;
              if (h.created_at && (!srcMap[key].importDate || h.created_at > srcMap[key].importDate)) srcMap[key].importDate = h.created_at;
            }
            const rows = Object.values(srcMap);
            if (rows.length === 0) return null;
            const dfmt = (d) => new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
            const dfmtShort = (d) => new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
            return (
              <div className="card">
                <div className="ctitle">Data Freshness</div>
                <div style={{display:"grid",gap:".4rem"}}>
                  {rows.map((r,i) => (
                    <div key={i} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .65rem",background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.05)",borderRadius:6}}>
                      <div style={{fontSize:".95rem",width:22,textAlign:"center"}}>{r.src==="CAS"?"📥":r.src==="SnapTrade"?"🔗":r.src==="CSV"?"📄":"✍️"}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:".75rem",color:"rgba(255,255,255,.8)",fontWeight:500}}>{r.member}</div>
                        <div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)"}}>{r.src} · {r.count} holding{r.count!==1?"s":""}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        {r.hasLive ? (
                          <div style={{fontSize:".72rem",color:"#4caf9a",fontWeight:500}}>Live</div>
                        ) : r.casPeriodEnd ? (
                          <>
                            <div style={{fontSize:".72rem",color:"#c9a84c",fontWeight:500}}>{r.casPeriodStart ? `${dfmtShort(r.casPeriodStart)} → ${dfmt(r.casPeriodEnd)}` : dfmt(r.casPeriodEnd)}</div>
                            {r.importDate && <div style={{fontSize:".58rem",color:"rgba(255,255,255,.25)"}}>Imported: {dfmtShort(r.importDate)}</div>}
                          </>
                        ) : r.date ? (
                          <>
                            <div style={{fontSize:".72rem",color:"#c9a84c",fontWeight:500}}>{dfmt(r.date)}</div>
                            {r.importDate && r.importDate.slice(0,10) !== r.date && <div style={{fontSize:".58rem",color:"rgba(255,255,255,.25)"}}>Imported: {dfmtShort(r.importDate)}</div>}
                          </>
                        ) : r.lastRefresh ? (
                          <div style={{fontSize:".72rem",color:"rgba(201,168,76,.6)",fontWeight:500}}>Price: {dfmt(r.lastRefresh)}</div>
                        ) : (
                          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.3)"}}>—</div>
                        )}
                        {r.lastRefresh && (r.casPeriodEnd || r.date) && (
                          <div style={{fontSize:".58rem",color:"rgba(255,255,255,.25)"}}>Price: {dfmtShort(r.lastRefresh)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── NET WORTH TIMELINE ── */}
          {(()=>{
            const nwHoldings = nwMember==="all" ? allHoldings : allHoldings.filter(h=>h.member_id===nwMember);
            const nwCur = nwHoldings.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            const nwInv = nwHoldings.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);

            // Build cumulative invested per month from transactions
            const monthlyInv = {};
            for(const h of nwHoldings){
              for(const t of (h.transactions||[])){
                const mo=t.txn_date.slice(0,7);
                const delta=(t.txn_type==="BUY"?1:-1)*(+t.units)*(+t.price);
                monthlyInv[mo]=(monthlyInv[mo]||0)+delta;
              }
              if(["FD","PPF","EPF","REAL_ESTATE"].includes(h.type)&&h.start_date){
                const mo=h.start_date.slice(0,7);
                monthlyInv[mo]=(monthlyInv[mo]||0)+(invINRCache.get(h.id)||0);
              }
            }
            // Convert to cumulative
            const sortedMos = Object.keys(monthlyInv).sort();
            let cum=0; const cumByMo={};
            for(const mo of sortedMos){ cum+=monthlyInv[mo]; cumByMo[mo]=Math.max(0,cum); }
            const last24=sortedMos.slice(-24);
            if(last24.length<2) return null;

            const [hovIdx,setHovIdx]=window.__nwHov||[null,null];
            const maxV=Math.max(...last24.map(m=>cumByMo[m]),nwCur)*1.05;
            const W=580,H=180,pad={l:58,r:16,t:14,b:32};
            const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
            const xPos=(i)=>pad.l+i*(iW/Math.max(last24.length-1,1));
            const yPos=(v)=>pad.t+iH-((v/maxV)*iH);
            const pts=last24.map((m,i)=>`${xPos(i)},${yPos(cumByMo[m]||0)}`).join(" ");
            const labels=last24.filter((_,i)=>i===0||(i%4===0)||i===last24.length-1);

            return(
            <div className="card">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".85rem",flexWrap:"wrap",gap:".5rem"}}>
                <div className="ctitle" style={{margin:0}}>Net Worth Timeline</div>
                <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
                  <select className="fi fs" style={{width:140,marginBottom:0,fontSize:".72rem",padding:".28rem .6rem"}}
                    value={nwMember} onChange={e=>setNwMember(e.target.value)}>
                    <option value="all">All Members</option>
                    {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",overflow:"visible"}}
                onMouseLeave={()=>{if(window.__nwSetHov)window.__nwSetHov(null);}}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="#c9a84c" stopOpacity="0.02"/>
                  </linearGradient>
                </defs>
                {/* Y grid + labels */}
                {[0,.25,.5,.75,1].map(p=>{
                  const y=pad.t+iH*(1-p);
                  return <g key={p}>
                    <line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth="1"/>
                    <text x={pad.l-6} y={y+4} textAnchor="end" fill="rgba(255,255,255,.4)" fontSize="9" fontFamily="'DM Mono',monospace">
                      {fmtCr(maxV*p)}
                    </text>
                  </g>;
                })}
                {/* Area fill */}
                <polygon points={`${pad.l},${pad.t+iH} ${pts} ${xPos(last24.length-1)},${pad.t+iH}`} fill="url(#nwGrad)"/>
                {/* Main line */}
                <polyline points={pts} fill="none" stroke="#c9a84c" strokeWidth="2" strokeLinejoin="round"/>
                {/* Today dot */}
                <circle cx={xPos(last24.length-1)} cy={yPos(nwCur)} r="5" fill="#4caf9a" stroke="#0c1526" strokeWidth="1.5"/>
                <line x1={xPos(last24.length-1)} y1={yPos(cumByMo[last24[last24.length-1]]||0)}
                  x2={xPos(last24.length-1)} y2={yPos(nwCur)}
                  stroke="#4caf9a" strokeWidth="1.2" strokeDasharray="3,2"/>
                {/* Hover dots with value tooltip */}
                {last24.map((m,i)=>{
                  const v=cumByMo[m]||0;
                  const cx=xPos(i),cy=yPos(v);
                  return <g key={m}>
                    <circle cx={cx} cy={cy} r="4" fill="#c9a84c" opacity="0" style={{cursor:"crosshair"}}
                      onMouseEnter={()=>{if(window.__nwSetHov)window.__nwSetHov(i);}}/>
                    {/* Always show value above dot for every other point */}
                    {(i%2===0||i===last24.length-1)&&(
                      <text x={cx} y={cy-8} textAnchor="middle" fill="rgba(201,168,76,.7)" fontSize="7.5" fontFamily="'DM Mono',monospace">
                        {fmtCr(v)}
                      </text>
                    )}
                  </g>;
                })}
                {/* X labels */}
                {last24.map((m,i)=>labels.includes(m)?(
                  <text key={m} x={xPos(i)} y={H-4} textAnchor="middle" fill="rgba(255,255,255,.42)" fontSize="8.5">
                    {new Date(m+"-01").toLocaleDateString("en-IN",{month:"short",year:"2-digit"})}
                  </text>
                ):null)}
              </svg>
              <div style={{display:"flex",gap:"1.5rem",marginTop:".6rem",fontSize:".72rem"}}>
                <div><span style={{color:"rgba(255,255,255,.45)"}}>Invested: </span><span style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>{fmtCr(nwInv)}</span></div>
                <div><span style={{color:"rgba(255,255,255,.45)"}}>Current: </span><span style={{fontFamily:"'DM Mono',monospace",color:"#ffffff"}}>{fmtCr(nwCur)}</span></div>
                <div><span style={{color:"rgba(255,255,255,.45)"}}>Gain: </span><span style={{fontFamily:"'DM Mono',monospace",color:nwCur>=nwInv?"#4caf9a":"#e07c5a"}}>{fmtCr(nwCur-nwInv)} ({fmtPct(nwInv>0?(nwCur-nwInv)/nwInv*100:0)})</span></div>
              </div>
            </div>);
          })()}

          {/* ── WEALTH PROGRESSION (from monthly snapshots) ── */}
          {wealthSnapshots.length>=2&&(()=>{
            const snaps=wealthSnapshots.slice(-24);
            const maxV=Math.max(...snaps.map(s=>Math.max(s.total_current,s.total_invested)))*1.08;
            const W=580,H=220,pad={l:62,r:16,t:14,b:36};
            const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
            const xP=(i)=>pad.l+i*(iW/Math.max(snaps.length-1,1));
            const yP=(v)=>pad.t+iH-((v/maxV)*iH);
            const curPts=snaps.map((s,i)=>`${xP(i)},${yP(s.total_current)}`).join(" ");
            const invPts=snaps.map((s,i)=>`${xP(i)},${yP(s.total_invested)}`).join(" ");
            const fillPts=`${xP(0)},${yP(0)} ${curPts} ${xP(snaps.length-1)},${yP(0)}`;
            const latestSnap=snaps[snaps.length-1];
            const totalGain=latestSnap.total_current-latestSnap.total_invested;
            const totalPct=latestSnap.total_invested>0?((totalGain/latestSnap.total_invested)*100).toFixed(1):"0";
            const monthGrowth=snaps.length>=2?latestSnap.total_current-snaps[snaps.length-2].total_current:0;
            const step=snaps.length>12?4:snaps.length>6?3:2;
            const showLabel=(i)=>i===0||i===snaps.length-1||(i%step===0);
            return(
            <div className="card" style={{marginTop:"1rem"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".8rem",flexWrap:"wrap",gap:".5rem"}}>
                <div className="ctitle" style={{margin:0}}>📈 Wealth Progression</div>
                <div style={{display:"flex",gap:"1rem",fontSize:".68rem"}}>
                  <span style={{color:"rgba(255,255,255,.5)"}}>{snaps.length} months tracked</span>
                  <span style={{color:totalGain>=0?"#4caf9a":"#e07c5a"}}>{totalGain>=0?"+":""}{fmtCr(totalGain)} ({totalPct}%)</span>
                </div>
              </div>
              <div style={{display:"flex",gap:"1rem",marginBottom:".8rem",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:"rgba(76,175,154,.06)",border:"1px solid rgba(76,175,154,.15)"}}>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.45)",textTransform:"uppercase",letterSpacing:".05em"}}>Current Value</div>
                  <div style={{fontSize:".9rem",fontWeight:600,color:"#4caf9a",fontFamily:"'DM Mono',monospace"}}>{fmtCr(latestSnap.total_current)}</div>
                </div>
                <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.15)"}}>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.45)",textTransform:"uppercase",letterSpacing:".05em"}}>Total Invested</div>
                  <div style={{fontSize:".9rem",fontWeight:600,color:"#c9a84c",fontFamily:"'DM Mono',monospace"}}>{fmtCr(latestSnap.total_invested)}</div>
                </div>
                <div style={{flex:1,minWidth:120,padding:".5rem .7rem",borderRadius:8,background:monthGrowth>=0?"rgba(76,175,154,.06)":"rgba(224,124,90,.06)",border:`1px solid ${monthGrowth>=0?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)"}`}}>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.45)",textTransform:"uppercase",letterSpacing:".05em"}}>Month Change</div>
                  <div style={{fontSize:".9rem",fontWeight:600,color:monthGrowth>=0?"#4caf9a":"#e07c5a",fontFamily:"'DM Mono',monospace"}}>{monthGrowth>=0?"+":""}{fmtCr(monthGrowth)}</div>
                </div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block"}}>
                {[0,0.25,0.5,0.75,1].map(f=>{const y=pad.t+iH*(1-f);const val=maxV*f;return<g key={f}><line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth={0.5}/><text x={pad.l-6} y={y+3} fill="rgba(255,255,255,.3)" fontSize={8} textAnchor="end" fontFamily="DM Mono,monospace">{val>=10000000?(val/10000000).toFixed(1)+"Cr":val>=100000?(val/100000).toFixed(0)+"L":Math.round(val).toLocaleString("en-IN")}</text></g>;})}
                <polygon points={fillPts} fill="rgba(76,175,154,.08)"/>
                <polyline points={invPts} fill="none" stroke="#c9a84c" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}/>
                <polyline points={curPts} fill="none" stroke="#4caf9a" strokeWidth={2}/>
                {snaps.map((s,i)=>(<g key={i}><circle cx={xP(i)} cy={yP(s.total_current)} r={snaps.length>15?2:3} fill="#4caf9a"/>{showLabel(i)&&(<text x={xP(i)} y={H-pad.b+14} fill="rgba(255,255,255,.4)" fontSize={7.5} textAnchor={i===0?"start":i===snaps.length-1?"end":"middle"} fontFamily="DM Mono,monospace">{(()=>{const[y,m]=s.snapshot_month.split("-");return["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]+"'"+y.slice(2);})()}</text>)}{s.source==="cas_import"&&<circle cx={xP(i)} cy={yP(s.total_current)-8} r={2} fill="#a084ca" opacity={0.7}/>}</g>))}
                <g transform={`translate(${pad.l},${H-6})`}><line x1={0} y1={0} x2={14} y2={0} stroke="#4caf9a" strokeWidth={2}/><text x={18} y={3} fill="rgba(255,255,255,.4)" fontSize={7}>Current</text><line x1={60} y1={0} x2={74} y2={0} stroke="#c9a84c" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}/><text x={78} y={3} fill="rgba(255,255,255,.4)" fontSize={7}>Invested</text><circle cx={125} cy={0} r={2} fill="#a084ca" opacity={0.7}/><text x={130} y={3} fill="rgba(255,255,255,.4)" fontSize={7}>CAS import</text></g>
              </svg>
              <details style={{marginTop:".6rem"}}>
                <summary style={{fontSize:".68rem",color:"rgba(255,255,255,.45)",cursor:"pointer",userSelect:"none"}}>View monthly data ({snaps.length} snapshots)</summary>
                <div style={{overflowX:"auto",marginTop:".4rem"}}>
                  <table className="ht" style={{fontSize:".7rem"}}><thead><tr><th>Month</th><th className="r">Invested</th><th className="r">Current</th><th className="r">Gain</th><th className="r">Return</th><th>Source</th></tr></thead>
                  <tbody>{[...snaps].reverse().map(s=>{const gain=s.total_current-s.total_invested;const pct=s.total_invested>0?((gain/s.total_invested)*100).toFixed(1):"0";const[y,m]=s.snapshot_month.split("-");const mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1];return<tr key={s.snapshot_month}><td style={{whiteSpace:"nowrap"}}>{mon} {y}</td><td className="r mono">{fmtCr(s.total_invested)}</td><td className="r mono">{fmtCr(s.total_current)}</td><td className={`r mono ${gain>=0?"gain":"loss"}`}>{gain>=0?"+":""}{fmtCr(gain)}</td><td className={`r ${gain>=0?"gain":"loss"}`}>{pct}%</td><td style={{fontSize:".62rem",color:"rgba(255,255,255,.35)"}}>{s.source==="cas_import"?"📥 CAS":s.source==="price_refresh"?"🔄 Refresh":"📝 Manual"}{s.cas_statement_date?` (${s.cas_statement_date})`:""}</td></tr>;})}</tbody></table>
                </div>
              </details>
            </div>);
          })()}
        </>)}

        {/* ── HOLDINGS ── */}
        {tab==="holdings"&&(<div className="card">
          {/* ── Data Freshness Banner ── */}
          {(()=>{
            const srcDates = {};
            for (const h of visH) {
              if (!h.source_date) continue;
              const src = h.source === "cas" ? (h.brokerage_name || "CAS") : (h.source || "manual");
              const mem = allMembers.find(m => m.id === h.member_id);
              const memName = mem?.name || (h._shared_owner ? h._shared_owner : "Unassigned");
              const key = `${src}|${memName}`;
              if (!srcDates[key] || h.source_date > srcDates[key].date) {
                srcDates[key] = { date: h.source_date, src, member: memName };
              }
            }
            const entries = Object.values(srcDates);
            if (entries.length === 0) return null;
            const allSame = entries.every(e => e.date === entries[0].date);
            return (
              <div style={{background:"linear-gradient(135deg,rgba(76,175,154,.08),rgba(160,132,202,.06))",border:"1px solid rgba(76,175,154,.18)",borderRadius:8,padding:".55rem .85rem",marginBottom:".65rem",display:"flex",alignItems:"center",gap:".65rem"}}>
                <div style={{fontSize:"1.15rem",lineHeight:1}}>📅</div>
                <div style={{flex:1}}>
                  {allSame ? (
                    <div style={{fontSize:".75rem",color:"#4caf9a",fontWeight:500}}>
                      Data as on {new Date(entries[0].date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                      <span style={{color:"rgba(255,255,255,.35)",fontWeight:400,marginLeft:".5rem"}}>{entries.length} source{entries.length>1?"s":""}</span>
                    </div>
                  ) : (
                    <div style={{display:"flex",flexWrap:"wrap",gap:".25rem .8rem"}}>
                      {entries.map((e,i) => (
                        <div key={i} style={{fontSize:".72rem"}}>
                          <span style={{color:"rgba(255,255,255,.5)"}}>{e.member}:</span>{" "}
                          <span style={{color:"#4caf9a",fontWeight:500}}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span>
                          <span style={{color:"rgba(255,255,255,.25)",marginLeft:".3rem",fontSize:".62rem"}}>{e.src}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{fontSize:".6rem",color:"rgba(255,255,255,.3)",marginTop:".15rem"}}>NAVs & prices reflect the CAS statement date, not live market</div>
                </div>
              </div>
            );
          })()}
          <div className="tbar">
            <div className={`fchip${filterType==="ALL"?" act":""}`} onClick={()=>setFilterType("ALL")}>All</div>
            {Object.entries(AT).map(([k,v])=>(<div key={k} className={`fchip${filterType===k?" act":""}`} onClick={()=>setFilterType(k)}>{v.icon} {v.label}</div>))}
          </div>
          {visH.length===0?<div className="empty">{demoMode?"No holdings match the current filter":"No holdings yet"} — <span style={{color:"#c9a84c",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setModal("add")}>add to portfolio</span>{!demoMode&&<>{" or "}<span style={{color:"#a084ca",cursor:"pointer",textDecoration:"underline"}} onClick={loadDemoData}>try sample data</span></>}</div>:(<>
            <div className="ht-desktop"><div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",margin:"0 -0.9rem",padding:"0 0.9rem"}}>
              <table className="ht">
                <thead><tr>
                  {[
                    {key:"name",    label:"Asset",       align:""},
                    {key:"ticker",  label:"Ticker",      align:""},
                    {key:"type",    label:"Type",        align:""},
                    {key:"member",  label:"Member",      align:""},
                    {key:"brokerage",label:"Source",     align:""},
                    {key:"units",   label:"Units",       align:"r", tip:"Net units held after all buys minus sells"},
                    {key:"avg",     label:"Avg Price",   align:"r", tip:"Weighted average purchase price across all buy transactions"},
                    {key:"price",   label:"Cur. Price",  align:"r", tip:"Latest market price — live-fetched or manually entered"},
                    {key:"current", label:"Value",       align:"r", tip:"Current market value = units × current price"},
                    {key:"gain",    label:"P&L",         align:"r", tip:"Profit & Loss = current value minus total invested (unrealized)"},
                  ].map(c=>(
                    <th key={c.key} className={c.align} title={c.title||undefined}
                      onClick={()=>toggleSort(c.key)}
                      style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}>
                      {c.label}
                      {c.tip&&<span title={c.tip} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:13,height:13,borderRadius:"50%",border:"1px solid rgba(255,255,255,.15)",fontSize:"8px",color:"rgba(255,255,255,.3)",marginLeft:3,cursor:"help",verticalAlign:"middle",fontStyle:"normal",fontWeight:400}}>?</span>}
                      {sortCol===c.key
                        ? <span style={{marginLeft:3,fontSize:".55rem",opacity:.7}}>{sortDir==="asc"?"▲":"▼"}</span>
                        : <span style={{marginLeft:3,fontSize:".55rem",opacity:.25}}>⇅</span>}
                    </th>
                  ))}
                  <th/>
                </tr></thead>
                <tbody>
                  {(()=>{
                    // Group holdings into 3 categories — CASH split by currency
                    const US_TYPES = new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
                    const IN_TYPES = new Set(["IN_STOCK","IN_ETF","MF"]);
                    const isUSCash = h => h.type === "CASH" && isUSDHolding(h);
                    const isINCash = h => h.type === "CASH" && !isUSDHolding(h);
                    const groups = [
                      { key: "us", label: "US Assets", icon: "$", color: "#5a9ce0", items: visH.filter(h => US_TYPES.has(h.type) || isUSCash(h)) },
                      { key: "in", label: "Indian Assets", icon: "₹", color: "#e07c5a", items: visH.filter(h => IN_TYPES.has(h.type) || isINCash(h)) },
                      { key: "other", label: "Other Assets", icon: "📦", color: "#c9a84c", items: visH.filter(h => !US_TYPES.has(h.type) && !IN_TYPES.has(h.type) && h.type !== "CASH") },
                    ].filter(g => g.items.length > 0);

                    // Total column count: 10 data columns + 1 action = 11
                    const COL_COUNT = 11;

                    return groups.map((grp, gi) => {
                      const grpCur = grp.items.reduce((s, h) => s + (valINRCache.get(h.id)||0), 0);
                      const grpInv = grp.items.reduce((s, h) => s + (invINRCache.get(h.id)||0), 0);
                      const grpG = grpCur - grpInv;
                      const grpP = grpInv > 0 ? (grpG / grpInv) * 100 : 0;
                      return [
                        // Spacer row between groups (skip for first)
                        gi > 0 && <tr key={`spc_${grp.key}`}><td colSpan={11} style={{padding:0,height:"18px",background:"transparent",border:"none"}}/></tr>,
                        // Section header row
                        <tr key={`hdr_${grp.key}`} style={{background:`${grp.color}0D`}}>
                          <td colSpan={8} style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                            <span style={{fontSize:".78rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>
                              {grp.icon} {grp.label}
                            </span>
                            <span style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginLeft:10}}>{grp.items.length} holding{grp.items.length!==1?"s":""}</span>
                          </td>
                          <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:".76rem",color:grp.color,fontWeight:600}}>{fmtCr(grpCur)}</span>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:".68rem",color:"rgba(201,168,76,.75)",fontWeight:600}}>≈ {fmtCrINR(grpCur)}</div>
                          </td>
                          <td className="r" style={{padding:".7rem .65rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}>
                            <span className={`mono${grpG>=0?" gain":" loss"}`} style={{fontSize:".72rem",fontWeight:600}}>{grpG>=0?"+":""}{fmtCr(grpG)} ({fmtPct(grpP)})</span>
                          </td>
                          <td style={{borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`}}/>
                        </tr>,
                        // Holdings rows within this group
                        ...grp.items.map(h => {
                    const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id)||0,g=cur-inv,p=inv>0?(g/inv)*100:0;
                    const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                    const a = h.type==="CASH" ? {..._a, label: isUSDHolding(h)?"Cash USD":"Cash INR", icon: isUSDHolding(h)?"💵":"₹"} : _a;
                    const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                    const isSharedH = h._shared;
                    const sharedOwnerLabel = isSharedH ? h._shared_owner : "";
                    const isLive=!!h.price_fetched_at;
                    const units   = h.net_units ?? h.units ?? null;
                    const avgCost = h.avg_cost  ?? h.purchase_price ?? h.purchase_nav ?? null;
                    const isUS    = isUSDHolding(h);
                    const nativeSym = isUS ? "$" : "₹";
                    const fmtH = n => fmtNative(n, h);  // native formatter for this holding

                    const avgDisplay = avgCost
                      ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"rgba(255,255,255,.85)"}}>
                          {nativeSym}{h.type==="MF"?Number(avgCost).toFixed(4):Number(avgCost).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                        </span>
                      : <span style={{color:"rgba(255,255,255,.35)"}}>—</span>;

                    const rawPrice = h.type==="MF" ? (h.current_nav||h.purchase_nav||null) : (h.current_price||h.purchase_price||null);
                    const curPriceDisplay = rawPrice
                      ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"#ffffff"}}>
                          {nativeSym}{h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}
                        </span>
                      : <span style={{color:"rgba(255,255,255,.35)"}}>—</span>;

                    const brokerLabel = h.brokerage_name && h.brokerage_name !== "Unknown" ? h.brokerage_name : null;
                    const src = h.source || "manual";
                    const srcLabel = src === "snaptrade" ? "SnapTrade" : src === "csv" || src === "import" ? "CSV" : src === "cas" ? "CAS" : "Manual";

                    return(
                      <tr key={h.id}>
                        <td>
                          <div className="hn">{h.name}</div>
                          <div className="hm">{mn}</div>
                        </td>
                        <td>
                          {(h.ticker||h.scheme_code)
                            ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".73rem",color:"#c9a84c",background:"rgba(201,168,76,.08)",padding:"2px 7px",borderRadius:3,border:"1px solid rgba(201,168,76,.2)"}}>
                                {h.ticker||`SC:${h.scheme_code}`}
                              </span>
                            : <span style={{fontSize:".7rem",color:"rgba(255,255,255,.3)"}}>—</span>
                          }
                        </td>
                        <td><span className="tbadge2" style={{background:a.color+"22",color:a.color}}>{a.icon} {a.label}</span></td>
                        <td className="dim">
                          {mn}{isSharedH && <span style={{fontSize:".55rem",marginLeft:4,padding:".1rem .3rem",borderRadius:3,background:"rgba(167,139,250,.1)",color:"rgba(167,139,250,.6)"}}>👁 {sharedOwnerLabel}</span>}
                        </td>
                        <td>
                          {brokerLabel
                            ? <div><span style={{fontSize:".62rem",background:"rgba(167,139,250,.08)",color:"rgba(167,139,250,.7)",padding:"2px 6px",borderRadius:3,border:"1px solid rgba(167,139,250,.15)"}}>{brokerLabel}</span>
                                <div style={{fontSize:".55rem",color:"rgba(255,255,255,.3)",marginTop:2}}>{srcLabel}</div></div>
                            : <span style={{fontSize:".62rem",color:"rgba(255,255,255,.3)"}}>{srcLabel}</span>
                          }
                        </td>
                        <td className="r">
                          {units!=null
                            ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"rgba(255,255,255,.85)"}}>{Number(units).toLocaleString("en-IN",{maximumFractionDigits:4})}</span>
                            : <span style={{color:"rgba(255,255,255,.35)"}}>—</span>}
                        </td>
                        <td className="r">{avgDisplay}</td>
                        <td className="r">
                          <div>{curPriceDisplay}</div>
                          {isLive&&<div style={{fontSize:".52rem",color:"#4caf9a",marginTop:1}}>● {ago(h.price_fetched_at)}</div>}
                        </td>
                        <td className="r">
                          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:".78rem"}}>{fmtCrNative(cur, h)}</div>
                        </td>
                        <td className="r">
                          <div className={`mono${g>=0?" gain":" loss"}`} style={{fontSize:".78rem"}}>{g>=0?"+":""}{fmtNative(Math.abs(g), h)}</div>
                          <div className={`mono${p>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(p)}</div>
                        </td>
                        <td>
                          <div style={{display:"flex",gap:3}}>
                            <button className="delbtn" title="View transactions" onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}} style={{color:(h.transactions||[]).length>0?"#a084ca":"rgba(255,255,255,.38)"}}>
                              📋{(h.transactions||[]).length>0?` ${(h.transactions||[]).length}`:""}
                            </button>
                            {!isSharedH && <>
                              <button className="delbtn" title="Attach documents" onClick={()=>setArtifactHolding(h)} style={{color:(h.artifacts||[]).length>0?"#c9a84c":"rgba(255,255,255,.38)"}}>
                                📎{(h.artifacts||[]).length>0?` ${(h.artifacts||[]).length}`:""}
                              </button>
                              <button className="delbtn" title="Modify holding" style={{color:"rgba(90,156,224,.5)"}} onClick={()=>editH(h)}>✎</button>
                              <button className="delbtn" title="Delete holding" onClick={()=>deleteHolding(h.id)}>✕</button>
                            </>}
                          </div>
                        </td>
                      </tr>
                    );
                        })
                      ];
                    });
                  })()}
                </tbody>
                {/* Totals footer row */}
                {visH.length>0&&(()=>{
                  const totI=visH.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
                  const totC=visH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
                  const totG=totC-totI;
                  const totP=totI>0?(totG/totI)*100:0;
                  return(
                  <tfoot>
                    <tr style={{borderTop:"2px solid rgba(201,168,76,.2)"}}>
                      <td colSpan={8} style={{padding:".75rem .65rem",fontSize:".7rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.42)",fontWeight:600}}>Total · {visH.length} holding{visH.length!==1?"s":""}</td>
                      <td className="r" style={{padding:".75rem .65rem"}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#c9a84c",fontSize:".88rem"}}>{fmtCr(totC)}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"rgba(201,168,76,.8)",marginTop:1,fontWeight:600}}>≈ {fmtCrINR(totC)}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:1}}>inv. {fmtCr(totI)}</div>
                      </td>
                      <td className="r" style={{padding:".75rem .65rem"}}>
                        <div className={`mono${totG>=0?" gain":" loss"}`} style={{fontWeight:600,fontSize:".83rem"}}>{totG>=0?"+":""}{fmtCr(totG)}</div>
                        <div className={`mono${totP>=0?" gain":" loss"}`} style={{fontSize:".65rem",marginTop:1}}>{fmtPct(totP)}</div>
                      </td>
                      <td style={{padding:".75rem .65rem"}}/>
                    </tr>
                  </tfoot>);
                })()}
              </table>
            </div></div>{/* end ht-desktop */}
            {/* ── Mobile holding cards ── */}
            <div className="m-holdings-list">
              {(()=>{
                const US_T=new Set(["US_STOCK","US_ETF","US_BOND","CRYPTO"]);
                const IN_T=new Set(["IN_STOCK","IN_ETF","MF"]);
                const isUSCash=h=>h.type==="CASH"&&isUSDHolding(h);
                const isINCash=h=>h.type==="CASH"&&!isUSDHolding(h);
                const groups=[
                  {key:"us",label:"US Assets",icon:"$",color:"#5a9ce0",items:visH.filter(h=>US_T.has(h.type)||isUSCash(h))},
                  {key:"in",label:"Indian Assets",icon:"₹",color:"#e07c5a",items:visH.filter(h=>IN_T.has(h.type)||isINCash(h))},
                  {key:"other",label:"Other Assets",icon:"📦",color:"#c9a84c",items:visH.filter(h=>!US_T.has(h.type)&&!IN_T.has(h.type)&&h.type!=="CASH")},
                ].filter(g=>g.items.length>0);
                return groups.map((grp,gi)=>{
                  const grpCur=grp.items.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
                  const grpInv=grp.items.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
                  const grpG=grpCur-grpInv;
                  const grpP=grpInv>0?(grpG/grpInv)*100:0;
                  return(<div key={grp.key} style={gi>0?{marginTop:"1rem"}:{}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:".6rem .5rem",marginBottom:".35rem",borderTop:`2px solid ${grp.color}44`,borderBottom:`1px solid ${grp.color}33`,background:`${grp.color}0D`,borderRadius:"4px 4px 0 0"}}>
                      <span style={{fontSize:".76rem",letterSpacing:".1em",textTransform:"uppercase",color:grp.color,fontWeight:700}}>{grp.icon} {grp.label} <span style={{color:"rgba(255,255,255,.3)",fontWeight:400}}>{grp.items.length}</span></span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:grp.color,fontWeight:600}}>{fmtCr(grpCur)} <span className={grpG>=0?"gain":"loss"} style={{fontSize:".62rem"}}>{grpG>=0?"+":""}{fmtPct(grpP)}</span></span>
                    </div>
                    {grp.items.map(h=>{
                      const cur=valNativeCache.get(h.id)||0,inv=invNativeCache.get(h.id)||0,g=cur-inv,p=inv>0?(g/inv)*100:0;
                      const _a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
                      const a=h.type==="CASH"?{..._a,label:isUSDHolding(h)?"Cash USD":"Cash INR",icon:isUSDHolding(h)?"💵":"₹"}:_a;
                      const mn=allMembers.find(m=>m.id===h.member_id)?.name||"";
                      const isSharedH=h._shared;
                      const units=h.net_units??h.units??null;
                      const isUS=isUSDHolding(h);
                      const nativeSym=isUS?"$":"₹";
                      const isExp=expandedHolding===h.id;
                      const rawPrice=h.type==="MF"?(h.current_nav||h.purchase_nav||null):(h.current_price||h.purchase_price||null);
                      return(<div key={h.id} className="m-hc" onClick={()=>setExpandedHolding(isExp?null:h.id)}>
                        <div className="m-hc-top">
                          <div style={{flex:1,minWidth:0}}>
                            <div className="m-hc-name">{h.name}</div>
                            <div className="m-hc-ticker">
                              {h.ticker||h.scheme_code||""}{mn&&<span style={{opacity:.5}}> · {mn}</span>}
                            </div>
                          </div>
                          <span className="tbadge2" style={{background:a.color+"22",color:a.color,flexShrink:0,marginLeft:8}}>{a.icon} {a.label}</span>
                        </div>
                        <div className="m-hc-grid">
                          <div className="m-hc-cell">
                            <span className="m-hc-lbl">Current Value</span>
                            <span className="m-hc-val" style={{fontWeight:600,color:"#c9a84c"}}>{fmtCrNative(cur,h)}</span>
                          </div>
                          <div className="m-hc-cell" style={{textAlign:"right"}}>
                            <span className="m-hc-lbl">P&L</span>
                            <span className={`m-hc-val ${g>=0?"gain":"loss"}`} style={{fontWeight:600}}>
                              {g>=0?"+":""}{fmtNative(Math.abs(g),h)} ({fmtPct(p)})
                            </span>
                          </div>
                          {isExp&&<>
                            <div className="m-hc-cell">
                              <span className="m-hc-lbl">Units</span>
                              <span className="m-hc-val">{units!=null?Number(units).toLocaleString(undefined,{maximumFractionDigits:4}):"—"}</span>
                            </div>
                            <div className="m-hc-cell" style={{textAlign:"right"}}>
                              <span className="m-hc-lbl">Invested</span>
                              <span className="m-hc-val">{fmtCrNative(inv,h)}</span>
                            </div>
                            <div className="m-hc-cell">
                              <span className="m-hc-lbl">Cur. Price</span>
                              <span className="m-hc-val">{rawPrice?`${nativeSym}${h.type==="MF"?Number(rawPrice).toFixed(4):Number(rawPrice).toLocaleString(isUS?"en-US":"en-IN",{maximumFractionDigits:2})}`:"—"}</span>
                            </div>
                            <div className="m-hc-cell" style={{textAlign:"right"}}>
                              <span className="m-hc-lbl">Source</span>
                              <span className="m-hc-val" style={{fontSize:".68rem"}}>{h.source==="snaptrade"?"SnapTrade":h.source==="csv"||h.source==="import"?"CSV":h.source==="cas"?"CAS":"Manual"}</span>
                            </div>
                          </>}
                        </div>
                        {!isExp&&<div style={{textAlign:"center",marginTop:".4rem",fontSize:".56rem",color:"rgba(255,255,255,.2)",letterSpacing:".08em",textTransform:"uppercase"}}>tap for details</div>}
                        {isExp&&<div className="m-hc-actions" onClick={e=>e.stopPropagation()}>
                          <button title="Transactions" onClick={()=>{setTxnForm({...BT,holding_id:h.id});setTxnHolding(h);}} style={{color:(h.transactions||[]).length>0?"#a084ca":"rgba(255,255,255,.3)"}}>📋{(h.transactions||[]).length>0?` ${(h.transactions||[]).length}`:""}</button>
                          {!isSharedH&&<>
                            <button title="Documents" onClick={()=>setArtifactHolding(h)} style={{color:(h.artifacts||[]).length>0?"#c9a84c":"rgba(255,255,255,.3)"}}>📎{(h.artifacts||[]).length>0?` ${(h.artifacts||[]).length}`:""}</button>
                            <button title="Edit" onClick={()=>editH(h)} style={{color:"rgba(90,156,224,.5)"}}>✎</button>
                            <button title="Delete" onClick={()=>deleteHolding(h.id)} style={{color:"rgba(224,124,90,.4)"}}>✕</button>
                          </>}
                        </div>}
                      </div>);
                    })}
                  </div>);
                });
              })()}
              {/* Mobile totals */}
              {visH.length>0&&(()=>{
                const totI=visH.reduce((s,h)=>s+(invINRCache.get(h.id)||0),0);
                const totC=visH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
                const totG=totC-totI;const totP=totI>0?(totG/totI)*100:0;
                return(<div className="m-hc-totals">
                  <div><div className="m-hc-lbl">{visH.length} holding{visH.length!==1?"s":""} · Invested</div><div className="m-hc-val" style={{color:"rgba(255,255,255,.6)",marginTop:".15rem"}}>{fmtCr(totI)}</div></div>
                  <div style={{textAlign:"right"}}><div className="m-hc-lbl">Current · P&L</div><div className="m-hc-val" style={{color:"#c9a84c",marginTop:".15rem"}}>{fmtCr(totC)}</div><div className={`m-hc-val ${totG>=0?"gain":"loss"}`} style={{fontWeight:600,fontSize:".75rem"}}>{totG>=0?"+":""}{fmtCr(totG)} ({fmtPct(totP)})</div></div>
                </div>);
              })()}
            </div>
          </>)}
          <div style={{marginTop:"1rem",padding:".75rem 1rem",background:"rgba(255,255,255,.02)",borderRadius:8,fontSize:".72rem",color:"rgba(255,255,255,.45)",lineHeight:1.6}}>
            <strong style={{color:"rgba(255,255,255,.65)"}}>Live prices:</strong> Add NSE ticker (e.g. <code style={{color:"#c9a84c"}}>RELIANCE</code>) or AMFI scheme code (e.g. <code style={{color:"#c9a84c"}}>119551</code>) when adding a holding, then click <strong style={{color:"rgba(255,255,255,.65)"}}>⟳ Live Prices</strong> to auto-fetch. 📎 button attaches contract notes, statements, or receipts to any holding.
          </div>
        </div>)}

        {/* ── GOALS ── */}
        {tab==="goals"&&(()=>{
          const sortedGoals=[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99));
          function goalCur(g){
            const lt=g.linkedTypes||[];
            const lm=g.linkedMembers||["all"];
            const memberH = lm.includes("all")||lm.length===0 ? allHoldings : allHoldings.filter(h=>lm.includes(h.member_id));
            if(lt.length>0){
              const typeSet=new Set(lt);
              return memberH.filter(h=>typeSet.has(h.type)).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            }
            return memberH.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
          }
          // Goal status: On Track / Behind / Needs Attention / Achieved / Overdue
          function goalStatus(g, cur) {
            const prog = g.targetAmount > 0 ? cur / g.targetAmount : 0;
            if (prog >= 1) return { label: "Achieved", color: "#1d9e75" };
            const msLeft = Math.max(0, new Date(g.targetDate) - new Date());
            const yLeft = msLeft / (864e5 * 365.25);
            if (yLeft <= 0) return { label: "Overdue", color: "#e07c5a" };
            const monthly = g.monthlyContribution || 0;
            const projectedSIP = monthly * yLeft * 12;
            const r = 0.10;
            const projGrowth = cur * Math.pow(1 + r, yLeft) + (monthly > 0 ? projectedSIP * (1 + r * yLeft / 2) : 0);
            if (projGrowth >= g.targetAmount * 0.95) return { label: "On track", color: "#1d9e75" };
            if (projGrowth >= g.targetAmount * 0.7) return { label: "Needs attention", color: "#d4a017" };
            return { label: "Behind", color: "#e07c5a" };
          }

          // Detect asset types allocated to multiple goals
          const typeGoalMap = {};
          goals.forEach(g=>(g.linkedTypes||[]).forEach(t=>{
            if(!typeGoalMap[t]) typeGoalMap[t]=[];
            typeGoalMap[t].push(g.name);
          }));
          const doubleAllocated = Object.entries(typeGoalMap).filter(([,gs])=>gs.length>1);
          return(<>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem",flexWrap:"wrap",gap:".7rem"}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"#ffffff"}}>Financial Goals</div>
            <div style={{display:"flex",gap:".5rem"}}>
              {goals.length>0&&<button className="btn-o" onClick={()=>setModal("goalplan")}>✦ Fulfillment Plan</button>}
              <button className="btn-sm" onClick={()=>{setGoalForm({...BG,priority:goals.length+1});setEditGoalId(null);setModal("goal");}}>+ New Goal</button>
            </div>
          </div>

          {/* Goal summary bar */}
          {goals.length>0&&(()=>{
            const statuses=sortedGoals.map(g=>goalStatus(g,goalCur(g)));
            const onTrack=statuses.filter(s=>s.label==="On track"||s.label==="Achieved").length;
            const behind=statuses.filter(s=>s.label==="Behind"||s.label==="Overdue").length;
            const needsAttn=statuses.filter(s=>s.label==="Needs attention").length;
            const totalTarget=goals.reduce((s,g)=>s+g.targetAmount,0);
            const totalFunded=sortedGoals.reduce((s,g)=>s+goalCur(g),0);
            const pct=totalTarget>0?(totalFunded/totalTarget*100).toFixed(0):0;
            return(
            <div style={{marginBottom:"1rem",padding:".55rem .85rem",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,display:"flex",gap:"1.5rem",flexWrap:"wrap",fontSize:".72rem",color:"rgba(255,255,255,.55)",alignItems:"center"}}>
              <span>{goals.length} goal{goals.length!==1?"s":""}</span>
              {onTrack>0&&<span style={{color:"#1d9e75"}}>{onTrack} on track</span>}
              {needsAttn>0&&<span style={{color:"#d4a017"}}>{needsAttn} needs attention</span>}
              {behind>0&&<span style={{color:"#e07c5a"}}>{behind} behind</span>}
              <span style={{marginLeft:"auto"}}>Target: <span style={{color:"#fff",fontFamily:"'DM Mono',monospace"}}>{fmtCr(totalTarget)}</span></span>
              <span>Funded: <span style={{color:"#c9a84c",fontFamily:"'DM Mono',monospace"}}>{pct}%</span></span>
            </div>);
          })()}

          {goals.length===0&&<div className="card empty">Set your first financial milestone</div>}

          {doubleAllocated.length>0&&(
            <div style={{marginBottom:"1rem",padding:".55rem .85rem",background:"rgba(224,124,90,.06)",border:"1px solid rgba(224,124,90,.2)",borderRadius:8,fontSize:".72rem",color:"#e07c5a",lineHeight:1.6}}>
              ⚠ Double-counted: {doubleAllocated.map(([t,gs])=>`${AT[t]?.icon||""} ${AT[t]?.label||t} → ${gs.join(" & ")}`).join(" · ")}
              <span style={{color:"rgba(255,255,255,.4)",marginLeft:6}}>Same asset type in multiple goals inflates total funded %</span>
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:"1rem"}}>
            {sortedGoals.map((g,idx)=>{
              const cur=goalCur(g);
              const prog=Math.min((cur/g.targetAmount)*100,100);
              const rem=Math.max(0,g.targetAmount-cur);
              const yLeft=((Math.max(0,new Date(g.targetDate)-new Date()))/(864e5*365.25)).toFixed(1);
              const lm=g.linkedMembers||["all"];
              const memberNames=lm.includes("all")?"All members":lm.map(id=>members.find(m=>m.id===id)?.name||"?").join(", ");
              const monthly=g.monthlyContribution||0;
              const st=goalStatus(g,cur);
              return(
              <div key={g.id} className="card" style={{borderTop:`3px solid ${g.color}`,position:"relative"}}>
                {/* Priority badge + status pill */}
                <div style={{display:"flex",alignItems:"center",gap:".35rem",marginBottom:".55rem"}}>
                  <div style={{background:`${g.color}22`,border:`1px solid ${g.color}55`,borderRadius:3,padding:"1px 7px",fontSize:".6rem",letterSpacing:".08em",color:g.color,fontWeight:600}}>P{g.priority||idx+1}</div>
                  <div style={{background:st.color+"18",border:`1px solid ${st.color}44`,borderRadius:10,padding:"1px 8px",fontSize:".58rem",color:st.color,fontWeight:500}}>{st.label}</div>
                  <span style={{fontSize:".62rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.28)",marginLeft:".15rem"}}>{g.category}</span>
                </div>
                {/* Controls — top right */}
                <div style={{position:"absolute",top:8,right:8,display:"flex",gap:".2rem"}}>
                  <button className="delbtn" title="Move up in priority" onClick={()=>setGoals(p=>{const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===0)return p;const np=[...s];[np[i-1],np[i]]=[np[i],np[i-1]];return np.map((x,j)=>({...x,priority:j+1}));})}>↑</button>
                  <button className="delbtn" title="Move down in priority" onClick={()=>setGoals(p=>{const s=[...p].sort((a,b)=>(a.priority||99)-(b.priority||99));const i=s.findIndex(x=>x.id===g.id);if(i===s.length-1)return p;const np=[...s];[np[i],np[i+1]]=[np[i+1],np[i]];return np.map((x,j)=>({...x,priority:j+1}));})}>↓</button>
                  <button className="delbtn" title="Edit goal" style={{color:"rgba(90,156,224,.5)"}} onClick={()=>{setGoalForm({name:g.name,targetAmount:g.targetAmount,targetDate:g.targetDate,linkedMembers:g.linkedMembers||["all"],linkedTypes:g.linkedTypes||[],category:g.category,color:g.color,notes:g.notes||"",priority:g.priority||idx+1,monthlyContribution:g.monthlyContribution||""});setEditGoalId(g.id);setModal("goal");}}>✎</button>
                  <button className="delbtn" title="Delete goal" onClick={()=>setGoals(p=>p.filter(x=>x.id!==g.id))}>✕</button>
                </div>

                {/* Goal name */}
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",color:"#ffffff",marginBottom:".2rem"}}>{g.name}</div>
                {g.notes&&<div style={{fontSize:".72rem",color:"rgba(255,255,255,.4)",marginBottom:".6rem"}}>{g.notes}</div>}

                {/* Funded by: members + asset types */}
                <div style={{marginBottom:".5rem",fontSize:".62rem",color:"rgba(255,255,255,.35)",letterSpacing:".04em",textTransform:"uppercase",fontWeight:500}}>Funded by</div>
                <div style={{marginBottom:".65rem",display:"flex",flexWrap:"wrap",gap:".35rem"}}>
                  <span style={{fontSize:".65rem",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"2px 9px",color:"rgba(255,255,255,.55)"}}>
                    👤 {memberNames}
                  </span>
                  {(g.linkedTypes||[]).length>0?g.linkedTypes.map(t=>{
                    const a=AT[t]||{icon:"📦",color:"#888",label:t};
                    const isDouble=typeGoalMap[t]?.length>1;
                    return(
                    <span key={t} style={{fontSize:".6rem",background:a.color+"15",border:`1px solid ${a.color}${isDouble?"88":"44"}`,
                      borderRadius:4,padding:"2px 7px",color:a.color,fontWeight:500}}>
                      {a.icon} {a.label}{isDouble&&<span style={{color:"#e07c5a",marginLeft:3}} title={`Also in: ${typeGoalMap[t].filter(n=>n!==g.name).join(", ")}`}>⚠</span>}
                    </span>);
                  }):(
                    <span style={{fontSize:".6rem",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px",color:"rgba(255,255,255,.4)",display:"flex",alignItems:"center",gap:".25rem"}}>
                      <span style={{fontSize:".7rem",opacity:.6}}>ℹ</span> Entire portfolio
                    </span>
                  )}
                </div>

                {/* Progress */}
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".45rem"}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"1.05rem",color:g.color}}>{fmtCr(cur)}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:".82rem",color:"rgba(255,255,255,.5)"}}>of {fmtCr(g.targetAmount)}</span>
                </div>
                <div className="gbbg"><div className="gbfill" style={{width:`${prog}%`,background:g.color}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:".55rem",fontSize:".7rem"}}>
                  <span style={{color:"rgba(255,255,255,.5)"}}>Remaining <span style={{color:"#ffffff",fontFamily:"'DM Mono',monospace"}}>{fmtCr(rem)}</span></span>
                  <span style={{color:"rgba(255,255,255,.5)"}}>{yLeft}y · {prog.toFixed(0)}%</span>
                </div>

                {/* Monthly contribution if set */}
                {monthly>0&&(
                  <div style={{marginTop:".65rem",padding:".4rem .7rem",background:"rgba(255,255,255,.03)",borderRadius:5,fontSize:".68rem",color:"rgba(255,255,255,.5)"}}>
                    Monthly SIP: <span style={{fontFamily:"'DM Mono',monospace",color:"rgba(255,255,255,.85)"}}>₹{monthly.toLocaleString("en-IN")}</span>
                  </div>
                )}
              </div>);
            })}
          </div>
          </>);
        })()}

        {/* ── STRATEGY (combined Alerts + Allocation) ── */}
        {tab==="strategy"&&(()=>{
          const quietAlerts = alerts.filter(a=>a.active && !trigAlerts.find(t=>t.id===a.id));
          const inactiveAlerts = alerts.filter(a=>!a.active);

          // ── Rebalance computation ──
          const rHoldings = rebalMember==="all" ? allHoldings : allHoldings.filter(h=>h.member_id===rebalMember);
          const rTotal    = rHoldings.reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
          const cash      = +rebalCash||0;
          const totalWithCash = rTotal + cash;
          const curAlloc = {};
          for(const h of rHoldings){ curAlloc[h.type] = (curAlloc[h.type]||0) + (valINRCache.get(h.id)||0); }
          const tSum = Object.values(targetAlloc).reduce((s,v)=>s+(+v||0),0);
          const normTarget = {};
          for(const [k,v] of Object.entries(targetAlloc)){ normTarget[k] = tSum>0 ? (+v||0)/tSum*100 : 0; }
          const trades = Object.keys(AT).map(type=>{
            const cur = curAlloc[type]||0;
            const curPct = rTotal>0?(cur/rTotal)*100:0;
            const tgtPct = normTarget[type]||0;
            const tgtAmt = totalWithCash * (tgtPct/100);
            const delta  = tgtAmt - cur;
            return { type, cur, curPct, tgtPct, tgtAmt, delta };
          }).filter(r=>r.tgtPct>0||r.cur>0);
          const totalBuy  = trades.filter(t=>t.delta>500).reduce((s,t)=>s+t.delta,0);
          const totalSell = trades.filter(t=>t.delta<-500).reduce((s,t)=>s+Math.abs(t.delta),0);
          const activeTypes = new Set(trades.map(t=>t.type));
          const maxPct = Math.max(...trades.map(x=>Math.max(x.curPct,x.tgtPct)),1);

          return(<>
            {/* ═══ SECTION 1: TRIGGERED ALERTS ═══ */}
            {trigAlerts.length>0&&(
              <div style={{marginBottom:"1.2rem",padding:"1rem",borderRadius:8,background:"rgba(224,124,90,.06)",border:"1px solid rgba(224,124,90,.25)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".7rem"}}>
                  <div style={{fontSize:".72rem",letterSpacing:".1em",textTransform:"uppercase",color:"#e07c5a",fontWeight:600}}>⚠ {trigAlerts.length} Alert{trigAlerts.length>1?"s":""} Triggered</div>
                </div>
                {trigAlerts.map(a=>{
                  const rule = alerts.find(r=>r.id===a.id);
                  const curVal = (()=>{
                    if(!rule) return null;
                    if(rule.type==="RETURN_TARGET") return totPct;
                    const v = allHoldings.filter(h=>h.type===rule.assetType).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
                    return allCur>0?(v/allCur)*100:0;
                  })();
                  return(
                  <div key={a.id} style={{display:"flex",alignItems:"center",gap:".8rem",padding:".7rem .85rem",background:"rgba(224,124,90,.08)",borderRadius:6,marginBottom:".4rem",border:"1px solid rgba(224,124,90,.18)"}}>
                    <div style={{fontSize:"1.1rem"}}>⚠️</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:".82rem",color:"#e07c5a",fontWeight:500}}>{a.label}</div>
                      <div style={{fontSize:".68rem",color:"rgba(224,124,90,.6)",marginTop:2}}>
                        {rule?.type==="RETURN_TARGET"
                          ? `Portfolio return ${curVal!==null?curVal.toFixed(1)+"% ":""}is below ${rule.threshold}% target`
                          : `${rule?.type==="CONCENTRATION"?"Below":"Above"} ${rule?.threshold}% threshold${curVal!==null?" — currently "+curVal.toFixed(1)+"%":""}`}
                      </div>
                    </div>
                    <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                      style={{background:"none",border:"1px solid rgba(224,124,90,.3)",borderRadius:4,padding:"3px 10px",fontSize:".65rem",cursor:"pointer",color:"rgba(224,124,90,.7)"}}>Snooze</button>
                  </div>);
                })}
              </div>
            )}

            {/* ═══ SECTION 2: ALERT RULES ═══ */}
            <div style={{marginBottom:"1.2rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".7rem"}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"#ffffff"}}>Alert Rules</div>
                <button className="btn-sm" onClick={()=>{setAlertForm(BA);setModal("alert");}}>+ New Alert</button>
              </div>

              {alerts.length===0?(
                <div className="card" style={{padding:"1.2rem",textAlign:"center"}}>
                  <div style={{fontSize:".78rem",color:"rgba(255,255,255,.45)",marginBottom:".4rem"}}>No alert rules configured</div>
                  <div style={{fontSize:".65rem",color:"rgba(255,255,255,.3)"}}>Create alerts to monitor allocation drift, concentration risk, or return targets</div>
                </div>
              ):(
                <div className="card">
                  {/* Active triggered alerts (already shown above, just list rule inline) */}
                  {alerts.filter(a=>a.active && trigAlerts.find(t=>t.id===a.id)).map(a=>(
                    <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".55rem .7rem",borderRadius:5,marginBottom:".35rem",background:"rgba(224,124,90,.04)",border:"1px solid rgba(224,124,90,.15)"}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:"#e07c5a",flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:".78rem",color:"#e07c5a"}}>{a.label}</div>
                        <div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under-weight below ":"Over-weight above "}{a.threshold}%{a.type==="RETURN_TARGET"?" return target":""}</div>
                      </div>
                      <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                        style={{background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"#4caf9a"}}>ON</button>
                      <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
                    </div>
                  ))}

                  {/* Active non-triggered alerts */}
                  {quietAlerts.map(a=>(
                    <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".55rem .7rem",borderRadius:5,marginBottom:".35rem",background:"rgba(76,175,154,.03)",border:"1px solid rgba(76,175,154,.1)"}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:"#4caf9a",flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:".78rem",color:"rgba(255,255,255,.75)"}}>{a.label}</div>
                        <div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under-weight below ":"Over-weight above "}{a.threshold}%{a.type==="RETURN_TARGET"?" return target":""}</div>
                      </div>
                      <span style={{fontSize:".6rem",color:"rgba(76,175,154,.6)",padding:"2px 6px",borderRadius:3,background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.15)"}}>✓ Passing</span>
                      <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                        style={{background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"#4caf9a"}}>ON</button>
                      <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
                    </div>
                  ))}

                  {/* Inactive/disabled alerts — collapsible */}
                  {inactiveAlerts.length>0&&(
                    <>
                      <div onClick={()=>setShowQuietAlerts(p=>!p)}
                        style={{display:"flex",alignItems:"center",gap:".5rem",padding:".45rem .7rem",marginTop:".3rem",cursor:"pointer",borderRadius:5,background:"rgba(255,255,255,.02)"}}>
                        <span style={{fontSize:".6rem",color:"rgba(255,255,255,.3)",transform:showQuietAlerts?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}>▶</span>
                        <span style={{fontSize:".68rem",color:"rgba(255,255,255,.35)"}}>{inactiveAlerts.length} paused rule{inactiveAlerts.length>1?"s":""}</span>
                      </div>
                      {showQuietAlerts&&inactiveAlerts.map(a=>(
                        <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".45rem .7rem",borderRadius:5,marginBottom:".2rem",opacity:.55}}>
                          <div style={{width:7,height:7,borderRadius:"50%",background:"rgba(255,255,255,.18)",flexShrink:0}}/>
                          <div style={{flex:1}}>
                            <div style={{fontSize:".75rem",color:"rgba(255,255,255,.5)"}}>{a.label}</div>
                            <div style={{fontSize:".6rem",color:"rgba(255,255,255,.25)",marginTop:1}}>{a.type==="CONCENTRATION"?"Under ":"Over "}{a.threshold}%</div>
                          </div>
                          <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active}:x))}
                            style={{background:"none",border:"1px solid rgba(255,255,255,.08)",borderRadius:4,padding:"2px 9px",fontSize:".65rem",cursor:"pointer",color:"rgba(255,255,255,.3)"}}>OFF</button>
                          <button className="delbtn" onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ═══ DIVIDER ═══ */}
            <div style={{height:1,background:"rgba(255,255,255,.06)",margin:"0.5rem 0 1.2rem"}}/>

            {/* ═══ SECTION 3: ASSET ALLOCATION & REBALANCE ═══ */}
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.05rem",color:"#ffffff",marginBottom:".8rem"}}>Asset Allocation</div>

            {/* Member selector + Cash — compact top bar */}
            <div style={{display:"flex",gap:"1rem",alignItems:"flex-end",marginBottom:"1rem",flexWrap:"wrap"}}>
              <div>
                <label className="flbl">Member</label>
                <div style={{display:"flex",gap:".35rem",marginTop:".3rem"}}>
                  {["all",...members.map(m=>m.id)].map(id=>(
                    <div key={id} onClick={()=>setRebalMember(id)}
                      style={{padding:".28rem .6rem",borderRadius:4,cursor:"pointer",fontSize:".72rem",
                        background:rebalMember===id?"rgba(201,168,76,.16)":"rgba(255,255,255,.04)",
                        border:`1px solid ${rebalMember===id?"rgba(201,168,76,.4)":"rgba(255,255,255,.1)"}`,
                        color:rebalMember===id?"#c9a84c":"rgba(255,255,255,.55)"}}>
                      {id==="all"?"All":members.find(m=>m.id===id)?.name}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{flex:"0 0 180px"}}>
                <label className="flbl">Fresh Cash to Deploy</label>
                <FmtInput value={rebalCash} placeholder="e.g. 50000"
                  onChange={e=>setRebalCash(e.target.value)} style={{marginTop:".3rem"}}/>
              </div>
              <div style={{flex:1,textAlign:"right"}}>
                <div style={{fontSize:".62rem",color:"rgba(255,255,255,.45)",letterSpacing:".08em",textTransform:"uppercase"}}>Portfolio</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1.15rem",color:"#ffffff"}}>{fmtCr(rTotal)}</div>
                {cash>0&&<div style={{fontSize:".65rem",color:"rgba(201,168,76,.6)"}}>+ {fmtCr(cash)} cash</div>}
              </div>
            </div>

            {/* Quick Strategy Presets */}
            <div style={{display:"flex",gap:".4rem",marginBottom:"1rem",flexWrap:"wrap"}}>
              <span style={{fontSize:".62rem",color:"rgba(255,255,255,.4)",alignSelf:"center",marginRight:".2rem"}}>STRATEGY:</span>
              {[
                {name:"Conservative",desc:"Low risk, FD/PPF heavy",alloc:{IN_STOCK:15,MF:20,IN_ETF:5,US_STOCK:0,US_ETF:0,US_BOND:5,CRYPTO:0,FD:25,PPF:15,EPF:15,REAL_ESTATE:0}},
                {name:"Balanced",desc:"Mix of equity & debt",alloc:{IN_STOCK:25,MF:25,IN_ETF:5,US_STOCK:8,US_ETF:5,US_BOND:0,CRYPTO:2,FD:10,PPF:10,EPF:10,REAL_ESTATE:0}},
                {name:"Aggressive",desc:"Equity & crypto heavy",alloc:{IN_STOCK:30,MF:25,IN_ETF:5,US_STOCK:15,US_ETF:5,US_BOND:0,CRYPTO:5,FD:5,PPF:5,EPF:5,REAL_ESTATE:0}},
                {name:"Global",desc:"Cross-border diversified",alloc:{IN_STOCK:20,MF:15,IN_ETF:5,US_STOCK:20,US_ETF:15,US_BOND:0,CRYPTO:5,FD:5,PPF:5,EPF:5,REAL_ESTATE:5}},
              ].map(p=>(
                <div key={p.name} onClick={()=>setTargetAlloc(p.alloc)}
                  title={p.desc}
                  style={{padding:".3rem .65rem",borderRadius:4,cursor:"pointer",fontSize:".7rem",
                    background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",
                    color:"rgba(255,255,255,.65)",transition:"all .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(201,168,76,.1)";e.currentTarget.style.borderColor="rgba(201,168,76,.3)";e.currentTarget.style.color="#c9a84c";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.04)";e.currentTarget.style.borderColor="rgba(255,255,255,.08)";e.currentTarget.style.color="rgba(255,255,255,.65)";}}>
                  {p.name}
                </div>
              ))}
            </div>

            {/* Allocation + Drift + Action table */}
            <div className="card" style={{marginBottom:"1rem"}}>
              {rTotal===0?<div className="empty">Add holdings to see your allocation plan</div>:(
                <>
                <table className="ht" style={{fontSize:".78rem"}}>
                  <thead><tr>
                    <th>Asset Class</th>
                    <th className="r" style={{width:80}}>Target %</th>
                    <th className="r">Current %</th>
                    <th style={{width:"22%"}}>Drift</th>
                    <th className="r">Action</th>
                  </tr></thead>
                  <tbody>
                    {trades.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).map(t=>{
                      const a=AT[t.type]||{icon:"?",label:t.type,color:"#999"};
                      const isFlat=Math.abs(t.delta)<500;
                      const isOver=t.curPct>t.tgtPct+1;
                      const isUnder=t.curPct<t.tgtPct-1;
                      const driftPct = t.curPct - t.tgtPct;
                      const absDelta = Math.abs(t.delta);
                      const monthlySIP = absDelta > 5000 ? Math.round(absDelta / 12) : 0;
                      return(
                      <tr key={t.type}>
                        <td>
                          <span style={{color:a.color}}>{a.icon}</span> {a.label}
                          <div style={{fontSize:".62rem",color:"rgba(255,255,255,.4)",marginTop:1}}>{fmtCr(t.cur)}</div>
                        </td>
                        <td className="r">
                          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:".2rem"}}>
                            <input type="number" min="0" max="100" step="1"
                              value={targetAlloc[t.type]||0}
                              onChange={e=>setTargetAlloc(p=>({...p,[t.type]:+e.target.value}))}
                              style={{width:44,textAlign:"right",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",
                                borderRadius:3,padding:".18rem .35rem",color:"#c9a84c",fontFamily:"'DM Mono',monospace",fontSize:".78rem"}}/>
                            <span style={{fontSize:".68rem",color:"rgba(255,255,255,.4)"}}>%</span>
                          </div>
                        </td>
                        <td className="r mono" style={{color:"rgba(255,255,255,.6)",fontSize:".75rem"}}>{t.curPct.toFixed(1)}%</td>
                        <td>
                          <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
                            <div style={{flex:1,height:6,background:"rgba(255,255,255,.05)",borderRadius:3,overflow:"visible",position:"relative"}}>
                              <div style={{position:"absolute",left:`${Math.min(t.tgtPct/maxPct*100,100)}%`,top:-1,width:2,height:8,
                                background:"rgba(201,168,76,.7)",borderRadius:1,transform:"translateX(-50%)",zIndex:2}}/>
                              <div style={{height:"100%",width:`${Math.min(t.curPct/maxPct*100,100)}%`,
                                background:isOver?`${a.color}cc`:isUnder?`${a.color}55`:`${a.color}88`,
                                borderRadius:3,transition:"width .4s"}}/>
                            </div>
                            <span style={{fontSize:".6rem",fontFamily:"'DM Mono',monospace",minWidth:40,textAlign:"right",
                              color:isFlat?"rgba(255,255,255,.35)":isOver?"#e07c5a":"#4caf9a"}}>
                              {isFlat?"—":`${driftPct>0?"+":""}${driftPct.toFixed(1)}%`}
                            </span>
                          </div>
                        </td>
                        <td className="r">
                          {isFlat?(
                            <span style={{color:"rgba(76,175,154,.6)",fontSize:".68rem"}}>✓ Aligned</span>
                          ):t.delta>0?(
                            <div>
                              <span style={{
                                background:"rgba(76,175,154,.12)",color:"#4caf9a",
                                border:"1px solid rgba(76,175,154,.3)",
                                borderRadius:4,padding:"3px 8px",fontSize:".7rem",fontFamily:"'DM Mono',monospace",
                                fontWeight:600,whiteSpace:"nowrap"
                              }}>
                                ▲ Invest {fmtCr(absDelta)}
                              </span>
                              {monthlySIP>0&&<div style={{fontSize:".58rem",color:"rgba(76,175,154,.5)",marginTop:3}}>
                                {absDelta>50000?`SIP ~${fmtCr(monthlySIP)}/mo × 12`:"lump sum"}
                              </div>}
                            </div>
                          ):(
                            <div>
                              <span style={{
                                background:"rgba(224,124,90,.12)",color:"#e07c5a",
                                border:"1px solid rgba(224,124,90,.3)",
                                borderRadius:4,padding:"3px 8px",fontSize:".7rem",fontFamily:"'DM Mono',monospace",
                                fontWeight:600,whiteSpace:"nowrap"
                              }}>
                                ▼ Trim {fmtCr(absDelta)}
                              </span>
                              <div style={{fontSize:".58rem",color:"rgba(224,124,90,.45)",marginTop:3}}>
                                {absDelta>100000?"redeem or pause SIPs":"pause new investments"}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>);
                    })}
                  </tbody>
                </table>

                {/* Total % + summary footer */}
                <div style={{marginTop:".75rem",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".5rem"}}>
                  <div style={{padding:".4rem .7rem",borderRadius:4,fontSize:".7rem",
                    background:Math.abs(tSum-100)<0.5?"rgba(76,175,154,.08)":"rgba(224,124,90,.08)",
                    border:`1px solid ${Math.abs(tSum-100)<0.5?"rgba(76,175,154,.2)":"rgba(224,124,90,.2)"}`,
                    color:Math.abs(tSum-100)<0.5?"#4caf9a":"#e07c5a"}}>
                    Target total: {tSum.toFixed(0)}% {Math.abs(tSum-100)<0.5?"✓":"— adjust to 100%"}
                  </div>
                  <div style={{display:"flex",gap:"1rem",fontSize:".72rem"}}>
                    {totalBuy>0&&<span style={{color:"#4caf9a"}}>Invest {fmtCr(totalBuy)}</span>}
                    {totalSell>0&&<span style={{color:"#e07c5a"}}>Trim {fmtCr(totalSell)}</span>}
                  </div>
                </div>

                <div style={{marginTop:".6rem",fontSize:".65rem",color:"rgba(255,255,255,.35)",lineHeight:1.5}}>
                  ℹ️ "Trim" = redeem units or redirect future SIPs to other asset classes. Selling may have tax implications — consult your CA.
                  {cash>0&&<span style={{color:"rgba(201,168,76,.5)"}}> Fresh cash of {fmtCr(cash)} is factored into Invest amounts.</span>}
                </div>

                {/* Legend */}
                <div style={{marginTop:".5rem",display:"flex",gap:".8rem",fontSize:".6rem",color:"rgba(255,255,255,.35)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:2,background:"rgba(201,168,76,.7)"}}/> Target</div>
                  <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:6,background:"rgba(76,175,154,.5)",borderRadius:1}}/> Under</div>
                  <div style={{display:"flex",alignItems:"center",gap:".25rem"}}><div style={{width:8,height:6,background:"rgba(224,124,90,.5)",borderRadius:1}}/> Over</div>
                </div>
                </>
              )}
            </div>

            {/* Show all asset types (collapsed) */}
            {Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0).length>0&&(
              <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",cursor:"pointer",textAlign:"center",padding:".4rem",
                border:"1px dashed rgba(255,255,255,.1)",borderRadius:6}}
                onClick={()=>{
                  const missing = Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0);
                  if(missing.length) setTargetAlloc(p=>{const n={...p};missing.forEach(t=>n[t]=0);return n;});
                }}>
                + Show all asset types ({Object.keys(AT).filter(t=>!activeTypes.has(t)&&(+targetAlloc[t]||0)===0).length} hidden)
              </div>
            )}
          </>);
        })()}

        {/* ── MEMBERS ── */}
        {tab==="members"&&(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"#ffffff"}}>Family Members</div><button className="btn-sm" onClick={()=>openMemberModal(null)}>+ Add Member</button></div>
          {mSum.length===0&&(<div className="empty">No members yet. Add a family member to start tracking individual portfolios.</div>)}
          {mSum.map(m=>{const hs=allHoldings.filter(h=>h.member_id===m.id);const byT=Object.keys(AT).map(t=>({t,v:hs.filter(h=>h.type===t).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0)})).filter(x=>x.v>0);const holdingCount=hs.length;return(<div key={m.id} className="card" style={{marginBottom:"1rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:".82rem",marginBottom:".95rem"}}>
              <div className="av" style={{width:42,height:42,fontSize:"1rem"}}>{m.name[0]}</div>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",color:"#ffffff"}}>{m.name}</div>
                <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",textTransform:"uppercase",letterSpacing:".08em"}}>
                  {m.relation}{holdingCount>0?` · ${holdingCount} holding${holdingCount>1?"s":""}`:""}{m.email?<span style={{textTransform:"none",letterSpacing:"normal",marginLeft:6,fontSize:".6rem",color:"rgba(76,175,154,.6)"}}>● Linked: {m.email}</span>:""}
                </div>
              </div>
              <div style={{display:"flex",gap:".35rem",alignItems:"center"}}>
                <button className="delbtn" title="Edit member" onClick={()=>openMemberModal(m.id)}
                  style={{color:"rgba(255,255,255,.5)",fontSize:".78rem"}}>✏️</button>
                <button className="delbtn" title="Delete member" onClick={()=>setMemberAction({type:"delete",memberId:m.id,reassignTo:""})}
                  style={{color:"rgba(224,124,90,.5)",fontSize:".78rem"}}>🗑️</button>
                {members.length>1&&holdingCount>0&&(
                  <button className="delbtn" title="Merge into another member" onClick={()=>setMemberAction({type:"merge",memberId:m.id,reassignTo:""})}
                    style={{color:"rgba(160,132,202,.6)",fontSize:".78rem"}}>🔗</button>
                )}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1rem",color:"#c9a84c"}}>{fmt(m.cur)}</div>
                <div className={m.gain>=0?"gain":"loss"} style={{fontSize:".73rem"}}>{fmtPct(m.pct)}</div>
              </div>
            </div>
            {byT.length>0&&(<div style={{display:"flex",gap:".45rem",flexWrap:"wrap"}}>{byT.map(({t,v})=>{const a=AT[t];return(<div key={t} style={{background:a.color+"18",border:`1px solid ${a.color}44`,borderRadius:5,padding:".38rem .7rem",fontSize:".73rem",color:a.color}}>{a.icon} {a.label}: {fmt(v)}</div>);})}</div>)}
          </div>);})}

          {/* ── Delete / Merge Confirmation Modal ── */}
          {memberAction&&(()=>{
            const m = members.find(x=>x.id===memberAction.memberId);
            if (!m) return null;
            const holdingCount = holdings.filter(h=>h.member_id===m.id).length;
            const otherMembers = members.filter(x=>x.id!==m.id);
            const isDelete = memberAction.type==="delete";
            const title = isDelete ? `Delete "${m.name}"` : `Merge "${m.name}"`;
            const desc = isDelete
              ? holdingCount>0
                ? `This member has ${holdingCount} holding${holdingCount>1?"s":""}. Choose a member to reassign them to, or leave empty to unassign.`
                : "No holdings are assigned to this member."
              : `Move all ${holdingCount} holding${holdingCount>1?"s":""} from "${m.name}" to another member, then remove "${m.name}".`;

            return(
              <Overlay onClose={()=>setMemberAction(null)} narrow>
                <div className="modtitle">{isDelete?"🗑️":"🔗"} {title}</div>
                <div style={{fontSize:".8rem",color:"rgba(255,255,255,.7)",marginBottom:"1rem",lineHeight:1.6}}>{desc}</div>
                {(holdingCount>0||!isDelete)&&otherMembers.length>0&&(
                  <FG label={isDelete?"Reassign holdings to":"Merge into"}>
                    <select className="fi fs" value={memberAction.reassignTo} onChange={e=>setMemberAction(p=>({...p,reassignTo:e.target.value}))}>
                      {isDelete&&<option value="">— Leave unassigned —</option>}
                      {!isDelete&&<option value="">Select a member…</option>}
                      {otherMembers.map(o=><option key={o.id} value={o.id}>{o.name}{o.relation?` (${o.relation})`:""} — {holdings.filter(h=>h.member_id===o.id).length} holdings</option>)}
                    </select>
                  </FG>
                )}
                {holdingCount>0&&memberAction.reassignTo&&(
                  <div style={{background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.25)",borderRadius:8,padding:".6rem .8rem",marginBottom:".8rem",fontSize:".73rem",color:"#4caf9a"}}>
                    ✓ {holdingCount} holding{holdingCount>1?"s":""} will be moved to <strong>{otherMembers.find(o=>o.id===memberAction.reassignTo)?.name}</strong>
                  </div>
                )}
                <MA>
                  <button className="btnc" onClick={()=>setMemberAction(null)}>Cancel</button>
                  <button className="btns" disabled={!isDelete&&!memberAction.reassignTo}
                    style={isDelete?{background:"rgba(224,124,90,.14)",borderColor:"rgba(224,124,90,.5)",color:"#e07c5a"}:{}}
                    onClick={async()=>{
                      if(isDelete){
                        await deleteMember(m.id, memberAction.reassignTo||null);
                      } else {
                        await mergeMembers(m.id, memberAction.reassignTo);
                      }
                      setMemberAction(null);
                    }}>
                    {isDelete?"Delete Member":"Merge Members"}
                  </button>
                </MA>
              </Overlay>
            );
          })()}
        </>)}


        {/* ── BUDGET ── */}
        {tab==="budget"&&(()=>{

          // ── Load functions ──
          async function loadBudget(){
            try{
              const [stmts,cats,analytics]=await Promise.all([
                api("/api/budget/statements"),
                api("/api/budget/categories"),
                api(`/api/budget/analytics${budgetSelMonth?`?month=${budgetSelMonth}`:""}`)
              ]);
              setBudgetStatements(stmts||[]);
              setBudgetCategories(cats||[]);
              setBudgetAnalytics(analytics||null);
            }catch(e){console.error(e);}
          }
          async function loadTxns(){
            try{
              const params=new URLSearchParams();
              if(budgetSelStmt!=="all") params.set("statement_id",budgetSelStmt);
              if(budgetSelCat!=="All") params.set("category",budgetSelCat);
              if(budgetSelMonth) params.set("month",budgetSelMonth);
              if(budgetSearch) params.set("search",budgetSearch);
              const txns=await api(`/api/budget/transactions?${params}`);
              setBudgetTxns(txns||[]);
            }catch(e){console.error(e);}
          }

          // ── Charts ──
          const analytics=budgetAnalytics;
          const catData=analytics?Object.entries(analytics.byCategory||{}).map(([name,v])=>{
            const cat=budgetCategories.find(c=>c.name===name);
            return{name,value:v,color:cat?.color||"#6b6356",icon:cat?.icon||"📦"};
          }).sort((a,b)=>b.value-a.value):[];
          const totalSpend=catData.reduce((s,x)=>s+x.value,0);

          // Bar chart data (monthly trend)
          const monthlyData=analytics?Object.entries(analytics.monthly||{})
            .sort((a,b)=>a[0].localeCompare(b[0])).slice(-6):[];
          const maxMonthly=Math.max(...monthlyData.map(x=>x[1]),1);

          const fmtAmt=(n,cur)=>{
            if(cur==="USD") return n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1e3?`$${(n/1000).toFixed(1)}K`:`$${Math.round(n).toLocaleString("en-US")}`;
            return n>=1e7?`₹${(n/1e7).toFixed(2)}Cr`:n>=1e5?`₹${(n/1e5).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n).toLocaleString("en-IN")}`;
          };
          // Detect dominant currency from statements (for analytics overview)
          const usStmts = budgetStatements.filter(s=>s.region==="US").length;
          const inStmts = budgetStatements.filter(s=>s.region==="IN").length;
          const domCur = usStmts >= inStmts && usStmts > 0 ? "USD" : "INR";
          const TYPE_COLORS={"BANK":"#5a9ce0","CREDIT_CARD":"#e07c5a","UPI":"#4caf9a","OTHER":"#a084ca"};
          const TYPE_ICONS={"BANK":"🏦","CREDIT_CARD":"💳","UPI":"📲","OTHER":"📄"};

          return(<>
            {/* ── Sub-nav ── */}
            <div style={{display:"flex",gap:".4rem",marginBottom:"1.2rem",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",gap:".35rem"}}>
                {["overview","transactions","categories","import"].map(v=>(
                  <div key={v} onClick={async()=>{setBudgetView(v);if(v==="overview"||v==="categories")await loadBudget();if(v==="transactions")await loadTxns();}}
                    style={{padding:".3rem .75rem",borderRadius:5,cursor:"pointer",fontSize:".73rem",fontWeight:500,
                      background:budgetView===v?"rgba(201,168,76,.18)":"rgba(255,255,255,.04)",
                      border:`1px solid ${budgetView===v?"rgba(201,168,76,.5)":"rgba(255,255,255,.1)"}`,
                      color:budgetView===v?"#c9a84c":"rgba(255,255,255,.6)",transition:"all .15s",textTransform:"capitalize"}}>
                    {v==="overview"?"📊 Overview":v==="transactions"?"📋 Transactions":v==="categories"?"🏷️ Categories":"📤 Import"}
                  </div>
                ))}
              </div>
              {/* Month picker */}
              <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
                <input type="month" className="fi" style={{width:150,padding:".28rem .6rem",fontSize:".75rem"}}
                  value={budgetSelMonth}
                  onChange={e=>{
                    const mo = e.target.value;
                    setBudgetSelMonth(mo);
                    // Reload everything with new month
                    (async()=>{
                      try {
                        const [stmts,cats,analytics,txns] = await Promise.all([
                          api("/api/budget/statements"),
                          api("/api/budget/categories"),
                          api(`/api/budget/analytics${mo?`?month=${mo}`:""}`),
                          api(`/api/budget/transactions${mo?`?month=${mo}`:""}`)
                        ]);
                        setBudgetStatements(stmts||[]);
                        setBudgetCategories(cats||[]);
                        setBudgetAnalytics(analytics||null);
                        setBudgetTxns(txns||[]);
                      } catch(err) { console.error("Month change reload:", err); }
                    })();
                  }}
                  placeholder="All time"/>
                {budgetSelMonth&&<button onClick={()=>{
                  setBudgetSelMonth("");
                  (async()=>{
                    try {
                      const [stmts,cats,analytics,txns] = await Promise.all([
                        api("/api/budget/statements"),
                        api("/api/budget/categories"),
                        api("/api/budget/analytics"),
                        api("/api/budget/transactions")
                      ]);
                      setBudgetStatements(stmts||[]);
                      setBudgetCategories(cats||[]);
                      setBudgetAnalytics(analytics||null);
                      setBudgetTxns(txns||[]);
                    } catch(err) { console.error("Month clear reload:", err); }
                  })();
                }} style={{background:"none",border:"none",color:"rgba(255,255,255,.5)",cursor:"pointer",fontSize:".9rem"}}>✕</button>}
              </div>
            </div>

            {/* ═══ OVERVIEW ═══ */}
            {budgetView==="overview"&&(()=>{
              if(!analytics) return(<div style={{textAlign:"center",padding:"3rem",color:"rgba(255,255,255,.4)"}}>
                <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📊</div>
                <div>Import a bank statement to see your spending overview</div>
                <button className="btns" style={{marginTop:"1rem"}} onClick={()=>setBudgetView("import")}>+ Import Statement</button>
              </div>);
              return(<>
                {/* KPI row */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".75rem",marginBottom:"1.2rem"}}>
                  {[
                    {label:"Total Spent",val:analytics.totalDebit,color:"#e07c5a"},
                    {label:"Total Credited",val:analytics.totalCredit,color:"#4caf9a"},
                    {label:"Net Flow",val:analytics.totalCredit-analytics.totalDebit,color:(analytics.totalCredit-analytics.totalDebit)>=0?"#4caf9a":"#e07c5a"},
                    {label:"Categories",val:catData.length,color:"#c9a84c",isCnt:true},
                  ].map(k=>(
                    <div key={k.label} className="card" style={{padding:".85rem 1rem"}}>
                      <div style={{fontSize:".62rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".4rem"}}>{k.label}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:k.isCnt?"1.4rem":"1.1rem",color:k.color}}>
                        {k.isCnt?k.val:fmtAmt(Math.abs(k.val),domCur)}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1.2rem"}}>
                  {/* Spending donut */}
                  <div className="card">
                    <div className="ctitle">Spending by Category</div>
                    {catData.length===0?<div className="empty">No spending data</div>:(
                      <div style={{display:"flex",gap:"1rem",alignItems:"flex-start",flexWrap:"wrap"}}>
                        <svg viewBox="0 0 180 180" style={{width:160,height:160,flexShrink:0}}>
                          {(()=>{
                            let angle=-90;
                            return catData.map((d,i)=>{
                              const sweep=(d.value/totalSpend)*360;
                              if(sweep<0.5){angle+=sweep;return null;}
                              const r=72,ir=44,cx=90,cy=90;
                              const pt=(a,rad)=>({x:cx+rad*Math.cos(a*Math.PI/180),y:cy+rad*Math.sin(a*Math.PI/180)});
                              const sa=angle,ea=angle+sweep;
                              angle+=sweep;
                              const s=pt(sa,r),e=pt(ea,r),si=pt(sa,ir),ei=pt(ea,ir);
                              const lg=sweep>180?1:0;
                              const path=`M${s.x},${s.y}A${r},${r},0,${lg},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir},${ir},0,${lg},0,${si.x},${si.y}Z`;
                              return<path key={i} d={path} fill={d.color} opacity=".9"/>;
                            });
                          })()}
                          <text x="90" y="86" textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="'DM Mono',monospace">{fmtAmt(totalSpend,domCur)}</text>
                          <text x="90" y="100" textAnchor="middle" fill="rgba(255,255,255,.5)" fontSize="8">spent</text>
                        </svg>
                        <div style={{flex:1,minWidth:120}}>
                          {catData.slice(0,8).map(d=>(
                            <div key={d.name} style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".35rem",fontSize:".72rem"}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:d.color,flexShrink:0}}/>
                              <div style={{flex:1,color:"rgba(255,255,255,.65)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.icon} {d.name}</div>
                              <div style={{fontFamily:"'DM Mono',monospace",color:"rgba(255,255,255,.65)",fontSize:".68rem"}}>{((d.value/totalSpend)*100).toFixed(1)}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Monthly bar chart */}
                  <div className="card">
                    <div className="ctitle">Monthly Spending Trend</div>
                    {monthlyData.length===0?<div className="empty">No trend data yet</div>:(
                      <div style={{display:"flex",alignItems:"flex-end",gap:".4rem",height:140,padding:".5rem 0"}}>
                        {monthlyData.map(([mo,val])=>{
                          const pct=(val/maxMonthly)*100;
                          const label=new Date(mo+"-01").toLocaleDateString("en-IN",{month:"short"});
                          return(
                          <div key={mo} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:".3rem"}}>
                            <div style={{fontSize:".6rem",color:"rgba(255,255,255,.5)",fontFamily:"'DM Mono',monospace"}}>{fmtAmt(val,domCur)}</div>
                            <div style={{width:"100%",background:"rgba(201,168,76,.12)",borderRadius:"3px 3px 0 0",height:100,display:"flex",alignItems:"flex-end"}}>
                              <div style={{width:"100%",background:"rgba(201,168,76,.7)",borderRadius:"3px 3px 0 0",height:`${pct}%`,transition:"height .6s ease"}}/>
                            </div>
                            <div style={{fontSize:".62rem",color:"rgba(255,255,255,.55)"}}>{label}</div>
                          </div>);
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Category budget buckets */}
                {catData.length>0&&(
                  <div className="card">
                    <div className="ctitle">Budget Buckets</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(260px,100%),1fr))",gap:".75rem"}}>
                      {catData.map(d=>{
                        const cat=budgetCategories.find(c=>c.name===d.name);
                        const limit=cat?.monthly_limit||0;
                        const pct=limit>0?Math.min((d.value/limit)*100,100):0;
                        const over=limit>0&&d.value>limit;
                        return(
                        <div key={d.name} style={{padding:".75rem .9rem",background:"rgba(255,255,255,.03)",border:`1px solid rgba(255,255,255,.07)`,borderRadius:7}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:".45rem"}}>
                            <span style={{fontSize:".8rem",color:"#ffffff"}}>{d.icon} {d.name}</span>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:".78rem",color:over?"#e07c5a":"#c9a84c"}}>{fmtAmt(d.value,domCur)}</span>
                          </div>
                          {limit>0&&(
                            <>
                              <div style={{height:4,background:"rgba(255,255,255,.07)",borderRadius:2,marginBottom:".3rem"}}>
                                <div style={{height:"100%",width:`${pct}%`,background:over?"#e07c5a":d.color,borderRadius:2,transition:"width .6s"}}/>
                              </div>
                              <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>
                                {over?<span style={{color:"#e07c5a"}}>Over by {fmtAmt(d.value-limit,domCur)}</span>:
                                  <span>{fmtAmt(limit-d.value,domCur)} remaining of {fmtAmt(limit,domCur)}</span>}
                              </div>
                            </>
                          )}
                        </div>);
                      })}
                    </div>
                  </div>
                )}

              {/* ── Budget ↔ Investment Bridge ── */}
              {analytics&&analytics.totalDebit>0&&(
                <div className="card" style={{borderTop:"2px solid rgba(201,168,76,.3)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".85rem"}}>
                    <div className="ctitle" style={{margin:0}}>💡 Spend-to-Wealth Bridge</div>
                    <div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)"}}>What if you invested more?</div>
                  </div>
                  {(()=>{
                    const topCats = catData.filter(d=>!["Investments","Transfers","Other"].includes(d.name)).slice(0,4);
                    const CAGR = 0.12; // 12% assumed portfolio CAGR
                    const years = [5, 10, 15];
                    return(
                    <div style={{overflowX:"auto"}}>
                      <table className="ht" style={{fontSize:".75rem"}}>
                        <thead><tr>
                          <th>Category</th><th className="r">Monthly Spend</th>
                          {years.map(y=><th key={y} className="r">SIP → {y}Y at 12%</th>)}
                          <th className="r">vs Your Return</th>
                        </tr></thead>
                        <tbody>
                          {topCats.map(d=>{
                            const monthly=d.value/Math.max(Object.keys(analytics.monthly||{}).length,1);
                            return(<tr key={d.name}>
                              <td><span style={{color:d.color}}>{d.icon}</span> {d.name}</td>
                              <td className="r mono" style={{color:"#e07c5a"}}>₹{Math.round(monthly).toLocaleString("en-IN")}</td>
                              {years.map(y=>{
                                // FV of monthly SIP: P * [((1+r)^n - 1) / r] * (1+r)
                                const r=CAGR/12, n=y*12;
                                const fv=monthly*((Math.pow(1+r,n)-1)/r)*(1+r);
                                return <td key={y} className="r mono" style={{color:"#4caf9a"}}>{fmtCr(fv)}</td>;
                              })}
                              <td className="r" style={{fontSize:".68rem",color:"rgba(255,255,255,.5)"}}>
                                {totInv>0?`Your portfolio: ${fmtPct((allCur-allInv)/allInv*100)}`:"—"}
                              </td>
                            </tr>);
                          })}
                        </tbody>
                      </table>
                      <div style={{fontSize:".65rem",color:"rgba(255,255,255,.35)",marginTop:".5rem"}}>Assumes 12% CAGR. Monthly spend estimated from {budgetSelMonth||"all imported"} data.</div>
                    </div>);
                  })()}
                </div>
              )}
              </>);
            })()}

            {/* ═══ TRANSACTIONS ═══ */}
            {budgetView==="transactions"&&(()=>{
              return(<>
                {/* Filter bar */}
                <div style={{display:"flex",gap:".6rem",marginBottom:".85rem",flexWrap:"wrap",alignItems:"flex-end"}}>
                  <div style={{flex:2,minWidth:180}}>
                    <label className="flbl">Search</label>
                    <input className="fi" placeholder="Search transactions…" value={budgetSearch}
                      onChange={e=>setBudgetSearch(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")loadTxns();}}/>
                  </div>
                  <div style={{flex:1,minWidth:140}}>
                    <label className="flbl">Statement</label>
                    <select className="fi fs" value={budgetSelStmt} onChange={e=>setBudgetSelStmt(e.target.value)}>
                      <option value="all">All</option>
                      {budgetStatements.map(s=><option key={s.id} value={s.id}>{s.source} · {s.period_start?.slice(0,7)||"?"}</option>)}
                    </select>
                  </div>
                  <div style={{flex:1,minWidth:140}}>
                    <label className="flbl">Category</label>
                    <select className="fi fs" value={budgetSelCat} onChange={e=>setBudgetSelCat(e.target.value)}>
                      <option value="All">All Categories</option>
                      {budgetCategories.map(c=><option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                  <button className="btns" onClick={loadTxns} style={{alignSelf:"flex-end"}}>Filter</button>
                </div>

                {/* Bulk actions */}
                {selectedTxnIds.size>0&&(
                  <div style={{display:"flex",alignItems:"center",gap:".7rem",padding:".6rem .9rem",background:"rgba(201,168,76,.08)",border:"1px solid rgba(201,168,76,.25)",borderRadius:7,marginBottom:".75rem"}}>
                    <span style={{fontSize:".78rem",color:"#c9a84c"}}>{selectedTxnIds.size} selected</span>
                    <select className="fi fs" style={{width:200,marginBottom:0}} value={bulkCatTarget} onChange={e=>setBulkCatTarget(e.target.value)}>
                      <option value="">Move to category…</option>
                      {budgetCategories.map(c=><option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                    </select>
                    <button className="btns" onClick={async()=>{
                      if(!bulkCatTarget)return;
                      await api("/api/budget/recategorise",{method:"POST",body:JSON.stringify({ids:[...selectedTxnIds],category:bulkCatTarget})});
                      setSelectedTxnIds(new Set());setBulkCatTarget("");
                      await loadTxns();
                    }}>Apply</button>
                    <button onClick={()=>setSelectedTxnIds(new Set())} style={{background:"none",border:"none",color:"rgba(255,255,255,.5)",cursor:"pointer"}}>✕ Clear</button>
                  </div>
                )}

                {budgetTxns.length===0?(
                  <div className="card empty">No transactions — adjust filters or import a statement</div>
                ):(
                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    <table className="ht">
                      <thead><tr>
                        <th style={{width:32}}><input type="checkbox" onChange={e=>{
                          if(e.target.checked) setSelectedTxnIds(new Set(budgetTxns.map(t=>t.id)));
                          else setSelectedTxnIds(new Set());
                        }}/></th>
                        <th>Date</th><th>Description</th><th className="r">Amount</th><th>Type</th><th>Category</th>
                      </tr></thead>
                      <tbody>
                        {budgetTxns.slice(0,200).map(t=>{
                          const cat=budgetCategories.find(c=>c.name===t.category);
                          return(<tr key={t.id} style={{background:selectedTxnIds.has(t.id)?"rgba(201,168,76,.06)":""}}>
                            <td><input type="checkbox" checked={selectedTxnIds.has(t.id)}
                              onChange={e=>{const s=new Set(selectedTxnIds);e.target.checked?s.add(t.id):s.delete(t.id);setSelectedTxnIds(s);}}/></td>
                            <td className="mono dim" style={{fontSize:".75rem"}}>{t.txn_date}</td>
                            <td style={{maxWidth:"30vw",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:".78rem",color:"rgba(255,255,255,.8)"}}>{t.description}</td>
                            <td className="r mono" style={{color:t.txn_type==="DEBIT"?"#e07c5a":"#4caf9a",fontSize:".82rem"}}>
                              {t.txn_type==="DEBIT"?"-":"+"}{fmtAmt(t.amount,t.currency)}
                            </td>
                            <td><span className="tbadge2" style={{background:t.txn_type==="DEBIT"?"rgba(224,124,90,.15)":"rgba(76,175,154,.15)",color:t.txn_type==="DEBIT"?"#e07c5a":"#4caf9a",fontSize:".65rem"}}>{t.txn_type}</span></td>
                            <td>
                              <select value={t.category} style={{background:"transparent",border:"none",color:cat?.color||"#c9a84c",fontSize:".73rem",cursor:"pointer",fontFamily:"inherit",colorScheme:"dark"}}
                                onChange={async e=>{
                                  await api(`/api/budget/transactions/${t.id}`,{method:"PATCH",body:JSON.stringify({category:e.target.value})});
                                  setBudgetTxns(p=>p.map(x=>x.id===t.id?{...x,category:e.target.value}:x));
                                }}>
                                {budgetCategories.map(c=><option key={c.id} value={c.name} style={{background:"#0c1526",color:"#ffffff"}}>{c.icon} {c.name}</option>)}
                              </select>
                            </td>
                          </tr>);
                        })}
                      </tbody>
                    </table>
                    {budgetTxns.length>200&&<div style={{padding:".65rem",textAlign:"center",fontSize:".72rem",color:"rgba(255,255,255,.4)"}}>Showing 200 of {budgetTxns.length} transactions — apply filters to narrow</div>}
                  </div>
                )}
              </>);
            })()}

            {/* ═══ CATEGORIES ═══ */}
            {budgetView==="categories"&&(<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
                <div className="ctitle" style={{margin:0}}>Spending Categories</div>
                <button className="btn-sm" onClick={()=>setBudgetEditCat("new")}>+ New Category</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))",gap:".75rem"}}>
                {budgetCategories.map(cat=>(
                  <div key={cat.id} className="card" style={{borderLeft:`3px solid ${cat.color}`,padding:".85rem 1rem"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:".9rem",color:"#ffffff",marginBottom:".2rem"}}>{cat.icon} {cat.name}</div>
                        <div style={{fontSize:".68rem",color:"rgba(255,255,255,.45)"}}>
                          {cat.monthly_limit>0?`Budget: ₹${cat.monthly_limit.toLocaleString("en-IN")} /mo`:"No budget set"}
                        </div>
                        {cat.keywords&&<div style={{fontSize:".65rem",color:"rgba(255,255,255,.38)",marginTop:".2rem",lineHeight:1.5}}>Keywords: {cat.keywords.slice(0,60)}{cat.keywords.length>60?"…":""}</div>}
                      </div>
                      <div style={{display:"flex",gap:".3rem"}}>
                        <button className="delbtn" onClick={()=>setBudgetEditCat(cat)} title="Edit">✎</button>
                        <button className="delbtn" onClick={async()=>{
                          if(!confirm(`Delete "${cat.name}"?`))return;
                          await api(`/api/budget/categories/${cat.id}`,{method:"DELETE"});
                          await loadBudget();
                        }}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Edit/New category modal */}
              {budgetEditCat&&(
                <Overlay onClose={()=>setBudgetEditCat(null)} narrow>
                  <div className="modtitle">{budgetEditCat==="new"?"New Category":"Edit Category"}</div>
                  {(()=>{
                    const isNew=budgetEditCat==="new";
                    const form=isNew?budgetNewCat:budgetEditCat;
                    const setForm=isNew?setBudgetNewCat:(f=>setBudgetEditCat(p=>typeof f==="function"?f(p):f));
                    return(<>
                      <div className="frow">
                        <FG label="Icon"><input className="fi" style={{width:60}} value={form.icon} onChange={e=>setForm(p=>({...p,icon:e.target.value}))}/></FG>
                        <FG label="Name"><input className="fi" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/></FG>
                        <FG label="Colour"><input type="color" className="fi" value={form.color} onChange={e=>setForm(p=>({...p,color:e.target.value}))} style={{height:40,padding:"4px 8px",cursor:"pointer"}}/></FG>
                      </div>
                      <FG label="Monthly Budget ₹ (0 = unlimited)">
                        <input type="number" className="fi" value={form.monthly_limit} onChange={e=>setForm(p=>({...p,monthly_limit:+e.target.value}))}/>
                      </FG>
                      <FG label="Auto-match Keywords (comma separated)">
                        <input className="fi" placeholder="e.g. swiggy,zomato,restaurant" value={form.keywords} onChange={e=>setForm(p=>({...p,keywords:e.target.value}))}/>
                      </FG>
                      <MA>
                        <button className="btnc" onClick={()=>setBudgetEditCat(null)}>Cancel</button>
                        <button className="btns" onClick={async()=>{
                          if(isNew){
                            await api("/api/budget/categories",{method:"POST",body:JSON.stringify(form)});
                            setBudgetNewCat({name:"",color:"#c9a84c",icon:"📁",monthly_limit:0,keywords:""});
                          } else {
                            await api(`/api/budget/categories/${form.id}`,{method:"PUT",body:JSON.stringify({name:form.name,color:form.color,icon:form.icon,monthly_limit:form.monthly_limit,keywords:form.keywords})});
                          }
                          setBudgetEditCat(null);
                          await loadBudget();
                        }} disabled={!form.name}>Save</button>
                      </MA>
                    </>);
                  })()}
                </Overlay>
              )}
            </>)}

            {/* ═══ IMPORT ═══ */}
            {budgetView==="import"&&(<>

              {/* Manual Upload card */}
              <div className="card" style={{marginBottom:"1.2rem"}}>
                <div className="ctitle">Import Bank Statement</div>
                <div style={{fontSize:".77rem",color:"rgba(255,255,255,.55)",marginBottom:"1rem",lineHeight:1.7}}>
                  Upload CSV, Excel, or PDF statements from US banks (Chase, BofA, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank) and Indian banks (HDFC, ICICI, Axis, SBI, Kotak).
                  Transactions are <span style={{color:"#4caf9a"}}>AES-256 encrypted</span> before storage. Statements older than 1 year are automatically purged.
                </div>
                <div className="frow">
                  <FG label="Region">
                    <select className="fi fs" value={budgetUploadForm.region}
                      onChange={e=>{setBudgetUploadForm(p=>({...p,region:e.target.value,bank_key:""})); setBudgetUploadMsg("");}}>
                      <option value="">Select region…</option>
                      <option value="US">🇺🇸 US Bank</option>
                      <option value="IN">🇮🇳 Indian Bank</option>
                      <option value="AUTO">🔍 Auto-detect</option>
                    </select>
                  </FG>
                  <FG label="Bank">
                    <select className="fi fs" value={budgetUploadForm.bank_key}
                      disabled={!budgetUploadForm.region}
                      onChange={e=>setBudgetUploadForm(p=>({...p,bank_key:e.target.value}))}>
                      {budgetUploadForm.region==="US"?(<>
                        <option value="">Select bank…</option>
                        <option value="chase">Chase</option>
                        <option value="bofa">Bank of America</option>
                        <option value="wells_fargo">Wells Fargo</option>
                        <option value="citi">Citi</option>
                        <option value="capital_one">Capital One</option>
                        <option value="amex">Amex</option>
                        <option value="discover">Discover</option>
                        <option value="us_bank">US Bank</option>
                        <option value="other_us">Other US Bank</option>
                      </>):budgetUploadForm.region==="IN"?(<>
                        <option value="">Select bank…</option>
                        <option value="hdfc">HDFC</option>
                        <option value="icici">ICICI</option>
                        <option value="axis">Axis</option>
                        <option value="sbi">SBI</option>
                        <option value="kotak">Kotak</option>
                        <option value="other_in">Other Indian Bank</option>
                      </>):budgetUploadForm.region==="AUTO"?(<>
                        <option value="auto">Auto-detect from file</option>
                      </>):(<option value="">Pick a region first</option>)}
                    </select>
                  </FG>
                </div>
                <div className="frow">
                  <FG label="Type">
                    <select className="fi fs" value={budgetUploadForm.statement_type}
                      onChange={e=>setBudgetUploadForm(p=>({...p,statement_type:e.target.value}))}>
                      <option value="BANK">🏦 Bank Account</option>
                      <option value="CREDIT_CARD">💳 Credit Card</option>
                      <option value="UPI">📲 UPI / GPay</option>
                      <option value="OTHER">📄 Other</option>
                    </select>
                  </FG>
                  <FG label="Custom Label (optional)">
                    <input className="fi" placeholder="e.g. Joint Savings, Salary Account"
                      value={budgetUploadForm.custom_label}
                      onChange={e=>setBudgetUploadForm(p=>({...p,custom_label:e.target.value}))}/>
                  </FG>
                </div>
                <FG label="Statement File (CSV, XLSX, or PDF)">
                  <input type="file" accept=".csv,.xlsx,.xls,.pdf" className="fi"
                    onChange={e=>setBudgetUploadFile(e.target.files[0])}
                    style={{paddingTop:".4rem",color:"rgba(255,255,255,.85)"}}/>
                </FG>
                <FG label="Notes (optional)">
                  <input className="fi" placeholder="e.g. Jan–Mar 2026 statement"
                    value={budgetUploadForm.notes}
                    onChange={e=>setBudgetUploadForm(p=>({...p,notes:e.target.value}))}/>
                </FG>

                {budgetUploadMsg&&(
                  <div style={{padding:".6rem .85rem",borderRadius:6,marginBottom:".75rem",fontSize:".78rem",
                    whiteSpace:"pre-wrap",fontFamily:budgetUploadMsg.startsWith("📄")?"monospace":"inherit",
                    maxHeight:budgetUploadMsg.startsWith("📄")?"400px":"none",overflow:"auto",
                    background:budgetUploadMsg.startsWith("✓")?"rgba(76,175,154,.1)":budgetUploadMsg.startsWith("📄")?"rgba(90,156,224,.08)":"rgba(224,124,90,.1)",
                    border:`1px solid ${budgetUploadMsg.startsWith("✓")?"rgba(76,175,154,.3)":budgetUploadMsg.startsWith("📄")?"rgba(90,156,224,.2)":"rgba(224,124,90,.3)"}`,
                    color:budgetUploadMsg.startsWith("✓")?"#4caf9a":budgetUploadMsg.startsWith("📄")?"rgba(255,255,255,.7)":"#e07c5a"}}>
                    {budgetUploadMsg}
                  </div>
                )}

                <button className="btns" disabled={!budgetUploadFile||!budgetUploadForm.region||budgetUploading}
                  onClick={async()=>{
                    if(!budgetUploadFile||!budgetUploadForm.region) return;
                    const bankKey = budgetUploadForm.bank_key || (budgetUploadForm.region==="AUTO"?"auto":"");
                    if(!bankKey){setBudgetUploadMsg("⚠ Please select a bank"); return;}
                    setBudgetUploading(true); setBudgetUploadMsg("");
                    try{
                      const fd=new FormData();
                      fd.append("file",budgetUploadFile);
                      fd.append("bank_key",bankKey);
                      fd.append("source",budgetUploadForm.custom_label||budgetUploadForm.bank_key||"Auto");
                      fd.append("statement_type",budgetUploadForm.statement_type);
                      fd.append("notes",budgetUploadForm.notes||"");
                      const data=await api("/api/budget/upload",{method:"POST",body:fd});
                      if(data.ok){
                        setBudgetUploadMsg(`✓ Imported ${data.txn_count} transactions (${data.period_start} to ${data.period_end})`);
                        setBudgetUploadFile(null);
                        setBudgetUploadForm({region:"",bank_key:"",statement_type:"BANK",notes:"",custom_label:""});
                        await loadBudget();
                        const stmts=await api("/api/budget/statements");
                        setBudgetStatements(stmts||[]);
                      } else { setBudgetUploadMsg("⚠ "+data.error); }
                    }catch(e){ setBudgetUploadMsg("⚠ "+e.message); }
                    setBudgetUploading(false);
                  }}>
                  {budgetUploading?"Importing…":"Upload & Parse"}
                </button>
                {budgetUploadFile && budgetUploadFile.name.endsWith(".pdf") && (
                  <button className="btnc" style={{marginLeft:".5rem",fontSize:".7rem"}}
                    onClick={async()=>{
                      setBudgetUploadMsg("Analyzing + importing PDF...");
                      try{
                        const fd=new FormData();
                        fd.append("file",budgetUploadFile);
                        fd.append("import","true");
                        const data=await api("/api/budget/debug-pdf",{method:"POST",body:fd});
                        let msg = `📄 ${data.pages} pages, ${data.totalLines} lines, ${data.totalChars} chars\n` +
                          `US parser: ${data.usRowsParsed} rows | IN parser: ${data.inRowsParsed} rows\n`;
                        if (data.imported > 0) {
                          msg = `✓ Imported ${data.imported} transactions via debug endpoint\n` + msg;
                          await loadBudget();
                          setBudgetStatements(await api("/api/budget/statements") || []);
                        } else {
                          msg += `Import: ${data.imported} (${data.importError || "no rows to import"})\n`;
                        }
                        msg += `Sections: ${data.sectionHeaders?.join(" | ") || "none"}\n` +
                          `Date lines: ${data.dateLines?.slice(0,5).join(" | ") || "none"}\n` +
                          `--- First 15 lines ---\n${data.first80Lines?.slice(0,15).join("\n")}`;
                        setBudgetUploadMsg(msg);
                      }catch(e){setBudgetUploadMsg("⚠ Debug: "+e.message);}
                    }}>
                    🔍 Debug + Import PDF
                  </button>
                )}
              </div>

              {/* Statement history */}
              <div className="card">
                <div className="ctitle">Statement History (1-year rolling)</div>
                {budgetStatements.length===0?<div className="empty">No statements imported yet</div>:(
                  <table className="ht">
                    <thead><tr><th>Source</th><th>Type</th><th>Period</th><th className="r">Transactions</th><th>Uploaded</th><th>Notes</th><th/></tr></thead>
                    <tbody>
                      {budgetStatements.map(s=>(
                        <tr key={s.id}>
                          <td style={{fontWeight:500,color:"#ffffff"}}>{s.source}</td>
                          <td><span style={{fontSize:".68rem",padding:"2px 7px",borderRadius:3,background:`${TYPE_COLORS[s.statement_type]||"#6b6356"}22`,color:TYPE_COLORS[s.statement_type]||"#6b6356",border:`1px solid ${TYPE_COLORS[s.statement_type]||"#6b6356"}44`}}>{TYPE_ICONS[s.statement_type]} {s.statement_type}</span></td>
                          <td className="dim" style={{fontSize:".75rem"}}>{s.period_start||"?"} → {s.period_end||"?"}</td>
                          <td className="r mono" style={{color:"#c9a84c"}}>{s.txn_count}</td>
                          <td className="dim" style={{fontSize:".72rem"}}>{s.upload_date?.slice(0,10)}</td>
                          <td className="dim" style={{fontSize:".72rem",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.notes||"—"}</td>
                          <td><button className="delbtn" onClick={async()=>{
                            if(!confirm(`Delete "${s.source}" statement and all its transactions?`))return;
                            await api(`/api/budget/statements/${s.id}`,{method:"DELETE"});
                            const stmts=await api("/api/budget/statements");
                            setBudgetStatements(stmts||[]);
                          }}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </>)}
          </>);
        })()}


        {/* ── CALENDAR ── */}
        {tab==="calendar"&&(()=>{
          const now = new Date();
          const [calY, calMo] = calMonth.split("-").map(Number);
          const firstDay = new Date(calY, calMo-1, 1).getDay(); // 0=Sun
          const daysInMonth = new Date(calY, calMo, 0).getDate();

          // ── Gather all calendar events from holdings + goals ──
          const events = {}; // "YYYY-MM-DD" -> [{type,label,color,icon}]
          const addEvent = (date, ev) => {
            if(!date) return;
            const d = date.slice(0,10);
            if(!events[d]) events[d] = [];
            events[d].push(ev);
          };

          // FD maturity
          for(const h of holdings){
            if(h.type==="FD"&&h.maturity_date){
              addEvent(h.maturity_date,{type:"FD Maturity",label:h.name,color:"#f0a050",icon:"🏦"});
            }
            // Detect truly active SIPs with strict checks
            if(h.type==="MF"&&h.transactions?.length>=3){
              const buyTxns=[...h.transactions]
                .filter(t=>t.txn_type==="BUY")
                .sort((a,b)=>b.txn_date.localeCompare(a.txn_date));
              if(buyTxns.length>=3){
                // Rule 1: last BUY must be in current or previous calendar month only
                const lastMo=buyTxns[0].txn_date.slice(0,7);
                const nowMo=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
                const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
                const prevMo=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}`;
                if(lastMo===nowMo||lastMo===prevMo){
                  // Rule 2: at least 3 distinct months active in the last 6 months
                  const cutoff=new Date(now.getFullYear(),now.getMonth()-6,1).toISOString().slice(0,7);
                  const activeMos=new Set(buyTxns.filter(t=>t.txn_date.slice(0,7)>=cutoff).map(t=>t.txn_date.slice(0,7)));
                  if(activeMos.size>=3){
                    // Rule 3: find the most common day-of-month
                    const freq={};
                    buyTxns.slice(0,6).forEach(t=>{const d=+t.txn_date.slice(8,10);freq[d]=(freq[d]||0)+1;});
                    const sipDay=+Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0];
                    // Rule 4: only show on current or future months (not past months in calendar)
                    const viewedMo=`${calY}-${String(calMo).padStart(2,"0")}`;
                    if(viewedMo>=nowMo){
                      const daysInCalMo=new Date(calY,calMo,0).getDate();
                      const day=Math.min(sipDay,daysInCalMo);
                      const ds=`${calY}-${String(calMo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                      const avgAmt=buyTxns.slice(0,3).reduce((s,t)=>s+(+t.units)*(+t.price),0)/3;
                      const lbl=`${h.name.length>22?h.name.slice(0,22)+"...":h.name} (₹${Math.round(avgAmt/1000)}K)`;
                      addEvent(ds,{type:"SIP Due",label:lbl,color:"#4caf9a",icon:"📈"});
                    }
                  }
                }
              }
            }
          }

          // Goal target dates
          for(const g of goals){
            if(g.targetDate) addEvent(g.targetDate,{type:"Goal Target",label:g.name,color:g.color||"#c9a84c",icon:"🎯"});
          }

          // Indian financial calendar — fixed annual events
          const finCalendar = [
            // Tax
            {mo:3,d:31,label:"FY End — File ITR / Last date for 80C investments",color:"#e07c5a",icon:"📋",type:"Tax"},
            {mo:7,d:31,label:"ITR Filing Deadline (non-audit)",color:"#e07c5a",icon:"📋",type:"Tax"},
            {mo:9,d:15,label:"Advance Tax Q2 (45%)",color:"#e07c5a",icon:"📋",type:"Tax"},
            {mo:12,d:15,label:"Advance Tax Q3 (75%)",color:"#e07c5a",icon:"📋",type:"Tax"},
            {mo:3,d:15,label:"Advance Tax Q4 (100%)",color:"#e07c5a",icon:"📋",type:"Tax"},
            // PPF
            {mo:4,d:5,label:"PPF — Deposit before 5th for full month interest",color:"#a084ca",icon:"💰",type:"PPF"},
            {mo:3,d:31,label:"PPF Annual Contribution Deadline",color:"#a084ca",icon:"💰",type:"PPF"},
            // ELSS / 80C
            {mo:3,d:31,label:"ELSS / 80C — Last date for tax-saving investments",color:"#5a9ce0",icon:"🛡️",type:"80C"},
          ];
          for(const e of finCalendar){
            if(e.mo===calMo){
              const d=`${calY}-${String(e.mo).padStart(2,"0")}-${String(e.d).padStart(2,"0")}`;
              addEvent(d,{type:e.type,label:e.label,color:e.color,icon:e.icon});
            }
          }

          // Today
          const todayStr=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
          const isToday = (y,m,d) => `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` === todayStr;
          const cellDate = (d) => `${calY}-${String(calMo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

          // ── Upcoming events list (next 60 days) ──
          const upcoming = [];
          const inRange = (d) => { const dt=new Date(d); return dt>=now && dt<=new Date(Date.now()+60*864e5); };
          for(const [d,evs] of Object.entries(events)){
            if(inRange(d)) evs.forEach(e=>upcoming.push({date:d,...e}));
          }
          upcoming.sort((a,b)=>a.date.localeCompare(b.date));

          const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
          const monthName=new Date(calY,calMo-1,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"});
          const prevMo=()=>{let m=calMo-1,y=calY;if(m<1){m=12;y--;}setCalMonth(`${y}-${String(m).padStart(2,"0")}`);};
          const nextMo=()=>{let m=calMo+1,y=calY;if(m>12){m=1;y++;}setCalMonth(`${y}-${String(m).padStart(2,"0")}`);};

          return(<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:"1rem",alignItems:"start"}}>

              {/* Calendar grid */}
              <div className="card" style={{padding:"1rem"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
                  <button onClick={prevMo} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"rgba(255,255,255,.7)",borderRadius:5,padding:".25rem .6rem",cursor:"pointer",fontSize:".85rem"}}>‹</button>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"#ffffff"}}>{monthName}</div>
                  <button onClick={nextMo} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"rgba(255,255,255,.7)",borderRadius:5,padding:".25rem .6rem",cursor:"pointer",fontSize:".85rem"}}>›</button>
                </div>

                {/* Day headers */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
                  {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:".63rem",color:"rgba(255,255,255,.38)",letterSpacing:".05em",padding:".3rem 0"}}>{d}</div>)}
                </div>

                {/* Calendar cells */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                  {Array.from({length:firstDay},(_,i)=><div key={"e"+i}/>)}
                  {Array.from({length:daysInMonth},(_,i)=>{
                    const day=i+1;
                    const key=cellDate(day);
                    const dayEvents=events[key]||[];
                    const today=isToday(calY,calMo,day);
                    return(
                    <div key={day} style={{
                      minHeight:56,padding:".3rem .28rem",borderRadius:5,position:"relative",
                      background:today?"rgba(201,168,76,.12)":"rgba(255,255,255,.02)",
                      border:`1px solid ${today?"rgba(201,168,76,.3)":"rgba(255,255,255,.05)"}`,
                    }}>
                      <div style={{fontSize:".72rem",color:today?"#c9a84c":"rgba(255,255,255,.5)",fontWeight:today?600:400,marginBottom:".2rem"}}>{day}</div>
                      {dayEvents.slice(0,2).map((e,idx)=>(
                        <div key={idx} style={{fontSize:".55rem",lineHeight:1.3,padding:"1px 3px",borderRadius:2,marginBottom:1,
                          background:`${e.color}22`,color:e.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                          title={e.label}>
                          {e.icon} {e.label.slice(0,14)}{e.label.length>14?"…":""}
                        </div>
                      ))}
                      {dayEvents.length>2&&<div style={{fontSize:".52rem",color:"rgba(255,255,255,.4)"}}>+{dayEvents.length-2} more</div>}
                    </div>);
                  })}
                </div>
              </div>

              {/* Upcoming events panel */}
              <div>
                <div className="card" style={{marginBottom:"1rem"}}>
                  <div className="ctitle">Upcoming (60 days)</div>
                  {upcoming.length===0?<div className="empty" style={{padding:".75rem 0"}}>Nothing due soon</div>:(
                    upcoming.map((e,i)=>{
                      const dt=new Date(e.date);
                      const daysLeft=Math.ceil((dt-now)/864e5);
                      return(
                      <div key={i} style={{display:"flex",gap:".6rem",padding:".6rem 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                        <div style={{fontSize:"1.1rem",flexShrink:0}}>{e.icon}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:".75rem",color:"#ffffff",lineHeight:1.4,marginBottom:".15rem"}}>{e.label}</div>
                          <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>{e.type}</div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:".7rem",color:e.color}}>{daysLeft===0?"Today":daysLeft===1?"Tomorrow":`${daysLeft}d`}</div>
                          <div style={{fontSize:".62rem",color:"rgba(255,255,255,.38)"}}>{dt.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                        </div>
                      </div>);
                    })
                  )}
                </div>

                {/* Legend */}
                <div className="card">
                  <div className="ctitle">Event Types</div>
                  {[
                    {icon:"📈",label:"SIP Dues",color:"#4caf9a"},
                    {icon:"🏦",label:"FD Maturity",color:"#f0a050"},
                    {icon:"🎯",label:"Goal Targets",color:"#c9a84c"},
                    {icon:"📋",label:"Tax Deadlines",color:"#e07c5a"},
                    {icon:"💰",label:"PPF Dates",color:"#a084ca"},
                    {icon:"🛡️",label:"80C Deadlines",color:"#5a9ce0"},
                  ].map(l=>(
                    <div key={l.label} style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".35rem"}}>
                      <div style={{fontSize:".85rem"}}>{l.icon}</div>
                      <div style={{fontSize:".73rem",color:"rgba(255,255,255,.65)"}}>{l.label}</div>
                      <div style={{width:8,height:8,borderRadius:"50%",background:l.color,marginLeft:"auto"}}/>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>);
        })()}


        {/* ── ASSET ALLOCATION PLANNER ── */}

        {/* ── ASK AI ── */}
        {tab==="ask"&&(
          <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 280px)",minHeight:500}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
              <div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"#ffffff"}}>✦ Advisor</div>
                <div style={{fontSize:".72rem",color:"rgba(255,255,255,.45)",marginTop:".2rem"}}>Ask anything about your holdings, returns, goals, or allocation</div>
              </div>
              {aiMessages.length>0&&<button className="btn-sm" onClick={()=>setAiMessages([])}>Clear chat</button>}
            </div>

            {/* Suggested questions — shown when chat is empty */}
            {aiMessages.length===0&&(
              <div style={{marginBottom:"1.2rem"}}>
                <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.38)",marginBottom:".65rem"}}>Suggested questions</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:".5rem"}}>
                  {[
                    "What is my total portfolio value today?",
                    "Which holding has the best XIRR?",
                    "How much have I invested in mutual funds?",
                    "What is Priya's total portfolio worth?",
                    "Which holdings are at a loss?",
                    "How far am I from my retirement goal?",
                    "What percentage of my portfolio is in equity?",
                    "Which is my largest single holding?",
                  ].map(q=>(
                    <button key={q} onClick={()=>{setAiInput(q);}}
                      style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",color:"rgba(255,255,255,.65)",padding:".38rem .8rem",borderRadius:20,cursor:"pointer",fontSize:".74rem",fontFamily:"'DM Sans',sans-serif",transition:"all .2s",textAlign:"left"}}
                      onMouseEnter={e=>{e.target.style.background="rgba(201,168,76,.1)";e.target.style.color="#c9a84c";e.target.style.borderColor="rgba(201,168,76,.3)";}}
                      onMouseLeave={e=>{e.target.style.background="rgba(255,255,255,.04)";e.target.style.color="rgba(255,255,255,.65)";e.target.style.borderColor="rgba(255,255,255,.1)";}}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:".85rem",paddingRight:".25rem",marginBottom:"1rem"}}>
              {aiMessages.map((m,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                  {/* Role label */}
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.38)",marginBottom:".3rem",letterSpacing:".06em",textTransform:"uppercase"}}>
                    {m.role==="user"?"You":"✦ Advisor"}
                  </div>
                  {/* Bubble */}
                  <div style={{
                    maxWidth:"80%",
                    padding:".75rem 1rem",
                    borderRadius: m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",
                    background: m.role==="user"?"rgba(201,168,76,.14)":"rgba(255,255,255,.04)",
                    border: m.role==="user"?"1px solid rgba(201,168,76,.3)":"1px solid rgba(255,255,255,.08)",
                    fontSize:".82rem",
                    lineHeight:1.65,
                    color: m.role==="user"?"#ffffff":"rgba(255,255,255,.85)",
                    whiteSpace:"pre-wrap",
                    fontFamily:"'DM Sans',sans-serif",
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {/* Typing indicator */}
              {aiLoading&&(
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
                  <div style={{fontSize:".62rem",color:"rgba(255,255,255,.38)",marginBottom:".3rem",letterSpacing:".06em",textTransform:"uppercase"}}>✦ Advisor</div>
                  <div style={{padding:".75rem 1rem",borderRadius:"12px 12px 12px 2px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",display:"flex",gap:".35rem",alignItems:"center"}}>
                    {[0,1,2].map(i=>(
                      <div key={i} style={{width:6,height:6,borderRadius:"50%",background:"rgba(201,168,76,.5)",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>
                    ))}
                  </div>
                </div>
              )}
              <div ref={aiBottomRef}/>
            </div>

            {/* Input bar */}
            <div style={{display:"flex",gap:".6rem",alignItems:"flex-end"}}>
              <textarea
                className="fi"
                rows={2}
                placeholder="Ask anything about your portfolio… e.g. 'Which MF has the best return?' or 'How much has Arjun invested?'"
                value={aiInput}
                onChange={e=>setAiInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askAI();}}}
                style={{flex:1,resize:"none",lineHeight:1.5,fontSize:".82rem",padding:".65rem .9rem"}}
              />
              <button className="btns" onClick={askAI} disabled={!aiInput.trim()||aiLoading}
                style={{padding:".65rem 1.2rem",whiteSpace:"nowrap",alignSelf:"stretch"}}>
                {aiLoading?"…":"Send ↵"}
              </button>
            </div>
            <div style={{fontSize:".65rem",color:"rgba(255,255,255,.32)",marginTop:".4rem",textAlign:"center"}}>
              Press Enter to send · Shift+Enter for new line · Conversation context is maintained across messages
            </div>
            <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
          </div>
        )}
      </main>
    </div>

    {/* Artifact panel */}
    {artifactHolding&&<ArtifactPanel holding={artifactHolding} onClose={()=>setArtifactHolding(null)}/>}

    {/* MODALS */}
    {modal==="holding"&&(
      <Overlay onClose={()=>{setModal(null);setEditHolding(null);setForm(BF);setMfSearch("");setMfResults([]);setMfNav(null);setStockInfo(null);setStockSearch("");setStockResults([]);setUsSearch("");setUsResults([]);setEtfSearch("");setEtfResults([]);setEtfInfo(null);}}>
        <div className="modtitle">{editHolding?"Edit":"Add"} Holding</div>
        <div style={{fontSize:".75rem",color:"rgba(255,255,255,.5)",marginBottom:"1rem",lineHeight:1.6}}>
          {editHolding?"Update instrument details below.":"Register the instrument. Transactions (buy/sell) are added separately via + Add > Log transaction."}
        </div>
        <div className="frow">
          <FG label="Member"><select className="fi fs" value={form.member_id} onChange={e=>setForm(f=>({...f,member_id:e.target.value}))}><option value="">Select</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></FG>
          <FG label="Asset Type"><select className="fi fs" value={form.type} onChange={e=>{setForm(f=>({...f,type:e.target.value}));setStockInfo(null);if(USD_TYPES.has(e.target.value))fetchUsdInr();}}>{Object.entries(AT).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</select></FG>
        </div>
        <FG label="Name"><input className="fi" placeholder="e.g. Reliance Industries" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></FG>
        {form.type==="IN_STOCK"&&(
          <div style={{marginBottom:".85rem"}}>
            <label className="flbl">Search Indian Stock (name or NSE/BSE ticker)</label>
            <div style={{position:"relative"}}>
              <input className="fi" placeholder="e.g. Reliance, HDFCBANK, Tata Motors…"
                value={stockSearch}
                onChange={e=>{
                  const v=e.target.value;
                  setStockSearch(v);
                  setStockResults([]);
                  setStockInfo(null);
                  clearTimeout(stockSearchTimer.current);
                  if(v.length<2){setStockSearching(false);return;}
                  setStockSearching(true);
                  stockSearchTimer.current=setTimeout(async()=>{
                    try{
                      const r=await api(`/api/stock/search?q=${encodeURIComponent(v)}&market=IN`);
                      setStockResults(r||[]);
                    }catch{setStockResults([]);}
                    setStockSearching(false);
                  },350);
                }}
                autoComplete="off"
              />
              {stockSearching&&<div style={{position:"absolute",right:".7rem",top:"50%",transform:"translateY(-50%)",fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Searching…</div>}
            </div>
            {stockResults.length>0&&(
              <div style={{background:"#0c1526",border:"1px solid rgba(224,124,90,.2)",borderRadius:"0 0 8px 8px",maxHeight:220,overflowY:"auto",marginTop:"-1px"}}>
                {stockResults.map(s=>(
                  <div key={s.ticker}
                    onClick={async()=>{
                      setStockSearch(s.name);
                      setStockResults([]);
                      setForm(f=>({...f,name:s.name,ticker:s.ticker}));
                      try{
                        const info=await api(`/api/stock/info?ticker=${encodeURIComponent(s.ticker)}&market=IN`);
                        setStockInfo(info);
                        if(info.found&&info.name) setForm(f=>({...f,name:info.name,ticker:s.ticker}));
                      }catch{setStockInfo({found:false});}
                    }}
                    style={{padding:".6rem .85rem",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:".8rem",lineHeight:1.4}}
                    onMouseEnter={x=>x.currentTarget.style.background="rgba(224,124,90,.08)"}
                    onMouseLeave={x=>x.currentTarget.style.background="transparent"}>
                    <div style={{color:"#ffffff",marginBottom:".12rem"}}>{s.name}</div>
                    <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",fontFamily:"'DM Mono',monospace"}}>{s.ticker} · {s.exchange}</div>
                  </div>
                ))}
              </div>
            )}
            {!stockSearching&&stockSearch.length>=2&&stockResults.length===0&&!stockInfo&&(
              <div style={{marginTop:".45rem",fontSize:".72rem",color:"rgba(255,255,255,.42)"}}>
                No results — try ticker directly:&nbsp;
                <input className="fi" style={{display:"inline",width:130,padding:".28rem .5rem",fontSize:".72rem"}}
                  placeholder="e.g. RELIANCE"
                  onChange={e=>{
                    const t=e.target.value.toUpperCase();
                    setForm(f=>({...f,ticker:t}));
                    handleTickerChange(t,"IN");
                  }}/>
              </div>
            )}
            {stockInfo&&stockInfo.found&&(
              <div style={{marginTop:".5rem",padding:".6rem .85rem",background:"rgba(224,124,90,.07)",border:"1px solid rgba(224,124,90,.22)",borderRadius:7,fontSize:".75rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"#e07c5a",fontWeight:500}}>{stockInfo.name}</div>
                  <div style={{color:"rgba(255,255,255,.5)",fontSize:".67rem"}}>{stockInfo.exchange} · {form.ticker} · NSE/BSE</div>
                </div>
                {stockInfo.price&&<div style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c",fontSize:".9rem"}}>₹{stockInfo.price.toLocaleString("en-IN",{maximumFractionDigits:2})}</div>}
              </div>
            )}
          </div>
        )}

        {form.type==="IN_ETF"&&(
          <div style={{marginBottom:".85rem"}}>
            <label className="flbl">Search Indian ETF</label>
            <div style={{position:"relative"}}>
              <input className="fi"
                placeholder="Type ETF name e.g. Nifty BeES, Gold, Midcap…"
                value={etfSearch}
                onChange={e=>{
                  handleEtfSearch(e.target.value);
                  setForm(f=>({...f, name:e.target.value, ticker:""}));
                  setEtfInfo(null);
                }}
                autoComplete="off"
              />
              {etfSearching&&<div style={{position:"absolute",right:".7rem",top:"50%",transform:"translateY(-50%)",fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Searching…</div>}
            </div>
            {/* Dropdown results */}
            {etfResults.length>0&&(
              <div style={{background:"#0c1526",border:"1px solid rgba(240,160,80,.2)",borderRadius:"0 0 8px 8px",maxHeight:220,overflowY:"auto",marginTop:"-1px"}}>
                {etfResults.map(e=>(
                  <div key={e.ticker}
                    onClick={()=>selectEtf(e)}
                    style={{padding:".6rem .85rem",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:".8rem",lineHeight:1.4}}
                    onMouseEnter={x=>x.currentTarget.style.background="rgba(240,160,80,.08)"}
                    onMouseLeave={x=>x.currentTarget.style.background="transparent"}>
                    <div style={{color:"#ffffff",marginBottom:".15rem"}}>{e.name}</div>
                    <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",fontFamily:"'DM Mono',monospace"}}>{e.ticker} · {e.exchange}</div>
                  </div>
                ))}
              </div>
            )}
            {/* No results message */}
            {!etfSearching&&etfSearch.length>=2&&etfResults.length===0&&(
              <div style={{marginTop:".5rem",fontSize:".72rem",color:"rgba(255,255,255,.45)"}}>
                No ETFs found — try a shorter search term or enter ticker directly below
              </div>
            )}
            {/* Selected ETF info card */}
            {form.ticker&&etfInfo&&etfInfo.found&&(
              <div style={{marginTop:".6rem",padding:".7rem .9rem",background:"rgba(240,160,80,.07)",border:"1px solid rgba(240,160,80,.25)",borderRadius:7,fontSize:".75rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"#f0a050",fontWeight:500}}>{etfInfo.name||form.name}</div>
                  <div style={{color:"rgba(255,255,255,.5)",fontSize:".67rem"}}>{etfInfo.exchange} · {form.ticker}.NS · ETF</div>
                </div>
                {etfInfo.price&&<div style={{textAlign:"right"}}><div style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c",fontSize:".9rem"}}>₹{etfInfo.price.toLocaleString("en-IN",{maximumFractionDigits:2})}</div><div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Current price</div></div>}
              </div>
            )}
            {/* Manual ticker fallback */}
            {!form.ticker&&(
              <div style={{marginTop:".5rem",display:"flex",alignItems:"center",gap:".5rem",fontSize:".7rem",color:"rgba(255,255,255,.4)"}}>
                Or enter ticker directly:
                <input className="fi" style={{width:140,padding:".3rem .6rem",fontSize:".72rem",display:"inline"}}
                  placeholder="e.g. NIFTYBEES"
                  onChange={e=>{setForm(f=>({...f,ticker:e.target.value.toUpperCase()}));}}/>
              </div>
            )}
          </div>
        )}
        {USD_TYPES.has(form.type)&&(
          <div style={{marginBottom:".85rem"}}>
            <label className="flbl">{form.type==="CRYPTO"?"Search Cryptocurrency":form.type==="US_ETF"?"Search US ETF":form.type==="US_BOND"?"Search US Bond / Treasury ETF":"Search US Stock (company name or ticker)"}</label>
            <div style={{position:"relative"}}>
              <input className="fi" placeholder={form.type==="CRYPTO"?"e.g. Bitcoin, ETH, Solana…":form.type==="US_ETF"?"e.g. VOO, SPY, QQQ, VTI, SCHD…":"e.g. Apple, NVDA, Microsoft, Tesla…"}
                value={usSearch}
                onChange={e=>{
                  const v=e.target.value;
                  setUsSearch(v);
                  setUsResults([]);
                  setStockInfo(null);
                  clearTimeout(usSearchTimer.current);
                  if(v.length<2){setUsSearching(false);return;}
                  setUsSearching(true);
                  usSearchTimer.current=setTimeout(async()=>{
                    try{
                      const r=await api(`/api/stock/search?q=${encodeURIComponent(v)}&market=US`);
                      setUsResults(r||[]);
                    }catch{setUsResults([]);}
                    setUsSearching(false);
                  },350);
                }}
                autoComplete="off"
              />
              {usSearching&&<div style={{position:"absolute",right:".7rem",top:"50%",transform:"translateY(-50%)",fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Searching…</div>}
            </div>
            {usResults.length>0&&(
              <div style={{background:"#0c1526",border:"1px solid rgba(90,156,224,.2)",borderRadius:"0 0 8px 8px",maxHeight:220,overflowY:"auto",marginTop:"-1px"}}>
                {usResults.map(s=>(
                  <div key={s.ticker}
                    onClick={async()=>{
                      setUsSearch(s.name);
                      setUsResults([]);
                      setForm(f=>({...f,name:s.name,ticker:s.ticker}));
                      try{
                        const info=await api(`/api/stock/info?ticker=${encodeURIComponent(s.ticker)}&market=US`);
                        setStockInfo(info);
                        if(info.found&&info.name) setForm(f=>({...f,name:info.name,ticker:s.ticker}));
                      }catch{setStockInfo({found:false});}
                    }}
                    style={{padding:".6rem .85rem",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:".8rem",lineHeight:1.4}}
                    onMouseEnter={x=>x.currentTarget.style.background="rgba(90,156,224,.08)"}
                    onMouseLeave={x=>x.currentTarget.style.background="transparent"}>
                    <div style={{color:"#ffffff",marginBottom:".12rem"}}>{s.name}</div>
                    <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",fontFamily:"'DM Mono',monospace"}}>{s.ticker} · {s.exchange}</div>
                  </div>
                ))}
              </div>
            )}
            {!usSearching&&usSearch.length>=2&&usResults.length===0&&!stockInfo&&(
              <div style={{marginTop:".45rem",fontSize:".72rem",color:"rgba(255,255,255,.42)"}}>
                No results — enter ticker directly:&nbsp;
                <input className="fi" style={{display:"inline",width:120,padding:".28rem .5rem",fontSize:".72rem"}}
                  placeholder="e.g. AAPL"
                  onChange={e=>{
                    const t=e.target.value.toUpperCase();
                    setForm(f=>({...f,ticker:t}));
                    handleTickerChange(t,"US");
                  }}/>
              </div>
            )}
            {stockInfo&&stockInfo.found&&(
              <div style={{marginTop:".5rem",padding:".6rem .85rem",background:"rgba(90,156,224,.07)",border:"1px solid rgba(90,156,224,.22)",borderRadius:7,fontSize:".75rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".4rem"}}>
                  <div>
                    <div style={{color:"#5a9ce0",fontWeight:500}}>{stockInfo.name}</div>
                    <div style={{color:"rgba(255,255,255,.5)",fontSize:".67rem"}}>{stockInfo.exchange} · {form.ticker} · {stockInfo.currency}</div>
                  </div>
                  {stockInfo.price&&(
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c",fontSize:".9rem"}}>${stockInfo.price.toLocaleString("en-US",{maximumFractionDigits:2})}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",color:"rgba(255,255,255,.55)",fontSize:".72rem"}}>₹{(stockInfo.price*(+form.usd_inr_rate||_liveUsdInr)).toLocaleString("en-IN",{maximumFractionDigits:0})}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="frow" style={{marginTop:".7rem"}}>
              <div>
                <label className="flbl">USD/INR Rate</label>
                <div style={{position:"relative"}}>
                  <input type="number" className="fi" value={form.usd_inr_rate}
                    onChange={e=>setForm(f=>({...f,usd_inr_rate:e.target.value}))}/>
                  <button onClick={fetchUsdInr} disabled={usdInrLoading}
                    style={{position:"absolute",right:".4rem",top:"50%",transform:"translateY(-50%)",background:"rgba(201,168,76,.15)",border:"1px solid rgba(201,168,76,.3)",color:"#c9a84c",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:".62rem",fontFamily:"'DM Sans',sans-serif"}}>
                    {usdInrLoading?"…":"⟳ Live"}
                  </button>
                </div>
                <div style={{fontSize:".65rem",color:"rgba(255,255,255,.4)",marginTop:".2rem"}}>1 USD = ₹{(+form.usd_inr_rate||_liveUsdInr).toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
        {form.type==="MF"&&(
          <div style={{marginBottom:".85rem"}}>
            <label className="flbl">Search Mutual Fund</label>
            <div style={{position:"relative"}}>
              <input
                className="fi"
                placeholder="Type fund name e.g. Mirae Asset Large Cap..."
                value={mfSearch}
                onChange={e=>{
                  handleMfSearch(e.target.value);
                  setForm(f=>({...f,name:e.target.value,scheme_code:""}));
                  setMfNav(null);
                }}
                autoComplete="off"
              />
              {mfSearching&&<div style={{position:"absolute",right:".7rem",top:"50%",transform:"translateY(-50%)",fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Searching…</div>}
            </div>
            {/* Search results dropdown */}
            {mfResults.length>0&&(
              <div style={{background:"#0c1526",border:"1px solid rgba(201,168,76,.2)",borderRadius:"0 0 8px 8px",maxHeight:220,overflowY:"auto",marginTop:"-1px"}}>
                {mfResults.map(f=>(
                  <div key={f.scheme_code}
                    onClick={()=>selectMfFund(f)}
                    style={{padding:".6rem .85rem",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:".8rem",color:"rgba(255,255,255,.85)",lineHeight:1.4}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(201,168,76,.08)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{color:"#ffffff",marginBottom:".15rem"}}>{f.name}</div>
                    <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",fontFamily:"'DM Mono',monospace"}}>Code: {f.scheme_code}</div>
                  </div>
                ))}
              </div>
            )}
            {/* Selected fund info card */}
            {form.scheme_code&&mfNav&&(
              <div style={{marginTop:".6rem",padding:".7rem .9rem",background:"rgba(160,132,202,.08)",border:"1px solid rgba(160,132,202,.25)",borderRadius:7,fontSize:".75rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:".35rem"}}>
                  <div>
                    <div style={{color:"#a084ca",fontWeight:500,marginBottom:".2rem"}}>{form.name}</div>
                    <div style={{color:"rgba(255,255,255,.5)",fontSize:".68rem"}}>{mfNav.fund_house}</div>
                    {mfNav.scheme_category&&<div style={{color:"rgba(255,255,255,.45)",fontSize:".65rem"}}>{mfNav.scheme_category}</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:"1rem"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1rem",color:"#c9a84c"}}>₹{mfNav.nav?.toFixed(4)}</div>
                    <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Current NAV · {mfNav.date}</div>
                    <div style={{fontSize:".65rem",fontFamily:"'DM Mono',monospace",color:"rgba(255,255,255,.4)",marginTop:".15rem"}}>Code: {form.scheme_code}</div>
                  </div>
                </div>
                <div style={{fontSize:".68rem",color:"#4caf9a"}}>✓ Live NAV will be fetched automatically on refresh</div>
              </div>
            )}
            {/* Manual scheme code fallback */}
            {!form.scheme_code&&!mfSearching&&mfSearch.length===0&&(
              <div style={{marginTop:".5rem",fontSize:".7rem",color:"rgba(255,255,255,.38)"}}>
                Or enter scheme code directly:&nbsp;
                <input className="fi" style={{display:"inline",width:"auto",padding:".3rem .6rem",fontSize:".72rem"}}
                  placeholder="e.g. 119551"
                  onChange={e=>setForm(f=>({...f,scheme_code:e.target.value}))}/>
              </div>
            )}
          </div>
        )}
        {form.type==="FD"&&<div className="frow"><FG label="Principal ₹" style={{marginBottom:"1.5rem"}}><FmtInput value={form.principal||""} placeholder="e.g. 100000" onChange={e=>setForm(f=>({...f,principal:e.target.value}))}/></FG><FG label="Rate % p.a."><input type="number" className="fi" value={form.interest_rate||""} onChange={e=>setForm(f=>({...f,interest_rate:e.target.value}))}/></FG><FG label="Maturity Date"><input type="date" className="fi" value={form.maturity_date||""} onChange={e=>setForm(f=>({...f,maturity_date:e.target.value}))}/></FG></div>}
        {(form.type==="PPF"||form.type==="EPF")&&<FG label={`Current Corpus ₹ (auto-grows at ${form.type==="PPF"?PPF_R:EPF_R}% p.a.)`}><input type="number" className="fi" value={form.principal||""} onChange={e=>setForm(f=>({...f,principal:e.target.value}))}/></FG>}
        {form.type==="REAL_ESTATE"&&<div className="frow"><FG label="Purchase Value ₹" style={{marginBottom:"1.5rem"}}><FmtInput value={form.purchase_value||""} placeholder="e.g. 5000000" onChange={e=>setForm(f=>({...f,purchase_value:e.target.value}))}/></FG><FG label="Current Value ₹" style={{marginBottom:"1.5rem"}}><FmtInput value={form.current_value||""} placeholder="e.g. 7500000" onChange={e=>setForm(f=>({...f,current_value:e.target.value}))}/></FG></div>}
        <FG label="Start Date"><input type="date" className="fi" value={form.start_date||""} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></FG>
        {["IN_STOCK","IN_ETF","US_STOCK","US_ETF","US_BOND","CRYPTO","MF"].includes(form.type)&&!editHolding&&(
          <div style={{fontSize:".72rem",color:"#4caf9a",padding:".55rem .8rem",background:"rgba(76,175,154,.07)",border:"1px solid rgba(76,175,154,.2)",borderRadius:6,marginTop:".25rem"}}>
            ✓ After saving, the transaction panel will open automatically to record your first buy.
          </div>
        )}
        <MA><button className="btnc" onClick={()=>{setModal(null);setEditHolding(null);setForm(BF);setMfSearch("");setMfResults([]);setMfNav(null);setStockInfo(null);setStockSearch("");setStockResults([]);setUsSearch("");setUsResults([]);setEtfSearch("");setEtfResults([]);setEtfInfo(null);}}>Cancel</button><button className="btns" onClick={saveHolding} disabled={!form.name||!form.member_id}>{editHolding?"Save Changes":"Add Holding"}</button></MA>
      </Overlay>
    )}

    {/* Global Add Transaction modal */}
    {globalTxnModal&&(()=>{
      const selHolding = holdings.find(h=>h.id===txnForm.holding_id);
      const isUS = USD_TYPES.has(selHolding?.type);
      const fxRate = +(selHolding?.usd_inr_rate||usdInrRate||_liveUsdInr);
      const priceUsd = isUS ? +txnForm.price_usd||0 : 0;
      const totalUsd = isUS ? priceUsd * +txnForm.units : 0;
      const totalInr = isUS ? totalUsd * fxRate : +txnForm.price * +txnForm.units;
      // Filter holdings by selected member + type
      const filteredHoldings = holdings
        .filter(h=>["IN_STOCK","IN_ETF","US_STOCK","US_ETF","US_BOND","CRYPTO","MF"].includes(h.type))
        .filter(h=>txnFilterMember==="all"||h.member_id===txnFilterMember)
        .filter(h=>txnFilterType==="ALL"||h.type===txnFilterType);
      return (
      <Overlay onClose={()=>setGlobalTxnModal(false)}>
        <div className="modtitle">Add Transaction</div>

        {/* Filter row */}
        <div style={{display:"flex",gap:".6rem",marginBottom:"1rem",padding:".75rem",background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:".63rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".35rem"}}>Member</div>
            <select className="fi fs" style={{marginBottom:0}} value={txnFilterMember} onChange={e=>{setTxnFilterMember(e.target.value);setTxnForm(p=>({...p,holding_id:"",price:"",price_usd:"",units:""}));setGlobalMfAmount("");setGlobalMfNav(null);setGlobalNavError("");}}>
              <option value="all">All Members</option>
              {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:".63rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".35rem"}}>Asset Type</div>
            <select className="fi fs" style={{marginBottom:0}} value={txnFilterType} onChange={e=>{setTxnFilterType(e.target.value);setTxnForm(p=>({...p,holding_id:"",price:"",price_usd:"",units:""}));setGlobalMfAmount("");setGlobalMfNav(null);setGlobalNavError("");}}>
              <option value="ALL">All Types</option>
              {["US_STOCK","US_ETF","US_BOND","CRYPTO","IN_STOCK","IN_ETF","MF"].map(t=><option key={t} value={t}>{AT[t].icon} {AT[t].label}</option>)}
            </select>
          </div>
        </div>

        <FG label={`Holding ${filteredHoldings.length>0?`(${filteredHoldings.length} shown)`:""}`}>
          <select className="fi fs" value={txnForm.holding_id} onChange={e=>{
            const h=holdings.find(x=>x.id===e.target.value);
            setTxnForm(p=>({...p,holding_id:e.target.value,price:"",price_usd:"",units:""}));
            setGlobalMfAmount(""); setGlobalMfNav(null); setGlobalNavError("");
            if(h && USD_TYPES.has(h.type)) fetchUsdInr();
          }}>
            <option value="">Select holding…</option>
            {filteredHoldings.map(h=>{
              const mn=members.find(m=>m.id===h.member_id)?.name||"";
              const a=AT[h.type]||{label:h.type||"Other",color:"#888",icon:"📦"};
              return <option key={h.id} value={h.id}>{a.icon} {h.name}{mn?` · ${mn}`:""}</option>;
            })}
          </select>
        </FG>
        <div className="frow">
          <FG label="Type">
            <select className="fi fs" value={txnForm.txn_type} onChange={e=>setTxnForm(p=>({...p,txn_type:e.target.value}))}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </FG>
          {/* MF: amount-first flow */}
          {selHolding?.type==="MF" ? (
            <FG label="Amount Invested ₹">
              <input type="number" className="fi" placeholder="e.g. 5000"
                value={globalMfAmount}
                onChange={e=>{setGlobalMfAmount(e.target.value);setGlobalMfNav(null);setGlobalNavError("");}}
              />
            </FG>
          ) : isUS ? (
            <FG label="Price $ per unit">
              <input type="number" className="fi" placeholder="e.g. 189.50" value={txnForm.price_usd||""} onChange={e=>{
                const usd=e.target.value;
                setTxnForm(p=>({...p,price_usd:usd,price:usd?(+usd*fxRate).toFixed(2):""}));
              }}/>
            </FG>
          ) : (
            <FG label="Price ₹ per unit">
              <input type="number" className="fi" placeholder="e.g. 2450" value={txnForm.price} onChange={e=>setTxnForm(p=>({...p,price:e.target.value}))}/>
            </FG>
          )}
          {/* Non-MF units */}
          {selHolding?.type!=="MF"&&(
            <FG label="Units">
              <input type="number" className="fi" placeholder="e.g. 50" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/>
            </FG>
          )}
        </div>
        {/* MF: date + fetch NAV row */}
        {selHolding?.type==="MF"&&(
          <div style={{marginBottom:".85rem"}}>
            <FG label="Date">
              <input type="date" className="fi" value={txnForm.txn_date}
                onChange={e=>{setTxnForm(p=>({...p,txn_date:e.target.value}));setGlobalMfNav(null);setGlobalNavError("");}}
              />
            </FG>
            <div style={{display:"flex",alignItems:"center",gap:".6rem",marginTop:".5rem",padding:".6rem .85rem",
              background:"rgba(160,132,202,.06)",border:"1px solid rgba(160,132,202,.18)",borderRadius:7}}>
              <div style={{flex:1,fontSize:".75rem",color:"rgba(255,255,255,.55)"}}>
                {globalMfNav
                  ? <><span style={{color:"#a084ca",fontWeight:500}}>NAV: ₹{globalMfNav.nav?.toFixed(4)}</span>
                      <span style={{marginLeft:".5rem",color:"rgba(255,255,255,.45)",fontSize:".68rem"}}>
                        {globalMfNav.is_estimated?"Est. ":"Exact "}{globalMfNav.date}
                      </span>
                    </>
                  : (txnForm.txn_date?"Click Fetch NAV to get NAV for this date":"Select a date first")}
              </div>
              <button onClick={async()=>{
                if(!txnForm.txn_date||!selHolding?.scheme_code) return;
                setGlobalNavLoading(true); setGlobalNavError("");
                try{
                  const d=new Date(txnForm.txn_date);
                  const res=await api("/api/mf/sip-navs",{method:"POST",body:JSON.stringify({
                    scheme_code:selHolding.scheme_code,
                    months:[{year:d.getFullYear(),month:d.getMonth()+1,sip_date:d.getDate()}]
                  })});
                  const r=res.results?.[0];
                  if(r?.nav){
                    setGlobalMfNav({nav:r.nav,date:r.nav_date,is_estimated:r.is_estimated});
                    if(globalMfAmount) setTxnForm(p=>({...p,units:(+globalMfAmount/r.nav).toFixed(4),price:r.nav.toString()}));
                  } else { setGlobalNavError("NAV not found for this date"); }
                }catch(e){ setGlobalNavError(e.message); }
                setGlobalNavLoading(false);
              }} disabled={globalNavLoading||!txnForm.txn_date}
                style={{background:"rgba(160,132,202,.15)",border:"1px solid rgba(160,132,202,.3)",color:"#a084ca",
                  borderRadius:5,padding:".32rem .75rem",cursor:"pointer",fontSize:".72rem",
                  fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0,
                  opacity:(!txnForm.txn_date||globalNavLoading)?.5:1}}>
                {globalNavLoading?"…":"⟳ Fetch NAV"}
              </button>
            </div>
            {globalNavError&&<div style={{marginTop:".3rem",fontSize:".68rem",color:"rgba(224,124,90,.7)"}}>⚠ {globalNavError}</div>}
            {/* Units preview */}
            {globalMfNav&&globalMfAmount&&(
              <div style={{marginTop:".5rem",display:"flex",gap:"1.5rem",padding:".55rem .85rem",
                background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:6,fontSize:".72rem"}}>
                <div><div style={{color:"rgba(255,255,255,.45)",marginBottom:".15rem"}}>Amount</div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:"#c9a84c"}}>₹{Number(globalMfAmount).toLocaleString("en-IN")}</div></div>
                <div><div style={{color:"rgba(255,255,255,.45)",marginBottom:".15rem"}}>Units Allotted</div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:"#ffffff"}}>{(+globalMfAmount/globalMfNav.nav).toFixed(4)}</div></div>
                <div><div style={{color:"rgba(255,255,255,.45)",marginBottom:".15rem"}}>NAV</div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:"#ffffff"}}>₹{globalMfNav.nav?.toFixed(4)}</div></div>
              </div>
            )}
          </div>
        )}
        {/* USD/INR info row for US stocks */}
        {isUS&&(
          <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".85rem",padding:".6rem .85rem",background:"rgba(90,156,224,.06)",border:"1px solid rgba(90,156,224,.2)",borderRadius:7}}>
            <div style={{flex:1}}>
              <div style={{fontSize:".68rem",color:"rgba(255,255,255,.5)",marginBottom:".25rem"}}>Exchange Rate</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:".85rem",color:"#5a9ce0"}}>1 USD = ₹{fxRate.toFixed(2)}</div>
            </div>
            {txnForm.price_usd&&(
              <div style={{flex:1}}>
                <div style={{fontSize:".68rem",color:"rgba(255,255,255,.5)",marginBottom:".25rem"}}>Price in INR</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:".85rem",color:"#c9a84c"}}>₹{(+txnForm.price_usd*fxRate).toLocaleString("en-IN",{maximumFractionDigits:2})}</div>
              </div>
            )}
            <button onClick={fetchUsdInr} disabled={usdInrLoading}
              style={{background:"rgba(90,156,224,.15)",border:"1px solid rgba(90,156,224,.3)",color:"#5a9ce0",borderRadius:4,padding:".3rem .7rem",cursor:"pointer",fontSize:".68rem",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>
              {usdInrLoading?"…":"⟳ Refresh Rate"}
            </button>
          </div>
        )}
        <div className="frow">
          {selHolding?.type!=="MF"&&(
            <FG label="Date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
          )}
          <FG label="Notes (optional)"><input className="fi" placeholder="e.g. SIP, bonus, tax harvesting" value={txnForm.notes} onChange={e=>setTxnForm(p=>({...p,notes:e.target.value}))}/></FG>
        </div>
        {/* Total value summary */}
        {txnForm.holding_id&&txnForm.units&&txnForm.price&&(
          <div style={{padding:".65rem .9rem",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:7,marginBottom:".5rem",display:"flex",gap:"1.5rem",flexWrap:"wrap"}}>
            {isUS&&totalUsd>0&&(
              <div>
                <div style={{fontSize:".62rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".2rem"}}>Total (USD)</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#5a9ce0"}}>${totalUsd.toLocaleString("en-US",{maximumFractionDigits:2})}</div>
              </div>
            )}
            <div>
              <div style={{fontSize:".62rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".2rem"}}>Total (INR)</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:".9rem",color:"#c9a84c"}}>₹{totalInr.toLocaleString("en-IN",{maximumFractionDigits:0})}</div>
            </div>
            {isUS&&(
              <div>
                <div style={{fontSize:".62rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".2rem"}}>Rate used</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:".85rem",color:"rgba(255,255,255,.55)"}}>₹{fxRate.toFixed(2)}</div>
              </div>
            )}
          </div>
        )}
        <MA>
          <button className="btnc" onClick={()=>{setGlobalTxnModal(false);setGlobalMfAmount("");setGlobalMfNav(null);setGlobalNavError("");}}>Cancel</button>
          <button className="btns" onClick={addTransaction}
            disabled={!txnForm.holding_id||!txnForm.txn_date||(selHolding?.type==="MF"?(!globalMfAmount||!globalMfNav?.nav):(!txnForm.units||!txnForm.price))}>
            Save Transaction
          </button>
        </MA>
      </Overlay>
      );
    })()}

    {/* Inline transaction history panel (opened from 📋 button on holding row) */}
    {txnHolding&&<TransactionPanel holding={txnHolding} txnForm={txnForm} setTxnForm={setTxnForm} onAddTxn={addTransaction} onReload={reloadHoldings} onDeleteTxn={deleteTransaction} onClose={()=>setTxnHolding(null)} onFetchFx={fetchUsdInr} fxRate={usdInrRate} fxLoading={usdInrLoading}/>}
    {modal==="member"&&(<Overlay onClose={()=>{setModal(null);setEditingMemberId(null);setMergeCandidate(null);}} narrow>
      <div className="modtitle">{editingMemberId?"Edit Member":"Add Family Member"}</div>
      <FG label="Full Name">
        <input className="fi" value={newMember.name} placeholder="e.g. Avinash Tallam"
          onChange={e=>handleMemberNameChange(e.target.value)}/>
      </FG>
      {/* ── Merge suggestion ── */}
      {mergeCandidate&&!editingMemberId&&(
        <div style={{background:"rgba(160,132,202,.1)",border:"1px solid rgba(160,132,202,.3)",borderRadius:8,padding:".75rem .9rem",marginBottom:".8rem"}}>
          <div style={{fontSize:".78rem",color:"rgba(255,255,255,.85)",marginBottom:".5rem"}}>
            🔗 Is this the same person as <strong style={{color:"#a084ca"}}>{mergeCandidate.name}</strong>
            {mergeCandidate.relation?` (${mergeCandidate.relation})`:""} ?
          </div>
          <div style={{fontSize:".68rem",color:"rgba(255,255,255,.5)",marginBottom:".6rem"}}>
            {holdings.filter(h=>h.member_id===mergeCandidate.id).length} holdings already assigned to this member
          </div>
          <div style={{display:"flex",gap:".5rem"}}>
            <button className="btns" style={{fontSize:".72rem",padding:".35rem .8rem"}}
              onClick={()=>{
                // Use existing member — close modal
                setNewMember({name:"",relation:"",email:""}); setMergeCandidate(null); setModal(null);
              }}>Yes, use "{mergeCandidate.name}"</button>
            <button className="btnc" style={{fontSize:".72rem",padding:".35rem .8rem"}}
              onClick={()=>setMergeCandidate(null)}>No, add as separate</button>
          </div>
        </div>
      )}
      <FG label="Relation">
        <select className="fi fs" value={newMember.relation} onChange={e=>setNewMember(p=>({...p,relation:e.target.value}))}>
          <option value="">Select</option>
          {["Self","Spouse","Son","Daughter","Father","Mother","Sibling"].map(r=><option key={r} value={r}>{r}</option>)}
        </select>
      </FG>
      <FG label="Email (required — enables shared login access)">
        <input className="fi" type="email" value={newMember.email||""} placeholder="e.g. priya@gmail.com"
          onChange={e=>setNewMember(p=>({...p,email:e.target.value}))}/>
        <div style={{fontSize:".62rem",color:"rgba(255,255,255,.38)",marginTop:".3rem",lineHeight:1.5}}>
          This person will be able to see your portfolio when they log in with this email.
          They'll need to sign up first if they don't have an account.
        </div>
      </FG>
      {/* Cross-link checkbox — only show when user has existing family shares */}
      {sharedWithMe.length > 0 && !editingMemberId && (
        <label style={{display:"flex",alignItems:"center",gap:".5rem",fontSize:".75rem",color:"rgba(255,255,255,.7)",marginBottom:".8rem",cursor:"pointer"}}>
          <input type="checkbox" checked={shareWithFamily} onChange={e=>setShareWithFamily(e.target.checked)} style={{accentColor:"#a084ca"}}/>
          Also share with existing family members ({sharedWithMe.map(s=>s.owner_name).join(", ")})
        </label>
      )}
      <MA>
        <button className="btnc" onClick={()=>{setModal(null);setEditingMemberId(null);setMergeCandidate(null);}}>Cancel</button>
        <button className="btns" onClick={saveMember} disabled={!newMember.name.trim() || (newMember.relation !== "Self" && !(newMember.email||"").trim())}>
          {editingMemberId?"Save Changes":"Add Member"}
        </button>
      </MA>
    </Overlay>)}
    {modal==="goal"&&(
      <Overlay onClose={()=>{setModal(null);setEditGoalId(null);}}>
        <div className="modtitle">{editGoalId ? "Edit Financial Goal" : "Add Financial Goal"}</div>
        <FG label="Goal Name"><input className="fi" placeholder="e.g. Daughter's Education" value={goalForm.name} onChange={e=>setGoalForm(p=>({...p,name:e.target.value}))}/></FG>
        <div className="frow">
          <FG label="Target Amount ₹" style={{marginBottom:"1.5rem"}}><FmtInput placeholder="e.g. 5000000" value={goalForm.targetAmount} onChange={e=>setGoalForm(p=>({...p,targetAmount:e.target.value}))}/></FG>
          <FG label="Target Date"><input type="date" className="fi" value={goalForm.targetDate} onChange={e=>setGoalForm(p=>({...p,targetDate:e.target.value}))}/></FG>
        </div>
        <div className="frow">
          <FG label="Category">
            <select className="fi fs" value={goalForm.category} onChange={e=>setGoalForm(p=>({...p,category:e.target.value}))}>
              {["Retirement","Education","Real Estate","Emergency Fund","Wedding","Travel","Business"].map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </FG>
          <FG label="Priority (1 = highest)">
            <input type="number" className="fi" min="1" max="20" value={goalForm.priority} onChange={e=>setGoalForm(p=>({...p,priority:+e.target.value}))}/>
          </FG>
          <FG label="Colour"><input type="color" className="fi" value={goalForm.color} onChange={e=>setGoalForm(p=>({...p,color:e.target.value}))} style={{height:40,padding:"4px 8px",cursor:"pointer"}}/></FG>
        </div>

        {/* Member allocation */}
        <div className="fg">
          <label className="flbl">Link to Members</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:".4rem",marginTop:".3rem"}}>
            {[{id:"all",name:"All Members"},...members].map(m=>{
              const lm=goalForm.linkedMembers||["all"];
              const sel=lm.includes(m.id);
              return(
              <div key={m.id} onClick={()=>setGoalForm(p=>{
                const cur=p.linkedMembers||["all"];
                if(m.id==="all") return {...p,linkedMembers:["all"]};
                const without=cur.filter(x=>x!=="all"&&x!==m.id);
                const next=sel?without:[...without,m.id];
                return {...p,linkedMembers:next.length===0?["all"]:next};
              })}
              style={{padding:".3rem .75rem",borderRadius:20,cursor:"pointer",fontSize:".74rem",fontWeight:500,
                background:sel?"rgba(201,168,76,.16)":"rgba(255,255,255,.04)",
                border:`1px solid ${sel?"rgba(201,168,76,.45)":"rgba(255,255,255,.1)"}`,
                color:sel?"#c9a84c":"rgba(255,255,255,.6)",transition:"all .15s"}}>
                {m.id==="all"?"👨‍👩‍👧‍👦":m.name[0]} {m.name}
              </div>);
            })}
          </div>
          <div style={{fontSize:".65rem",color:"rgba(255,255,255,.38)",marginTop:".4rem"}}>Progress = selected members' holdings filtered by asset types below.</div>
        </div>

        {/* Linked asset types — which asset classes fund this goal */}
        <div className="fg">
          <label className="flbl">Fund with Asset Types</label>
          <div style={{fontSize:".63rem",color:"rgba(255,255,255,.35)",marginBottom:".4rem"}}>Select which asset classes count toward this goal. Leave empty = entire portfolio.</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>
            {Object.entries(AT).map(([type,a])=>{
              const sel=(goalForm.linkedTypes||[]).includes(type);
              const lm=goalForm.linkedMembers||["all"];
              const memberH = lm.includes("all") ? holdings : holdings.filter(h=>lm.includes(h.member_id));
              const typeCount=memberH.filter(h=>h.type===type).length;
              const typeVal=memberH.filter(h=>h.type===type).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
              // Check if this type is already assigned to another goal
              const conflictGoal=goals.find(g=>g.id!==editGoalId&&(g.linkedTypes||[]).includes(type)&&(()=>{
                const glm=g.linkedMembers||["all"];
                return lm.includes("all")||glm.includes("all")||lm.some(mid=>glm.includes(mid));
              })());
              return(
              <div key={type} onClick={()=>setGoalForm(p=>{
                const cur=new Set(p.linkedTypes||[]);
                sel?cur.delete(type):cur.add(type);
                return {...p,linkedTypes:[...cur]};
              })}
              style={{display:"flex",alignItems:"center",gap:".4rem",padding:".35rem .65rem",borderRadius:6,cursor:"pointer",
                background:sel?(conflictGoal?"rgba(224,124,90,.1)":a.color+"18"):"rgba(255,255,255,.03)",
                border:`1px solid ${sel?(conflictGoal?"rgba(224,124,90,.45)":a.color+"55"):"rgba(255,255,255,.08)"}`,
                transition:"all .12s",opacity:typeCount===0&&!sel?.5:1}}
              onMouseEnter={e=>{if(!sel)e.currentTarget.style.borderColor="rgba(255,255,255,.2)";}}
              onMouseLeave={e=>{if(!sel)e.currentTarget.style.borderColor=sel?(conflictGoal?"rgba(224,124,90,.45)":a.color+"55"):"rgba(255,255,255,.08)";}}>
                <span style={{fontSize:".8rem"}}>{a.icon}</span>
                <div>
                  <div style={{fontSize:".72rem",color:sel?(conflictGoal?"#e07c5a":a.color):"rgba(255,255,255,.7)",fontWeight:sel?600:400}}>{a.label}</div>
                  {typeCount>0&&<div style={{fontSize:".58rem",color:"rgba(255,255,255,.35)"}}>{typeCount} holding{typeCount!==1?"s":""} · {fmtCr(typeVal)}</div>}
                  {sel&&conflictGoal&&<div style={{fontSize:".55rem",color:"#e07c5a",marginTop:1}}>Already in: {conflictGoal.name}</div>}
                </div>
              </div>);
            })}
          </div>
          {(goalForm.linkedTypes||[]).length>0&&(()=>{
            const lm=goalForm.linkedMembers||["all"];
            const memberH = lm.includes("all") ? holdings : holdings.filter(h=>lm.includes(h.member_id));
            const typeSet=new Set(goalForm.linkedTypes);
            const totalLinked=memberH.filter(h=>typeSet.has(h.type)).reduce((s,h)=>s+(valINRCache.get(h.id)||0),0);
            const holdingCount=memberH.filter(h=>typeSet.has(h.type)).length;
            return(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:".5rem",padding:".4rem .65rem",background:"rgba(201,168,76,.06)",borderRadius:5,border:"1px solid rgba(201,168,76,.15)"}}>
              <span style={{fontSize:".68rem",color:"rgba(201,168,76,.8)"}}>{goalForm.linkedTypes.length} type{goalForm.linkedTypes.length!==1?"s":""} · {holdingCount} holding{holdingCount!==1?"s":""} · {fmtCr(totalLinked)}</span>
              <button onClick={()=>setGoalForm(p=>({...p,linkedTypes:[]}))}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:".62rem",color:"rgba(224,124,90,.6)"}}>Clear</button>
            </div>);
          })()}
        </div>

        <FG label="Monthly Contribution ₹ (optional)" style={{marginBottom:"1.5rem"}}><FmtInput placeholder="e.g. 10000" value={goalForm.monthlyContribution} onChange={e=>setGoalForm(p=>({...p,monthlyContribution:e.target.value}))}/></FG>
        <FG label="Notes"><input className="fi" placeholder="Optional description" value={goalForm.notes} onChange={e=>setGoalForm(p=>({...p,notes:e.target.value}))}/></FG>
        {/* Duplicate asset-type conflict warning */}
        {(()=>{
          const conflicts=goalDuplicateTypes(goalForm,editGoalId);
          if(conflicts.length===0) return null;
          return(
          <div style={{marginBottom:".8rem",padding:".5rem .75rem",background:"rgba(224,124,90,.08)",border:"1px solid rgba(224,124,90,.25)",borderRadius:6,fontSize:".7rem",color:"#e07c5a",lineHeight:1.6}}>
            ⚠ Cannot save — {conflicts.map(c=>`${AT[c.type]?.icon||""} ${AT[c.type]?.label||c.type}`).join(", ")} already assigned to "{conflicts[0].goalName}". One asset type per member can only fund one goal.
          </div>);
        })()}
        <MA>
          <button className="btnc" onClick={()=>{setModal(null);setEditGoalId(null);}}>Cancel</button>
          <button className="btns" onClick={addGoal} disabled={!goalForm.name||!goalForm.targetAmount||goalDuplicateTypes(goalForm,editGoalId).length>0}>{editGoalId?"Save Changes":"Add Goal"}</button>
        </MA>
      </Overlay>
    )}

    {/* ── SETTINGS MODAL ── */}
    {showSettings&&(
      <Overlay onClose={()=>setShowSettings(false)}>
        <div className="modtitle">⚙️ Account Settings</div>

        {/* Live FX Rate */}
        <div style={{marginBottom:"1.4rem"}}>
          <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"#c9a84c",marginBottom:".75rem"}}>Live Exchange Rate</div>
          <div style={{display:"flex",alignItems:"center",gap:"1rem",padding:".65rem .85rem",background:"rgba(90,156,224,.06)",border:"1px solid rgba(90,156,224,.15)",borderRadius:8}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1rem",color:"#5a9ce0"}}>1 USD = ₹{_liveUsdInr.toFixed(2)}</div>
            <div style={{fontSize:".65rem",color:"rgba(255,255,255,.4)"}}>Auto-fetched · live rate</div>
          </div>
          <div style={{fontSize:".65rem",color:"rgba(255,255,255,.35)",marginTop:".5rem",lineHeight:1.5}}>
            All totals display in $ (primary) with ₹ equivalent. Per-holding prices show in native currency.
          </div>
        </div>

        {/* Asset Types */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".75rem"}}>
            <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"#c9a84c"}}>Asset Types</div>
            <button className="btn-sm" onClick={()=>{
              const newAt={id:"",label:"",icon:"📦",color:"#c9a84c",price_source:"MANUAL",currency:"INR",is_default:false,_editing:true};
              setAssetTypes(p=>[...p,newAt]);
            }}>+ Add Custom Type</button>
          </div>
          {/* Built-in types grouped by category */}
          {["US Market","Indian Market","Debt","Physical"].map(cat=>{
            const types = Object.entries(AT).filter(([,v])=>v.cat===cat);
            if(!types.length) return null;
            return(
              <div key={cat} style={{marginBottom:".75rem"}}>
                <div style={{fontSize:".6rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".4rem",paddingLeft:".1rem"}}>{cat}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>
                  {types.map(([k,v])=>(
                    <div key={k} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".35rem .65rem",borderRadius:6,
                      background:v.color+"12",border:`1px solid ${v.color}30`}}>
                      <span style={{fontSize:".8rem"}}>{v.icon}</span>
                      <span style={{fontSize:".72rem",color:v.color,fontWeight:500}}>{v.label}</span>
                      <span style={{fontSize:".58rem",color:"rgba(255,255,255,.35)",marginLeft:".2rem"}}>
                        {USD_TYPES.has(k)?"USD":"INR"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {/* Custom types */}
          {assetTypes.filter(at=>!at.is_default).length>0&&(
            <div style={{marginTop:".6rem"}}>
              <div style={{fontSize:".6rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".4rem"}}>Custom</div>
            </div>
          )}
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {assetTypes.filter(at=>!at.is_default).map((at,i)=>{
              const idx = assetTypes.indexOf(at);
              return(
              <div key={at.id||i} style={{display:"flex",gap:".6rem",alignItems:"center",marginBottom:".5rem",padding:".55rem .75rem",background:"rgba(255,255,255,.03)",borderRadius:6,border:"1px solid rgba(255,255,255,.06)"}}>
                <input value={at.icon} onChange={e=>setAssetTypes(p=>p.map((x,j)=>j===idx?{...x,icon:e.target.value}:x))}
                  style={{width:36,background:"transparent",border:"none",fontSize:"1.1rem",textAlign:"center",outline:"none"}}/>
                <input value={at.label} onChange={e=>setAssetTypes(p=>p.map((x,j)=>j===idx?{...x,label:e.target.value}:x))}
                  style={{flex:1,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"#ffffff",padding:".32rem .6rem",borderRadius:4,fontSize:".78rem",fontFamily:"'DM Sans',sans-serif"}}
                  placeholder="Asset type name"/>
                <input type="color" value={at.color} onChange={e=>setAssetTypes(p=>p.map((x,j)=>j===idx?{...x,color:e.target.value}:x))}
                  style={{width:28,height:28,padding:2,borderRadius:4,border:"1px solid rgba(255,255,255,.1)",background:"transparent",cursor:"pointer"}}/>
                <select value={at.price_source} onChange={e=>setAssetTypes(p=>p.map((x,j)=>j===idx?{...x,price_source:e.target.value}:x))}
                  style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"rgba(255,255,255,.85)",padding:".3rem .5rem",borderRadius:4,fontSize:".7rem",fontFamily:"'DM Sans',sans-serif"}}>
                  {["MANUAL","YAHOO","MFAPI"].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn-sm" style={{padding:".28rem .6rem",fontSize:".68rem"}} onClick={async()=>{
                  if(!at.label.trim()) return;
                  if(at.id){ await api(`/api/asset-types/${at.id}`,{method:"PUT",body:JSON.stringify({label:at.label,icon:at.icon,color:at.color,price_source:at.price_source})}); }
                  else { const r=await api("/api/asset-types",{method:"POST",body:JSON.stringify({label:at.label,icon:at.icon,color:at.color,price_source:at.price_source,currency:at.currency||"INR",is_default:false})}); setAssetTypes(p=>p.map((x,j)=>j===idx?{...x,id:r.id,_editing:false}:x)); }
                }}>Save</button>
                <button className="delbtn" onClick={async()=>{
                  if(at.id){ await api(`/api/asset-types/${at.id}`,{method:"DELETE"}); }
                  setAssetTypes(p=>p.filter((_,j)=>j!==idx));
                }}>✕</button>
              </div>);
            })}
          </div>
          <div style={{fontSize:".65rem",color:"rgba(255,255,255,.35)",marginTop:".5rem"}}>Built-in types are always available. Add custom types for alternatives, commodities, etc.</div>
        </div>

        {/* Portfolio Sharing */}
        <div style={{marginTop:"1.4rem"}}>
          <div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"#a78bfa",marginBottom:".75rem"}}>Portfolio Sharing</div>
          <div style={{fontSize:".67rem",color:"rgba(255,255,255,.45)",marginBottom:".8rem",lineHeight:1.6}}>
            Share your portfolio with family members or advisors. They'll see your holdings when they log in with their own account.
          </div>

          {/* Add new share */}
          <div style={{display:"flex",gap:".4rem",marginBottom:".8rem",alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:".6rem",color:"rgba(255,255,255,.4)",marginBottom:".25rem"}}>Email address</div>
              <input value={shareEmail} onChange={e=>setShareEmail(e.target.value)} placeholder="priya@example.com"
                onKeyDown={e=>e.key==="Enter"&&addShare()}
                style={{width:"100%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"#fff",padding:".38rem .6rem",borderRadius:4,fontSize:".75rem",fontFamily:"'DM Sans',sans-serif"}}/>
            </div>
            <span style={{fontSize:".65rem",color:"rgba(255,255,255,.4)",padding:".38rem .3rem",whiteSpace:"nowrap"}}>Viewer</span>
            <button className="btn-sm" onClick={addShare} disabled={shareLoading||!shareEmail.trim()}
              style={{padding:".38rem .75rem",opacity:shareEmail.trim()?1:.5}}>
              {shareLoading?"…":"Share"}
            </button>
          </div>
          {shareError&&<div style={{fontSize:".68rem",color:"#e07c5a",marginBottom:".6rem"}}>{shareError}</div>}

          {/* Active shares I've granted */}
          {shares.length>0&&(
            <div style={{marginBottom:".8rem"}}>
              <div style={{fontSize:".6rem",color:"rgba(255,255,255,.4)",marginBottom:".35rem"}}>People with access</div>
              {shares.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .65rem",marginBottom:".3rem",background:"rgba(255,255,255,.03)",borderRadius:6,border:"1px solid rgba(255,255,255,.06)"}}>
                  <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(167,139,250,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".65rem",color:"#a78bfa",flexShrink:0}}>
                    {(s.shared_with_name||"?")[0].toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".75rem",color:"#fff"}}>{s.shared_with_name||"User"}</div>
                    <div style={{fontSize:".6rem",color:"rgba(255,255,255,.4)"}}>Shared {new Date(s.created_at).toLocaleDateString()}</div>
                  </div>
                  <span style={{fontSize:".6rem",color:"rgba(255,255,255,.4)",padding:".2rem .4rem",background:"rgba(255,255,255,.04)",borderRadius:3}}>Viewer</span>
                  <button className="delbtn" onClick={()=>removeShare(s.id)} title="Revoke access"
                    style={{color:"rgba(224,124,90,.6)",fontSize:".8rem"}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Portfolios shared with me */}
          {sharedWithMe.length>0&&(
            <div>
              <div style={{fontSize:".6rem",color:"rgba(255,255,255,.4)",marginBottom:".35rem"}}>Shared with me</div>
              {sharedWithMe.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .65rem",marginBottom:".3rem",background:"rgba(76,175,154,.04)",borderRadius:6,border:"1px solid rgba(76,175,154,.12)"}}>
                  <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(76,175,154,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".65rem",color:"#4caf9a",flexShrink:0}}>
                    {(s.owner_name||"?")[0].toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".75rem",color:"#fff"}}>{s.owner_name}'s portfolio</div>
                    <div style={{fontSize:".6rem",color:"rgba(255,255,255,.4)"}}>Role: {s.role}</div>
                  </div>
                  <button className="btn-sm" onClick={()=>{viewSharedPortfolio(s.owner_id,s.owner_name,s.role);setShowSettings(false);}}
                    style={{padding:".25rem .6rem",fontSize:".62rem"}}>View</button>
                  <button className="delbtn" onClick={()=>removeShare(s.id)} title="Leave this shared portfolio"
                    style={{color:"rgba(224,124,90,.5)",fontSize:".75rem"}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <MA><button className="btns" onClick={()=>setShowSettings(false)}>Done</button></MA>
      </Overlay>
    )}

    <GoalPlanModal open={modal==="goalplan"} onClose={()=>setModal(null)} goals={goals} members={members} holdings={holdings} allCur={allCur} allInv={allInv}/>
    {modal==="alert"&&(<Overlay onClose={()=>setModal(null)} narrow><div className="modtitle">New Alert Rule</div><FG label="Alert Type"><select className="fi fs" value={alertForm.type} onChange={e=>setAlertForm(p=>({...p,type:e.target.value}))}><option value="ALLOCATION_DRIFT">Over-weight</option><option value="CONCENTRATION">Under-weight</option><option value="RETURN_TARGET">Return below target</option></select></FG>{alertForm.type!=="RETURN_TARGET"&&<FG label="Asset Class"><select className="fi fs" value={alertForm.assetType} onChange={e=>setAlertForm(p=>({...p,assetType:e.target.value}))}>{Object.entries(AT).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</select></FG>}<FG label={alertForm.type==="RETURN_TARGET"?"Target Return %":"Threshold %"}><input type="number" className="fi" value={alertForm.threshold} onChange={e=>setAlertForm(p=>({...p,threshold:e.target.value}))}/></FG><FG label="Description"><input className="fi" value={alertForm.label} onChange={e=>setAlertForm(p=>({...p,label:e.target.value}))}/></FG><MA><button className="btnc" onClick={()=>setModal(null)}>Cancel</button><button className="btns" onClick={addAlert} disabled={!alertForm.threshold||!alertForm.label}>Add Alert</button></MA></Overlay>)}
    {/* ── Quick-Add Wizard (first-holding combined flow) ── */}
    {modal==="quickadd"&&(()=>{
      const qaTypes = [
        {k:"US_STOCK",label:"US Stock",icon:"$",c:"#5a9ce0"},
        {k:"US_ETF",label:"US ETF",icon:"🔵",c:"#4a8cd8"},
        {k:"CRYPTO",label:"Crypto",icon:"₿",c:"#f7931a"},
        {k:"IN_STOCK",label:"Indian Stock",icon:"📈",c:"#e07c5a"},
        {k:"MF",label:"Mutual Fund",icon:"📊",c:"#a084ca"},
        {k:"IN_ETF",label:"Indian ETF",icon:"🔷",c:"#f0a050"},
      ];
      const qaMore = [
        {k:"FD",label:"Fixed Deposit"},{k:"PPF",label:"PPF"},{k:"EPF",label:"EPF"},
        {k:"REAL_ESTATE",label:"Real Estate"},{k:"US_BOND",label:"US Bonds"},{k:"OTHER",label:"Other"},
      ];
      return (
      <Overlay onClose={()=>setModal(null)}>
        <div className="modtitle">Add your first investment</div>
        <div style={{fontSize:".75rem",color:"rgba(255,255,255,.5)",marginBottom:"1rem",lineHeight:1.6}}>
          One form — pick type, enter details, record your first buy. We'll create the holding and transaction together.
        </div>

        {/* Step indicator */}
        <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".8rem"}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:form.type?"#4caf9a":"#c9a84c",transition:"all .2s"}}/>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,.08)"}}/>
          <div style={{width:8,height:8,borderRadius:"50%",background:form.name?"#4caf9a":"rgba(255,255,255,.12)",transition:"all .2s"}}/>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,.08)"}}/>
          <div style={{width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,.12)"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:".6rem",color:"rgba(255,255,255,.3)",marginBottom:"1.1rem"}}>
          <span style={{color:form.type?"#4caf9a":"#c9a84c"}}>Pick type</span>
          <span style={{color:form.name?"#4caf9a":"rgba(255,255,255,.3)"}}>Enter details</span>
          <span>Confirm</span>
        </div>

        {/* Type picker grid — US first */}
        <div style={{fontSize:".63rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:".4rem"}}>What are you investing in?</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:".4rem",marginBottom:".4rem"}}>
          {qaTypes.map(t=>(
            <div key={t.k} onClick={()=>{setForm(f=>({...f,type:t.k}));if(USD_TYPES.has(t.k))fetchUsdInr();}}
              style={{padding:".5rem",textAlign:"center",borderRadius:8,cursor:"pointer",transition:"all .15s",
                border:form.type===t.k?`1.5px solid ${t.c}`:"1px solid rgba(255,255,255,.08)",
                background:form.type===t.k?`${t.c}11`:"rgba(255,255,255,.02)"}}>
              <div style={{fontSize:".9rem"}}>{t.icon}</div>
              <div style={{fontSize:".7rem",color:form.type===t.k?t.c:"rgba(255,255,255,.5)",fontWeight:form.type===t.k?500:400,marginTop:".15rem"}}>{t.label}</div>
            </div>
          ))}
        </div>
        <details style={{marginBottom:"1rem",fontSize:".7rem",color:"rgba(255,255,255,.35)"}}>
          <summary style={{cursor:"pointer",listStyle:"none"}}>
            <span style={{textDecoration:"underline"}}>+ FD, PPF, EPF, Real Estate, Bonds, Other</span>
          </summary>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:".35rem",marginTop:".4rem"}}>
            {qaMore.map(t=>(
              <div key={t.k} onClick={()=>setForm(f=>({...f,type:t.k}))}
                style={{padding:".4rem",textAlign:"center",borderRadius:6,cursor:"pointer",fontSize:".68rem",
                  border:form.type===t.k?"1.5px solid #c9a84c":"1px solid rgba(255,255,255,.06)",
                  background:form.type===t.k?"rgba(201,168,76,.08)":"transparent",
                  color:form.type===t.k?"#c9a84c":"rgba(255,255,255,.4)"}}>
                {AT[t.k]?.icon} {t.label}
              </div>
            ))}
          </div>
        </details>

        {/* Name / Ticker + Member */}
        <div className="frow">
          <FG label="Name / Ticker"><input className="fi" placeholder={form.type==="MF"?"e.g. Mirae Asset Large Cap":"e.g. NVDA, Reliance"} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></FG>
          <FG label="Member"><select className="fi fs" value={form.member_id} onChange={e=>setForm(f=>({...f,member_id:e.target.value}))}><option value="">Select</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></FG>
        </div>
        {(form.type==="IN_STOCK"||form.type==="IN_ETF"||form.type==="US_STOCK"||form.type==="US_ETF"||form.type==="CRYPTO"||form.type==="US_BOND")&&(
          <FG label="Ticker symbol"><input className="fi" placeholder={USD_TYPES.has(form.type)?"e.g. AAPL, VOO, BTC-USD":"e.g. RELIANCE, NIFTYBEES"} value={form.ticker} onChange={e=>setForm(f=>({...f,ticker:e.target.value.toUpperCase()}))}/></FG>
        )}
        {form.type==="MF"&&(
          <FG label="AMFI Scheme Code"><input className="fi" placeholder="e.g. 118834 (optional — for live NAV)" value={form.scheme_code} onChange={e=>setForm(f=>({...f,scheme_code:e.target.value}))}/></FG>
        )}

        {/* Optional buy transaction section */}
        {["IN_STOCK","IN_ETF","US_STOCK","US_ETF","CRYPTO","US_BOND","MF"].includes(form.type)&&(
          <div style={{padding:".75rem .9rem",background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,marginBottom:".85rem",marginTop:".3rem"}}>
            <div style={{fontSize:".7rem",fontWeight:500,color:"rgba(255,255,255,.55)",marginBottom:".55rem"}}>Record your first buy <span style={{fontWeight:400,color:"rgba(255,255,255,.3)"}}>(optional — you can add later)</span></div>
            <div className="frow">
              <FG label="Buy date"><input type="date" className="fi" value={txnForm.txn_date} onChange={e=>setTxnForm(p=>({...p,txn_date:e.target.value}))}/></FG>
              <FG label={USD_TYPES.has(form.type)?"Price $ per unit":"Price ₹ per unit"}>
                <input type="number" className="fi" placeholder={USD_TYPES.has(form.type)?"e.g. 129.50":"e.g. 2450"}
                  value={USD_TYPES.has(form.type)?txnForm.price_usd:txnForm.price}
                  onChange={e=>{
                    if(USD_TYPES.has(form.type)){
                      const u=e.target.value;
                      setTxnForm(p=>({...p,price_usd:u,price:u?(+u*(_liveUsdInr)).toFixed(2):""}));
                    } else {
                      setTxnForm(p=>({...p,price:e.target.value}));
                    }
                  }}/>
              </FG>
              <FG label={form.type==="MF"?"Units (NAV÷amount)":"Units / Shares"}>
                <input type="number" className="fi" placeholder="e.g. 10" value={txnForm.units} onChange={e=>setTxnForm(p=>({...p,units:e.target.value}))}/>
              </FG>
            </div>
            {txnForm.units&&(USD_TYPES.has(form.type)?txnForm.price_usd:txnForm.price)&&(
              <div style={{fontSize:".68rem",color:"rgba(201,168,76,.7)",fontFamily:"'DM Mono',monospace",marginTop:".3rem"}}>
                Total: {USD_TYPES.has(form.type)
                  ? `$${(+txnForm.units*(+txnForm.price_usd||0)).toLocaleString("en-US",{maximumFractionDigits:2})} ≈ ₹${(+txnForm.units*(+txnForm.price_usd||0)*_liveUsdInr).toLocaleString("en-IN",{maximumFractionDigits:0})}`
                  : `₹${(+txnForm.units*(+txnForm.price||0)).toLocaleString("en-IN",{maximumFractionDigits:2})}`}
              </div>
            )}
          </div>
        )}

        {/* FD / PPF / EPF / RE specific fields */}
        {(form.type==="FD"||form.type==="PPF"||form.type==="EPF")&&(
          <div className="frow">
            <FG label="Principal ₹"><input type="number" className="fi" placeholder="e.g. 500000" value={form.principal} onChange={e=>setForm(f=>({...f,principal:e.target.value}))}/></FG>
            {form.type==="FD"&&<FG label="Interest Rate %"><input type="number" className="fi" placeholder="e.g. 7.25" value={form.interest_rate} onChange={e=>setForm(f=>({...f,interest_rate:e.target.value}))}/></FG>}
            <FG label="Start Date"><input type="date" className="fi" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></FG>
            {form.type==="FD"&&<FG label="Maturity Date"><input type="date" className="fi" value={form.maturity_date} onChange={e=>setForm(f=>({...f,maturity_date:e.target.value}))}/></FG>}
          </div>
        )}
        {form.type==="REAL_ESTATE"&&(
          <div className="frow">
            <FG label="Purchase Value ₹"><input type="number" className="fi" placeholder="e.g. 5000000" value={form.purchase_value} onChange={e=>setForm(f=>({...f,purchase_value:e.target.value}))}/></FG>
            <FG label="Current Value ₹"><input type="number" className="fi" placeholder="e.g. 7500000" value={form.current_value} onChange={e=>setForm(f=>({...f,current_value:e.target.value}))}/></FG>
          </div>
        )}

        <MA>
          <button className="btnc" onClick={()=>{setModal(null);setForm(BF);setTxnForm(BT);}}>Cancel</button>
          <button className="btn-o" onClick={async()=>{
            // Save holding only (skip transaction)
            if(!form.name||!form.member_id){alert("Enter a name and select a member");return;}
            try{
              const h={...form,id:uid(),principal:+form.principal||null,interest_rate:+form.interest_rate||null,purchase_value:+form.purchase_value||null,current_value:+form.current_value||null,usd_inr_rate:+form.usd_inr_rate||_liveUsdInr};
              await api("/api/holdings",{method:"POST",body:JSON.stringify(h)});
              const hlds=await api("/api/holdings"); setHoldings(hlds||[]);
              setModal(null);setForm(BF);setTxnForm(BT);
            }catch(e){alert("Save failed: "+e.message);}
          }}>Skip transaction, save holding</button>
          <button className="btns" onClick={async()=>{
            if(!form.name||!form.member_id){alert("Enter a name and select a member");return;}
            const hasTxn=txnForm.units&&(USD_TYPES.has(form.type)?txnForm.price_usd:txnForm.price);
            try{
              const hId=uid();
              const h={...form,id:hId,principal:+form.principal||null,interest_rate:+form.interest_rate||null,purchase_value:+form.purchase_value||null,current_value:+form.current_value||null,usd_inr_rate:+form.usd_inr_rate||_liveUsdInr};
              await api("/api/holdings",{method:"POST",body:JSON.stringify(h)});
              if(hasTxn){
                await api("/api/transactions",{method:"POST",body:JSON.stringify({
                  holding_id:hId, txn_type:"BUY",
                  units:+txnForm.units, price:+txnForm.price||+(+txnForm.price_usd*_liveUsdInr).toFixed(2),
                  price_usd:txnForm.price_usd?+txnForm.price_usd:undefined,
                  txn_date:txnForm.txn_date, notes:"First buy via quick-add",
                })});
              }
              const hlds=await api("/api/holdings"); setHoldings(hlds||[]);
              setModal(null);setForm(BF);setTxnForm(BT);
            }catch(e){alert("Save failed: "+e.message);}
          }} disabled={!form.name||!form.member_id}>{txnForm.units?"Save holding + transaction":"Save holding"}</button>
        </MA>
      </Overlay>);
    })()}
    {/* ── Unified + Add Chooser ── */}
    {modal==="add"&&(
      <Overlay onClose={()=>setModal(null)}>
        <div className="modtitle">Add to portfolio</div>

        {/* ── Section: Connect a broker (auto-sync) ── */}
        <div style={{fontSize:".6rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:".5rem",paddingLeft:".1rem"}}>
          🔗 Connect broker — auto-sync holdings
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:".5rem",marginBottom:"1rem"}}>

          {/* SnapTrade — US */}
          <div onClick={()=>{setModal(null);setShowSnapTrade(true);}}
            style={{padding:".85rem 1rem",borderRadius:10,border:"1.5px solid rgba(167,139,250,.4)",
              background:"linear-gradient(135deg,rgba(167,139,250,.08) 0%,rgba(90,156,224,.05) 100%)",
              cursor:"pointer",display:"flex",alignItems:"center",gap:".9rem",transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(167,139,250,.7)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(167,139,250,.4)"}>
            <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#1a3a6e,#2d5aa0)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:".65rem",fontWeight:700,color:"#fff",letterSpacing:".06em"}}>US</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".15rem"}}>
                <span style={{fontSize:".85rem",color:"#fff",fontWeight:600}}>SnapTrade</span>
                <span style={{fontSize:".52rem",padding:".1rem .45rem",borderRadius:8,background:"rgba(167,139,250,.18)",color:"#a78bfa",fontWeight:600,letterSpacing:".04em",textTransform:"uppercase"}}>Recommended</span>
              </div>
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Robinhood · Schwab · Fidelity · 25+ US brokers · automatic</div>
            </div>
            <span style={{color:"rgba(167,139,250,.5)",fontSize:"1rem"}}>→</span>
          </div>

          {/* Kite — Zerodha */}
          <div onClick={()=>{setModal(null);setShowKite(true);}}
            style={{padding:".85rem 1rem",borderRadius:10,border:"1.5px solid rgba(201,168,76,.35)",
              background:"rgba(201,168,76,.05)",cursor:"pointer",display:"flex",alignItems:"center",gap:".9rem",transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(201,168,76,.65)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(201,168,76,.35)"}>
            <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#1a2e0a,#2d5010)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:"1px solid rgba(201,168,76,.3)"}}>
              <span style={{fontSize:".65rem",fontWeight:700,color:"#c9a84c",letterSpacing:".04em"}}>ZE</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".15rem"}}>
                <span style={{fontSize:".85rem",color:"#fff",fontWeight:600}}>Zerodha Kite</span>
                <span style={{fontSize:".52rem",padding:".1rem .45rem",borderRadius:8,background:"rgba(76,175,154,.12)",color:"#4caf9a",fontWeight:600,letterSpacing:".04em",textTransform:"uppercase"}}>Free</span>
              </div>
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Equity + Coin MF · Personal API · 1-click daily refresh</div>
            </div>
            <span style={{color:"rgba(201,168,76,.4)",fontSize:"1rem"}}>→</span>
          </div>

          {/* Breeze — ICICI Direct */}
          <div onClick={()=>{setModal(null);setShowBreeze(true);}}
            style={{padding:".85rem 1rem",borderRadius:10,border:"1.5px solid rgba(90,156,224,.35)",
              background:"rgba(90,156,224,.05)",cursor:"pointer",display:"flex",alignItems:"center",gap:".9rem",transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(90,156,224,.65)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(90,156,224,.35)"}>
            <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#0a1e3a,#0d2d5a)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:"1px solid rgba(90,156,224,.3)"}}>
              <span style={{fontSize:".6rem",fontWeight:700,color:"#5a9ce0",letterSpacing:".02em"}}>ICICI</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".15rem"}}>
                <span style={{fontSize:".85rem",color:"#fff",fontWeight:600}}>ICICI Direct</span>
                <span style={{fontSize:".52rem",padding:".1rem .45rem",borderRadius:8,background:"rgba(76,175,154,.12)",color:"#4caf9a",fontWeight:600,letterSpacing:".04em",textTransform:"uppercase"}}>Free</span>
              </div>
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)"}}>Equity + MF · Breeze API · daily session token</div>
            </div>
            <span style={{color:"rgba(90,156,224,.4)",fontSize:"1rem"}}>→</span>
          </div>
        </div>

        {/* ── Section: Import / Manual ── */}
        <div style={{fontSize:".6rem",letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:".5rem",paddingLeft:".1rem"}}>
          📂 Import or add manually
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".55rem"}}>
          {[
            {key:"import",icon:"📂",title:"Import file",desc:"CSV or Excel from any broker",tag:"most used",tagColor:"#4caf9a",border:"rgba(201,168,76,.3)",bg:"rgba(201,168,76,.05)"},
            {key:"cas",icon:"📥",title:"CAS PDF",desc:"NSDL/CDSL CAS — all MF + demat",tag:"Indian",tagColor:"#a084ca",border:"rgba(160,132,202,.3)",bg:"rgba(160,132,202,.05)"},
            {key:"holding",icon:"✏️",title:"Add holding",desc:"Manually add an instrument",tag:null,border:"rgba(255,255,255,.08)",bg:"rgba(255,255,255,.03)"},
            {key:"txn",icon:"📋",title:"Log transaction",desc:"Record buy/sell on existing",tag:null,border:"rgba(255,255,255,.08)",bg:"rgba(255,255,255,.03)"},
          ].map(opt=>(
            <div key={opt.key} onClick={()=>{
              setModal(null);
              if(opt.key==="import") openImportModal();
              else if(opt.key==="cas"){resetCASDownloader();setCasModal(true);}
              else if(opt.key==="holding"){setForm(BF);setEditHolding(null);setModal("holding");}
              else {setTxnForm(BT);setGlobalTxnModal(true);}
            }} style={{padding:".85rem",borderRadius:10,border:`1px solid ${opt.border}`,
              background:opt.bg,cursor:"pointer",textAlign:"center",transition:"all .15s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity=".85"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <div style={{fontSize:"1.2rem",marginBottom:".4rem"}}>{opt.icon}</div>
              <div style={{fontSize:".8rem",color:"#fff",fontWeight:500,marginBottom:".25rem"}}>{opt.title}</div>
              <div style={{fontSize:".66rem",color:"rgba(255,255,255,.45)",lineHeight:1.4}}>{opt.desc}</div>
              {opt.tag&&<div style={{fontSize:".55rem",display:"inline-block",marginTop:".4rem",padding:".12rem .4rem",borderRadius:3,background:"rgba(76,175,154,.1)",color:opt.tagColor}}>{opt.tag}</div>}
            </div>
          ))}
        </div>
      </Overlay>
    )}
    {showSnapTrade&&(
      <Overlay onClose={()=>{setShowSnapTrade(false);reloadHoldings();}} wide>
        <SnapTradeImport onClose={async()=>{setShowSnapTrade(false);await reloadHoldings();}} members={members} />
      </Overlay>
    )}
    {showKite&&(
      <Overlay onClose={()=>{setShowKite(false);reloadHoldings();}} wide>
        <KiteImport onClose={async()=>{setShowKite(false);await reloadHoldings();}} members={members} api={api} />
      </Overlay>
    )}
    {showBreeze&&(
      <Overlay onClose={()=>{setShowBreeze(false);reloadHoldings();}} wide>
        <BreezeImport onClose={async()=>{setShowBreeze(false);await reloadHoldings();}} members={members} api={api} />
      </Overlay>
    )}
    {/* Setu AA overlay — disabled until integration is ready */}
    {modal==="import"&&(<ImportModal importState={importState} setImportState={setImportState} members={members} AT={AT} handleImportFile={handleImportFile} executeImport={executeImport} resetImport={resetImport} importFileRef={importFileRef} onClose={()=>{setModal(null);resetImport();}} fmt={fmt} submitCASPassword={submitCASPassword}/>)}

    {/* ── CAS Downloader modal ── */}
    {casModal&&(<Overlay onClose={resetCASDownloader}>
      <div className="modtitle">📥 CAS Downloader</div>

      {/* Step: intro */}
      {casStep==="intro"&&(<>
        <div style={{fontSize:".8rem",lineHeight:1.7,color:"rgba(255,255,255,.75)",marginBottom:"1.2rem"}}>
          Import your NSDL/CDSL Consolidated Account Statement (CAS) PDF to automatically pull in all mutual funds, equities, bonds, and G-Secs.
        </div>
        <div style={{background:"rgba(160,132,202,.06)",border:"1px solid rgba(160,132,202,.18)",borderRadius:8,padding:".9rem 1rem",marginBottom:"1rem"}}>
          <div style={{fontSize:".72rem",fontWeight:500,color:"#a084ca",marginBottom:".5rem"}}>How to get your CAS PDF</div>
          <div style={{fontSize:".72rem",lineHeight:1.7,color:"rgba(255,255,255,.6)"}}>
            1. Visit <span style={{color:"#a084ca"}}>cdslindia.com/cas</span> or <span style={{color:"#a084ca"}}>nsdl.co.in/nsdlcas</span><br/>
            2. Enter your PAN and email → you'll receive a CAS PDF via email<br/>
            3. The PDF password is your <span style={{color:"#c9a84c"}}>PAN number</span> (uppercase, e.g. ABCDE1234F)<br/>
            4. Upload that PDF below
          </div>
        </div>

        {/* Tip about setting up auto-forward */}
        <div style={{background:"rgba(76,175,154,.06)",border:"1px solid rgba(76,175,154,.18)",borderRadius:8,padding:".75rem 1rem",marginBottom:"1rem"}}>
          <div style={{fontSize:".68rem",fontWeight:500,color:"#4caf9a",marginBottom:".35rem"}}>💡 Pro tip: Auto-forward for hands-free import</div>
          <div style={{fontSize:".68rem",lineHeight:1.6,color:"rgba(255,255,255,.55)"}}>
            Set up a Gmail filter for emails from <code style={{fontSize:".65rem",background:"rgba(255,255,255,.06)",padding:".1rem .35rem",borderRadius:3}}>donotreply@camsonline.com</code> or <code style={{fontSize:".65rem",background:"rgba(255,255,255,.06)",padding:".1rem .35rem",borderRadius:3}}>nsdlcas@nsdl.co.in</code> to auto-label them, then upload the latest CAS here each month.
          </div>
        </div>

        {/* Member matching info */}
        <div style={{background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.18)",borderRadius:8,padding:".75rem 1rem",marginBottom:"1.2rem"}}>
          <div style={{fontSize:".68rem",fontWeight:500,color:"#c9a84c",marginBottom:".35rem"}}>👥 Smart member matching</div>
          <div style={{fontSize:".68rem",lineHeight:1.6,color:"rgba(255,255,255,.55)"}}>
            We extract the PAN holder name from your CAS and match it to your family members. Works even if your member name is shorter (e.g. "Avinash" matches "AVINASH TALLAM" in CAS).
          </div>
        </div>

        {casWarnings.length>0&&(
          <div style={{marginBottom:".8rem"}}>
            {casWarnings.map((w,i)=><div key={i} style={{fontSize:".72rem",color:"rgba(224,124,90,.8)",padding:".4rem .7rem",background:"rgba(224,124,90,.06)",borderRadius:5,marginBottom:".3rem"}}>⚠ {w}</div>)}
          </div>
        )}

        <div style={{display:"flex",justifyContent:"center"}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:".5rem",padding:".6rem 1.5rem",background:"rgba(160,132,202,.12)",border:"1px solid rgba(160,132,202,.3)",borderRadius:8,cursor:"pointer",color:"#a084ca",fontSize:".82rem",fontWeight:500,fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(160,132,202,.2)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(160,132,202,.12)";}}>
            {casUploading?"Parsing…":"📄 Upload CAS PDF"}
            <input type="file" accept=".pdf" style={{display:"none"}} disabled={casUploading}
              onChange={e=>{if(e.target.files[0]){handleCASUpload(e.target.files[0]);e.target.value="";}}}/>
          </label>
        </div>
        <MA><button className="btnc" onClick={resetCASDownloader}>Cancel</button></MA>
      </>)}

      {/* Step: matching — show extracted holders + matched members */}
      {casStep==="uploading"&&(
        <div style={{textAlign:"center",padding:"2.5rem 0"}}>
          <div style={{width:34,height:34,border:"2px solid rgba(160,132,202,.2)",borderTopColor:"#a084ca",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 1rem"}}/>
          <div style={{fontSize:".8rem",color:"rgba(255,255,255,.5)"}}>Parsing CAS PDF…</div>
          <div style={{fontSize:".68rem",color:"rgba(255,255,255,.3)",marginTop:".4rem"}}>Extracting holdings, NAVs, and holder info</div>
        </div>
      )}

      {/* Step: password — CAS PDF is encrypted, need PAN */}
      {casStep==="password"&&(<>
        <div style={{fontSize:".8rem",lineHeight:1.7,color:"rgba(255,255,255,.7)",marginBottom:"1rem"}}>
          This CAS PDF is password-protected. The password is your <span style={{color:"#c9a84c",fontWeight:500}}>PAN number</span> in uppercase (e.g. ABCDE1234F).
        </div>

        {casWarnings.length>0&&(
          <div style={{marginBottom:".8rem"}}>
            {casWarnings.map((w,i)=><div key={i} style={{fontSize:".72rem",color:"rgba(224,124,90,.8)",padding:".4rem .7rem",background:"rgba(224,124,90,.06)",borderRadius:5,marginBottom:".3rem"}}>⚠ {w}</div>)}
          </div>
        )}

        <FG label="PAN Number">
          <input className="fi" placeholder="e.g. ABCDE1234F" value={casPanInput}
            style={{textTransform:"uppercase",letterSpacing:".08em",fontFamily:"'DM Mono',monospace"}}
            onChange={e=>setCasPanInput(e.target.value.toUpperCase())}
            onKeyDown={e=>{if(e.key==="Enter"&&casPanInput.trim().length>=10)retryCASWithPassword();}}/>
        </FG>

        <label style={{display:"flex",alignItems:"center",gap:".5rem",fontSize:".72rem",color:"rgba(255,255,255,.5)",cursor:"pointer",marginBottom:"1rem",marginTop:".2rem"}}>
          <input type="checkbox" checked={casSavePan} onChange={e=>setCasSavePan(e.target.checked)}
            style={{accentColor:"#a084ca"}}/>
          Remember PAN (encrypted, for future CAS imports)
        </label>

        <MA>
          <button className="btnc" onClick={resetCASDownloader}>Cancel</button>
          <button className="btns" onClick={retryCASWithPassword}
            disabled={casPanInput.trim().length<10||casUploading}>
            {casUploading?"Unlocking…":"🔓 Unlock & Parse"}
          </button>
        </MA>
      </>)}

      {casStep==="matching"&&(<>
        <div style={{fontSize:".72rem",color:"rgba(255,255,255,.5)",marginBottom:".6rem",display:"flex",alignItems:"center",flexWrap:"wrap",gap:".4rem"}}>
          {casFormat&&<span style={{background:"rgba(160,132,202,.12)",color:"#a084ca",padding:".15rem .5rem",borderRadius:4,fontSize:".65rem"}}>{casFormat}</span>}
          {casStatementDate&&<span style={{background:"rgba(76,175,154,.12)",color:"#4caf9a",padding:".15rem .5rem",borderRadius:4,fontSize:".65rem",border:"1px solid rgba(76,175,154,.18)"}}>📅 {casPeriodStart&&casPeriodEnd?`${new Date(casPeriodStart).toLocaleDateString("en-IN",{month:"short",year:"numeric"})} → ${new Date(casPeriodEnd).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`:`as on ${new Date(casStatementDate).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`}</span>}
          {casDepository&&<span style={{background:"rgba(160,132,202,.08)",color:"#a084ca",padding:".15rem .5rem",borderRadius:4,fontSize:".65rem",border:"1px solid rgba(160,132,202,.15)"}}>🏛 {casDepository}</span>}
          <span>{casHoldings.length} holding{casHoldings.length!==1?"s":""} found</span>
        </div>

        {/* Quick-add member if none exist */}
        {members.length===0&&(
          <div style={{marginBottom:"1rem",padding:".8rem 1rem",background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.15)",borderRadius:8}}>
            <div style={{fontSize:".72rem",color:"rgba(201,168,76,.85)",marginBottom:".5rem",fontWeight:500}}>No members yet — add yourself to continue</div>
            <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
              <input className="fi" placeholder="Your name" value={casQuickMemberName}
                onChange={e=>setCasQuickMemberName(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&casQuickMemberName.trim())document.getElementById("cas-quick-add-btn")?.click();}}
                style={{marginBottom:0,flex:1}}/>
              <button id="cas-quick-add-btn" className="btns" style={{whiteSpace:"nowrap",padding:".4rem .8rem"}} disabled={!casQuickMemberName.trim()}
                onClick={async()=>{
                  const id=uid();
                  const nm=casQuickMemberName.trim();
                  const updated=[...members,{id,name:nm,relation:"Self"}];
                  setMembers(updated);
                  try{
                    const {data:port}=await supabase.from("portfolio").select("members").eq("user_id",session.user.id).single();
                    if(port)await supabase.from("portfolio").update({members:updated}).eq("user_id",session.user.id);
                    else await supabase.from("portfolio").insert({user_id:session.user.id,members:updated});
                  }catch{}
                  // Auto-select this member for all holders
                  if(casHolderNames.length>0){
                    const map={};
                    casHolderNames.forEach(n=>{map[n]=id;});
                    setCasHolderMap(map);
                  }else{
                    setCasHolderMap({"_all":id});
                  }
                  setCasQuickMemberName("");
                }}>+ Add</button>
            </div>
          </div>
        )}

        {/* Holder → Member mapping */}
        {casHolderNames.length>0&&(
          <div style={{marginBottom:"1rem"}}>
            <div style={{fontSize:".63rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".5rem"}}>CAS holder → member mapping</div>
            {casHolderNames.map(name=>{
              const matchedId = casHolderMap[name];
              const matchedMember = members.find(m=>m.id===matchedId);
              return (
                <div key={name} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".55rem .8rem",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:7,marginBottom:".4rem"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".75rem",color:"rgba(255,255,255,.85)",fontWeight:500}}>{name}</div>
                    {casHolderPans.length>0&&<div style={{fontSize:".62rem",color:"rgba(255,255,255,.35)",marginTop:".15rem"}}>PAN: {casHolderPans[0]?.slice(0,4)}****{casHolderPans[0]?.slice(-1)}</div>}
                  </div>
                  <div style={{fontSize:".72rem",color:"rgba(255,255,255,.4)",flexShrink:0}}>→</div>
                  <select className="fi fs" style={{marginBottom:0,maxWidth:180}}
                    value={matchedId||""}
                    onChange={e=>setCasHolderMap(p=>({...p,[name]:e.target.value}))}>
                    <option value="">Select member…</option>
                    {members.map(m=><option key={m.id} value={m.id}>{m.name}{m.relation?` (${m.relation})`:""}</option>)}
                  </select>
                  {matchedMember&&<div style={{fontSize:".62rem",color:"#4caf9a",flexShrink:0}}>✓</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* If no holder names extracted, show single member selector */}
        {casHolderNames.length===0&&(
          <div style={{marginBottom:"1rem"}}>
            <FG label="Assign all holdings to member">
              <select className="fi fs" value={casHolderMap["_all"]||""} onChange={e=>setCasHolderMap({"_all":e.target.value})}>
                <option value="">Select member…</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.name}{m.relation?` (${m.relation})`:""}</option>)}
              </select>
            </FG>
          </div>
        )}

        {casWarnings.length>0&&(
          <div style={{marginBottom:".6rem"}}>
            {casWarnings.map((w,i)=><div key={i} style={{fontSize:".68rem",color:"rgba(201,168,76,.7)",marginBottom:".2rem"}}>ℹ {w}</div>)}
          </div>
        )}

        {/* Holdings preview */}
        <div style={{fontSize:".63rem",letterSpacing:".08em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",marginBottom:".4rem"}}>Holdings preview</div>
        <div style={{maxHeight:220,overflowY:"auto",marginBottom:".8rem"}}>
          {casHoldings.map((h,i)=>{
            const a=AT[h.type]||{label:h.type,color:"#888",icon:"📦"};
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".4rem .65rem",background:h._duplicate?"rgba(224,124,90,.05)":"rgba(255,255,255,.02)",border:`1px solid ${h._duplicate?"rgba(224,124,90,.15)":"rgba(255,255,255,.05)"}`,borderRadius:5,marginBottom:".3rem",fontSize:".72rem"}}>
                <span style={{flexShrink:0}}>{a.icon}</span>
                <span style={{flex:1,color:"rgba(255,255,255,.8)"}}>{h.name}</span>
                <span style={{color:"rgba(255,255,255,.4)",fontFamily:"'DM Mono',monospace",fontSize:".68rem"}}>
                  {h.current_value?`₹${Number(h.current_value).toLocaleString("en-IN",{maximumFractionDigits:0})}`:""}
                </span>
                {h._duplicate&&<span style={{fontSize:".58rem",background:"rgba(224,124,90,.12)",color:"rgba(224,124,90,.8)",padding:".1rem .35rem",borderRadius:3}}>dup</span>}
              </div>
            );
          })}
        </div>

        <MA>
          <button className="btnc" onClick={resetCASDownloader}>Cancel</button>
          <button className="btns" onClick={executeCASImport}
            disabled={casHoldings.length===0||(casHolderNames.length>0&&Object.values(casHolderMap).filter(Boolean).length===0)}>
            Import {casHoldings.length} holding{casHoldings.length!==1?"s":""}
          </button>
        </MA>
      </>)}

      {/* Step: importing */}
      {casStep==="importing"&&(
        <div style={{textAlign:"center",padding:"2.5rem 0"}}>
          <div style={{width:34,height:34,border:"2px solid rgba(160,132,202,.2)",borderTopColor:"#a084ca",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 1rem"}}/>
          <div style={{fontSize:".8rem",color:"rgba(255,255,255,.5)"}}>Importing holdings…</div>
        </div>
      )}

      {/* Step: done */}
      {casStep==="done"&&(<>
        <div style={{textAlign:"center",padding:"1.5rem 0"}}>
          <div style={{fontSize:"2rem",marginBottom:".6rem"}}>✓</div>
          <div style={{fontSize:".9rem",color:"#4caf9a",fontWeight:500,marginBottom:".5rem"}}>CAS Import Complete</div>
          {casResult&&(
            <div style={{fontSize:".75rem",color:"rgba(255,255,255,.6)",lineHeight:1.7}}>
              {casResult.inserted_count>0&&<div>{casResult.inserted_count} new holding{casResult.inserted_count!==1?"s":""} added</div>}
              {casResult.updated_count>0&&<div>{casResult.updated_count} holding{casResult.updated_count!==1?"s":""} updated</div>}
              {casResult.skipped_count>0&&<div>{casResult.skipped_count} skipped</div>}
              {casResult.error_count>0&&<div style={{color:"rgba(224,124,90,.8)"}}>{casResult.error_count} error{casResult.error_count!==1?"s":""}</div>}
            </div>
          )}
        </div>
        <MA><button className="btns" onClick={resetCASDownloader}>Done</button></MA>
      </>)}
    </Overlay>)}
    {modal==="pdf"&&(<Overlay onClose={()=>setModal(null)}><div className="modtitle">Portfolio Report</div>{pdfState.loading?(<div style={{textAlign:"center",padding:"2.5rem 0"}}><div style={{width:34,height:34,border:"2px solid rgba(201,168,76,.2)",borderTopColor:"#c9a84c",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 1rem"}}/><div style={{fontSize:".8rem",color:"rgba(255,255,255,.5)"}}>Generating AI commentary…</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>):(<><div style={{fontSize:".68rem",letterSpacing:".1em",textTransform:"uppercase",color:"#c9a84c",marginBottom:".7rem"}}>AI Advisor Commentary</div><div style={{background:"rgba(201,168,76,.05)",border:"1px solid rgba(201,168,76,.14)",borderRadius:8,padding:"1rem 1.2rem",fontSize:".8rem",lineHeight:1.72,color:"rgba(255,255,255,.85)",maxHeight:260,overflowY:"auto",whiteSpace:"pre-wrap"}}>{pdfState.summary}</div></>)}<MA><button className="btnc" onClick={()=>setModal(null)}>Close</button></MA></Overlay>)}
    {/* ── Bottom Nav (mobile only, hidden on desktop via CSS) ── */}
    <div className="bottom-nav">
      {[
        {key:"overview",icon:"📊",label:"Overview"},
        {key:"holdings",icon:"📈",label:"Holdings"},
        {key:"budget",icon:"💰",label:"Budget",budget:true},
        {key:"goals",icon:"🎯",label:"Goals"},
        {key:"_more",icon:"⋯",label:"More"},
      ].map(n=>{
        const lockedTabs=new Set(loaded&&holdings.length===0&&!demoMode?["goals","strategy","members","calendar","ask"]:[]);
        const isLocked=n.key!=="_more"&&lockedTabs.has(n.key);
        return(<div key={n.key}
          className={`bnav-item${tab===n.key?" act":""}${n.budget?" budget-tab":""}${n.key==="_more"&&moreSheetOpen?" act":""}`}
          style={isLocked?{opacity:.35,pointerEvents:"none"}:{}}
          onClick={()=>{if(n.key==="_more"){setMoreSheetOpen(p=>!p);}else{setTab(n.key);setMoreSheetOpen(false);}}}
        ><span className="bnav-icon">{n.icon}</span><span className="bnav-label">{n.label}</span></div>);
      })}
    </div>
    {/* More sheet overlay */}
    {moreSheetOpen&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:205}} onClick={()=>setMoreSheetOpen(false)}/>}
    <div className={`more-sheet${moreSheetOpen?" open":""}`}>
      <div className="more-sheet-handle"/>
      <div className="more-sheet-grid">
        {[
          {key:"strategy",icon:"⚖️",label:"Strategy",badge:trigAlerts.length||null},
          {key:"members",icon:"👥",label:"Members"},
          {key:"calendar",icon:"📅",label:"Calendar"},
          {key:"ask",icon:"✦",label:"AI Advisor"},
        ].map(n=>{
          const lockedTabs=new Set(loaded&&holdings.length===0&&!demoMode?["goals","strategy","members","calendar","ask"]:[]);
          const isLocked=lockedTabs.has(n.key);
          return(<div key={n.key}
            className={`more-sheet-item${tab===n.key?" act":""}`}
            style={isLocked?{opacity:.35,pointerEvents:"none"}:{}}
            onClick={()=>{if(!isLocked){setTab(n.key);setMoreSheetOpen(false);}}}
          ><span className="msi-icon">{n.icon}{n.badge&&<span className="tbadge" style={{marginLeft:2,verticalAlign:"top"}}>{n.badge}</span>}</span><span className="msi-label">{n.label}</span></div>);
        })}
      </div>
    </div>
    </>
  );
}

function GoalPlanModal({open,onClose,goals,members,holdings,allCur,allInv}){
  const [loading,setLoading] = useState(false);
  const [plan,setPlan]       = useState("");
  const [error,setError]     = useState("");

  function goalCurVal(g){
    const lt=g.linkedTypes||[];
    const lm=g.linkedMembers||["all"];
    const memberH = lm.includes("all")||lm.length===0 ? holdings : holdings.filter(h=>lm.includes(h.member_id));
    if(lt.length>0){
      const typeSet=new Set(lt);
      return memberH.filter(h=>typeSet.has(h.type)).reduce((s,h)=>s+getValINR(h),0);
    }
    return memberH.reduce((s,h)=>s+getValINR(h),0);
  }

  useEffect(()=>{
    if(!open) return;
    setPlan(""); setError("");
    generate();
  },[open]);

  async function generate(){
    setLoading(true);
    const sorted=[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99));
    const goalDetails=sorted.map((g,i)=>{
      const cur=goalCurVal(g);
      const pct=g.targetAmount>0?(cur/g.targetAmount*100).toFixed(1):0;
      const rem=Math.max(0,g.targetAmount-cur);
      const yLeft=((Math.max(0,new Date(g.targetDate)-new Date()))/(864e5*365.25)).toFixed(1);
      const lm=g.linkedMembers||["all"];
      const mNames=lm.includes("all")?"all family members":lm.map(id=>members.find(m=>m.id===id)?.name||"?").join(", ");
      const lh=g.linkedTypes||[];
      const linkedDetail=lh.length>0?` | Asset types: ${lh.map(t=>AT[t]?.label||t).join(", ")}`:"";      return `${i+1}. ${g.name} [Priority ${g.priority||i+1}] — Category: ${g.category} | Target: ${fmtCr(g.targetAmount)} by ${g.targetDate} | Current: ${fmtCr(cur)} (${pct}%) | Remaining: ${fmtCr(rem)} | Time left: ${yLeft}y | Linked to: ${mNames}${g.monthlyContribution>0?` | Monthly SIP: ₹${(+g.monthlyContribution).toLocaleString("en-IN")}`:""}${linkedDetail}`;    }).join("\n");

    const memberBreakdown=members.map(m=>{
      const mCur=holdings.reduce((s,h)=>h.member_id===m.id?s+getValINR(h):s,0);
      const mInv=holdings.reduce((s,h)=>h.member_id===m.id?s+h.purchase_value||0:s,0);
      return `  ${m.name} (${m.relation}): ${fmtCr(mCur)}`;
    }).join("\n");

    const prompt=`You are a wealth advisor for an Indian family. Analyse their financial goals and provide a clear, prioritised fulfillment plan.

FAMILY PORTFOLIO SUMMARY:
- Total portfolio value: ${fmtCr(allCur)}
- Total invested: ${fmtCr(allInv)}
- Total gain: ${fmtCr(allCur-allInv)} (${allInv>0?((allCur-allInv)/allInv*100).toFixed(1):0}% return)

MEMBER PORTFOLIOS:
${memberBreakdown}

GOALS (sorted by priority):
${goalDetails}

Please provide:
1. A brief assessment of each goal's feasibility given current portfolio and time horizon
2. A recommended monthly SIP allocation strategy across goals (if multiple goals compete for funds)
3. Specific action items for the top 3 priority goals
4. Any goals that are at risk of not being met and what corrective action to take
5. A summary recommendation on goal prioritisation

Keep the response practical, specific to the numbers, and formatted clearly with headings. Use Indian number formatting (Lakhs/Crores).`;

    try{
      const res=await fetch("/api/ai/chat",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`},
        body:JSON.stringify({model:"claude-opus-4-5",max_tokens:2000,
          system:"You are a concise, practical Indian family wealth advisor. Format with clear sections. Be specific with numbers.",
          messages:[{role:"user",content:prompt}]})});
      const data=await res.json();
      const text=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      setPlan(text||"No response received");
    }catch(e){ setError(e.message); }
    setLoading(false);
  }

  if(!open) return null;
  return(
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:700}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>✦ Goal Fulfillment Plan</div>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.5)"}}>AI-powered analysis of your {goals.length} goal{goals.length!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",gap:".4rem"}}>
            <button onClick={generate} disabled={loading}
              style={{background:"rgba(160,132,202,.12)",border:"1px solid rgba(160,132,202,.3)",color:"#a084ca",borderRadius:5,padding:".28rem .65rem",cursor:"pointer",fontSize:".68rem",fontFamily:"'DM Sans',sans-serif"}}>
              {loading?"…":"⟳ Refresh"}
            </button>
            <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Goal priority summary */}
        <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:"1rem"}}>
          {[...goals].sort((a,b)=>(a.priority||99)-(b.priority||99)).map((g,i)=>(
            <div key={g.id} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".28rem .65rem",
              background:`${g.color}14`,border:`1px solid ${g.color}44`,borderRadius:12,fontSize:".68rem",color:g.color}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:g.color}}/>
              P{g.priority||i+1} {g.name}
            </div>
          ))}
        </div>

        {/* Quick summary table */}
        <div style={{marginBottom:"1rem",overflowX:"auto",border:"1px solid rgba(255,255,255,.06)",borderRadius:6}}>
          <table style={{width:"100%",fontSize:".7rem",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,.1)"}}>
              {["Goal","Status","Funded","Gap","Monthly Needed"].map(h=><th key={h} style={{padding:".4rem .55rem",textAlign:"left",color:"rgba(255,255,255,.4)",fontWeight:500,fontSize:".6rem",letterSpacing:".06em",textTransform:"uppercase"}}>{h}</th>)}
            </tr></thead>
            <tbody>{sorted.map((g,i)=>{
              const cur=goalCurVal(g);
              const rem=Math.max(0,g.targetAmount-cur);
              const yLeft=Math.max(0.1,((new Date(g.targetDate)-new Date())/(864e5*365.25)));
              const monthlyNeeded=rem/(yLeft*12);
              const pct=g.targetAmount>0?(cur/g.targetAmount*100):0;
              const status=pct>=100?"Achieved":yLeft<=0?"Overdue":pct>=40?"On track":"Behind";
              const stColor=status==="Achieved"?"#1d9e75":status==="On track"?"#1d9e75":status==="Overdue"?"#e07c5a":"#e07c5a";
              return <tr key={g.id} style={{borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <td style={{padding:".4rem .55rem",color:g.color,fontWeight:500}}>{g.name}</td>
                <td style={{padding:".4rem .55rem"}}><span style={{color:stColor,fontSize:".62rem",background:stColor+"15",border:`1px solid ${stColor}33`,borderRadius:8,padding:"1px 7px"}}>{status}</span></td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>{pct.toFixed(0)}%</td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>{fmtCr(rem)}</td>
                <td style={{padding:".4rem .55rem",fontFamily:"'DM Mono',monospace"}}>₹{Math.round(monthlyNeeded).toLocaleString("en-IN")}/mo</td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        {/* Plan content */}
        <div style={{background:"rgba(160,132,202,.04)",border:"1px solid rgba(160,132,202,.14)",borderRadius:8,
          padding:"1rem 1.2rem",maxHeight:440,overflowY:"auto",minHeight:180,
          display:"flex",alignItems:loading&&!plan?"center":"flex-start",justifyContent:loading&&!plan?"center":"flex-start"}}>
          {loading&&!plan&&(
            <div style={{textAlign:"center"}}>
              <div style={{width:28,height:28,border:"2px solid rgba(160,132,202,.2)",borderTopColor:"#a084ca",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto .75rem"}}/>
              <div style={{fontSize:".78rem",color:"rgba(255,255,255,.45)"}}>Analysing your goals…</div>
            </div>
          )}
          {error&&<div style={{color:"#e07c5a",fontSize:".8rem"}}>⚠ {error}</div>}
          {plan&&(
            <div style={{fontSize:".8rem",lineHeight:1.75,color:"rgba(255,255,255,.85)",whiteSpace:"pre-wrap",width:"100%"}}>
              {plan}
            </div>
          )}
        </div>

        <div style={{marginTop:".75rem",textAlign:"right"}}>
          <button className="btnc" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DonutChart({data,total}){
  const S=180,cx=90,cy=90,r=72,ir=44;let angle=-90;
  const slices=data.map(d=>{const sweep=(d.v/total)*360,startA=angle;angle+=sweep;return{...d,startA,endA:angle};});
  const pt=(a,rad)=>({x:cx+rad*Math.cos(a*Math.PI/180),y:cy+rad*Math.sin(a*Math.PI/180)});
  const arc=(sa,ea,or,ir2)=>{if(Math.abs(ea-sa)>=359.99)ea=sa+359.99;const s=pt(sa,or),e=pt(ea,or),si=pt(sa,ir2),ei=pt(ea,ir2),l=ea-sa>180?1:0;return`M${s.x},${s.y}A${or},${or},0,${l},1,${e.x},${e.y}L${ei.x},${ei.y}A${ir2},${ir2},0,${l},0,${si.x},${si.y}Z`;};
  const fmtV=v=>v>=1e7?`₹${(v/1e7).toFixed(2)}Cr`:v>=1e5?`₹${(v/1e5).toFixed(2)}L`:`₹${Math.round(v).toLocaleString("en-IN")}`;
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"2.5rem",flexWrap:"wrap",padding:".5rem 0"}}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
        {slices.map(s=><path key={s.t} d={arc(s.startA,s.endA,r,ir)} fill={AT[s.t].color} opacity={0.85}/>)}
        <text x={cx} y={cy-6} textAnchor="middle" fill="#ffffff" fontSize="11" fontFamily="DM Mono">{total>=1e7?(total/1e7).toFixed(1)+"Cr":total>=1e5?(total/1e5).toFixed(1)+"L":"₹"+Math.round(total)}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill="rgba(255,255,255,.42)" fontSize="8.5" fontFamily="DM Sans">TOTAL</text>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:".6rem"}}>
        {slices.map(s=>(
          <div key={s.t} style={{display:"flex",alignItems:"center",gap:".55rem"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:AT[s.t].color,flexShrink:0}}/>
            <span style={{color:"rgba(255,255,255,.65)",fontSize:".76rem",minWidth:94}}>{AT[s.t].label}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:".73rem",color:"#ffffff",minWidth:72,textAlign:"right"}}>{fmtV(s.v)}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:".7rem",color:"rgba(255,255,255,.5)",minWidth:40,textAlign:"right"}}>{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function ImportModal({ importState, setImportState, members, AT, handleImportFile, executeImport, resetImport, importFileRef, onClose, fmt, submitCASPassword }) {
  const { mode, step, format, holdings, transactions, warnings, result, dragOver, assignMember, accounts, accountMap, needsPassword, casPan, casDob, casRemember } = importState;
  const items = mode === "transactions" ? transactions : holdings;
  const dupCount = holdings.filter(h => h._duplicate).length;
  const importCount = mode === "transactions" ? transactions.length : holdings.length;

  const US_FORMATS = [
    { name: "Schwab", color: "#00a3e0" }, { name: "Fidelity", color: "#4a8c2a" },
    { name: "Robinhood", color: "#00c805" }, { name: "Vanguard", color: "#c22e2e" },
    { name: "IBKR", color: "#d81b3c" }, { name: "E*TRADE", color: "#6633cc" },
    { name: "Merrill", color: "#0060a9" }, { name: "J.P. Morgan", color: "#1a3c6e" },
    { name: "Webull", color: "#f5a623" }, { name: "SoFi", color: "#00bcd4" },
    { name: "Wealthfront", color: "#522da8" }, { name: "Betterment", color: "#1d8ae0" },
    { name: "Firstrade", color: "#003d79" }, { name: "Ally", color: "#650360" },
    { name: "Public", color: "#000000" }, { name: "Tastytrade", color: "#b71c1c" },
    { name: "Coinbase", color: "#0052ff" },
  ];
  const IN_FORMATS = [
    { name: "Zerodha", color: "#e5483e" }, { name: "Groww", color: "#00d09c" },
    { name: "ICICI Direct", color: "#f58220" }, { name: "HDFC Sec", color: "#004b8d" },
    { name: "Upstox", color: "#6b3fa0" }, { name: "Angel One", color: "#1d4aa7" },
    { name: "Kuvera / MF", color: "#2e7d32" },
  ];
  const OTHER_FORMATS = [
    { name: "NSDL/CDSL CAS", color: "#e07c5a" }, { name: "PDF", color: "#e05555" }, { name: "Excel", color: "#217346" }, { name: "Generic CSV", color: "#888" },
  ];

  return (
    <Overlay onClose={onClose} wide>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
        <div className="modtitle" style={{margin:0}}>
          {step==="done"?"✓ Import Complete":step==="importing"?"Importing…":step==="dup_review"?"⚠ Review Duplicates":step==="cas_password"?"🔒 Unlock CAS PDF":step==="preview"?(mode==="transactions"?"Import Transactions":"Import Portfolio"):"Import Portfolio or Transactions"}
        </div>
      </div>

      {step==="upload"&&(<>
        <div style={{border:`2px dashed ${dragOver?"#c9a84c":"rgba(255,255,255,.22)"}`,borderRadius:12,
          padding:"2.5rem 1.5rem",textAlign:"center",cursor:"pointer",
          background:dragOver?"rgba(201,168,76,.06)":"rgba(255,255,255,.02)",transition:"all .25s",marginBottom:"1.2rem"}}
          onClick={()=>importFileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setImportState(s=>({...s,dragOver:true}));}}
          onDragLeave={()=>setImportState(s=>({...s,dragOver:false}))}
          onDrop={e=>{e.preventDefault();setImportState(s=>({...s,dragOver:false}));const f=e.dataTransfer.files[0];if(f)handleImportFile(f);}}>
          <div style={{fontSize:"2.2rem",marginBottom:".6rem"}}>📂</div>
          <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)",fontWeight:500}}>
            Drag & drop your broker export here
          </div>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.45)",marginTop:".4rem"}}>
            Holdings or tradebook — auto-detected · CSV, XLSX, PDF
          </div>
          <button className="btns" style={{marginTop:"1rem",fontSize:".75rem"}}>Browse Files</button>
        </div>
        <div style={{fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"#c9a84c",marginBottom:".6rem",fontWeight:600}}>Auto-detected formats</div>
        <div style={{marginBottom:".8rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",letterSpacing:".06em",textTransform:"uppercase",minWidth:"1.8rem"}}>US</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {US_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",letterSpacing:".06em",textTransform:"uppercase",minWidth:"1.8rem"}}>IN</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {IN_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
            <span style={{fontSize:".6rem",color:"rgba(255,255,255,.45)",minWidth:"1.8rem"}}></span>
            <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>
              {OTHER_FORMATS.map(f=>(
                <span key={f.name} style={{fontSize:".67rem",padding:".22rem .55rem",borderRadius:4,
                  background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.82)",border:"1px solid rgba(255,255,255,.12)",borderLeft:`3px solid ${f.color}`,whiteSpace:"nowrap"}}>
                  {f.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        {warnings.length>0&&(
          <div style={{background:"rgba(224,124,90,.1)",border:"1px solid rgba(224,124,90,.25)",borderRadius:8,padding:".7rem .9rem",marginTop:".6rem"}}>
            {warnings.map((w,i)=>(<div key={i} style={{fontSize:".73rem",color:"#e07c5a",marginBottom:i<warnings.length-1?".3rem":0}}>⚠ {w}</div>))}
          </div>
        )}
      </>)}

      {/* ── CAS Password Step ── */}
      {step==="cas_password"&&(
        <div style={{maxWidth:400,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:"1.2rem"}}>
            <div style={{fontSize:"2rem",marginBottom:".5rem"}}>🔐</div>
            <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)",marginBottom:".3rem"}}>This PDF is password-protected</div>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.5)"}}>NSDL/CDSL CAS password is your PAN number</div>
          </div>
          <div style={{marginBottom:".8rem"}}>
            <label style={{fontSize:".68rem",color:"rgba(255,255,255,.6)",letterSpacing:".05em",textTransform:"uppercase",display:"block",marginBottom:".3rem"}}>PAN Number</label>
            <input className="fi" value={casPan} onChange={e=>setImportState(s=>({...s,casPan:e.target.value.toUpperCase()}))}
              placeholder="ABCDE1234F" maxLength={10} style={{fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:".1em"}}/>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:".5rem",fontSize:".73rem",color:"rgba(255,255,255,.6)",marginBottom:"1.2rem",cursor:"pointer"}}>
            <input type="checkbox" checked={casRemember} onChange={e=>setImportState(s=>({...s,casRemember:e.target.checked}))}
              style={{accentColor:"#c9a84c"}}/>
            Remember for future imports (encrypted)
          </label>
          {warnings.length>0&&(
            <div style={{background:"rgba(224,124,90,.1)",border:"1px solid rgba(224,124,90,.25)",borderRadius:8,padding:".55rem .75rem",marginBottom:".8rem"}}>
              {warnings.map((w,i)=>(<div key={i} style={{fontSize:".73rem",color:"#e07c5a"}}>⚠ {w}</div>))}
            </div>
          )}
          <div style={{display:"flex",gap:".7rem"}}>
            <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"upload",needsPassword:false,pendingFile:null}))}>Cancel</button>
            <button className="btns" disabled={!casPan||casPan.length!==10} onClick={submitCASPassword}>
              Unlock & Import
            </button>
          </div>
        </div>
      )}

      {step==="preview"&&(<>
        <div style={{display:"flex",alignItems:"center",gap:".7rem",marginBottom:".8rem",flexWrap:"wrap"}}>
          <span style={{fontSize:".72rem",padding:".25rem .65rem",borderRadius:5,
            background:"rgba(201,168,76,.12)",color:"#c9a84c",fontWeight:600,border:"1px solid rgba(201,168,76,.2)"}}>
            {format}
          </span>
          <span style={{fontSize:".68rem",padding:".22rem .55rem",borderRadius:5,
            background:mode==="transactions"?"rgba(160,132,202,.12)":"rgba(76,175,154,.12)",
            color:mode==="transactions"?"#a084ca":"#4caf9a",fontWeight:600,
            border:`1px solid ${mode==="transactions"?"rgba(160,132,202,.25)":"rgba(76,175,154,.25)"}`}}>
            {mode==="transactions"?"📋 Transactions":"📊 Holdings"}
          </span>
          <span style={{fontSize:".75rem",color:"rgba(255,255,255,.7)"}}>
            {items.length} {mode==="transactions"?"transaction":"holding"}{items.length!==1?"s":""} found
          </span>
          {dupCount>0&&<span style={{fontSize:".72rem",color:"#e0a85a",background:"rgba(224,168,90,.1)",padding:".18rem .5rem",borderRadius:4,border:"1px solid rgba(224,168,90,.2)"}}>⚠ {dupCount} already in portfolio</span>}
        </div>
        {mode==="holdings"&&members.length>0&&(
          <div style={{marginBottom:".8rem"}}>
            {accounts.length>0&&members.length>1?(
              <div>
                <div style={{fontSize:".65rem",letterSpacing:".06em",textTransform:"uppercase",color:"rgba(255,255,255,.45)",marginBottom:".4rem"}}>Map accounts to family members</div>
                {accounts.map(acct=>{
                  const autoMatched = accountMap[acct] && members.find(m=>m.id===accountMap[acct]);
                  return(
                  <div key={acct} style={{display:"flex",gap:".6rem",alignItems:"center",marginBottom:".35rem"}}>
                    <span style={{fontSize:".72rem",color:"rgba(255,255,255,.7)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acct}</span>
                    <span style={{fontSize:".65rem",color:"rgba(255,255,255,.4)"}}>→</span>
                    <select className="fi fs" style={{padding:".22rem .5rem",fontSize:".7rem",width:"auto",minWidth:120,
                      borderColor: autoMatched ? "rgba(76,175,154,.4)" : undefined}}
                      value={accountMap[acct]||""} onChange={e=>setImportState(s=>({...s,accountMap:{...s.accountMap,[acct]:e.target.value}}))}>
                      <option value="">Auto (first member)</option>
                      {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    {autoMatched&&<span style={{fontSize:".6rem",color:"#4caf9a"}}>✓ matched</span>}
                  </div>
                );})}

              </div>
            ):(
              <div style={{display:"flex",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
                <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".73rem",color:"rgba(255,255,255,.7)"}}>
                  Assign to:
                  <select className="fi fs" style={{padding:".25rem .5rem",fontSize:".72rem",width:"auto"}}
                    value={assignMember||members[0]?.id||""} onChange={e=>setImportState(s=>({...s,assignMember:e.target.value}))}>
                    {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                {members.length===1&&<span style={{fontSize:".62rem",color:"rgba(76,175,154,.6)"}}>✓ auto-selected</span>}
              </div>
            )}
          </div>
        )}
        {warnings.length>0&&(
          <div style={{background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.15)",borderRadius:8,padding:".55rem .75rem",marginBottom:".7rem"}}>
            {warnings.map((w,i)=>(<div key={i} style={{fontSize:".7rem",color:"#c9a84c"}}>⚠ {w}</div>))}
          </div>
        )}
        <div style={{overflowX:"auto",maxHeight:340,overflowY:"auto",borderRadius:8,border:"1px solid rgba(255,255,255,.06)"}}>
          {mode==="transactions"?(
            <table className="ht" style={{fontSize:".72rem"}}><thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th className="r">Units</th><th className="r">Price</th></tr></thead>
            <tbody>{transactions.slice(0,200).map((t,i)=>(
              <tr key={i}><td className="mono dim">{t.txn_date}</td><td>{t._symbol}</td>
              <td><span style={{fontSize:".65rem",padding:".15rem .4rem",borderRadius:3,
                background:t.txn_type==="BUY"?"rgba(76,175,154,.15)":"rgba(224,124,90,.15)",
                color:t.txn_type==="BUY"?"#4caf9a":"#e07c5a"}}>{t.txn_type}</span></td>
              <td className="r mono">{t.units}</td><td className="r mono dim">{fmt(t.price)}</td></tr>
            ))}</tbody></table>
          ):(
            <table className="ht" style={{fontSize:".72rem"}}><thead><tr><th style={{width:30}}></th><th>Name</th><th>Type</th><th>Ticker/Code</th><th className="r">Units</th><th className="r">Avg Cost</th><th className="r">Invested</th></tr></thead>
            <tbody>{holdings.map((h,i)=>{
              const inv=h.purchase_value||(h.units*(h.purchase_price||h.purchase_nav||0));
              return(<tr key={i}>
                <td>{h._duplicate
                  ?<span title="Existing — will update" style={{fontSize:".65rem",padding:".12rem .35rem",borderRadius:3,background:"rgba(90,156,224,.12)",color:"#5a9ce0"}}>↻</span>
                  :<span title="New holding" style={{fontSize:".65rem",padding:".12rem .35rem",borderRadius:3,background:"rgba(76,175,154,.12)",color:"#4caf9a"}}>+</span>}</td>
                <td style={{fontWeight:500}}>{h.name}</td>
                <td><span className="tbadge2" style={{background:(AT[h.type]?.color||"#888")+"22",color:AT[h.type]?.color||"#888"}}>{AT[h.type]?.icon||"📦"} {AT[h.type]?.label||h.type}</span></td>
                <td className="mono dim">{h.ticker||h.scheme_code||"—"}</td>
                <td className="r mono">{h.units||"—"}</td>
                <td className="r mono dim">{fmt(h.purchase_price||h.purchase_nav||0)}</td>
                <td className="r mono">{fmt(inv)}</td>
              </tr>);
            })}</tbody></table>
          )}
        </div>
        {items.length>200&&<div style={{fontSize:".68rem",color:"rgba(255,255,255,.4)",textAlign:"center",marginTop:".4rem"}}>Showing first 200 of {items.length} rows</div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"1rem",gap:".6rem"}}>
          <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"upload",holdings:[],transactions:[],warnings:[]}))}>← Back</button>
          <div style={{display:"flex",gap:".5rem"}}>
            <button className="btnc" onClick={onClose}>Cancel</button>
            <button className="btns" onClick={()=>{
              if(mode==="holdings"&&dupCount>0){
                setImportState(s=>({...s,step:"dup_review"}));
              } else {
                executeImport();
              }
            }} disabled={importCount===0}>
              {mode==="holdings"&&dupCount>0
                ?`Review ${dupCount} Duplicate${dupCount>1?"s":""} →`
                :`Import ${importCount} ${mode==="transactions"?"Transaction":"Holding"}${importCount!==1?"s":""}`}
            </button>
          </div>
        </div>
      </>)}

      {step==="dup_review"&&(<>
        <div style={{marginBottom:"1rem"}}>
          <div style={{fontSize:".85rem",fontWeight:600,color:"#e0a85a",marginBottom:".4rem"}}>
            ⚠ {dupCount} holding{dupCount>1?"s":""} already exist{dupCount===1?"s":""} in your portfolio
          </div>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.55)",lineHeight:1.5}}>
            This file contains holdings that match existing entries. Choose what to do with each duplicate, or use the bulk actions below.
          </div>
        </div>

        {/* Bulk actions */}
        <div style={{display:"flex",gap:".5rem",marginBottom:".8rem",flexWrap:"wrap"}}>
          <button className="btnc" style={{fontSize:".68rem",padding:".28rem .65rem"}} onClick={()=>{
            setImportState(s=>({...s,holdings:s.holdings.map(h=>h._duplicate?{...h,_dupAction:"update"}:h)}));
          }}>↻ Update All Duplicates</button>
          <button className="btnc" style={{fontSize:".68rem",padding:".28rem .65rem"}} onClick={()=>{
            setImportState(s=>({...s,holdings:s.holdings.map(h=>h._duplicate?{...h,_dupAction:"skip"}:h)}));
          }}>⊘ Skip All Duplicates</button>
        </div>

        {/* Per-holding duplicate review */}
        <div style={{maxHeight:380,overflowY:"auto",borderRadius:8,border:"1px solid rgba(255,255,255,.06)"}}>
          {holdings.filter(h=>h._duplicate).map((h,i)=>{
            const action = h._dupAction || "update";
            const ex = h._existing || {};
            const newInv = h.purchase_value||(h.units*(h.purchase_price||h.purchase_nav||0));
            const exInv = ex.purchase_value||(ex.units*(ex.purchase_price||0));
            const unitsChanged = ex.units && h.units && Math.abs(ex.units-h.units)>0.001;
            const priceChanged = ex.purchase_price && h.purchase_price && Math.abs(ex.purchase_price-h.purchase_price)>0.01;
            return(
            <div key={i} style={{padding:".75rem .85rem",borderBottom:"1px solid rgba(255,255,255,.05)",
              background:action==="skip"?"rgba(255,255,255,.015)":"rgba(90,156,224,.03)",
              opacity:action==="skip"?.55:1,transition:"all .2s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:".6rem",marginBottom:".45rem"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:".78rem",fontWeight:600,color:"#fff"}}>{h.name}</div>
                  <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)",marginTop:".15rem"}}>
                    {h.ticker||h.scheme_code||"—"} · <span className="tbadge2" style={{background:(AT[h.type]?.color||"#888")+"22",color:AT[h.type]?.color||"#888",fontSize:".6rem",padding:".1rem .35rem"}}>{AT[h.type]?.icon||"📦"} {AT[h.type]?.label||h.type}</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:".3rem",flexShrink:0}}>
                  <button onClick={()=>setImportState(s=>({...s,holdings:s.holdings.map((hh,ii)=>hh===h?{...hh,_dupAction:"update"}:hh)}))}
                    style={{fontSize:".65rem",padding:".22rem .5rem",borderRadius:4,cursor:"pointer",border:"1px solid",transition:"all .15s",fontFamily:"'DM Sans',sans-serif",
                      background:action==="update"?"rgba(90,156,224,.15)":"transparent",
                      borderColor:action==="update"?"rgba(90,156,224,.45)":"rgba(255,255,255,.15)",
                      color:action==="update"?"#5a9ce0":"rgba(255,255,255,.5)"}}>
                    ↻ Update
                  </button>
                  <button onClick={()=>setImportState(s=>({...s,holdings:s.holdings.map((hh,ii)=>hh===h?{...hh,_dupAction:"skip"}:hh)}))}
                    style={{fontSize:".65rem",padding:".22rem .5rem",borderRadius:4,cursor:"pointer",border:"1px solid",transition:"all .15s",fontFamily:"'DM Sans',sans-serif",
                      background:action==="skip"?"rgba(224,124,90,.12)":"transparent",
                      borderColor:action==="skip"?"rgba(224,124,90,.35)":"rgba(255,255,255,.15)",
                      color:action==="skip"?"#e07c5a":"rgba(255,255,255,.5)"}}>
                    ⊘ Skip
                  </button>
                </div>
              </div>
              {/* Side-by-side comparison */}
              {action!=="skip"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:".4rem",fontSize:".67rem",marginTop:".3rem"}}>
                  <div style={{background:"rgba(255,255,255,.03)",borderRadius:6,padding:".4rem .6rem",border:"1px solid rgba(255,255,255,.06)"}}>
                    <div style={{fontSize:".58rem",letterSpacing:".06em",textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:".25rem"}}>Current (in portfolio)</div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Units: <span className="mono">{ex.units!=null?fmt(ex.units,2):"—"}</span></div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Avg Cost: <span className="mono">{ex.purchase_price?fmt(ex.purchase_price):"—"}</span></div>
                    <div style={{color:"rgba(255,255,255,.65)"}}>Invested: <span className="mono">{exInv?fmt(exInv):"—"}</span></div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",color:"rgba(255,255,255,.25)",fontSize:"1.1rem"}}>→</div>
                  <div style={{background:"rgba(90,156,224,.05)",borderRadius:6,padding:".4rem .6rem",border:"1px solid rgba(90,156,224,.12)"}}>
                    <div style={{fontSize:".58rem",letterSpacing:".06em",textTransform:"uppercase",color:"#5a9ce0",marginBottom:".25rem"}}>New (from file)</div>
                    <div style={{color:"#fff"}}>Units: <span className="mono" style={{color:unitsChanged?"#c9a84c":"#fff"}}>{fmt(h.units||0,2)}</span>{unitsChanged&&<span style={{fontSize:".58rem",color:"#c9a84c",marginLeft:".3rem"}}>changed</span>}</div>
                    <div style={{color:"#fff"}}>Avg Cost: <span className="mono" style={{color:priceChanged?"#c9a84c":"#fff"}}>{fmt(h.purchase_price||h.purchase_nav||0)}</span>{priceChanged&&<span style={{fontSize:".58rem",color:"#c9a84c",marginLeft:".3rem"}}>changed</span>}</div>
                    <div style={{color:"#fff"}}>Invested: <span className="mono">{fmt(newInv)}</span></div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>

        {/* Summary + new holdings count */}
        {holdings.filter(h=>!h._duplicate).length>0&&(
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.55)",marginTop:".6rem"}}>
            + {holdings.filter(h=>!h._duplicate).length} new holding{holdings.filter(h=>!h._duplicate).length>1?"s":""} will be added
          </div>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"1rem",gap:".6rem"}}>
          <button className="btnc" onClick={()=>setImportState(s=>({...s,step:"preview"}))}>← Back to Preview</button>
          <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
            {holdings.filter(h=>h._duplicate&&(h._dupAction||"update")==="skip").length>0&&(
              <span style={{fontSize:".67rem",color:"#e07c5a"}}>
                {holdings.filter(h=>h._duplicate&&h._dupAction==="skip").length} will be skipped
              </span>
            )}
            <button className="btns" onClick={executeImport}>
              Confirm & Import {holdings.filter(h=>!h._duplicate||(h._dupAction||"update")!=="skip").length} Holding{holdings.filter(h=>!h._duplicate||(h._dupAction||"update")!=="skip").length!==1?"s":""}
            </button>
          </div>
        </div>
      </>)}

      {step==="importing"&&(
        <div style={{textAlign:"center",padding:"2.5rem 1rem"}}>
          <div style={{width:40,height:40,margin:"0 auto 1rem",border:"3px solid rgba(201,168,76,.2)",borderTopColor:"#c9a84c",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <div style={{fontSize:".85rem",color:"rgba(255,255,255,.85)"}}>Importing {items.length} {mode==="transactions"?"transactions":"holdings"}…</div>
          <div style={{fontSize:".7rem",color:"rgba(255,255,255,.4)",marginTop:".4rem"}}>Creating entries and first transactions</div>
        </div>
      )}

      {step==="done"&&result&&(
        <div style={{padding:".5rem 0"}}>
          <div style={{background:"rgba(76,175,154,.08)",border:"1px solid rgba(76,175,154,.2)",borderRadius:10,padding:"1rem 1.2rem",marginBottom:".8rem"}}>
            <div style={{fontSize:"1.1rem",fontWeight:600,color:"#4caf9a",marginBottom:".3rem"}}>
              ✓ {(result.inserted_count||0)+(result.updated_count||0)+(result.imported_count||0)} processed
            </div>
            {result.inserted_count>0&&<div style={{fontSize:".75rem",color:"rgba(255,255,255,.7)"}}>+ {result.inserted_count} new holding{result.inserted_count>1?"s":""} added</div>}
            {result.updated_count>0&&<div style={{fontSize:".75rem",color:"#5a9ce0"}}>↻ {result.updated_count} existing holding{result.updated_count>1?"s":""} updated</div>}
            {result.skipped_count>0&&<div style={{fontSize:".75rem",color:"rgba(255,255,255,.45)"}}>⊘ {result.skipped_count} duplicate{result.skipped_count>1?"s":""} skipped (kept existing)</div>}
            {result.unmatched_count>0&&(<div style={{fontSize:".75rem",color:"#e07c5a",marginTop:".3rem"}}>
              ⚠ {result.unmatched_count} transaction{result.unmatched_count>1?"s":""} not matched to holdings:
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.5)",marginTop:".2rem"}}>{result.unmatched?.join(", ")}</div>
            </div>)}
            {result.error_count>0&&<div style={{fontSize:".75rem",color:"#e07c5a",marginTop:".3rem"}}>{result.error_count} error{result.error_count>1?"s":""}</div>}
          </div>
          {result.errors?.length>0&&(
            <div style={{background:"rgba(224,124,90,.08)",borderRadius:8,padding:".6rem .8rem",marginBottom:".7rem"}}>
              {result.errors.map((e,i)=>(<div key={i} style={{fontSize:".7rem",color:"#e07c5a"}}>• {e}</div>))}
            </div>
          )}
          <div style={{display:"flex",justifyContent:"flex-end",gap:".5rem"}}>
            <button className="btnc" onClick={resetImport}>Import More</button>
            <button className="btns" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Overlay>
  );
}
function Overlay({onClose,children,narrow,wide}){return<div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}><div className="mod" style={{maxWidth:narrow?380:wide?700:540}}>{children}</div></div>;}
function FG({label,children}){return<div className="fg"><label className="flbl">{label}</label>{children}</div>;}
function MA({children}){return<div className="ma">{children}</div>;}

const CSS=`
*{box-sizing:border-box;margin:0;padding:0}
html,body{overflow-x:hidden;width:100%}
body{background:#070d1a}
.app{min-height:100vh;background:#070d1a;background-image:radial-gradient(ellipse at 20% 10%,rgba(201,168,76,.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(90,156,224,.05) 0%,transparent 50%);font-family:'DM Sans',sans-serif;color:#ffffff}

/* ── Header ── */
.hdr{border-bottom:1px solid rgba(201,168,76,.14);padding:0 1.2rem;display:flex;align-items:center;justify-content:space-between;height:56px;background:rgba(7,13,26,.97);backdrop-filter:blur(12px);position:sticky;top:0;z-index:100;gap:.5rem}
.logo{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:500;letter-spacing:.04em;color:#ffffff;flex-shrink:0}.logo span{color:#c9a84c}
.hdr-r{display:flex;align-items:center;gap:.4rem;flex-wrap:nowrap}
.btn-o{background:none;border:1px solid rgba(201,168,76,.3);color:#c9a84c;padding:.3rem .7rem;border-radius:4px;cursor:pointer;font-size:.68rem;letter-spacing:.06em;transition:all .2s;white-space:nowrap;font-family:'DM Sans',sans-serif}.btn-o:hover{background:rgba(201,168,76,.1)}.btn-o:disabled{opacity:.45;cursor:not-allowed}
.btn-g{background:rgba(201,168,76,.11);border:1px solid rgba(201,168,76,.42);color:#c9a84c;padding:.32rem .78rem;border-radius:4px;cursor:pointer;font-size:.68rem;white-space:nowrap;transition:all .2s;font-family:'DM Sans',sans-serif}.btn-g:hover{background:rgba(201,168,76,.2)}
.btn-p{background:rgba(201,168,76,.17);border:1px solid rgba(201,168,76,.52);color:#c9a84c;padding:.34rem .9rem;border-radius:5px;cursor:pointer;font-size:.73rem;font-weight:500;white-space:nowrap;transition:all .2s;font-family:'DM Sans',sans-serif}.btn-p:hover{background:rgba(201,168,76,.27)}
.alert-pill{background:rgba(224,124,90,.14);border:1px solid rgba(224,124,90,.38);color:#e07c5a;padding:.28rem .65rem;border-radius:4px;font-size:.68rem;cursor:pointer;white-space:nowrap}

/* ── Layout ── */
.main{max-width:1400px;margin:0 auto;padding:1.4rem 1.2rem;padding-bottom:5rem}

/* ── Member bar ── */
.mbar{display:flex;align-items:center;gap:.5rem;margin-bottom:1.2rem;flex-wrap:wrap}
.mlbl{font-size:.67rem;letter-spacing:.1em;color:rgba(255,255,255,.5);text-transform:uppercase;margin-right:.18rem}
.mchip{padding:.32rem .75rem;border-radius:20px;cursor:pointer;font-size:.73rem;font-weight:500;border:1px solid transparent;transition:all .2s;background:rgba(255,255,255,.04);color:rgba(255,255,255,.65)}.mchip.act{background:rgba(201,168,76,.14);border-color:rgba(201,168,76,.48);color:#c9a84c}.mchip:hover:not(.act){background:rgba(255,255,255,.07);color:#ffffff}

/* ── Tabs — scrollable on mobile ── */
.tabs{display:flex;margin-bottom:1.4rem;border-bottom:1px solid rgba(255,255,255,.07);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tab{padding:.55rem 1rem;cursor:pointer;font-size:.78rem;color:rgba(255,255,255,.5);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s;white-space:nowrap;text-transform:capitalize;flex-shrink:0}.tab.act{color:#c9a84c;border-bottom-color:#c9a84c}.tab:hover:not(.act){color:rgba(255,255,255,.8)}
.tbadge{display:inline-block;background:#e07c5a;color:#fff;border-radius:10px;padding:1px 6px;font-size:.58rem;margin-left:4px;vertical-align:middle}

/* ── KPI Grid ── */
.mg{display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;margin-bottom:1.4rem}
.mc{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:1.1rem;position:relative;overflow:hidden}.mc::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.32),transparent)}
.mclbl{font-size:.63rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:.4rem}.mcval{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:500;line-height:1;color:#ffffff}.mcsub{font-size:.68rem;margin-top:.35rem}
.gain{color:#4caf9a}.loss{color:#e07c5a}
.sg{display:grid;grid-template-columns:1fr 1.4fr;gap:1.2rem;margin-bottom:1.2rem}

/* ── Cards ── */
.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:1.2rem}
.ctitle{font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#ffffff;margin-bottom:1rem}
.arow{display:flex;align-items:center;gap:.65rem;margin-bottom:.9rem}.aicon{font-size:.95rem;width:24px;text-align:center}.ainfo{flex:1}.aname{font-size:.78rem;color:rgba(255,255,255,.85)}.abg{height:3px;background:rgba(255,255,255,.07);border-radius:2px;margin-top:4px}.afill{height:100%;border-radius:2px;transition:width .8s ease}.argt{text-align:right;min-width:80px}.aval{font-size:.78rem;font-family:'DM Mono',monospace;color:#ffffff}.apct{font-size:.66rem}
.msrow{display:flex;align-items:center;gap:.7rem;padding:.75rem 0;border-bottom:1px solid rgba(255,255,255,.05)}.msrow:last-child{border-bottom:none}
.av{width:33px;height:33px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:600;flex-shrink:0;background:rgba(201,168,76,.14);color:#c9a84c;border:1px solid rgba(201,168,76,.28)}
.tbar{display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap}
.fchip{padding:.28rem .7rem;border-radius:20px;cursor:pointer;font-size:.7rem;border:1px solid transparent;transition:all .2s;background:rgba(255,255,255,.04);color:rgba(255,255,255,.55)}.fchip.act{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);color:#ffffff}

/* ── Table — horizontal scroll on mobile ── */
.ht{width:100%;border-collapse:collapse}.ht th{font-size:.61rem;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.5);text-align:left;padding:0 .6rem .6rem;border-bottom:1px solid rgba(255,255,255,.06)}.ht th.r{text-align:right}.ht td{padding:.72rem .6rem;font-size:.78rem;border-bottom:1px solid rgba(255,255,255,.04);color:rgba(255,255,255,.85)}.ht tr:hover td{background:rgba(255,255,255,.02)}
.hn{color:#ffffff;font-weight:500}.hm{font-size:.66rem;color:rgba(255,255,255,.45);margin-top:2px}
.tbadge2{padding:.16rem .48rem;border-radius:3px;font-size:.61rem;letter-spacing:.04em;font-weight:500;white-space:nowrap}
.mono{font-family:'DM Mono',monospace}.dim{color:rgba(255,255,255,.55)}.r{text-align:right}
.delbtn{background:none;border:none;cursor:pointer;color:rgba(224,124,90,.32);font-size:.76rem;padding:.2rem .42rem;transition:all .2s;border-radius:4px}.delbtn:hover{color:#e07c5a;background:rgba(224,124,90,.09)}
.btn-sm{background:none;border:1px dashed rgba(201,168,76,.28);color:rgba(201,168,76,.6);padding:.34rem .78rem;border-radius:6px;cursor:pointer;font-size:.71rem;transition:all .2s;font-family:'DM Sans',sans-serif}.btn-sm:hover{border-color:rgba(201,168,76,.55);color:#c9a84c}
.gbbg{height:4px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden}.gbfill{height:100%;border-radius:3px;transition:width .8s ease}
.empty{text-align:center;padding:2.5rem;color:rgba(255,255,255,.4);font-family:'Cormorant Garamond',serif;font-size:1rem}

/* ── Modal — full-screen on mobile ── */
.ovl{position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(5px);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem}
.mod{background:#0c1526;border:1px solid rgba(201,168,76,.2);border-radius:15px;padding:1.85rem;width:100%;max-width:640px;max-height:92vh;overflow-y:auto}
.modtitle{font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#ffffff;margin-bottom:1.2rem}
.frow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem;margin-bottom:.05rem}
.fg{display:flex;flex-direction:column;gap:.32rem;margin-bottom:.8rem}
.flbl{font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.62)}
.fi{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#ffffff;padding:.52rem .75rem;border-radius:6px;font-size:.85rem;font-family:'DM Sans',sans-serif;outline:none;transition:border-color .2s;width:100%;-webkit-appearance:none;color-scheme:dark}.fi:focus{border-color:rgba(201,168,76,.48)}.fi::placeholder{color:rgba(255,255,255,.3)}
.fs{appearance:none;-webkit-appearance:none;cursor:pointer;color:#ffffff;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.45)' stroke-width='1.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .65rem center;padding-right:1.8rem}.fs option{background:#0c1526;color:#ffffff;padding:.35rem .5rem}
.ma{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.2rem}
.btnc{background:none;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);padding:.52rem 1rem;border-radius:6px;cursor:pointer;font-size:.78rem;transition:all .2s;font-family:'DM Sans',sans-serif}.btnc:hover{border-color:rgba(255,255,255,.25);color:#ffffff}
.btns{background:rgba(201,168,76,.14);border:1px solid rgba(201,168,76,.48);color:#c9a84c;padding:.52rem 1.2rem;border-radius:6px;cursor:pointer;font-size:.78rem;font-weight:500;transition:all .2s;font-family:'DM Sans',sans-serif}.btns:hover{background:rgba(201,168,76,.24)}.btns:disabled{opacity:.38;cursor:not-allowed}

/* ── Login ── */
.login-wrap{min-height:100vh;background:#070d1a;display:flex}
.login-card{width:100%;max-width:340px}
.google-btn{display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:#ffffff;padding:.75rem 1.5rem;border-radius:8px;cursor:pointer;font-size:.88rem;font-family:'DM Sans',sans-serif;font-weight:500;transition:all .2s;width:100%}.google-btn:hover{background:rgba(255,255,255,.12)}.google-btn:disabled{opacity:.45;cursor:not-allowed}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(201,168,76,.17);border-radius:3px}

/* ════════════════════════════════
   RESPONSIVE BREAKPOINTS
════════════════════════════════ */

/* ── Bottom Nav (mobile) ── */
.bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(7,13,26,.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(201,168,76,.15);z-index:180;padding:.2rem 0 calc(.2rem + env(safe-area-inset-bottom));justify-content:space-around;align-items:center}
.bnav-item{display:flex;flex-direction:column;align-items:center;gap:.15rem;padding:.35rem .5rem;border-radius:8px;cursor:pointer;transition:all .2s;min-width:52px;-webkit-tap-highlight-color:transparent}
.bnav-item .bnav-icon{font-size:1.15rem;line-height:1}
.bnav-item .bnav-label{font-size:.58rem;letter-spacing:.04em;color:rgba(255,255,255,.35);transition:color .2s}
.bnav-item.act .bnav-label{color:#c9a84c}.bnav-item.act{background:rgba(201,168,76,.1)}
.bnav-item.budget-tab .bnav-label{color:rgba(160,132,202,.55)}.bnav-item.budget-tab.act .bnav-label{color:#a084ca}.bnav-item.budget-tab.act{background:rgba(160,132,202,.1)}

/* ── More sheet ── */
.more-sheet{position:fixed;bottom:0;left:0;right:0;background:#0c1526;border-top-left-radius:20px;border-top-right-radius:20px;border:1px solid rgba(201,168,76,.15);border-bottom:none;padding:1rem;padding-bottom:calc(1.2rem + env(safe-area-inset-bottom));z-index:210;transform:translateY(100%);transition:transform .3s ease}
.more-sheet.open{transform:translateY(0)}
.more-sheet-handle{width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 1rem}
.more-sheet-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.6rem}
.more-sheet-item{display:flex;flex-direction:column;align-items:center;gap:.35rem;padding:.65rem .2rem;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);cursor:pointer;-webkit-tap-highlight-color:transparent}
.more-sheet-item:active{background:rgba(255,255,255,.07)}
.more-sheet-item .msi-icon{font-size:1.15rem}.more-sheet-item .msi-label{font-size:.58rem;color:rgba(255,255,255,.5);text-align:center}
.more-sheet-item.act{background:rgba(201,168,76,.1);border-color:rgba(201,168,76,.25)}.more-sheet-item.act .msi-label{color:#c9a84c}

/* ── Mobile holding cards ── */
.m-holdings-list{display:none}
.m-hc{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:.9rem;margin-bottom:.55rem;-webkit-tap-highlight-color:transparent;cursor:pointer;transition:background .15s}
.m-hc:active{background:rgba(255,255,255,.05)}
.m-hc-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.55rem}
.m-hc-name{font-size:.86rem;color:#ffffff;font-weight:500;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m-hc-ticker{font-size:.66rem;color:rgba(255,255,255,.35);margin-top:.12rem;font-family:'DM Mono',monospace}
.m-hc-grid{display:grid;grid-template-columns:1fr 1fr;gap:.4rem .8rem}
.m-hc-cell{display:flex;flex-direction:column;gap:.08rem}
.m-hc-lbl{font-size:.55rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.3)}
.m-hc-val{font-size:.78rem;font-family:'DM Mono',monospace;color:rgba(255,255,255,.85)}
.m-hc-actions{display:flex;justify-content:flex-end;gap:.35rem;margin-top:.65rem;padding-top:.55rem;border-top:1px solid rgba(255,255,255,.05)}
.m-hc-actions button{min-width:42px;min-height:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);cursor:pointer;font-size:.82rem;-webkit-tap-highlight-color:transparent;transition:background .15s}
.m-hc-actions button:active{background:rgba(255,255,255,.08)}
.m-hc-totals{background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.15);border-radius:10px;padding:.85rem;margin-top:.55rem;display:grid;grid-template-columns:1fr 1fr;gap:.5rem}

/* ── Tablet — 900px ── */
@media(max-width:900px){
  .mg{grid-template-columns:repeat(2,1fr)}
  .sg{grid-template-columns:1fr}
}

/* ── Mobile — 600px ── */
@media(max-width:600px){
  /* Bottom nav visible, top tabs hidden */
  .bottom-nav{display:flex}
  .tabs{display:none}
  .m-holdings-list{display:block}
  .ht-desktop{display:none}

  .main{padding:.75rem .75rem;padding-bottom:calc(4.5rem + env(safe-area-inset-bottom))}
  .hdr{padding:0 .75rem;height:50px}
  .logo{font-size:1.1rem}
  .hdr-r{gap:.25rem}
  .hdr-r .btn-o{font-size:.62rem;padding:.25rem .5rem;min-height:34px}

  /* KPI grid */
  .mg{grid-template-columns:repeat(2,1fr);gap:.5rem;margin-bottom:1rem}
  .mc{padding:.85rem;border-radius:10px}
  .mclbl{font-size:.6rem}
  .mcval{font-size:1.35rem}
  .mcsub{font-size:.7rem}

  /* Cards */
  .card{padding:.85rem .75rem;border-radius:10px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .ctitle{font-size:.95rem;margin-bottom:.75rem}

  /* Member chips: horizontally scrollable */
  .mbar{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:.3rem;margin-bottom:.85rem;gap:.4rem}
  .mbar::-webkit-scrollbar{display:none}

  /* Filter chips: horizontally scrollable */
  .tbar{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:.3rem}
  .tbar::-webkit-scrollbar{display:none}

  /* Overview split grid */
  .sg{grid-template-columns:1fr;gap:.75rem}

  /* Modals: bottom sheet */
  .ovl{align-items:flex-end;padding:0}
  .mod{border-radius:20px 20px 0 0;padding:1.5rem 1rem;max-width:100%;max-height:88vh;padding-bottom:calc(1.5rem + env(safe-area-inset-bottom));animation:slideUp .3s ease}
  @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
  .modtitle{font-size:1.15rem;margin-bottom:.85rem}
  .frow{grid-template-columns:1fr}
  .ma{flex-direction:column-reverse;gap:.5rem}
  .btns,.btnc{width:100%;text-align:center;padding:.65rem;min-height:46px;font-size:.82rem}

  /* Touch-friendly targets */
  .delbtn{min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;font-size:.88rem}
  .btn-o,.btn-g,.btn-p{min-height:42px;padding:.5rem .85rem;font-size:.74rem}
  .btn-sm{min-height:42px;padding:.5rem .85rem}
  .fchip{min-height:38px;padding:.4rem .75rem;font-size:.72rem;display:inline-flex;align-items:center;scroll-snap-align:start}
  .mchip{min-height:38px;padding:.4rem .75rem;font-size:.72rem;display:inline-flex;align-items:center;scroll-snap-align:start}
  .fi{min-height:44px;font-size:.9rem;padding:.6rem .8rem}
  .fs{min-height:44px}
  .google-btn{min-height:48px;font-size:.92rem}

  /* Empty states, tabs, table fallback */
  .empty{padding:2rem .75rem;font-size:.9rem}
  .tab{padding:.5rem .75rem;font-size:.73rem}
  .ht th{font-size:.58rem;padding:0 .45rem .5rem}
  .ht td{padding:.65rem .45rem;font-size:.75rem}

  /* Scroll snap for chips */
  .tbar{scroll-snap-type:x proximity}
  .mbar{scroll-snap-type:x proximity}
}

/* ── Very small — 400px ── */
@media(max-width:400px){
  .mg{grid-template-columns:1fr;gap:.45rem}
  .mcval{font-size:1.4rem}
  .mclbl{font-size:.58rem}
  .m-hc-grid{gap:.3rem .6rem}
  .m-hc-name{font-size:.82rem}
  .more-sheet-grid{grid-template-columns:repeat(3,1fr)}
  .hdr-r .btn-o:not(:first-child){display:none}
  .login-card{padding:2rem 1.2rem;max-width:100%}
}

/* ── Landscape phone ── */
@media(max-height:500px) and (orientation:landscape){
  .bottom-nav{padding:.1rem 0}
  .bnav-item{padding:.2rem .5rem}
  .bnav-item .bnav-icon{font-size:1rem}
  .bnav-item .bnav-label{display:none}
  .main{padding-bottom:3.5rem}
  .mod{max-height:85vh}
}

/* Desktop: ensure mobile list hidden */
@media(min-width:601px){
  .m-holdings-list{display:none}
  .ht-desktop{display:block}
  .bottom-nav{display:none}
}
`;
