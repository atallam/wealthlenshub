// SourceStatus.jsx — reusable connection-status banner for import sources.
//
// P4-2 groundwork (2026-09-18): this component is NEW and UNUSED — it is not
// yet wired into ImportHub.jsx or any route. Building it standalone first so
// it can be reviewed/tested on its own before anything that renders it today
// is touched. Wiring it in means: (a) each source (SnapTrade, Setu, Plaid,
// Gmail auto-import) needs a status-check call added to ImportHub, and
// (b) ImportHub's per-row UI needs to render this banner under the matching
// item — both un-verifiable without a running app, so left for a session with
// `npm run dev`. See RESTRUCTURE_PLAN.md's P4-2 entry for the wiring plan.
//
// Status → existing endpoint (for the future wiring step, not implemented here):
//   SnapTrade → GET /api/snaptrade/connections  (array; each has authorization_id, status)
//   Setu AA   → GET /api/setu/connections       (array; each has status via joined setu_consents)
//   Plaid     → GET /api/plaid/status           ({ connections: [...] }, each has status/error_code)
//   Gmail     → profile.gmail_auto_import + profile.gmail_token (no dedicated status route yet)

/**
 * @param {'connected'|'needs_reauth'|'not_connected'|'error'} status
 * @param {string}   [lastSyncedAt]  ISO date string — shown when status === 'connected'
 * @param {string}   [detail]        extra context, e.g. institution/brokerage name
 * @param {string}   [errorMessage]  shown when status === 'error'
 * @param {string}   [actionLabel]   button text, e.g. "Reconnect" / "Connect"
 * @param {Function} [onAction]      click handler for the action button; omit to hide it
 */
export default function SourceStatus({
  status,
  lastSyncedAt,
  detail,
  errorMessage,
  actionLabel,
  onAction,
}) {
  const STYLES = {
    connected:     { icon: '✓', color: '#4caf9a', bg: 'rgba(76,175,154,.08)',  border: 'rgba(76,175,154,.25)' },
    needs_reauth:  { icon: '⚠', color: '#f0a050', bg: 'rgba(240,160,80,.08)',  border: 'rgba(240,160,80,.3)' },
    error:         { icon: '✕', color: '#e07c5a', bg: 'rgba(224,124,90,.08)', border: 'rgba(224,124,90,.3)' },
    not_connected: { icon: '○', color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border)' },
  };
  const s = STYLES[status] || STYLES.not_connected;

  const lastSyncedText = (() => {
    if (status !== 'connected' || !lastSyncedAt) return null;
    const d = new Date(lastSyncedAt);
    if (Number.isNaN(d.getTime())) return null;
    return `Last synced ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  })();

  const primaryText = {
    connected:     detail ? `Connected · ${detail}` : 'Connected',
    needs_reauth:  detail ? `Needs reconnection · ${detail}` : 'Needs reconnection',
    error:         errorMessage || 'Connection error',
    not_connected: 'Not connected',
  }[status] || 'Not connected';

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '.55rem',
        padding: '.45rem .7rem', borderRadius: 8,
        background: s.bg, border: `1px solid ${s.border}`,
        fontSize: '.72rem',
      }}
    >
      <span aria-hidden="true" style={{ color: s.color, fontWeight: 700, fontSize: '.8rem', lineHeight: 1 }}>
        {s.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {primaryText}
        </div>
        {lastSyncedText && (
          <div style={{ color: 'var(--text-muted)', marginTop: '.1rem' }}>{lastSyncedText}</div>
        )}
      </div>
      {onAction && actionLabel && (
        <button
          type="button"
          className="btn-o"
          style={{ fontSize: '.68rem', padding: '.3rem .6rem', flexShrink: 0 }}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
