import { useState } from 'react';
import { GOLD, GREEN, RED, fmtAmt } from './budgetShared.jsx';

// ── Split modal (migrations/0033) ─────────────────────────────────
// Share one transaction between family members. Shares must total the
// transaction amount; "Split equally" fills the checked members and puts any
// leftover paisa on the first one so the total is always exact.
export function SplitModal({ txn, members, onClose, onSave }) {
  const [rows, setRows] = useState(() => {
    const init = {};
    for (const sh of txn.splits || []) init[sh.member_id] = String(sh.amount);
    return init; // { memberId: "amount string" } — presence = checked
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = Number(txn.amount) || 0;
  const picked = Object.keys(rows);
  const sum = picked.reduce((s, id) => s + (Number(rows[id]) || 0), 0);
  const diff = Math.round((total - sum) * 100) / 100;
  const balanced = Math.abs(diff) < 0.005;
  const canSave = picked.length >= 2 && balanced && picked.every(id => Number(rows[id]) > 0) && !busy;

  function toggle(id) {
    setRows(r => { const n = { ...r }; if (id in n) delete n[id]; else n[id] = ''; return n; });
  }
  function splitEqually() {
    if (!picked.length) return;
    const cents = Math.round(total * 100);
    const base = Math.floor(cents / picked.length);
    const extra = cents - base * picked.length;
    const n = {};
    picked.forEach((id, i) => { n[id] = ((base + (i === 0 ? extra : 0)) / 100).toFixed(2); });
    setRows(n);
  }
  async function submit(splits) {
    setBusy(true); setError('');
    try { await onSave(splits); onClose(); }
    catch (e) { setError(e.message || 'Could not save split'); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.2rem', width: '100%', maxWidth: 420 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.25rem' }}>Split transaction</div>
        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginBottom: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={txn.description}>
          {txn.description} · <b style={{ color: 'var(--text)' }}>{fmtAmt(total)}</b>
        </div>

        {members.length < 2 ? (
          <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', padding: '.5rem 0' }}>Add at least two family members to split a transaction.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '.7rem' }}>
              {members.map(m => {
                const on = m.id in rows;
                return (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '.55rem', fontSize: '.8rem', color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                    <span style={{ flex: 1 }}>{m.avatar || '👤'} {m.name}</span>
                    {on && (
                      <input className="fi" type="number" min="0" step="0.01" value={rows[m.id]} placeholder="0.00"
                        onChange={e => setRows(r => ({ ...r, [m.id]: e.target.value }))}
                        style={{ width: 110, textAlign: 'right', fontFamily: "'DM Mono',monospace" }} />
                    )}
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '.74rem', marginBottom: '.7rem' }}>
              <button onClick={splitEqually} disabled={picked.length < 2}
                style={{ padding: '.25rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: picked.length < 2 ? 'default' : 'pointer', color: 'var(--text-dim)' }}>
                Split equally
              </button>
              <span style={{ fontFamily: "'DM Mono',monospace", color: balanced ? GREEN : RED }}>
                {balanced ? '✓ fully allocated' : diff > 0 ? `${fmtAmt(diff)} left` : `${fmtAmt(-diff)} over`}
              </span>
            </div>
          </>
        )}

        {error && <div style={{ fontSize: '.72rem', color: RED, marginBottom: '.6rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {txn.is_split && (
            <button onClick={() => submit([])} disabled={busy}
              style={{ marginRight: 'auto', padding: '.35rem .7rem', background: 'transparent', border: `1px solid ${RED}55`, borderRadius: 6, fontSize: '.74rem', cursor: 'pointer', color: RED }}>
              Remove split
            </button>
          )}
          <button onClick={onClose} style={{ padding: '.35rem .8rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
          <button onClick={() => submit(picked.map(id => ({ member_id: id, amount: Number(rows[id]) })))} disabled={!canSave}
            style={{ padding: '.35rem .9rem', background: canSave ? GOLD : 'var(--bg-muted)', color: canSave ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 6, fontSize: '.75rem', cursor: canSave ? 'pointer' : 'default', fontWeight: 600 }}>
            {busy ? 'Saving…' : 'Save split'}
          </button>
        </div>
      </div>
    </div>
  );
}
