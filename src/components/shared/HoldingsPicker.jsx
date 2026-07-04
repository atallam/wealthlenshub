/**
 * HoldingsPicker.jsx
 * Searchable checklist of all holdings for goal-level earmarking.
 *
 * Props:
 *   allHoldings   — full holdings array
 *   valINRCache   — Map<holdingId, INR value>
 *   AT            — asset type map  { [key]: { icon, label, color } }
 *   members       — family members array
 *   selected      — string[] of currently selected holding IDs
 *   onChange      — (newSelectedIds: string[]) => void
 *   goals         — all goals (to warn about holdings already claimed elsewhere)
 *   currentGoalId — id of the goal being edited (to exclude from "already claimed" check)
 */

import { useState, useMemo } from 'react';

function fmtCr(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(a / 1e3).toFixed(0)}K`;
  return `₹${Math.round(a).toLocaleString('en-IN')}`;
}

export default function HoldingsPicker({
  allHoldings = [],
  valINRCache = new Map(),
  AT = {},
  members = [],
  selected = [],
  onChange,
  goals = [],
  currentGoalId = null,
}) {
  const [search,   setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open,     setOpen]     = useState(selected.length > 0);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Build a map: holdingId → goal names that have explicitly earmarked it (excluding current goal)
  const earmarkedByOtherGoal = useMemo(() => {
    const map = {};
    goals.forEach(g => {
      if (g.id === currentGoalId) return;
      (g.linkedHoldingIds || []).forEach(id => {
        if (!map[id]) map[id] = [];
        map[id].push(g.name);
      });
    });
    return map;
  }, [goals, currentGoalId]);

  const memberName = id => members.find(m => m.id === id)?.name || '';

  // Available type options for filter dropdown (only types present in holdings)
  const typeOptions = useMemo(() => {
    const types = [...new Set(allHoldings.map(h => h.type))].sort();
    return types;
  }, [allHoldings]);

  // Filtered + sorted holdings list
  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allHoldings
      .filter(h => {
        if (typeFilter && h.type !== typeFilter) return false;
        if (q && !h.name.toLowerCase().includes(q) && !(h.symbol || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .map(h => ({ ...h, _val: valINRCache.get(h.id) || 0 }))
      .sort((a, b) => b._val - a._val);
  }, [allHoldings, valINRCache, search, typeFilter]);

  function toggle(id) {
    const next = selectedSet.has(id)
      ? selected.filter(x => x !== id)
      : [...selected, id];
    onChange(next);
  }

  function selectAll() {
    const allIds = visible.map(h => h.id);
    const merged = [...new Set([...selected, ...allIds])];
    onChange(merged);
  }

  function clearAll() {
    const visibleIds = new Set(visible.map(h => h.id));
    onChange(selected.filter(id => !visibleIds.has(id)));
  }

  const selectedVisible = visible.filter(h => selectedSet.has(h.id)).length;

  return (
    <div style={{ marginTop: '.25rem' }}>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: selected.length > 0 ? 'rgba(90,156,224,.07)' : 'var(--bg-muted)',
          border: `1px solid ${selected.length > 0 ? 'rgba(90,156,224,.35)' : 'var(--border)'}`,
          borderRadius: open ? '7px 7px 0 0' : 7,
          padding: '.45rem .75rem', cursor: 'pointer',
          color: selected.length > 0 ? '#5a9ce0' : 'var(--text-muted)',
          fontFamily: "'DM Sans',sans-serif", fontSize: '.72rem',
        }}>
        <span>
          📌 Earmark specific holdings
          {selected.length > 0 && (
            <span style={{
              marginLeft: '.5rem', background: 'rgba(90,156,224,.18)',
              border: '1px solid rgba(90,156,224,.4)', borderRadius: 10,
              padding: '1px 8px', fontSize: '.65rem', fontWeight: 600, color: '#5a9ce0',
            }}>
              {selected.length} selected
            </span>
          )}
        </span>
        <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          border: '1px solid rgba(90,156,224,.25)', borderTop: 'none',
          borderRadius: '0 0 7px 7px', background: 'var(--bg-muted)',
          overflow: 'hidden',
        }}>
          {/* Search + filter bar */}
          <div style={{ display: 'flex', gap: '.5rem', padding: '.5rem .65rem', borderBottom: '1px solid var(--border)' }}>
            <input
              className="fi"
              style={{ flex: 2, fontSize: '.72rem', padding: '.3rem .6rem' }}
              placeholder="Search holdings…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="fi fs"
              style={{ flex: 1, fontSize: '.72rem', padding: '.3rem .5rem' }}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {typeOptions.map(t => (
                <option key={t} value={t}>{AT[t]?.icon || ''} {AT[t]?.label || t}</option>
              ))}
            </select>
          </div>

          {/* Bulk actions */}
          <div style={{ display: 'flex', gap: '.5rem', padding: '.3rem .65rem', borderBottom: '1px solid var(--border)', fontSize: '.65rem' }}>
            <button type="button" onClick={selectAll}
              style={{ background: 'none', border: 'none', color: '#5a9ce0', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit' }}>
              Select all {typeFilter || search ? 'filtered' : ''}
            </button>
            <span style={{ color: 'var(--border)' }}>·</span>
            <button type="button" onClick={clearAll}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit' }}>
              Clear {typeFilter || search ? 'filtered' : 'all'}
            </button>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
              {selectedVisible}/{visible.length} shown
            </span>
          </div>

          {/* Holdings list */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {visible.length === 0 ? (
              <div style={{ padding: '.75rem', textAlign: 'center', fontSize: '.72rem', color: 'var(--text-muted)' }}>
                No holdings match
              </div>
            ) : visible.map(h => {
              const a        = AT[h.type] || { icon: '📦', label: h.type, color: '#888' };
              const isChecked = selectedSet.has(h.id);
              const claimedBy = earmarkedByOtherGoal[h.id] || [];
              const mName    = memberName(h.member_id);

              return (
                <label
                  key={h.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.55rem',
                    padding: '.38rem .65rem', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: isChecked ? 'rgba(90,156,224,.05)' : 'transparent',
                    transition: 'background .1s',
                  }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(h.id)}
                    style={{ flexShrink: 0, accentColor: '#5a9ce0' }}
                  />
                  {/* Type icon */}
                  <span style={{ fontSize: '.85rem', flexShrink: 0 }}>{a.icon}</span>
                  {/* Name + badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '.72rem', color: isChecked ? 'var(--text)' : 'var(--text-dim)',
                      fontWeight: isChecked ? 500 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {h.name}
                    </div>
                    <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.1rem' }}>
                      <span style={{
                        fontSize: '.58rem', padding: '1px 5px', borderRadius: 3,
                        background: `${a.color}18`, border: `1px solid ${a.color}44`, color: a.color,
                      }}>
                        {a.label}
                      </span>
                      {mName && (
                        <span style={{
                          fontSize: '.58rem', padding: '1px 5px', borderRadius: 3,
                          background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)',
                        }}>
                          {mName}
                        </span>
                      )}
                      {claimedBy.length > 0 && (
                        <span style={{
                          fontSize: '.58rem', padding: '1px 5px', borderRadius: 3,
                          background: 'rgba(201,168,76,.12)', border: '1px solid rgba(201,168,76,.3)', color: '#c9a84c',
                        }}
                          title={`Also earmarked in: ${claimedBy.join(', ')}`}>
                          also in {claimedBy[0]}{claimedBy.length > 1 ? ` +${claimedBy.length - 1}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Value */}
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: '.72rem',
                    color: isChecked ? '#5a9ce0' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}>
                    {h._val > 0 ? fmtCr(h._val) : '—'}
                  </span>
                </label>
              );
            })}
          </div>

          {/* Footer note */}
          <div style={{ padding: '.35rem .65rem', fontSize: '.62rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', lineHeight: 1.5 }}>
            Earmarked holdings are always included in this goal's funded value, regardless of member or type filters above.
          </div>
        </div>
      )}
    </div>
  );
}
