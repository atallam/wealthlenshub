import { Download } from 'lucide-react';
import { Overlay } from '../shared/Overlay.jsx';

/**
 * ImportHub — single entry point for every import source.
 * Config-driven so adding a source is one array entry (previously this was
 * ~65 lines of repeated inline JSX in App.jsx). Also surfaces Zerodha Kite and
 * ICICI Breeze, which were previously reachable only via orphaned overlays.
 *
 * Props:
 *   onClose()      – close the hub
 *   onSelect(key)  – user picked a source; App maps the key to an action
 */
const SECTIONS = [
  {
    label: '🇮🇳 India',
    items: [
      { key: 'cas',    icon: '📄', title: 'NSDL / CDSL CAS',     desc: 'Import all mutual funds & demat holdings from your CAS PDF' },
      { key: 'kite',   icon: '📈', title: 'Zerodha Kite',        desc: 'Live-sync equity & mutual fund holdings from Zerodha' },
      { key: 'breeze', icon: '📊', title: 'ICICI Direct (Breeze)', desc: 'Live-sync holdings from your ICICI Direct account' },
      { key: 'fd',     icon: '🏦', title: 'Fixed Deposit (FD)',  desc: 'Scan certificate with AI vision or enter details manually' },
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

export default function ImportHub({ onClose, onSelect }) {
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
              <button
                key={it.key}
                className="btn-o import-hub-row"
                style={{ justifyContent: 'flex-start', gap: '.65rem', padding: '.55rem .9rem', fontSize: '.82rem' }}
                onClick={() => pick(it.key)}
              >
                <span style={{ fontSize: '1rem' }} aria-hidden="true">{it.icon}</span>
                <span>
                  <span style={{ fontWeight: 600 }}>{it.title}</span>
                  <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '.1rem' }}>{it.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Overlay>
  );
}
