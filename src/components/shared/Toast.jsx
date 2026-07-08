// Toast.jsx — lightweight in-app notification system.
// Usage:
//   import { ToastContainer, useToast } from './Toast.jsx';
//   const toast = useToast();
//   toast.success('Saved!');
//   toast.error('Failed to load prices');
//   toast.info('Refreshing...');
//   const ok = await toast.confirm('Delete this holding?');  // returns true/false

import { useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';

const ToastCtx = createContext(null);

export function useToast() {
  return useContext(ToastCtx);
}

let _idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts,    setToasts]    = useState([]);
  const [confirms,  setConfirms]  = useState([]);
  const resolvers = useRef({});

  const dismiss = useCallback(id => {
    setToasts(p => p.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 300);
  }, []);

  const add = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_idSeq;
    setToasts(p => [...p, { id, message, type, leaving: false }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  // Memoized so consumers can safely list `toast` in hook dependency arrays.
  const toast = useMemo(() => ({
    success: (msg, dur)  => add(msg, 'success', dur),
    error:   (msg, dur)  => add(msg, 'error', dur ?? 6000),
    info:    (msg, dur)  => add(msg, 'info', dur),
    warn:    (msg, dur)  => add(msg, 'warn', dur),
    dismiss,
    // confirm() opens a modal and returns a Promise<boolean>
    confirm: (message, { confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) => {
      const id = ++_idSeq;
      return new Promise(resolve => {
        resolvers.current[id] = resolve;
        setConfirms(p => [...p, { id, message, confirmLabel, cancelLabel, danger }]);
      });
    },
  }), [add, dismiss]);

  function resolveConfirm(id, value) {
    setConfirms(p => p.filter(c => c.id !== id));
    resolvers.current[id]?.(value);
    delete resolvers.current[id];
  }

  const COLORS = {
    success: { bg: 'rgba(76,175,154,.18)', border: '#4caf9a', icon: '✓', iconColor: '#4caf9a' },
    error:   { bg: 'rgba(224,124,90,.18)', border: '#e07c5a', icon: '✕', iconColor: '#e07c5a' },
    info:    { bg: 'rgba(90,156,224,.15)', border: '#5a9ce0', icon: 'ℹ', iconColor: '#5a9ce0' },
    warn:    { bg: 'rgba(240,160,80,.18)', border: '#f0a050', icon: '⚠', iconColor: '#f0a050' },
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}

      {/* Toast stack */}
      <div style={{ position:'fixed', bottom:'1.5rem', right:'1.5rem', zIndex:9999, display:'flex', flexDirection:'column', gap:'.6rem', pointerEvents:'none' }}>
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <div key={t.id} style={{
              display:'flex', alignItems:'flex-start', gap:'.75rem',
              background: c.bg, border: `1px solid ${c.border}`,
              borderLeft: `4px solid ${c.border}`,
              borderRadius: 10, padding:'.75rem 1rem',
              minWidth: 260, maxWidth: 380,
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 20px rgba(0,0,0,.3)',
              pointerEvents: 'all',
              opacity: t.leaving ? 0 : 1,
              transform: t.leaving ? 'translateX(20px)' : 'translateX(0)',
              transition: 'opacity .28s ease, transform .28s ease',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <span style={{ color: c.iconColor, fontWeight: 700, fontSize: '1rem', lineHeight: 1.4, flexShrink: 0 }}>{c.icon}</span>
              <span style={{ flex: 1, fontSize: '.82rem', color: 'var(--text)', lineHeight: 1.5 }}>{t.message}</span>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:'.5rem', minHeight:'44px', minWidth:'44px', fontSize:'.9rem', lineHeight:1, flexShrink:0 }}>✕</button>
            </div>
          );
        })}
      </div>

      {/* Confirm modals */}
      {confirms.map(c => (
        <div key={c.id} style={{ position:'fixed', inset:0, zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)' }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'2rem', maxWidth:360, width:'90%', textAlign:'center', boxShadow:'0 8px 40px rgba(0,0,0,.4)' }}>
            <div style={{ fontSize:'2rem', marginBottom:'.75rem' }}>⚠️</div>
            <div style={{ fontSize:'.92rem', color:'var(--text)', lineHeight:1.55, marginBottom:'1.5rem', fontFamily:"'DM Sans',sans-serif" }}>{c.message}</div>
            <div style={{ display:'flex', gap:'.75rem', justifyContent:'center' }}>
              <button onClick={() => resolveConfirm(c.id, false)} style={{ padding:'.6rem 1.4rem', borderRadius:8, background:'var(--bg-muted)', border:'1px solid var(--border)', color:'var(--text)', cursor:'pointer', fontSize:'.84rem', fontFamily:"'DM Sans',sans-serif" }}>{c.cancelLabel}</button>
              <button onClick={() => resolveConfirm(c.id, true)}  style={{ padding:'.6rem 1.4rem', borderRadius:8, background: c.danger ? '#e07c5a' : '#4caf9a', border:'none', color:'#fff', cursor:'pointer', fontSize:'.84rem', fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>{c.confirmLabel}</button>
            </div>
          </div>
        </div>
      ))}
    </ToastCtx.Provider>
  );
}
