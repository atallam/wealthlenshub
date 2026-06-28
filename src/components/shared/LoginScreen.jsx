import { useState } from 'react';
import { signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword } from '../../supabase.js';

/* ══════════════════════════════════════════════
   LOGIN SCREEN
   Extracted from App.jsx lines 233–450
══════════════════════════════════════════════ */
export default function LoginScreen({ error: initError }) {
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

  const S = {
    page: {minHeight:"100vh",background:"#070d1a",color:"#e8e0d0",overflowX:"hidden"},
    nav: {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.4rem 4%",borderBottom:"1px solid rgba(201,168,76,.06)"},
    navLinks: {display:"flex",gap:"2rem",alignItems:"center",fontSize:".8rem",color:"rgba(232,224,208,.4)"},
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
          <div style={{display:"flex",gap:"2.5rem",flexWrap:"wrap"}}>
            {[["25+","US brokerages"],["14","bank parsers"],["4-layer","security"]].map(([n,l])=>(
              <div key={l}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"1.3rem",fontWeight:500,color:"#c9a84c"}}>{n}</div>
                <div style={{fontSize:".68rem",color:"rgba(232,224,208,.3)",marginTop:".15rem"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Login */}
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
            <span style={{marginLeft:"auto"}}>🔒 Encrypted &amp; Private</span>
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
