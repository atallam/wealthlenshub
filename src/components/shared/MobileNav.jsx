// MobileNav.jsx — the mobile FAB, bottom nav, and "···  more" sheet, extracted
// out of App.jsx (P3-5, step 3).
//
// tab/setTab are read via useAppShell() (P3-5, step 2), same as AppHeader.jsx.
// Everything else stays as props, same lift-and-shift convention as the other
// extracted pieces.

import { MoreHorizontal, Download, Eye, EyeOff, Settings, LogOut } from 'lucide-react';
import { useAppShell } from '../../contexts/AppShellContext.jsx';

export default function MobileNav({
  BOTTOM_NAV_TABS, MORE_SHEET_TABS,
  setModal,
  moreSheetOpen, setMoreSheetOpen,
  setShowImportHub, masked, toggleMask, setShowSettings,
  confirmSignOut, setConfirmSignOut, signOut,
}) {
  const { tab, setTab } = useAppShell();

  return (
    <>
      {/* ── FAB — Add Holding (mobile) ──────────────────────────── */}
      <button className="fab" onClick={() => setModal('add')} title="Add holding" aria-label="Add holding">+</button>

      {/* ── BOTTOM NAV (mobile) ─────────────────────────────────── */}
      <nav className="bnav">
        {BOTTOM_NAV_TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'bnav-btn active' : 'bnav-btn'} onClick={() => setTab(t.key)}>
            <span className="bnav-icon"><t.Icon size={20} strokeWidth={1.7}/></span>
            <span className="bnav-label">{t.label}</span>
          </button>
        ))}
        <button className={moreSheetOpen ? 'bnav-btn active' : 'bnav-btn'} onClick={() => { setMoreSheetOpen(p => !p); setConfirmSignOut(false); }}>
          <span className="bnav-icon"><MoreHorizontal size={20} strokeWidth={1.7}/></span>
          <span className="bnav-label">More</span>
        </button>
      </nav>

      {/* ── MORE SHEET (mobile) ─────────────────────────────────── */}
      {moreSheetOpen && (
        <>
          {/* Backdrop dismiss */}
          <div style={{position:'fixed',inset:0,zIndex:205,background:'rgba(0,0,0,.15)'}}
            onClick={() => { setMoreSheetOpen(false); setConfirmSignOut(false); }}/>
          <div className="more-sheet" style={{zIndex:210}}>
            <div className="more-sheet-handle"/>
            <div className="more-sheet-grid">
              {MORE_SHEET_TABS.map(t => (
                <button key={t.key} className={tab === t.key ? 'more-sheet-item act' : 'more-sheet-item'}
                  onClick={() => { setTab(t.key); setMoreSheetOpen(false); }}>
                  <span className="msi-icon"><t.Icon size={22} strokeWidth={1.6}/></span>
                  <span className="msi-label">{t.label}</span>
                </button>
              ))}
              <button className="more-sheet-item" onClick={() => { setShowImportHub(true); setMoreSheetOpen(false); }}>
                <span className="msi-icon"><Download size={22} strokeWidth={1.6}/></span>
                <span className="msi-label">Import</span>
              </button>
              <button className="more-sheet-item" onClick={() => { toggleMask(); setMoreSheetOpen(false); }}
                style={masked ? {color:'var(--accent-2)'} : {}}>
                <span className="msi-icon">{masked ? <EyeOff size={22} strokeWidth={1.6}/> : <Eye size={22} strokeWidth={1.6}/>}</span>
                <span className="msi-label">{masked ? "Show" : "Privacy"}</span>
              </button>
              <button className="more-sheet-item" onClick={() => { setShowSettings(true); setMoreSheetOpen(false); }}>
                <span className="msi-icon"><Settings size={22} strokeWidth={1.6}/></span>
                <span className="msi-label">Settings</span>
              </button>
              {/* Sign out — in-app confirmation instead of browser confirm() */}
              {confirmSignOut ? (
                <div className="more-sheet-item" style={{gridColumn:'1/-1',flexDirection:'row',gap:'.6rem',padding:'.65rem .8rem',cursor:'default'}}>
                  <span style={{flex:1,fontSize:'.75rem',color:'var(--text-dim)',fontWeight:600}}>Sign out?</span>
                  <button onClick={() => { signOut(); setMoreSheetOpen(false); setConfirmSignOut(false); }}
                    style={{padding:'.3rem .7rem',background:'var(--loss)',border:'none',color:'#fff',borderRadius:6,fontSize:'.73rem',fontWeight:700,cursor:'pointer'}}>
                    Yes
                  </button>
                  <button onClick={() => setConfirmSignOut(false)}
                    style={{padding:'.3rem .7rem',background:'var(--bg-muted)',border:'1.5px solid var(--border)',color:'var(--text-dim)',borderRadius:6,fontSize:'.73rem',fontWeight:700,cursor:'pointer'}}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="more-sheet-item" style={{color:'var(--loss)'}} onClick={() => setConfirmSignOut(true)}>
                  <span className="msi-icon"><LogOut size={22} strokeWidth={1.6}/></span>
                  <span className="msi-label">Sign Out</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
