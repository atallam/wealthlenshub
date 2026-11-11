import { useState } from 'react';
import { GOLD, GREEN, RED, fmtAmt } from './budgetShared.jsx';
import { SplitModal } from './SplitModal.jsx';

// ── Transaction List ──────────────────────────────────────────────
export function TransactionList({ fb, members = [] }) {
  const { fbTxns: txns, fbTxnsLoading: loading, fbTxnCat: cat, setFbTxnCat, fbTxnSearch: search, setFbTxnSearch,
    fbSelTxnIds: sel, setFbSelTxnIds, fbBulkCat: bulkCat, setFbBulkCat, fbCategories: categories, bulkCategorize, categorizeTxn, saveSplits } = fb;
  const [splitTxn, setSplitTxn] = useState(null);
  const memberName = (id) => members.find(m => m.id === id)?.name || 'Unknown';

  function toggleSel(id) { setFbSelTxnIds(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  const allSel = txns.length > 0 && txns.every(t => sel.has(t.id));

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <input className="fi" placeholder="Search transactions…" value={search} onChange={e => setFbTxnSearch(e.target.value)} style={{ flex: '1 1 160px', minWidth: 0 }} />
        <select className="fi" value={cat} onChange={e => setFbTxnCat(e.target.value)} style={{ minWidth: 130 }}>
          <option value="All">All categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
        </select>
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.5rem .8rem', background: GOLD + '18', borderRadius: 8, marginBottom: '.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.75rem', color: GOLD }}>{sel.size} selected</span>
          <select className="fi" value={bulkCat} onChange={e => setFbBulkCat(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            <option value="">— Assign category —</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
          <button onClick={() => bulkCategorize(sel, bulkCat)} disabled={!bulkCat} style={{ padding: '.3rem .8rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.75rem', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
          <button onClick={() => setFbSelTxnIds(new Set())} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Clear</button>
        </div>
      )}

      {loading ? <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading…</div> : txns.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>No transactions found</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '.68rem', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '.3rem', width: 24 }}>
                  <input type="checkbox" checked={allSel} onChange={() => allSel ? setFbSelTxnIds(new Set()) : setFbSelTxnIds(new Set(txns.map(t => t.id)))} />
                </th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500 }}>Description</th>
                <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontWeight: 500, minWidth: 110 }}>Category</th>
                <th style={{ textAlign: 'right', padding: '.4rem .5rem', fontWeight: 500 }}>Amount</th>
                <th style={{ padding: '.4rem .3rem', fontWeight: 500 }}>Shared</th>
              </tr>
            </thead>
            <tbody>
              {txns.slice(0, 300).map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: sel.has(t.id) ? GOLD + '0a' : 'transparent' }}>
                  <td style={{ padding: '.3rem' }}><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} /></td>
                  <td style={{ padding: '.4rem .5rem', color: 'var(--text-muted)', fontFamily: "'DM Mono',monospace", fontSize: '.68rem', whiteSpace: 'nowrap' }}>{t.txn_date}</td>
                  <td style={{ padding: '.4rem .5rem', color: 'var(--text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.description}>{t.description}</td>
                  <td style={{ padding: '.4rem .5rem' }}>
                    <select value={t.category || 'Other'} onChange={e => categorizeTxn(t.id, e.target.value)}
                      style={{ fontSize: '.7rem', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 4px', color: 'var(--text)', width: '100%' }}>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '.4rem .5rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", color: t.txn_type === 'DEBIT' ? RED : GREEN, fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {t.txn_type === 'CREDIT' ? '+' : '-'}{fmtAmt(t.amount, true)}
                    {t.is_split && t.member_share !== undefined && (
                      <div style={{ fontSize: '.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>your share {fmtAmt(t.member_share, true)}</div>
                    )}
                  </td>
                  <td style={{ padding: '.4rem .3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setSplitTxn(t)}
                      title={t.is_split ? 'Shared: ' + t.splits.map(sh => `${memberName(sh.member_id)} ${fmtAmt(sh.amount)}`).join(', ') : 'Split between family members'}
                      style={{ padding: '2px 7px', background: t.is_split ? GOLD + '22' : 'transparent', border: `1px solid ${t.is_split ? GOLD : 'var(--border)'}`, borderRadius: 5, fontSize: '.66rem', cursor: 'pointer', color: t.is_split ? GOLD : 'var(--text-muted)' }}>
                      {t.is_split ? `👥 ${t.splits.length}` : '⇄ Split'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {txns.length > 300 && <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', padding: '.5rem', textAlign: 'center' }}>Showing 300 of {txns.length}</div>}
        </div>
      )}
      {splitTxn && (
        <SplitModal txn={splitTxn} members={members} onClose={() => setSplitTxn(null)} onSave={(splits) => saveSplits(splitTxn.id, splits)} />
      )}
    </div>
  );
}
