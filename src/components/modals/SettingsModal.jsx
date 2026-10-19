// SettingsModal.jsx — the Settings panel, extracted out of App.jsx (P3-5, step 3).
//
// Pure lift-and-shift, same convention as the other extracted modals: state
// ownership (theme, showSettings, confirmSignOut, ...) all stays
// in App.jsx and is passed in as props.

import { Download, Activity, Sun, Moon, LogOut } from 'lucide-react';

export default function SettingsModal({
  showSettings, setShowSettings,
  user, signOut,
  setShowImportHub, setShowAuditLog,
  theme, setTheme,
  portfolio, api, setPpfRate, setEpfRate,
  pushSupported, pushSubscribed, pushLoading, togglePush,
  confirmSignOut, setConfirmSignOut,
  toast,
  Overlay,
}) {
  if (!showSettings) return null;

  return (
    <Overlay onClose={() => setShowSettings(false)}>
      <div className="modtitle">⚙ Settings</div>
      <div style={{marginBottom:'1rem'}}>
        <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.35rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Signed in as</div>
        <div style={{fontSize:'.85rem',color:'var(--text)',fontWeight:500}}>{user.email}</div>
      </div>
      <div style={{marginBottom:'1rem',display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
        <button className="btn-o" onClick={() => { setShowImportHub(true); setShowSettings(false); }}>
          <Download size={13} strokeWidth={2}/> Import Holdings
        </button>
        <button className="btn-o" onClick={() => { setShowAuditLog(true); setShowSettings(false); }}>
          <Activity size={13} strokeWidth={2}/> Activity Log
        </button>
      </div>

      {/* ── Appearance ── */}
      <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem',marginBottom:'1rem'}}>
        <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.65rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Appearance</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'.82rem',color:'var(--text)'}}>Theme</span>
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            style={{display:'flex',alignItems:'center',gap:'.35rem',padding:'.3rem .75rem',borderRadius:99,
              border:'1px solid var(--border)',background:'var(--bg-muted)',cursor:'pointer',
              fontSize:'.78rem',color:'var(--text)',fontWeight:600,transition:'all .15s'}}>
            {theme === 'dark'
              ? <><Sun size={13} strokeWidth={2}/> Light Mode</>
              : <><Moon size={13} strokeWidth={2}/> Dark Mode</>}
          </button>
        </div>
      </div>

      {/* ── PPF / EPF rate config ── */}
      <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem',marginBottom:'1rem'}}>
        <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.65rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Government Scheme Rates</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(200px,100%),1fr))',gap:'.6rem',marginBottom:'.6rem'}}>
          {[
            { key:'ppf_rate', label:'PPF Rate (%)', default: 7.1 },
            { key:'epf_rate', label:'EPF Rate (%)', default: 8.15 },
          ].map(({key, label, default: def}) => (
            <div key={key}>
              <div style={{fontSize:'.68rem',color:'var(--text-muted)',marginBottom:'.25rem'}}>{label}</div>
              <input
                type="number" step="0.05" min="1" max="25"
                className="fi"
                defaultValue={(portfolio.profile?.settings?.[key]) ?? def}
                style={{width:'100%',fontSize:'.82rem'}}
                onBlur={async e => {
                  const val = parseFloat(e.target.value);
                  if (!val || val <= 0 || val > 25) return;
                  const newSettings = { ...(portfolio.profile?.settings || {}), [key]: val };
                  try {
                    await api('/api/profile', { method: 'PUT', body: JSON.stringify({ settings: newSettings }) });
                    if (key === 'ppf_rate') setPpfRate(val);
                    if (key === 'epf_rate') setEpfRate(val);
                  } catch { /* settings save is best-effort; UI already updated */ }
                }}
              />
            </div>
          ))}
        </div>
        <div style={{fontSize:'.65rem',color:'var(--text-muted)'}}>RBI/EPFO rates change annually. Update here to reflect current returns on your PPF and EPF holdings.</div>
      </div>

      {/* ── Staleness thresholds ── */}
      <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem',marginBottom:'1rem'}}>
        <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.65rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Balance Refresh Reminders</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(175px,100%),1fr))',gap:'.5rem',marginBottom:'.6rem'}}>
          {[
            { key:'stale_ppf_days',         label:'PPF (days)',         default:90  },
            { key:'stale_epf_days',         label:'EPF (days)',         default:90  },
            { key:'stale_fd_days',          label:'Fixed Deposits',     default:90  },
            { key:'stale_real_estate_days', label:'Real Estate',        default:180 },
            { key:'stale_cash_days',        label:'Cash',              default:14  },
            { key:'stale_insurance_days',   label:'Insurance',         default:365 },
            { key:'stale_other_days',       label:'Other',             default:60  },
            { key:'stale_min_display_days', label:'Show badge after (days)', default:14 },
          ].map(({key, label, default: def}) => (
            <div key={key}>
              <div style={{fontSize:'.68rem',color:'var(--text-muted)',marginBottom:'.25rem'}}>{label}</div>
              <input
                type="number" step="1" min="1" max="730"
                className="fi"
                defaultValue={(portfolio.profile?.settings?.[key]) ?? def}
                style={{width:'100%',fontSize:'.82rem'}}
                onBlur={async e => {
                  const val = parseInt(e.target.value, 10);
                  if (!val || val < 1 || val > 730) return;
                  const newSettings = { ...(portfolio.profile?.settings || {}), [key]: val };
                  try {
                    await api('/api/profile', { method: 'PUT', body: JSON.stringify({ settings: newSettings }) });
                    portfolio.setProfile?.(p => ({ ...p, settings: newSettings }));
                  } catch { /* settings save is best-effort; UI already updated */ }
                }}
              />
            </div>
          ))}
        </div>
        <div style={{fontSize:'.65rem',color:'var(--text-muted)'}}>Number of days before a manually-tracked holding is flagged as stale. "Show badge after" controls how early the reminder starts appearing.</div>
      </div>

      <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem',display:'flex',alignItems:'center',gap:'.6rem',flexWrap:'wrap'}}>
        {/* ── Push Notifications ── */}
      {pushSupported && (
        <div style={{borderTop:'1px solid var(--border)',paddingTop:'1rem',marginTop:'.5rem',marginBottom:'1rem'}}>
          <div style={{fontSize:'.72rem',color:'var(--text-muted)',marginBottom:'.65rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Push Notifications</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'1rem'}}>
            <div style={{fontSize:'.8rem',color:'var(--text)'}}>
              {pushSubscribed ? 'Notifications are enabled on this device.' : 'Get price alerts and reminders on this device.'}
            </div>
            <button className="btn-o" onClick={togglePush} disabled={pushLoading}
              style={{flexShrink:0,minWidth:80,color:pushSubscribed?'var(--loss)':'#4caf9a',borderColor:pushSubscribed?'rgba(220,38,38,.25)':'rgba(76,175,154,.3)'}}>
              {pushLoading ? '…' : pushSubscribed ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      )}

      {confirmSignOut ? (
          <>
            <span style={{fontSize:'.8rem',color:'var(--text-dim)',fontWeight:600}}>Sign out?</span>
            <button className="btn-o" style={{color:'#fff',background:'var(--loss)',borderColor:'var(--loss)'}} onClick={() => { signOut(); setConfirmSignOut(false); }}>
              Yes, sign out
            </button>
            <button className="btnc" onClick={() => setConfirmSignOut(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn-o" style={{color:'var(--loss)',borderColor:'rgba(220,38,38,.25)'}}
            onClick={() => setConfirmSignOut(true)}>
            <LogOut size={13} strokeWidth={2}/> Sign Out
          </button>
        )}
      </div>
    </Overlay>
  );
}
