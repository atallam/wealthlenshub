/**
 * AuditLogPanel.jsx — Activity history overlay for WealthLens Hub.
 *
 * Opens as an Overlay from the Settings panel.
 * Shows a paginated, filterable timeline of all user actions.
 *
 * Usage:
 *   import AuditLogPanel from './features/audit/AuditLogPanel.jsx';
 *   {showAuditLog && <AuditLogPanel onClose={() => setShowAuditLog(false)} api={api} />}
 */

import { useState, useEffect, useCallback } from 'react';
import { Overlay } from '../../components/shared/Overlay.jsx';
import {
  Activity, Shield, TrendingUp, FileText, Users, RefreshCw,
  Brain, Wallet, Bell, Star, ChevronLeft, ChevronRight,
  CheckCircle, AlertCircle, Filter, X, Calendar, Download
} from 'lucide-react';

// ── Action metadata ──────────────────────────────────────────────────────────
const ACTION_META = {
  // Holdings
  HOLDING_CREATE:       { label: 'Holding Added',         color: '#4caf9a', Icon: TrendingUp  },
  HOLDING_UPDATE:       { label: 'Holding Updated',       color: '#5b9bd5', Icon: TrendingUp  },
  HOLDING_DELETE:       { label: 'Holding Deleted',       color: '#e57373', Icon: TrendingUp  },
  HOLDINGS_IMPORT:      { label: 'Holdings Imported',     color: '#4caf9a', Icon: FileText    },

  // Transactions
  TXN_ADD:              { label: 'Transaction Added',     color: '#4caf9a', Icon: Activity    },
  TXN_DELETE:           { label: 'Transaction Deleted',   color: '#e57373', Icon: Activity    },
  TRANSACTIONS_IMPORT:  { label: 'Transactions Imported', color: '#4caf9a', Icon: FileText    },

  // Portfolio / Profile
  PORTFOLIO_CREATE:     { label: 'Portfolio Created',     color: '#7c6af7', Icon: Shield      },
  PORTFOLIO_UPDATE:     { label: 'Portfolio Updated',     color: '#7c6af7', Icon: Shield      },
  PROFILE_UPDATE:       { label: 'Profile Updated',       color: '#5b9bd5', Icon: Users       },

  // Shares
  SHARE_GRANT:          { label: 'Portfolio Shared',      color: '#7c6af7', Icon: Users       },
  SHARE_REVOKE:         { label: 'Share Revoked',         color: '#e57373', Icon: Users       },

  // Connections
  SNAPTRADE_CONNECT:    { label: 'Broker Connected',      color: '#4caf9a', Icon: Shield      },
  SNAPTRADE_DISCONNECT: { label: 'Broker Disconnected',   color: '#e57373', Icon: Shield      },
  SNAPTRADE_IMPORT:     { label: 'Broker Import',         color: '#5b9bd5', Icon: TrendingUp  },
  PLAID_CONNECT:        { label: 'Bank Connected',        color: '#4caf9a', Icon: Wallet      },
  PLAID_SYNC:           { label: 'Bank Synced',           color: '#5b9bd5', Icon: Wallet      },

  // Prices / Snapshots
  PRICES_REFRESH:       { label: 'Prices Refreshed',     color: '#5b9bd5', Icon: RefreshCw   },
  SNAPSHOT_CREATE:      { label: 'Snapshot Saved',        color: '#5b9bd5', Icon: Activity    },

  // AI
  AI_QUERY:             { label: 'AI Advisor Query',      color: '#c084fc', Icon: Brain       },

  // Budget
  BUDGET_ACTION:        { label: 'Budget Action',         color: '#f4a261', Icon: Wallet      },
  BUDGET_DELETE:        { label: 'Budget Deleted',        color: '#e57373', Icon: Wallet      },

  // Alerts / Watchlist
  ALERT_CREATE:         { label: 'Alert Created',         color: '#4caf9a', Icon: Bell        },
  ALERT_UPDATE:         { label: 'Alert Updated',         color: '#5b9bd5', Icon: Bell        },
  ALERT_DELETE:         { label: 'Alert Deleted',         color: '#e57373', Icon: Bell        },
  WATCHLIST_ADD:        { label: 'Watchlist Add',         color: '#4caf9a', Icon: Star        },
  WATCHLIST_REMOVE:     { label: 'Watchlist Remove',      color: '#e57373', Icon: Star        },

  // Artifacts
  ARTIFACT_UPLOAD:      { label: 'Document Uploaded',     color: '#4caf9a', Icon: FileText    },
  ARTIFACT_DELETE:      { label: 'Document Deleted',      color: '#e57373', Icon: FileText    },

  // Import / FD
  DATA_IMPORT:          { label: 'Data Import',           color: '#4caf9a', Icon: FileText    },
  FD_ACTION:            { label: 'FD Action',             color: '#5b9bd5', Icon: TrendingUp  },
  FD_UPDATE:            { label: 'FD Updated',            color: '#5b9bd5', Icon: TrendingUp  },
  FD_DELETE:            { label: 'FD Deleted',            color: '#e57373', Icon: TrendingUp  },
};

const CATEGORIES = [
  { key: '',            label: 'All' },
  { key: 'holding',     label: 'Holdings' },
  { key: 'transaction', label: 'Transactions' },
  { key: 'portfolio',   label: 'Portfolio' },
  { key: 'profile',     label: 'Profile' },
  { key: 'share',       label: 'Sharing' },
  { key: 'snaptrade',   label: 'Brokers' },
  { key: 'plaid',       label: 'Bank' },
  { key: 'budget',      label: 'Budget' },
  { key: 'ai',          label: 'AI Advisor' },
  { key: 'alert',       label: 'Alerts' },
];

const PAGE_SIZE = 25;

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000)    return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function fmtFull(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function getMeta(action) {
  return ACTION_META[action] || { label: action, color: '#888', Icon: Activity };
}

function StatusDot({ code }) {
  const ok = code < 400;
  return (
    <span title={`HTTP ${code}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: '.65rem', color: ok ? '#4caf9a' : '#e57373',
    }}>
      {ok
        ? <CheckCircle size={10} strokeWidth={2}/>
        : <AlertCircle size={10} strokeWidth={2}/>
      }
      {code}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function AuditLogPanel({ onClose, api }) {
  const [logs,       setLogs]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(0);
  const [category,   setCategory]   = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | 'ok' | 'error'
  const [expanded,   setExpanded]   = useState(null);   // log id with open detail
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');

  const fetchLogs = useCallback(async (pg = 0, cat = '', sf = '', df = '', dt = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit:  PAGE_SIZE,
        offset: pg * PAGE_SIZE,
        ...(cat ? { category: cat } : {}),
        ...(sf  ? { status: sf }    : {}),
        ...(df  ? { from: df }      : {}),
        ...(dt  ? { to: dt }        : {}),
      });
      const data = await api(`/api/audit-logs?${params}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('AuditLogPanel fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchLogs(0, category, statusFilter); }, []);  // eslint-disable-line

  function applyFilter(cat, sf, df = dateFrom, dt = dateTo) {
    setCategory(cat);
    setStatusFilter(sf);
    setDateFrom(df);
    setDateTo(dt);
    setPage(0);
    setExpanded(null);
    fetchLogs(0, cat, sf, df, dt);
  }

  async function exportCsv() {
    try {
      const params = new URLSearchParams({
        limit: 9999, offset: 0,
        ...(category    ? { category }        : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(dateFrom    ? { from: dateFrom }  : {}),
        ...(dateTo      ? { to: dateTo }      : {}),
      });
      const data = await api(`/api/audit-logs?${params}`);
      const rows = data.logs || [];
      const header = ['Timestamp','Action','Method','Path','Status Code','Duration (ms)','Entity ID','IP Address'];
      const csvRows = [header, ...rows.map(l => [
        fmtFull(l.created_at), getMeta(l.action).label,
        l.method || '', l.path || '', l.status_code || '',
        l.duration_ms != null ? l.duration_ms : '', l.entity_id || '', l.ip_address || '',
      ])];
      const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('CSV export failed', e); }
  }

  function goPage(dir) {
    const next = page + dir;
    setPage(next);
    setExpanded(null);
    fetchLogs(next, category, statusFilter, dateFrom, dateTo);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    header: {
      display: 'flex', alignItems: 'center', gap: '.5rem',
      marginBottom: '1rem',
    },
    title: { fontSize: '1rem', fontWeight: 700, color: 'var(--text)', flex: 1 },
    subtitle: { fontSize: '.72rem', color: 'var(--text-muted)' },

    filterRow: {
      display: 'flex', gap: '.35rem', flexWrap: 'wrap',
      marginBottom: '.75rem', alignItems: 'center',
    },
    chip: (active) => ({
      padding: '.2rem .55rem', borderRadius: 99, fontSize: '.7rem', cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--text-muted)',
      fontWeight: active ? 600 : 400,
      transition: 'all .15s',
    }),

    meta: {
      fontSize: '.68rem', color: 'var(--text-muted)',
      marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem',
    },

    timeline: { display: 'flex', flexDirection: 'column', gap: 0 },

    row: (isExp) => ({
      display: 'flex', alignItems: 'flex-start', gap: '.7rem',
      padding: '.6rem 0',
      borderBottom: '1px solid var(--border)',
      cursor: 'pointer',
      background: isExp ? 'var(--bg-subtle, rgba(0,0,0,.03))' : 'transparent',
      borderRadius: isExp ? 6 : 0,
      paddingLeft: isExp ? '.5rem' : 0,
      transition: 'background .1s',
    }),

    iconWrap: (color) => ({
      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
      background: color + '22',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginTop: 2,
    }),

    rowBody: { flex: 1, minWidth: 0 },
    rowTop: { display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' },
    actionLabel: { fontSize: '.8rem', fontWeight: 600, color: 'var(--text)' },
    rowTime: { fontSize: '.68rem', color: 'var(--text-muted)', marginLeft: 'auto' },

    rowPath: {
      fontSize: '.68rem', color: 'var(--text-muted)',
      marginTop: '.15rem', fontFamily: 'monospace',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },

    detail: {
      marginTop: '.5rem', padding: '.6rem', borderRadius: 6,
      background: 'var(--bg-subtle, rgba(0,0,0,.04))',
      fontSize: '.7rem', color: 'var(--text-muted)',
    },
    detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem .8rem' },
    detailLabel: { fontWeight: 600, color: 'var(--text-muted)', fontSize: '.65rem', textTransform: 'uppercase' },
    detailValue: { color: 'var(--text)', wordBreak: 'break-all' },
    snapshotBox: {
      marginTop: '.4rem', padding: '.4rem', borderRadius: 4,
      background: 'rgba(0,0,0,.06)', fontFamily: 'monospace',
      fontSize: '.65rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      maxHeight: 120, overflowY: 'auto',
    },

    pagination: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: '.75rem', paddingTop: '.5rem', borderTop: '1px solid var(--border)',
      fontSize: '.75rem', color: 'var(--text-muted)',
    },
    pgBtn: (disabled) => ({
      display: 'flex', alignItems: 'center', gap: '.2rem',
      padding: '.25rem .5rem', borderRadius: 6, border: '1px solid var(--border)',
      background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? 'var(--text-muted)' : 'var(--text)',
      opacity: disabled ? .4 : 1, fontSize: '.75rem',
    }),

    empty: {
      textAlign: 'center', padding: '2rem 1rem',
      color: 'var(--text-muted)', fontSize: '.82rem',
    },
  };

  return (
    <Overlay onClose={onClose} wide label="Activity Log">
      {/* Header */}
      <div style={S.header}>
        <Activity size={16} strokeWidth={2} style={{ color: 'var(--accent)' }}/>
        <div>
          <div style={S.title}>Activity Log</div>
          <div style={S.subtitle}>{total} events recorded</div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={16}/>
        </button>
      </div>

      {/* Category filters */}
      <div style={S.filterRow}>
        <Filter size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}/>
        {CATEGORIES.map(c => (
          <button key={c.key} style={S.chip(category === c.key && !statusFilter)}
            onClick={() => applyFilter(c.key, '')}>
            {c.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.3rem' }}>
          <button style={S.chip(statusFilter === 'error')} onClick={() => applyFilter(category, statusFilter === 'error' ? '' : 'error')}>
            ⚠ Errors only
          </button>
        </div>
      </div>

      {/* Active filter summary */}
      {(category || statusFilter) && (
        <div style={{ ...S.meta, marginBottom: '.65rem' }}>
          Filtering:
          {category && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{category}</span>}
          {statusFilter && <span style={{ color: '#e57373', fontWeight: 600 }}>{statusFilter === 'error' ? 'errors only' : statusFilter}</span>}
          <button onClick={() => applyFilter('', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}>
            <X size={10}/> clear
          </button>
        </div>
      )}


      {/* Date range + Export */}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <Calendar size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
        <input type="date" className="fi" value={dateFrom}
          onChange={e => applyFilter(category, statusFilter, e.target.value, dateTo)}
          style={{ fontSize: '.72rem', padding: '.18rem .45rem', width: 'auto', flex: '1 1 120px', maxWidth: 160 }}
          title="From date"/>
        <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>→</span>
        <input type="date" className="fi" value={dateTo}
          onChange={e => applyFilter(category, statusFilter, dateFrom, e.target.value)}
          style={{ fontSize: '.72rem', padding: '.18rem .45rem', width: 'auto', flex: '1 1 120px', maxWidth: 160 }}
          title="To date"/>
        {(dateFrom || dateTo) && (
          <button onClick={() => applyFilter(category, statusFilter, '', '')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.7rem', display: 'flex', alignItems: 'center', gap: 2, padding: 0 }}>
            <X size={10}/> clear dates
          </button>
        )}
        <button onClick={exportCsv}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.3rem',
            padding: '.2rem .55rem', borderRadius: 99, fontSize: '.7rem', cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
            fontWeight: 500, transition: 'all .15s' }}
          title="Export current view as CSV">
          <Download size={11}/> Export CSV
        </button>
      </div>
      {/* Timeline */}
      {loading ? (
        <div style={S.empty}>Loading activity…</div>
      ) : logs.length === 0 ? (
        <div style={S.empty}>
          <Activity size={28} strokeWidth={1.2} style={{ margin: '0 auto .5rem', display: 'block', opacity: .3 }}/>
          No activity recorded yet.{' '}
          {category && 'Try clearing the filter.'}
        </div>
      ) : (
        <div style={S.timeline}>
          {logs.map(log => {
            const meta = getMeta(log.action);
            const { Icon } = meta;
            const isExp = expanded === log.id;

            return (
              <div key={log.id}>
                <div style={S.row(isExp)} onClick={() => setExpanded(isExp ? null : log.id)}>
                  {/* Icon */}
                  <div style={S.iconWrap(meta.color)}>
                    <Icon size={13} strokeWidth={2} style={{ color: meta.color }}/>
                  </div>

                  {/* Body */}
                  <div style={S.rowBody}>
                    <div style={S.rowTop}>
                      <span style={{ ...S.actionLabel, color: meta.color }}>{meta.label}</span>
                      {log.status_code && <StatusDot code={log.status_code}/>}
                      {log.duration_ms != null && (
                        <span style={{ fontSize: '.63rem', color: 'var(--text-muted)' }}>
                          {log.duration_ms}ms
                        </span>
                      )}
                      <span style={S.rowTime} title={fmtFull(log.created_at)}>
                        {fmtDate(log.created_at)}
                      </span>
                    </div>
                    <div style={S.rowPath}>{log.method} {log.path}</div>

                    {/* Expanded detail */}
                    {isExp && (
                      <div style={S.detail}>
                        <div style={S.detailGrid}>
                          <div>
                            <div style={S.detailLabel}>Timestamp</div>
                            <div style={S.detailValue}>{fmtFull(log.created_at)}</div>
                          </div>
                          {log.entity_id && (
                            <div>
                              <div style={S.detailLabel}>Entity ID</div>
                              <div style={S.detailValue}>{log.entity_id}</div>
                            </div>
                          )}
                          {log.ip_address && (
                            <div>
                              <div style={S.detailLabel}>IP Address</div>
                              <div style={S.detailValue}>{log.ip_address}</div>
                            </div>
                          )}
                          {log.duration_ms != null && (
                            <div>
                              <div style={S.detailLabel}>Duration</div>
                              <div style={S.detailValue}>{log.duration_ms}ms</div>
                            </div>
                          )}
                        </div>

                        {log.before_snapshot && (
                          <div style={{ marginTop: '.5rem' }}>
                            <div style={S.detailLabel}>Before</div>
                            <div style={S.snapshotBox}>
                              {JSON.stringify(log.before_snapshot, null, 2)}
                            </div>
                          </div>
                        )}
                        {log.after_snapshot && (
                          <div style={{ marginTop: '.5rem' }}>
                            <div style={S.detailLabel}>{log.before_snapshot ? 'After' : 'Payload'}</div>
                            <div style={S.snapshotBox}>
                              {JSON.stringify(log.after_snapshot, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={S.pagination}>
          <button style={S.pgBtn(page === 0)} disabled={page === 0} onClick={() => goPage(-1)}>
            <ChevronLeft size={13}/> Prev
          </button>
          <span>Page {page + 1} of {totalPages} &nbsp;·&nbsp; {total} total</span>
          <button style={S.pgBtn(page >= totalPages - 1)} disabled={page >= totalPages - 1} onClick={() => goPage(1)}>
            Next <ChevronRight size={13}/>
          </button>
        </div>
      )}
    </Overlay>
  );
}
