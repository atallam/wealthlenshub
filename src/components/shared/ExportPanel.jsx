/**
 * ExportPanel.jsx — One-click export dropdown.
 *
 * Wires up to the existing server routes:
 *   GET /api/export/holdings      → CSV
 *   GET /api/export/transactions  → CSV
 *   GET /api/export/xlsx          → Excel (multi-sheet: Holdings, Transactions, FDs, Summary)
 *   GET /api/export/report        → HTML report (browser print → PDF)
 *
 * Renders as a small "Export" button with a dropdown. Works standalone
 * in the header (hdr-extra class) or anywhere else.
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Table2, X } from 'lucide-react';
import { supabase } from '../../supabase.js';

async function getToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  } catch { return ''; }
}

async function triggerDownload(path, filename) {
  const token = await getToken();
  const res   = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob  = await res.blob();
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function openReport() {
  const token = await getToken();
  const res   = await fetch('/api/export/report', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Report failed');
  const html  = await res.text();
  const blob  = new Blob([html], { type: 'text/html' });
  const url   = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

const today = () => new Date().toISOString().slice(0, 10);

const EXPORTS = [
  {
    key:   'xlsx',
    label: 'Full Portfolio Excel',
    sub:   'Holdings, Transactions, FDs + Summary sheet',
    Icon:  FileSpreadsheet,
    color: '#4caf9a',
    action: () => triggerDownload('/api/export/xlsx', `wealthlens-portfolio-${today()}.xlsx`),
  },
  {
    key:   'report',
    label: 'Portfolio PDF Report',
    sub:   'Print-ready HTML — use browser Print → Save as PDF',
    Icon:  FileText,
    color: '#c9a84c',
    action: openReport,
  },
  {
    key:   'csv-h',
    label: 'Holdings CSV',
    sub:   'Raw holdings data with gains & XIRR',
    Icon:  Table2,
    color: '#5a9ce0',
    action: () => triggerDownload('/api/export/holdings', `wealthlens-holdings-${today()}.csv`),
  },
  {
    key:   'csv-t',
    label: 'Transactions CSV',
    sub:   'Full buy/sell/dividend history',
    Icon:  Table2,
    color: '#a084ca',
    action: () => triggerDownload('/api/export/transactions', `wealthlens-transactions-${today()}.csv`),
  },
];

export default function ExportPanel({ className = 'btn-o hdr-extra' }) {
  const [open,   setOpen]   = useState(false);
  const [status, setStatus] = useState({}); // { [key]: 'loading' | 'done' | 'error' }
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleExport(exp) {
    if (status[exp.key] === 'loading') return;
    setStatus(p => ({ ...p, [exp.key]: 'loading' }));
    try {
      await exp.action();
      setStatus(p => ({ ...p, [exp.key]: 'done' }));
      setTimeout(() => setStatus(p => ({ ...p, [exp.key]: undefined })), 3000);
    } catch (e) {
      console.error('Export error:', e);
      setStatus(p => ({ ...p, [exp.key]: 'error' }));
      setTimeout(() => setStatus(p => ({ ...p, [exp.key]: undefined })), 4000);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={className}
        onClick={() => setOpen(p => !p)}
        title="Export portfolio data"
        aria-label="Export"
      >
        <Download size={13} strokeWidth={2} />
        <span style={{ marginLeft: '.3rem' }}>Export</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 280, maxWidth: '92vw',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.22)',
          zIndex: 9999, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.6rem .85rem', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--text)' }}>Export Portfolio Data</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>

          {/* Options */}
          {EXPORTS.map((exp, i) => {
            const st = status[exp.key];
            return (
              <button
                key={exp.key}
                onClick={() => handleExport(exp)}
                disabled={st === 'loading'}
                style={{
                  width: '100%', background: st === 'done' ? 'rgba(76,175,154,.06)' : 'none',
                  border: 'none', cursor: st === 'loading' ? 'wait' : 'pointer',
                  borderBottom: i < EXPORTS.length - 1 ? '1px solid var(--border)' : 'none',
                  padding: '.65rem .85rem', textAlign: 'left',
                  display: 'flex', alignItems: 'flex-start', gap: '.65rem',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { if (st !== 'loading') e.currentTarget.style.background = 'var(--bg-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = st === 'done' ? 'rgba(76,175,154,.06)' : 'none'; }}
              >
                <exp.Icon size={15} strokeWidth={1.8} style={{ color: exp.color, marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.75rem', color: 'var(--text)', fontWeight: 500, lineHeight: 1.3 }}>
                    {st === 'loading' ? 'Preparing…' : st === 'done' ? '✓ Downloaded' : st === 'error' ? '⚠ Failed — try again' : exp.label}
                  </div>
                  <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.12rem' }}>{exp.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
