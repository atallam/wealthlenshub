/**
 * NotificationCentre.jsx — Bell icon + slide-in drawer for in-app notifications.
 *
 * Usage:
 *   <NotificationCentre api={api} />
 *
 * Fetches from GET /api/notifications on mount and every 60 s.
 * Shows an unread badge on the bell icon.
 * Drawer: list of notifications, mark-as-read on click, Mark all / Clear read buttons.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, CheckCheck, Trash2 } from 'lucide-react';

const KIND_META = {
  fd_alert:            { emoji: '🏦', color: '#f0a050' },
  insurance_reminder:  { emoji: '🛡️', color: '#5b9bd5' },
  goal_milestone:      { emoji: '🎯', color: '#059669' },
  alert_triggered:     { emoji: '⚠️', color: '#D97706' },
  stale_holding:       { emoji: '🔔', color: '#A084CA' },
  system:              { emoji: '💡', color: '#5b9bd5' },
};

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function NotificationCentre({ api }) {
  const [open,    setOpen]    = useState(false);
  const [items,   setItems]   = useState([]);
  const [unread,  setUnread]  = useState(0);
  const [loading, setLoading] = useState(false);
  const drawerRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api('/api/notifications?limit=50');
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch (e) {
      console.error('NotificationCentre fetch error:', e);
    }
  }, [api]);

  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchNotifications]);

  // Close drawer on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function markRead(id) {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
    try { await api(`/api/notifications/${id}/read`, { method: 'POST' }); }
    catch (e) { console.error(e); }
  }

  async function markAllRead() {
    setLoading(true);
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function clearRead() {
    setLoading(true);
    try {
      await api('/api/notifications/clear', { method: 'DELETE' });
      setItems(prev => prev.filter(n => !n.read));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const S = {
    wrap: {
      position: 'relative',
      display: 'inline-flex',
    },
    bell: (active) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
      border: '1px solid var(--border)', background: 'transparent',
      color: active ? 'var(--primary)' : 'var(--text-muted)',
      position: 'relative', transition: 'all .15s',
    }),
    badge: {
      position: 'absolute', top: -4, right: -4,
      minWidth: 16, height: 16, borderRadius: 99,
      background: '#DC2626', color: '#fff',
      fontSize: '.6rem', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 3px', lineHeight: 1, border: '1.5px solid var(--bg-card)',
    },
    drawer: {
      position: 'absolute', top: 'calc(100% + 8px)', right: 0,
      width: 340, maxHeight: '80vh',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, boxShadow: 'var(--shadow-lg)',
      display: 'flex', flexDirection: 'column',
      zIndex: 500, overflow: 'hidden',
    },
    drawerHead: {
      display: 'flex', alignItems: 'center', gap: '.5rem',
      padding: '.75rem 1rem',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    },
    drawerTitle: { fontSize: '.88rem', fontWeight: 700, color: 'var(--text)', flex: 1 },
    actions: { display: 'flex', gap: '.35rem' },
    actBtn: {
      display: 'flex', alignItems: 'center', gap: '.25rem',
      padding: '.2rem .45rem', borderRadius: 6, fontSize: '.68rem',
      border: '1px solid var(--border)', background: 'transparent',
      color: 'var(--text-muted)', cursor: 'pointer',
    },
    list: { overflowY: 'auto', flex: 1 },
    item: (read) => ({
      display: 'flex', gap: '.65rem', padding: '.75rem 1rem',
      borderBottom: '1px solid var(--border)',
      background: read ? 'transparent' : 'var(--primary-dim)',
      cursor: read ? 'default' : 'pointer',
      transition: 'background .15s',
      alignItems: 'flex-start',
    }),
    emoji: { fontSize: '1.1rem', flexShrink: 0, lineHeight: 1.4 },
    body: { flex: 1, minWidth: 0 },
    itemTitle: (read) => ({
      fontSize: '.78rem', fontWeight: read ? 400 : 600,
      color: 'var(--text)', marginBottom: '.15rem',
    }),
    itemBody: {
      fontSize: '.7rem', color: 'var(--text-muted)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },
    itemTime: {
      fontSize: '.63rem', color: 'var(--text-muted)', marginTop: '.15rem',
    },
    empty: {
      padding: '2rem 1rem', textAlign: 'center',
      color: 'var(--text-muted)', fontSize: '.82rem',
    },
  };

  return (
    <div style={S.wrap} ref={drawerRef}>
      {/* Bell button */}
      <button style={S.bell(open || unread > 0)} onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        title="Notifications">
        <Bell size={14} strokeWidth={2}/>
        {unread > 0 && (
          <span style={S.badge}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div style={S.drawer}>
          {/* Header */}
          <div style={S.drawerHead}>
            <Bell size={14} style={{ color: 'var(--primary)', flexShrink: 0 }}/>
            <span style={S.drawerTitle}>Notifications{unread > 0 ? ` · ${unread} new` : ''}</span>
            <div style={S.actions}>
              {unread > 0 && (
                <button style={S.actBtn} onClick={markAllRead} disabled={loading} title="Mark all as read">
                  <CheckCheck size={11}/> All read
                </button>
              )}
              {items.some(n => n.read) && (
                <button style={S.actBtn} onClick={clearRead} disabled={loading} title="Clear read notifications">
                  <Trash2 size={11}/> Clear
                </button>
              )}
              <button style={{ ...S.actBtn, border: 'none' }} onClick={() => setOpen(false)}>
                <X size={12}/>
              </button>
            </div>
          </div>

          {/* List */}
          <div style={S.list}>
            {items.length === 0 ? (
              <div style={S.empty}>
                <Bell size={26} strokeWidth={1.2} style={{ margin: '0 auto .5rem', display: 'block', opacity: .25 }}/>
                No notifications yet
              </div>
            ) : (
              items.map(n => {
                const meta = KIND_META[n.kind] || KIND_META.system;
                return (
                  <div key={n.id} style={S.item(n.read)}
                    onClick={() => { if (!n.read) markRead(n.id); }}>
                    <span style={S.emoji}>{meta.emoji}</span>
                    <div style={S.body}>
                      <div style={S.itemTitle(n.read)}>{n.title}</div>
                      {n.body && <div style={S.itemBody}>{n.body}</div>}
                      <div style={S.itemTime}>{fmtTime(n.created_at)}</div>
                    </div>
                    {!n.read && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: 5 }}/>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
