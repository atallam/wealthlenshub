/**
 * NotificationBell.jsx — In-app alert notification dropdown.
 *
 * Replaces the plain AlertTriangle badge in the header.
 * Shows triggered alert details inline so users don't need
 * to navigate to the Strategy tab just to see what fired.
 *
 * Props:
 *   trigAlerts     — array of triggered alert objects from App.jsx useMemo
 *   alerts         — full alerts array (for rule descriptions)
 *   AT             — asset type label map
 *   onGoToStrategy — () => setTab('strategy')
 */

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X, ArrowRight, Bell } from 'lucide-react';

function alertDesc(a, AT) {
  if (!a) return '';
  if (a.type === 'RETURN_TARGET')    return `Portfolio return below ${a.threshold}% target`;
  if (a.type === 'ALLOCATION_DRIFT') return `${AT?.[a.assetType]?.label || a.assetType} over ${a.threshold}% of portfolio`;
  if (a.type === 'CONCENTRATION')    return `${AT?.[a.assetType]?.label || a.assetType} under ${a.threshold}% of portfolio`;
  if (a.type === 'USD_INR_RATE')     return `USD/INR rate above ₹${a.threshold}`;
  return a.label || a.type;
}

const SEEN_KEY = 'wl_seen_alert_ids';
function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function markSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])); } catch {}
}

export default function NotificationBell({ trigAlerts = [], alerts = [], AT = {}, onGoToStrategy }) {
  const [open, setOpen]       = useState(false);
  const [seenIds, setSeenIds] = useState(getSeenIds);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unseenCount = trigAlerts.filter(a => !seenIds.has(a.id)).length;

  function handleMarkAllSeen() {
    const next = new Set([...seenIds, ...trigAlerts.map(a => a.id)]);
    setSeenIds(next);
    markSeen(next);
  }

  function handleGoStrategy() {
    handleMarkAllSeen();
    setOpen(false);
    onGoToStrategy?.();
  }

  if (trigAlerts.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell trigger */}
      <button
        className="btn-o"
        onClick={() => setOpen(p => !p)}
        title={`${trigAlerts.length} alert${trigAlerts.length !== 1 ? 's' : ''} triggered`}
        style={{ borderColor: unseenCount > 0 ? 'rgba(220,38,38,.4)' : 'rgba(220,38,38,.2)', color: 'var(--loss)', position: 'relative' }}
        aria-label="Triggered alerts"
      >
        <AlertTriangle size={13} strokeWidth={2} />
        {unseenCount > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: '#dc2626', color: '#fff', borderRadius: '50%',
            width: 14, height: 14, fontSize: '.55rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 300, maxWidth: '90vw',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.22)',
          zIndex: 9999, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.6rem .85rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <Bell size={13} strokeWidth={2} style={{ color: 'var(--loss)' }} />
              <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--text)' }}>
                {trigAlerts.length} Alert{trigAlerts.length !== 1 ? 's' : ''} Triggered
              </span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>

          {/* Alert list */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {trigAlerts.map((a, i) => {
              const rule  = alerts.find(r => r.id === a.id) || a;
              const isNew = !seenIds.has(a.id);
              const desc  = alertDesc(rule, AT);
              return (
                <div key={a.id || i} style={{
                  padding: '.6rem .85rem',
                  borderBottom: i < trigAlerts.length - 1 ? '1px solid var(--border)' : 'none',
                  background: isNew ? 'rgba(220,38,38,.035)' : 'transparent',
                  display: 'flex', gap: '.6rem', alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: '.85rem', flexShrink: 0, marginTop: 1 }}>⚠️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.75rem', color: 'var(--text)', fontWeight: isNew ? 600 : 400, lineHeight: 1.35 }}>
                      {rule.label || desc}
                    </div>
                    {rule.label && desc && rule.label !== desc && (
                      <div style={{ fontSize: '.67rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>{desc}</div>
                    )}
                  </div>
                  {isNew && <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: '#dc2626', marginTop: 5 }} />}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: '.5rem .85rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {unseenCount > 0
              ? <button onClick={handleMarkAllSeen} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.68rem', color: 'var(--text-muted)', padding: 0 }}>Mark all seen</button>
              : <span />
            }
            <button onClick={handleGoStrategy} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.68rem', color: 'var(--accent)', padding: 0, display: 'flex', alignItems: 'center', gap: '.3rem', fontWeight: 500 }}>
              Manage alerts <ArrowRight size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
