// AppHeader.jsx — the top header bar, member filter bar, and desktop tab nav,
// extracted out of App.jsx (P3-5, step 3).
//
// tab/selMember are read via useAppShell() (P3-5, step 2) instead of being passed
// as props — this component is always rendered inside <AppShellProvider>, so this
// is the first real consumer of that context. Everything else stays as props,
// same lift-and-shift convention as the other extracted pieces.

import { RefreshCw, Download, Eye, EyeOff, Settings, LogOut } from 'lucide-react';
import { useAppShell } from '../../contexts/AppShellContext.jsx';

export default function AppHeader({
  TABS,
  demoMode, syncSt,
  trigAlerts, alerts, AT,
  refreshPrices, priceRefreshing, lastPriceRefresh, ago,
  setShowImportHub, api, masked, toggleMask, setShowSettings, signOut,
  allMembers,
  NotificationBell, ExportPanel, NotificationCentre,
}) {
  const { tab, setTab, selMember, setSelMember } = useAppShell();

  return (
    <>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="hdr">
        <div className="hdr-left">
          <div className="logo">Wealth<span>Lens</span></div>
          {demoMode && (
            <span style={{marginLeft:'.5rem',fontSize:'.65rem',background:'rgba(160,132,202,.12)',border:'1px solid rgba(160,132,202,.3)',color:'#A084CA',borderRadius:4,padding:'2px 8px',letterSpacing:'.06em',fontWeight:600}}>
              DEMO
            </span>
          )}
        </div>

        <div className="hdr-right">
          {/* Sync status */}
          {syncSt === 'saving' && <span className="sync-saving">saving…</span>}
          {syncSt === 'saved'  && <span className="sync-saved">saved</span>}
          {syncSt === 'error'  && <span className="sync-error">save error</span>}

          {/* Triggered alerts — in-app notification bell */}
          <NotificationBell
            trigAlerts={trigAlerts}
            alerts={alerts}
            AT={AT}
            onGoToStrategy={() => setTab('strategy')}
          />

          {/* Price refresh */}
          <button className="btn-o"
            onClick={refreshPrices} disabled={priceRefreshing}
            title={lastPriceRefresh ? `Last: ${ago(lastPriceRefresh)}` : 'Refresh prices'}>
            <RefreshCw size={13} strokeWidth={2} style={priceRefreshing ? {animation:'spin 1s linear infinite'} : {}}/>
          </button>

          {/* hdr-extra: hidden on mobile — accessible via ··· more sheet */}
          <button className="btn-o hdr-extra" onClick={() => setShowImportHub(true)} title="Import Holdings" aria-label="Import Holdings">
            <Download size={13} strokeWidth={2}/>
          </button>
          <ExportPanel className="btn-o hdr-extra" />
          <button className="btn-o hdr-extra" onClick={toggleMask}
            title={masked ? "Show values" : "Hide values (privacy)"}
            aria-label={masked ? "Show values" : "Hide values"}
            style={masked ? {color:'var(--accent-2)',background:'var(--accent-2-dim)'} : {}}>
            {masked ? <EyeOff size={13} strokeWidth={2}/> : <Eye size={13} strokeWidth={2}/>}
          </button>
          <NotificationCentre api={api} />
          <button className="btn-o hdr-extra" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings"><Settings size={13} strokeWidth={2}/></button>
          <button className="btn-o hdr-extra" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={13} strokeWidth={2}/></button>
        </div>
      </header>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── MEMBER FILTER BAR ──────────────────────────────────── */}
      {allMembers.length > 1 && (
        <div className="mbar">
          <button className={selMember === 'all' ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember('all')}>All</button>
          {allMembers.map(m => (
            <button key={m.id} className={selMember === m.id ? 'mbar-btn active' : 'mbar-btn'} onClick={() => setSelMember(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* ── TAB BAR ────────────────────────────────────────────── */}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            <span className="tab-icon"><t.Icon size={15} strokeWidth={1.8}/></span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
