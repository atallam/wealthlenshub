import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Overlay } from '../shared/Overlay.jsx';
import SourceStatus from '../shared/SourceStatus.jsx';

/**
 * ImportHub — single entry point for every import source.
 * Config-driven so adding a source is one array entry.
 *
 * Props:
 *   onClose()      – close the hub
 *   onSelect(key)  – user picked a source; App maps the key to an action
 *   api            – shared authenticated fetch helper (src/lib/api.js), optional.
 *                    When present, ImportHub fetches connection status for the
 *                    sources that have one (SnapTrade, Setu AA) and shows a
 *                    <SourceStatus> banner under that row. One-shot import
 *                    sources (CAS, FD, CSV, manual) have no persistent
 *                    connection, so they never get a banner.
 */
const SECTIONS = [
  {
    label: '🇮🇳 India',
    items: [
      { key: 'cas',    icon: '📄', title: 'NSDL / CDSL CAS',     desc: 'Import all mutual funds & demat holdings from your CAS PDF' },
      { key: 'fd',     icon: '🏦', title: 'Fixed Deposit (FD)',  desc: 'Scan certificate with AI vision or enter details manually' },
      { key: 'setu',   icon: '🔗', title: 'Account Aggregator',  desc: 'RBI-regulated · fetch bank balances, FD, MF & stocks via Setu AA' },
    ],
  },
  {
    label: '🇺🇸 US / Global',
    items: [
      { key: 'snaptrade', icon: '📥', title: 'SnapTrade — US Brokers', desc: 'Connect Schwab, Fidelity, Robinhood & more' },
    ],
  },
  {
    label: 'Manual / CSV',
    items: [
      { key: 'csv',    icon: '📊', title: 'CSV / Excel Import', desc: 'Upload a spreadsheet of holdings or transactions' },
      { key: 'manual', icon: '✏️', title: 'Add Manually',       desc: 'Enter a single holding — stocks, MF, crypto, FD, PPF, EPF…' },
    ],
  },
];

// Sources with a persistent connection worth showing a status banner for.
// CAS/FD/CSV/manual are one-shot imports with nothing to report — skipped.
const STATUS_KEYS = ['snaptrade', 'setu'];

async function fetchSnapTradeStatus(api) {
  try {
    const data = await api('/api/snaptrade/connections');
    const conns = data?.connections || [];
    const active = conns.find(c => c.status === 'active');
    if (active) return { status: 'connected', detail: active.brokerage || undefined };
    if (conns.length > 0) return { status: 'needs_reauth', detail: conns[0].brokerage || undefined };
    return { status: 'not_connected' };
  } catch {
    // Covers both "no connection registered yet" (the backend's normal error
    // for that case) and any transient failure — either way, not worth
    // alarming the user with an "error" banner before they've even tried.
    return { status: 'not_connected' };
  }
}

async function fetchSetuStatus(api) {
  try {
    const st = await api('/api/setu/status');
    if (!st?.configured || st?.disabled) return null; // AA not enabled on this deployment — no banner
    const data = await api('/api/setu/connections');
    const conns = data?.connections || [];
    const active = conns.find(c => c.status === 'active');
    if (active) {
      const detail = Array.isArray(active.institution_names) && active.institution_names.length
        ? active.institution_names.join(', ')
        : undefined;
      return { status: 'connected', detail, lastSyncedAt: active.last_synced_at || undefined };
    }
    if (conns.length > 0) return { status: 'needs_reauth' };
    return { status: 'not_connected' };
  } catch {
    return null; // don't show a banner we can't back up
  }
}

export default function ImportHub({ onClose, onSelect, api }) {
  const [statusMap, setStatusMap] = useState({});

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      const [snaptrade, setu] = await Promise.all([fetchSnapTradeStatus(api), fetchSetuStatus(api)]);
      if (!cancelled) setStatusMap({ snaptrade, setu });
    })();
    return () => { cancelled = true; };
  }, [api]);

  const pick = (key) => { onSelect(key); onClose(); };
  return (
    <Overlay onClose={onClose} label="Import holdings">
      <div className="modtitle" style={{ marginBottom: '1.4rem' }}>
        <Download size={16} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '.45rem' }} />
        Import Holdings
      </div>

      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div style={{ fontSize: '.65rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '.5rem' }}>
            {section.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem', marginBottom: '1.1rem' }}>
            {section.items.map((it) => (
              <div key={it.key}>
                <button
                  className="btn-o import-hub-row"
                  style={{ justifyContent: 'flex-start', gap: '.65rem', padding: '.55rem .9rem', fontSize: '.82rem', width: '100%' }}
                  onClick={() => pick(it.key)}
                >
                  <span style={{ fontSize: '1rem' }} aria-hidden="true">{it.icon}</span>
                  <span>
                    <span style={{ fontWeight: 600 }}>{it.title}</span>
                    <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '.1rem' }}>{it.desc}</span>
                  </span>
                </button>
                {STATUS_KEYS.includes(it.key) && statusMap[it.key] && (
                  <div style={{ marginTop: '.35rem' }}>
                    <SourceStatus {...statusMap[it.key]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Overlay>
  );
}
