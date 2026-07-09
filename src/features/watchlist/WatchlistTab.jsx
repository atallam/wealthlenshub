/**
 * WatchlistTab.jsx — Watch tickers not yet in the portfolio.
 *
 * Features:
 *  • Add / delete watchlist items (ticker, name, asset type, target price, notes)
 *  • Live price fetch via GET /api/watchlist (server enriches prices on load)
 *  • Target-hit badge when current_price >= target_price
 *  • Price change % with colour coding
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabase.js';
import { X as XIcon, RefreshCw, Plus, Eye } from 'lucide-react';

const ASSET_TYPES = [
  { value: 'IN_STOCK', label: '🇮🇳 IN Stock' },
  { value: 'IN_ETF',   label: '🇮🇳 IN ETF' },
  { value: 'US_STOCK', label: '🇺🇸 US Stock' },
  { value: 'US_ETF',   label: '🇺🇸 US ETF' },
  { value: 'CRYPTO',   label: '₿ Crypto' },
  { value: 'MF',       label: '📦 Mutual Fund' },
];

function pctColor(v) {
  if (v == null) return 'var(--text-muted)';
  return v >= 0 ? '#4caf9a' : '#e07c5a';
}

function fmtPrice(p, assetType) {
  if (p == null) return '—';
  const sym = ['US_STOCK','US_ETF','CRYPTO'].includes(assetType) ? '$' : '₹';
  return `${sym}${Number(p).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const BLANK = { ticker: '', name: '', asset_type: 'IN_STOCK', target_price: '', notes: '' };

export default function WatchlistTab() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [form,    setForm]    = useState(BLANK);
  const [adding,  setAdding]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [editId,  setEditId]  = useState(null);
  const [editForm, setEditForm] = useState({});

  const authHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await authHeader();
      const r = await fetch('/api/watchlist', { headers });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      setItems(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  useEffect(() => { load(); }, [load]);

  async function addItem() {
    if (!form.ticker.trim()) return;
    setSaving(true);
    setError('');
    try {
      const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
      const r = await fetch('/api/watchlist', { method: 'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const item = await r.json();
      setItems(prev => [item, ...prev]);
      setForm(BLANK);
      setAdding(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id) {
    setSaving(true);
    try {
      const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
      const r = await fetch(`/api/watchlist/${id}`, { method: 'PATCH', headers, body: JSON.stringify(editForm) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const updated = await r.json();
      setItems(prev => prev.map(it => it.id === id ? updated : it));
      setEditId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      const headers = await authHeader();
      await fetch(`/api/watchlist/${id}`, { method: 'DELETE', headers });
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  // ── styles ──────────────────────────────────────────────────────────────────
  const inputStyle = {
    fontSize: '.78rem', padding: '.38rem .6rem',
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontFamily: "'DM Sans',sans-serif",
  };
  const btnPrimary = {
    fontSize: '.78rem', padding: '.38rem .85rem',
    background: 'rgba(201,168,76,.15)', border: '1px solid rgba(201,168,76,.4)',
    color: '#c9a84c', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
  };
  const btnGhost = {
    fontSize: '.72rem', padding: '.3rem .65rem',
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--text-muted)', borderRadius: 5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
  };

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
            <Eye size={15} style={{ verticalAlign: 'middle', marginRight: '.4rem' }}/>Watchlist
          </h2>
          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
            Track tickers you're watching but haven't bought yet
          </div>
        </div>
        <button onClick={load} disabled={loading} style={btnGhost}>
          <RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: '.3rem' }}/>
          {loading ? 'Loading…' : 'Refresh Prices'}
        </button>
        <button onClick={() => setAdding(p => !p)} style={btnPrimary}>
          <Plus size={13} style={{ verticalAlign: 'middle', marginRight: '.3rem' }}/>
          Add Ticker
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: 'rgba(224,124,90,.12)', border: '1px solid rgba(224,124,90,.3)', borderRadius: 8, padding: '.6rem .9rem', color: '#e07c5a', fontSize: '.8rem', marginBottom: '1rem' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Add form ── */}
      {adding && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--text)', marginBottom: '.75rem' }}>Add to Watchlist</div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
            <input style={{ ...inputStyle, width: 110 }} placeholder="Ticker (e.g. INFY)" value={form.ticker}
              onChange={e => setForm(p => ({ ...p, ticker: e.target.value.toUpperCase() }))}/>
            <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder="Name (optional)" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}/>
            <select style={{ ...inputStyle }} value={form.asset_type}
              onChange={e => setForm(p => ({ ...p, asset_type: e.target.value }))}>
              {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input style={{ ...inputStyle, width: 130 }} placeholder="Target price (₹/$)" type="number"
              value={form.target_price} onChange={e => setForm(p => ({ ...p, target_price: e.target.value }))}/>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 180 }} placeholder="Notes (optional)" value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}/>
            <button onClick={addItem} disabled={saving || !form.ticker.trim()} style={btnPrimary}>
              {saving ? 'Adding…' : '+ Add'}
            </button>
            <button onClick={() => { setAdding(false); setForm(BLANK); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {items.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '.85rem' }}>
          No watchlist items yet — add a ticker to start tracking.
        </div>
      )}

      {items.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  {['Ticker / Name', 'Type', 'Price', 'Change', 'Target', 'Status', 'Notes', ''].map(h => (
                    <th key={h} style={{ padding: '.65rem .75rem', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  editId === it.id ? (
                    <tr key={it.id} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(201,168,76,.04)' }}>
                      <td colSpan={8} style={{ padding: '.6rem .75rem' }}>
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <input style={{ ...inputStyle, width: 160 }} placeholder="Name" value={editForm.name || ''}
                            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}/>
                          <input style={{ ...inputStyle, width: 130 }} placeholder="Target price" type="number"
                            value={editForm.target_price || ''} onChange={e => setEditForm(p => ({ ...p, target_price: e.target.value }))}/>
                          <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="Notes"
                            value={editForm.notes || ''} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}/>
                          <button onClick={() => saveEdit(it.id)} disabled={saving} style={btnPrimary}>{saving ? '…' : 'Save'}</button>
                          <button onClick={() => setEditId(null)} style={btnGhost}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={it.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <td style={{ padding: '.6rem .75rem' }}>
                        <div style={{ fontWeight: 600, fontFamily: "'DM Mono',monospace", fontSize: '.78rem', color: '#c9a84c' }}>{it.ticker}</div>
                        {it.name && it.name !== it.ticker && (
                          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.1rem' }}>{it.name}</div>
                        )}
                      </td>
                      <td style={{ padding: '.6rem .75rem' }}>
                        <span style={{ fontSize: '.68rem', padding: '2px 7px', borderRadius: 4, background: 'var(--bg-muted)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                          {ASSET_TYPES.find(t => t.value === it.asset_type)?.label || it.asset_type}
                        </span>
                      </td>
                      <td style={{ padding: '.6rem .75rem', fontFamily: "'DM Mono',monospace", fontWeight: 600, color: 'var(--text)' }}>
                        {loading ? <span style={{ color: 'var(--text-muted)' }}>…</span> : fmtPrice(it.current_price, it.asset_type)}
                      </td>
                      <td style={{ padding: '.6rem .75rem', fontFamily: "'DM Mono',monospace", color: pctColor(it.price_change_pct) }}>
                        {it.price_change_pct != null
                          ? `${it.price_change_pct >= 0 ? '+' : ''}${Number(it.price_change_pct).toFixed(2)}%`
                          : '—'}
                      </td>
                      <td style={{ padding: '.6rem .75rem', fontFamily: "'DM Mono',monospace", color: 'var(--text-dim)' }}>
                        {it.target_price ? fmtPrice(it.target_price, it.asset_type) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '.6rem .75rem' }}>
                        {it.hit_target === true && (
                          <span style={{ fontSize: '.68rem', padding: '2px 7px', borderRadius: 4, fontWeight: 700, background: 'rgba(76,175,154,.15)', color: '#4caf9a', border: '1px solid rgba(76,175,154,.3)' }}>
                            ✓ Target hit
                          </span>
                        )}
                        {it.hit_target === false && (
                          <span style={{ fontSize: '.68rem', padding: '2px 7px', borderRadius: 4, background: 'var(--bg-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            Watching
                          </span>
                        )}
                        {it.hit_target === null && it.target_price == null && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '.7rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '.6rem .75rem', maxWidth: 160, fontSize: '.72rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.notes || '—'}
                      </td>
                      <td style={{ padding: '.6rem .75rem' }}>
                        <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                          <button title="Edit" onClick={() => { setEditId(it.id); setEditForm({ name: it.name, target_price: it.target_price || '', notes: it.notes || '' }); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(90,156,224,.65)', padding: '2px 4px', fontSize: '.7rem' }}>✎</button>
                          <button title="Remove" onClick={() => remove(it.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--loss)', padding: '2px 4px' }}>
                            <XIcon size={13} strokeWidth={2}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: '.85rem', fontSize: '.68rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Prices are fetched live when you load or refresh. Set a target price to get a "Target hit" badge when the price crosses it.
      </div>
    </div>
  );
}
