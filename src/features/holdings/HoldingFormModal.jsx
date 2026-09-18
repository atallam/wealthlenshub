// HoldingFormModal.jsx — the "Add / Edit Holding" modal (plus its FD Certificate
// Scanner sheet), extracted out of App.jsx (P3-5, step 3).
//
// This is a pure lift-and-shift, same convention as GoalFormModal.jsx: the JSX and
// logic are unchanged from the inline block that used to live in App.jsx's render
// (the `modal === 'add' || modal === 'quickadd'` branch, plus the sibling
// `fdScanOpen && <FDScanSheet>` block it triggers). State ownership (form,
// editHolding, all the broker-search state, modal) stays in App.jsx and is passed
// in as props — this extraction only moves markup out, it does not move state.
//
// Renders null when neither the holding modal nor the FD scanner is open, so it's
// safe to mount unconditionally.

import { BF } from '../../constants.js';

export default function HoldingFormModal({
  modal, setModal,
  form, setForm, editHolding, setEditHolding,
  members, AT,
  mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfNav, handleMfSearch,
  stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockInfo, handleStockSearch,
  etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfInfo, handleEtfSearch,
  usSearch, setUsSearch, usResults, setUsResults, usSearching, handleUsSearch,
  usdInrRate, usdInrLoading, fetchUsdInr,
  fdScanOpen, setFdScanOpen,
  saveHolding, api,
  Overlay, FG, MA, FmtInput, FDScanSheet,
}) {
  const holdingModalOpen = modal === 'add' || modal === 'quickadd';
  if (!holdingModalOpen && !fdScanOpen) return null;

  const closeModal = () => { setModal(null); setForm(BF); setEditHolding(null); };

  return (
    <>
      {holdingModalOpen && (
        <Overlay onClose={closeModal} wide>
          <div className="modtitle">{editHolding ? 'Edit Holding' : 'Add Holding'}</div>

          <FG label="Member">
            <select className="fi fs" value={form.member_id} onChange={e => setForm(p => ({ ...p, member_id: e.target.value }))}>
              <option value="">— Select member —</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.relation})</option>)}
            </select>
          </FG>

          <FG label="Asset Type">
            <select className="fi fs" value={form.type}
              onChange={e => { setForm(p => ({ ...p, type: e.target.value })); setMfNav(null); setStockInfo(null); setEtfInfo(null); }}>
              {Object.entries(AT).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </FG>

          {/* MF search */}
          {form.type === 'MF' && (
            <FG label="Search Mutual Fund">
              <input className="fi" placeholder="e.g. Mirae Asset, Axis Midcap…" value={mfSearch}
                onChange={e => handleMfSearch(e.target.value)}/>
              {mfSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {mfResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {mfResults.map(f => (
                    <div key={f.schemeCode} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, name: f.schemeName, scheme_code: String(f.schemeCode) })); setMfSearch(f.schemeName); setMfResults([]); }}>
                      {f.schemeName}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* IN_STOCK search */}
          {form.type === 'IN_STOCK' && (
            <FG label="Search Indian Stock">
              <input className="fi" placeholder="e.g. RELIANCE, TCS…" value={stockSearch}
                onChange={e => handleStockSearch(e.target.value)}/>
              {stockSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {stockResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {stockResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setStockSearch(r.name || r.symbol); setStockResults([]); }}>
                      <span style={{color:'var(--gold)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* IN_ETF search */}
          {form.type === 'IN_ETF' && (
            <FG label="Search Indian ETF">
              <input className="fi" placeholder="e.g. NIFTYBEES, GOLDBEES…" value={etfSearch}
                onChange={e => handleEtfSearch(e.target.value)}/>
              {etfSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {etfResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {etfResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setEtfSearch(r.name || r.symbol); setEtfResults([]); }}>
                      <span style={{color:'var(--gold)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* US stock / ETF / Crypto search */}
          {['US_STOCK','US_ETF','CRYPTO'].includes(form.type) && (
            <FG label={`Search ${AT[form.type]?.label}`}>
              <input className="fi" placeholder="e.g. NVDA, VOO, BTC-USD…" value={usSearch}
                onChange={e => handleUsSearch(e.target.value)}/>
              {usSearching && <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginTop:'.3rem'}}>Searching…</div>}
              {usResults.length > 0 && (
                <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6,marginTop:'.3rem',background:'var(--bg-card)',boxShadow:'var(--shadow-md)'}}>
                  {usResults.map(r => (
                    <div key={r.symbol} style={{padding:'.5rem .75rem',cursor:'pointer',fontSize:'.78rem',borderBottom:'1px solid var(--border)',color:'var(--text)'}}
                      onClick={() => { setForm(p => ({ ...p, ticker: r.symbol, name: r.name || r.symbol })); setUsSearch(r.name || r.symbol); setUsResults([]); }}>
                      <span style={{color:'var(--primary)',fontFamily:'var(--font-mono)'}}>{r.symbol}</span> — {r.name}
                    </div>
                  ))}
                </div>
              )}
            </FG>
          )}

          {/* Name / Ticker */}
          <div className="frow">
            <FG label="Name">
              <input className="fi" placeholder="Holding name" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}/>
            </FG>
            {['IN_STOCK','IN_ETF','US_STOCK','US_ETF','US_BOND','CRYPTO'].includes(form.type) && (
              <FG label="Ticker">
                <input className="fi" placeholder="e.g. RELIANCE, NVDA" value={form.ticker}
                  onChange={e => setForm(p => ({ ...p, ticker: e.target.value.toUpperCase() }))}/>
              </FG>
            )}
          </div>

          {/* FD Scan button */}
          {form.type === 'FD' && (
            <div style={{marginBottom:'.75rem'}}>
              <button
                type="button"
                onClick={() => setFdScanOpen(true)}
                style={{display:'flex',alignItems:'center',gap:'.5rem',padding:'.55rem 1rem',
                  background:'rgba(13,148,136,.08)',color:'var(--primary)',
                  border:'1px solid rgba(13,148,136,.25)',borderRadius:8,
                  fontSize:'.82rem',fontWeight:600,cursor:'pointer',width:'100%',justifyContent:'center'}}>
                📷 Scan Certificate — auto-fill with Claude Vision
              </button>
            </div>
          )}

          {/* FD / PPF / EPF fields */}
          {['FD','PPF','EPF'].includes(form.type) && (<>
            {/* FD: currency selector — shown first so it can drive label below */}
            {form.type === 'FD' && (
              <div className="frow" style={{marginBottom:'.5rem'}}>
                <FG label="Currency">
                  <select className="fi fs" value={form.currency||'INR'}
                    onChange={e => setForm(p => ({ ...p, currency: e.target.value, usd_inr_rate: '' }))}>
                    <option value="INR">₹ INR — Indian Rupee</option>
                    <option value="USD">$ USD — US Dollar (FCNR)</option>
                    <option value="SGD">S$ SGD — Singapore Dollar</option>
                    <option value="GBP">£ GBP — British Pound</option>
                    <option value="EUR">€ EUR — Euro</option>
                  </select>
                </FG>
                {(form.currency && form.currency !== 'INR') && (
                  <FG label={`1 ${form.currency} = ₹ (exchange rate)`}>
                    <input type="number" className="fi"
                      placeholder={form.currency==='USD'?'e.g. 84.5':form.currency==='SGD'?'e.g. 63.2':form.currency==='GBP'?'e.g. 107.0':'e.g. 90.0'}
                      value={form.usd_inr_rate||''}
                      onChange={e => setForm(p => ({ ...p, usd_inr_rate: e.target.value }))}/>
                  </FG>
                )}
              </div>
            )}
            <div className="frow">
              <FG label={form.type==='FD'&&form.currency&&form.currency!=='INR'?`Principal ${form.currency}`:"Principal ₹"}>
                <FmtInput value={form.principal} placeholder="e.g. 500000"
                  onChange={e => setForm(p => ({ ...p, principal: e.target.value }))}/>
              </FG>
              {form.type === 'FD' && (
                <FG label="Interest Rate % p.a.">
                  <input type="number" className="fi" placeholder="e.g. 7.25" value={form.interest_rate}
                    onChange={e => setForm(p => ({ ...p, interest_rate: e.target.value }))}/>
                </FG>
              )}
            </div>
            <div className="frow">
              <FG label="Start Date">
                <input type="date" className="fi" value={form.start_date}
                  onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}/>
              </FG>
              {form.type === 'FD' && (
                <FG label="Maturity Date">
                  <input type="date" className="fi" value={form.maturity_date}
                    onChange={e => setForm(p => ({ ...p, maturity_date: e.target.value }))}/>
                </FG>
              )}
            </div>
            {form.type === 'FD' && (
              <div className="frow">
                <FG label={`Maturity Amount ${form.currency&&form.currency!=='INR'?form.currency:'₹'} (optional — from the FD receipt)`}>
                  <FmtInput value={form.maturity_amount} placeholder="e.g. 537255"
                    onChange={e => setForm(p => ({ ...p, maturity_amount: e.target.value }))}/>
                </FG>
              </div>
            )}
          </>)}

          {/* Real estate */}
          {form.type === 'REAL_ESTATE' && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="e.g. 5000000"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="e.g. 7000000"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* Insurance */}
          {form.type === 'INSURANCE' && (<>
            <div className="frow">
              <FG label="Policy Type">
                <select className="fi fs" value={form.policy_type||'TERM'} onChange={e=>setForm(p=>({...p,policy_type:e.target.value}))}>
                  <option value="TERM">🛡️ Term — Pure protection</option>
                  <option value="ENDOWMENT">💰 Endowment — Protection + savings</option>
                  <option value="ULIP">📈 ULIP — Unit-linked</option>
                  <option value="WHOLE_LIFE">🔄 Whole Life — Lifelong cover</option>
                  <option value="HEALTH">🏥 Health / Mediclaim</option>
                  <option value="VEHICLE">🚗 Vehicle / Motor</option>
                </select>
              </FG>
              <FG label="Sum Assured ₹ (coverage)">
                <FmtInput value={form.sum_assured||''} placeholder="e.g. 10000000"
                  onChange={e=>setForm(p=>({...p,sum_assured:e.target.value}))}/>
              </FG>
            </div>
            <div className="frow">
              <FG label="Premium ₹ per period">
                <FmtInput value={form.premium||''} placeholder="e.g. 25000"
                  onChange={e=>setForm(p=>({...p,premium:e.target.value}))}/>
              </FG>
              <FG label="Frequency">
                <select className="fi fs" value={form.premium_frequency||'ANNUAL'} onChange={e=>setForm(p=>({...p,premium_frequency:e.target.value}))}>
                  <option value="ANNUAL">Annual</option>
                  <option value="SEMI">Semi-Annual (every 6 months)</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </FG>
            </div>
            <div className="frow">
              <FG label="Policy Start Date">
                <input type="date" className="fi" value={form.start_date}
                  onChange={e=>setForm(p=>({...p,start_date:e.target.value}))}/>
              </FG>
              <FG label="Maturity / Expiry Date">
                <input type="date" className="fi" value={form.maturity_date}
                  onChange={e=>setForm(p=>({...p,maturity_date:e.target.value}))}/>
              </FG>
            </div>
            {/* Savings-type policies: show current / invested value */}
            {['ENDOWMENT','ULIP','WHOLE_LIFE'].includes(form.policy_type||'TERM')&&(
              <div className="frow">
                <FG label="Total Premiums Paid ₹">
                  <FmtInput value={form.principal||''} placeholder="e.g. 150000"
                    onChange={e=>setForm(p=>({...p,principal:e.target.value}))}/>
                </FG>
                <FG label="Current Surrender / Fund Value ₹">
                  <FmtInput value={form.current_value||''} placeholder="e.g. 180000"
                    onChange={e=>setForm(p=>({...p,current_value:e.target.value}))}/>
                </FG>
              </div>
            )}
          </>)}

          {/* Indian instruments */}
          {['MF','IN_STOCK','IN_ETF'].includes(form.type) && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="total invested"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="current value"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* US instruments */}
          {['US_STOCK','US_ETF','US_BOND','CRYPTO','CASH'].includes(form.type) && (
            <div className="frow">
              <FG label="Purchase Value ₹">
                <FmtInput value={form.purchase_value} placeholder="purchase ₹"
                  onChange={e => setForm(p => ({ ...p, purchase_value: e.target.value }))}/>
              </FG>
              <FG label="Current Value ₹">
                <FmtInput value={form.current_value} placeholder="current ₹"
                  onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
              </FG>
              <FG label={<>USD/INR Rate <button type="button" onClick={fetchUsdInr} style={{fontSize:'.65rem',color:'#5a9ce0',background:'none',border:'none',cursor:'pointer'}}>{usdInrLoading ? '…' : '⟳'}</button></>}>
                <input type="number" className="fi" placeholder={String(usdInrRate)} value={form.usd_inr_rate}
                  onChange={e => setForm(p => ({ ...p, usd_inr_rate: e.target.value }))}/>
              </FG>
            </div>
          )}

          {/* Other / Cash simple value */}
          {['OTHER'].includes(form.type) && (
            <FG label="Current Value ₹">
              <FmtInput value={form.current_value} placeholder="e.g. 250000"
                onChange={e => setForm(p => ({ ...p, current_value: e.target.value }))}/>
            </FG>
          )}

          <MA>
            <button className="btnc" onClick={closeModal}>Cancel</button>
            <button className="btns" onClick={() => saveHolding(form, editHolding, closeModal)}>
              {editHolding ? 'Update Holding' : 'Save Holding'}
            </button>
          </MA>
        </Overlay>
      )}

      {/* ── FD Certificate Scanner ──────────────────────────────── */}
      {fdScanOpen && (
        <FDScanSheet
          api={api}
          onClose={() => setFdScanOpen(false)}
          onConfirm={fd => {
            setForm(p => ({
              ...p,
              name:          fd.bank_name ? `${fd.bank_name} FD` : p.name,
              principal:     fd.principal  != null ? String(fd.principal)    : p.principal,
              interest_rate: fd.interest_rate != null ? String(fd.interest_rate) : p.interest_rate,
              start_date:    fd.start_date    || p.start_date,
              maturity_date: fd.maturity_date || p.maturity_date,
              maturity_amount: fd.maturity_amount != null ? String(fd.maturity_amount) : p.maturity_amount,
            }));
            setFdScanOpen(false);
          }}
        />
      )}
    </>
  );
}
