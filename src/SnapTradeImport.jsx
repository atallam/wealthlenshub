import { useState, useCallback } from "react";

const US_BROKERS = [
  { slug: "ROBINHOOD",    name: "Robinhood",            icon: "🪶", color: "#00C805" },
  { slug: "SCHWAB",       name: "Charles Schwab",       icon: "🏛️", color: "#00A0DF" },
  { slug: "FIDELITY",     name: "Fidelity",             icon: "📊", color: "#4C8C2B" },
  { slug: "ETRADE",       name: "E*TRADE",              icon: "📈", color: "#6633CC" },
  { slug: "TDAMERITRADE", name: "TD Ameritrade",        icon: "🟢", color: "#2D8C3C" },
  { slug: "IBKR",         name: "Interactive Brokers",   icon: "🌐", color: "#D31145" },
  { slug: "WEBULL",       name: "Webull",               icon: "🐂", color: "#F95B5B" },
  { slug: "PUBLIC",       name: "Public",               icon: "👥", color: "#9B59B6" },
  { slug: "ALPACA",       name: "Alpaca",               icon: "🦙", color: "#F5D547" },
  { slug: "COINBASE",     name: "Coinbase",             icon: "₿",  color: "#0052FF" },
];

const STEP = { BROKER: 0, CONNECT: 1, ACCOUNTS: 2, PREVIEW: 3, DONE: 4 };

/* ─── Mock API — swap with real fetch calls when ready ─── */
const mockApi = {
  register: async () => ({ snaptrade_user_id: "wlh-demo", already_registered: false }),
  connect: async (_u, _s, broker) => ({ redirect_uri: `https://app.snaptrade.com/connect?broker=${broker}&demo=true` }),
  accounts: async () => ({ accounts: [
    { account_id: "acc-001", brokerage: "Robinhood", account_name: "Individual Brokerage", account_number: "****4821" },
    { account_id: "acc-002", brokerage: "Robinhood", account_name: "Roth IRA", account_number: "****7733" },
  ]}),
  holdings: async () => ({ assets: [
    { ticker: "AAPL",  asset_name: "Apple Inc.",              asset_type: "US_STOCK", units: 50,  current_price: 198.12, market_value: 9906,    currency: "USD", unrealized_pnl: 1240.50 },
    { ticker: "VTI",   asset_name: "Vanguard Total Stock Mkt", asset_type: "US_ETF",  units: 120, current_price: 267.40, market_value: 32088,   currency: "USD", unrealized_pnl: 4320 },
    { ticker: "MSFT",  asset_name: "Microsoft Corp.",         asset_type: "US_STOCK", units: 30,  current_price: 445.30, market_value: 13359,   currency: "USD", unrealized_pnl: 2100 },
    { ticker: "GOOGL", asset_name: "Alphabet Inc.",           asset_type: "US_STOCK", units: 25,  current_price: 178.50, market_value: 4462.50, currency: "USD", unrealized_pnl: -320 },
    { ticker: "BND",   asset_name: "Vanguard Total Bond Mkt", asset_type: "US_ETF",  units: 80,  current_price: 72.10,  market_value: 5768,    currency: "USD", unrealized_pnl: 110 },
    { ticker: "CASH-USD", asset_name: "Cash (USD)",           asset_type: "CASH",    units: 1,   current_price: 4250,   market_value: 4250,    currency: "USD", unrealized_pnl: 0 },
  ], total_market_value: 69833.50, asset_count: 6 }),
  importHoldings: async () => ({ status: "imported", assets_imported: 6 }),
};

/*  ─── REAL API (uncomment + pass your session token) ───
function realApi(token) { return {
  register:       () => fetch("/api/snaptrade/register", { method:"POST", headers:{ Authorization:`Bearer ${token}` }}).then(r=>r.json()),
  connect:        (_,__,broker) => fetch("/api/snaptrade/connect", { method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`}, body:JSON.stringify({broker})}).then(r=>r.json()),
  accounts:       () => fetch("/api/snaptrade/accounts", { headers:{ Authorization:`Bearer ${token}` }}).then(r=>r.json()),
  holdings:       (id) => fetch(`/api/snaptrade/holdings/${id}`, { headers:{ Authorization:`Bearer ${token}` }}).then(r=>r.json()),
  importHoldings: (id) => fetch(`/api/snaptrade/import/${id}`, { method:"POST", headers:{ Authorization:`Bearer ${token}` }}).then(r=>r.json()),
};}
*/

const api = mockApi;  // ← switch to realApi(token) when ready

const usd = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const pnlColor = n => n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#94a3b8";
const pnlSign = n => (n > 0 ? "+" : "") + usd(n);

const typeTag = {
  US_STOCK:{bg:"#3b82f620",fg:"#60a5fa",label:"US Stock"}, IN_STOCK:{bg:"#f59e0b20",fg:"#fbbf24",label:"IN Stock"},
  US_ETF:{bg:"#a855f720",fg:"#c084fc",label:"US ETF"}, IN_ETF:{bg:"#a855f720",fg:"#c084fc",label:"IN ETF"},
  CRYPTO:{bg:"#f9731620",fg:"#fb923c",label:"Crypto"}, CASH:{bg:"#22c55e20",fg:"#4ade80",label:"Cash"},
  BOND:{bg:"#06b6d420",fg:"#22d3ee",label:"Bond"}, OTHER:{bg:"#64748b20",fg:"#94a3b8",label:"Other"},
};

export default function SnapTradeImport({ onClose }) {
  const [step, setStep] = useState(STEP.BROKER);
  const [broker, setBroker] = useState(null);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [holdings, setHoldings] = useState(null);
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const filtered = US_BROKERS.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
  const toggle = id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doConnect = useCallback(async () => {
    setLoading(true); setError("");
    try { await api.register(); await api.connect(null,null,broker.slug); await new Promise(r=>setTimeout(r,2000));
      const { accounts: a } = await api.accounts(); setAccounts(a); setStep(STEP.ACCOUNTS);
    } catch(e){ setError(e.message); } finally { setLoading(false); }
  }, [broker]);

  const doFetch = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await api.holdings([...selected][0]); setHoldings(d); setStep(STEP.PREVIEW);
    } catch(e){ setError(e.message); } finally { setLoading(false); }
  }, [selected]);

  const doImport = useCallback(async () => {
    setLoading(true); setError("");
    try { await new Promise(r=>setTimeout(r,1200)); const r = await api.importHoldings([...selected][0]); setResult(r); setStep(STEP.DONE);
    } catch(e){ setError(e.message); } finally { setLoading(false); }
  }, [selected]);

  const reset = () => { setStep(STEP.BROKER); setBroker(null); setAccounts([]); setSelected(new Set()); setHoldings(null); setResult(null); setError(""); };

  const S = {
    root:{background:"#0b1120",color:"#e2e8f0",fontFamily:"'DM Sans',system-ui,sans-serif",padding:"28px 24px",borderRadius:16,border:"1px solid #1e293b",maxWidth:920,margin:"0 auto"},
    title:{fontSize:22,fontWeight:800,letterSpacing:"-.03em",margin:0,background:"linear-gradient(135deg,#e2e8f0,#a78bfa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"},
    badge:{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",padding:"3px 8px",borderRadius:6,background:"#7c3aed20",color:"#a78bfa",border:"1px solid #7c3aed40",marginLeft:10},
    close:{background:"none",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13},
    dot:(a,c)=>({width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#e2e8f0",background:a?"#a78bfa":"#1e293b",boxShadow:c?"0 0 10px #a78bfa60":"none"}),
    grid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10},
    brokerCard:(c)=>({display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"18px 10px",background:"#0f172a",border:"1.5px solid #1e293b",borderRadius:12,cursor:"pointer",transition:"all .2s"}),
    card:{display:"flex",flexDirection:"column",alignItems:"center",padding:36,background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,textAlign:"center"},
    acct:s=>({display:"flex",alignItems:"center",gap:12,padding:"14px 16px",border:`1.5px solid ${s?"#a78bfa":"#1e293b"}`,borderRadius:12,cursor:"pointer",background:s?"#a78bfa08":"#0f172a"}),
    th:{padding:"10px 14px",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",color:"#64748b",background:"#1e293b30",borderBottom:"1px solid #1e293b"},
    td:{padding:"12px 14px",fontSize:13,borderBottom:"1px solid #1e293b10"},
    stat:{display:"flex",flexDirection:"column",padding:"10px 16px",background:"#1e293b20",border:"1px solid #1e293b",borderRadius:10},
    btnP:{padding:"11px 22px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#7c3aed,#a78bfa)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",boxShadow:"0 2px 12px #7c3aed40"},
    btnS:{padding:"11px 22px",borderRadius:10,border:"1px solid #334155",background:"transparent",color:"#94a3b8",fontSize:14,cursor:"pointer"},
    row:{display:"flex",justifyContent:"flex-end",gap:10,marginTop:8},
    err:{background:"#7f1d1d30",border:"1px solid #991b1b",color:"#fca5a5",padding:"10px 14px",borderRadius:10,fontSize:13,marginBottom:14},
    doneIcon:{width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,#22c55e,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#fff",fontWeight:800,marginBottom:16},
  };
  const steps=["Broker","Connect","Accounts","Preview","Done"];

  return (<div style={S.root}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center"}}><h2 style={S.title}>Import US Portfolio</h2><span style={S.badge}>SnapTrade</span></div>
      {onClose&&<button style={S.close} onClick={onClose}>✕ Close</button>}
    </div>

    <div style={{display:"flex",justifyContent:"space-between",marginBottom:24,paddingBottom:16,borderBottom:"1px solid #1e293b"}}>
      {steps.map((l,i)=>(<div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={S.dot(i<=step,i===step)}>{i<step?"✓":i+1}</div>
        <span style={{fontSize:11,fontWeight:500,color:i<=step?"#e2e8f0":"#475569",marginTop:4}}>{l}</span>
      </div>))}
    </div>

    {error&&<div style={S.err}>{error}</div>}

    {step===STEP.BROKER&&(<>
      <div style={{display:"flex",alignItems:"center",padding:"9px 12px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,marginBottom:14}}>
        <span style={{marginRight:8,color:"#64748b"}}>🔍</span>
        <input placeholder="Search brokerages..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#e2e8f0",fontSize:14,fontFamily:"inherit"}}/>
      </div>
      <div style={S.grid}>{filtered.map(b=>(<div key={b.slug} style={S.brokerCard(b.color)}
        onClick={()=>{setBroker(b);setStep(STEP.CONNECT);}}
        onMouseEnter={e=>e.currentTarget.style.borderColor=b.color} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e293b"}>
        <span style={{fontSize:26}}>{b.icon}</span><span style={{fontSize:13,fontWeight:600}}>{b.name}</span>
        <div style={{width:6,height:6,borderRadius:"50%",background:b.color,opacity:.7}}/>
      </div>))}</div>
      {!filtered.length&&<p style={{textAlign:"center",color:"#475569",padding:32}}>No matching brokerages.</p>}
    </>)}

    {step===STEP.CONNECT&&broker&&(<div style={S.card}>
      <div style={{width:72,height:72,borderRadius:18,border:`2px solid ${broker.color}`,display:"flex",alignItems:"center",justifyContent:"center",background:"#0a0e1a",marginBottom:18}}>
        <span style={{fontSize:36}}>{broker.icon}</span></div>
      <h3 style={{fontSize:20,fontWeight:700,margin:"0 0 6px"}}>Connect to {broker.name}</h3>
      <p style={{fontSize:14,color:"#94a3b8",maxWidth:400,lineHeight:1.6,marginBottom:18}}>You'll be redirected to SnapTrade's secure portal. WealthLens Hub never sees your brokerage credentials.</p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginBottom:20}}>
        {["🔒 Bank-level encryption","🛡️ Read-only access","🔑 OAuth 2.0"].map(t=>(<span key={t} style={{fontSize:12,padding:"5px 11px",borderRadius:8,background:"#1e293b",color:"#94a3b8"}}>{t}</span>))}
      </div>
      <div style={S.row}><button style={S.btnS} onClick={()=>setStep(STEP.BROKER)}>← Back</button>
        <button style={{...S.btnP,opacity:loading?.7:1}} onClick={doConnect} disabled={loading}>{loading?"Connecting...":"Connect Account →"}</button></div>
    </div>)}

    {step===STEP.ACCOUNTS&&(<>
      <h3 style={{fontSize:17,fontWeight:700,marginBottom:12}}>Select Accounts to Import</h3>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {accounts.map(a=>(<div key={a.account_id} style={S.acct(selected.has(a.account_id))} onClick={()=>toggle(a.account_id)}>
          <div style={{width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {selected.has(a.account_id)?<span style={{color:"#a78bfa",fontWeight:800}}>✓</span>:<div style={{width:16,height:16,borderRadius:4,border:"2px solid #334155"}}/>}</div>
          <div><div style={{fontSize:14,fontWeight:600}}>{a.account_name}</div><div style={{fontSize:12,color:"#64748b"}}>{a.brokerage} · {a.account_number}</div></div>
        </div>))}
      </div>
      <div style={S.row}><button style={S.btnS} onClick={()=>setStep(STEP.CONNECT)}>← Back</button>
        <button style={{...S.btnP,opacity:!selected.size||loading?.4:1}} onClick={doFetch} disabled={!selected.size||loading}>{loading?"Fetching...":`Fetch Holdings (${selected.size}) →`}</button></div>
    </>)}

    {step===STEP.PREVIEW&&holdings&&(<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:14}}>
        <h3 style={{fontSize:17,fontWeight:700,margin:0}}>Holdings Preview</h3>
        <div style={{display:"flex",gap:10}}>
          <div style={S.stat}><span style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:".04em"}}>Total Value</span><span style={{fontSize:18,fontWeight:800}}>{usd(holdings.total_market_value)}</span></div>
          <div style={S.stat}><span style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:".04em"}}>Positions</span><span style={{fontSize:18,fontWeight:800}}>{holdings.asset_count}</span></div>
        </div>
      </div>
      <div style={{overflowX:"auto",marginBottom:16}}>
        <table style={{width:"100%",borderCollapse:"collapse",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
          <thead><tr>{["Asset","Type","Units","Price","Value","P&L"].map((h,i)=>(<th key={h} style={{...S.th,textAlign:i>1?"right":"left"}}>{h}</th>))}</tr></thead>
          <tbody>{holdings.assets.map((a,i)=>{const t=typeTag[a.asset_type]||typeTag.OTHER;return(<tr key={i}>
            <td style={S.td}><span style={{fontWeight:700,marginRight:6}}>{a.ticker}</span><span style={{fontSize:12,color:"#64748b"}}>{a.asset_name}</span></td>
            <td style={S.td}><span style={{fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:4,background:t.bg,color:t.fg,textTransform:"uppercase"}}>{t.label}</span></td>
            <td style={{...S.td,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{a.units}</td>
            <td style={{...S.td,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{usd(a.current_price)}</td>
            <td style={{...S.td,textAlign:"right",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{usd(a.market_value)}</td>
            <td style={{...S.td,textAlign:"right",color:pnlColor(a.unrealized_pnl),fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{pnlSign(a.unrealized_pnl)}</td>
          </tr>);})}</tbody>
        </table>
      </div>
      <div style={S.row}><button style={S.btnS} onClick={()=>setStep(STEP.ACCOUNTS)}>← Back</button>
        <button style={{...S.btnP,opacity:loading?.7:1}} onClick={doImport} disabled={loading}>{loading?"Importing...":`Import ${holdings.asset_count} Assets →`}</button></div>
    </>)}

    {step===STEP.DONE&&(<div style={S.card}>
      <div style={S.doneIcon}>✓</div>
      <h3 style={{fontSize:22,fontWeight:800,margin:"0 0 6px"}}>Portfolio Imported!</h3>
      <p style={{fontSize:14,color:"#94a3b8",maxWidth:400,lineHeight:1.6,marginBottom:20}}>{result?.assets_imported} assets from {broker?.name} added to your portfolio. Holdings will auto-sync daily.</p>
      <div style={{display:"flex",gap:10}}><button style={S.btnS} onClick={reset}>Import Another</button><button style={S.btnP} onClick={onClose||(() => {})}>View Portfolio →</button></div>
    </div>)}

    <div style={{marginTop:28,paddingTop:14,borderTop:"1px solid #1e293b",fontSize:12,color:"#475569",textAlign:"center"}}>
      Powered by <span style={{color:"#a78bfa",fontWeight:600}}>SnapTrade API</span><span style={{margin:"0 8px",color:"#334155"}}>·</span>Data encrypted in transit & at rest
    </div>
  </div>);
}
