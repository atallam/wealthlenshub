// Static form blanks and seed data extracted from App.jsx
// Import in App.jsx: import { AT, BF, BT, BG, BA, SEED } from './constants.js'

// ── Asset type metadata ───────────────────────────────────────────
export const AT = {
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
  INSURANCE:   { label:"Insurance",    color:"#e07b8c", icon:"🛡️", cat:"Protection" },
  OTHER:       { label:"Other",         color:"#999999", icon:"📁", cat:"Other" },
};

// Holding form — instrument details only, no transaction data
export const BF={member_id:"",type:"US_STOCK",name:"",ticker:"",scheme_code:"",interest_rate:"",start_date:"",maturity_date:"",purchase_value:"",current_value:"",principal:"",usd_inr_rate:"",currency:"INR",policy_type:"TERM",sum_assured:"",premium:"",premium_frequency:"ANNUAL"};
// Transaction form
// txn_type: BUY | SELL | DIVIDEND | BONUS | RIGHTS | SWP
export const BT={holding_id:"",txn_type:"BUY",units:"",price:"",price_usd:"",amount:"",txn_date:new Date().toISOString().slice(0,10),notes:""};
// Goal form blank
export const BG={name:"",targetAmount:"",targetDate:"",linkedMembers:["all"],linkedTypes:[],linkedHoldingIds:[],category:"Retirement",color:"#c9a84c",notes:"",priority:1,monthlyContribution:""};
// Alert form blank
export const BA={type:"ALLOCATION_DRIFT",assetType:"IN_STOCK",threshold:"",label:"",active:true};

// ── Demo seed data (used on first login) ─────────────────────────
const m1="mbr_demo1", m2="mbr_demo2";
export const SEED = {
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
    "h14": [{date:"2022-02-28",units:45,price:3888.89,type:"BUY"},{date:"2023-06-28",units:30,price:3733.33,type:"BUY"}],
    "h15": [{date:"2022-09-01",units:210,price:428.57,type:"BUY"}],
  }
};
