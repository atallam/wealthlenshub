import { useEffect, useRef } from 'react';
import { AA_ENABLED } from '../../components/modals/ImportHub.jsx';
import { supabase } from '../../supabase.js';
import SetuAAImport from '../../SetuAAImport.jsx';
import { BLUE, GOLD, GREEN, PURPLE, RED } from './budgetShared.jsx';

// ── Import Wizard ─────────────────────────────────────────────────
export function ImportWizard({ fb, members }) {
  const { fbImportStep: step, setFbImportStep: setStep, fbUploadForm: form, setFbUploadForm: setForm,
    fbUploadFile: file, setFbUploadFile: setFile, fbUploading: uploading, fbUploadMsg: msg,
    fbUploadKind: kind, fbPdfPwNeeded: pdfPwNeeded, fbPdfPw: pdfPw, setFbPdfPw, fbPwAttempt,
    fbBanks: banks, loadBanks, uploadStatement, previewImport, fbStatements: statements, loadStatements } = fb;
  const dropRef = useRef(null);

  useEffect(() => { if (banks.length === 0) loadBanks(); if (statements.length === 0) loadStatements(); }, [banks.length, statements.length, loadBanks, loadStatements]);

  const regions = [...new Set(banks.map(b => b.region))].filter(Boolean).sort();
  const banksForRegion = form.region ? banks.filter(b => b.region === form.region) : [];

  function handleDrop(e) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }
  function handleDragOver(e) { e.preventDefault(); }

  const msgStyle = {
    '': { background: 'var(--bg-muted)', color: 'var(--text-muted)' },
    info: { background: BLUE + '18', color: BLUE },
    success: { background: GREEN + '18', color: GREEN },
    error: { background: RED + '18', color: RED },
    debug: { background: PURPLE + '18', color: PURPLE },
  }[kind] || {};

  const canUpload = form.member_id && form.region && form.bank_key && file;

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Step breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '1.5rem' }}>
        {['👤 Person', '🏦 Bank', '📤 Upload'].map((label, i) => {
          const n = i + 1, active = step === n, done = step > n;
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => done && setStep(n)} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.35rem .7rem', borderRadius: 20, border: `1.5px solid ${active ? GOLD : done ? GREEN : 'var(--border)'}`, background: active ? GOLD + '20' : 'transparent', color: active ? GOLD : done ? GREEN : 'var(--text-muted)', fontSize: '.72rem', fontWeight: active ? 700 : 400, cursor: done ? 'pointer' : 'default' }}>
                {done ? '✓' : n} {label}
              </button>
              {i < 2 && <div style={{ width: 24, height: 1, background: done ? GREEN : 'var(--border)' }} />}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Person */}
      {step === 1 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Who does this statement belong to?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {members.map(m => (
              <button key={m.id} onClick={() => { setForm(p => ({ ...p, member_id: m.id })); setStep(2); }}
                style={{ display: 'flex', alignItems: 'center', gap: '.8rem', padding: '.75rem 1rem', borderRadius: 10, border: `1.5px solid ${form.member_id === m.id ? GOLD : 'var(--border)'}`, background: form.member_id === m.id ? GOLD + '15' : 'var(--bg-card)', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: GOLD + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>{m.avatar || m.name?.charAt(0)}</span>
                <span style={{ fontSize: '.85rem', fontWeight: 500 }}>{m.name}</span>
                {form.member_id === m.id && <span style={{ marginLeft: 'auto', color: GOLD }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — Bank */}
      {step === 2 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Select bank / card</div>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
            <select className="fi fs" value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value, bank_key: '' }))} style={{ flex: 1, minWidth: 140 }}>
              <option value="">— Region —</option>
              <option value="AUTO">Auto-detect</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.region && form.region !== 'AUTO' && (
              <select className="fi fs" value={form.bank_key} onChange={e => setForm(p => ({ ...p, bank_key: e.target.value }))} style={{ flex: 1, minWidth: 160 }}>
                <option value="">— Bank —</option>
                {banksForRegion.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            )}
            {form.region === 'AUTO' && !form.bank_key && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Bank will be auto-detected from the file</div>}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
            {['BANK', 'CREDIT_CARD'].map(t => (
              <button key={t} onClick={() => setForm(p => ({ ...p, statement_type: t }))}
                style={{ padding: '.35rem .8rem', borderRadius: 6, border: `1.5px solid ${form.statement_type === t ? GOLD : 'var(--border)'}`, background: form.statement_type === t ? GOLD + '20' : 'transparent', color: form.statement_type === t ? GOLD : 'var(--text-muted)', fontSize: '.72rem', cursor: 'pointer' }}>
                {t === 'BANK' ? '🏦 Bank Account' : '💳 Credit Card'}
              </button>
            ))}
          </div>
          <input className="fi fs" placeholder="Custom label (optional, e.g. 'Axis Salary Account')" value={form.custom_label} onChange={e => setForm(p => ({ ...p, custom_label: e.target.value }))} style={{ width: '100%', marginBottom: '.5rem' }} />
          <button onClick={() => setStep(3)} disabled={!form.region} style={{ padding: '.5rem 1.2rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: form.region ? 'pointer' : 'not-allowed', opacity: form.region ? 1 : .5, fontSize: '.82rem' }}>
            Next →
          </button>

          {AA_ENABLED && (<>
          {/* ── Account Aggregator shortcut ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '1rem' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>or connect directly</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <button
            onClick={() => { setForm(p => ({ ...p, region: 'SETU', bank_key: 'SETU_AA', statement_type: 'BANK' })); setStep(3); }}
            style={{ width: '100%', marginTop: '.6rem', padding: '.6rem 1rem', borderRadius: 10, border: '1.5px solid rgba(76,175,154,.4)', background: 'rgba(76,175,154,.06)', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.7rem', fontSize: '.82rem' }}>
            <span style={{ fontSize: '1.2rem' }}>🔗</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, color: '#4caf9a' }}>Account Aggregator (Setu)</div>
              <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: 1 }}>RBI-regulated · auto-fetches bank &amp; credit card transactions</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>→</span>
          </button>
          </>)}
        </div>
      )}

      {/* Step 3 — Upload (or Setu AA) */}
      {step === 3 && (
        <div>
          {/* If Setu AA selected → SetuAAImport in budget mode */}
          {form.bank_key === 'SETU_AA' ? (
            <SetuAAImport
              mode="budget"
              members={members}
              api={async (url, opts = {}) => {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;
                const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Request failed');
                return d;
              }}
              onClose={() => { setForm(p => ({ ...p, bank_key: '', region: '' })); setStep(2); }}
              onImported={() => { fb.loadStatements(); setStep(1); setForm(p => ({ ...p, bank_key: '', region: '' })); }}
            />
          ) : (
            <>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.8rem', fontSize: '.9rem' }}>Upload statement file</div>

          {/* Drag-drop zone */}
          <div ref={dropRef} onDrop={handleDrop} onDragOver={handleDragOver}
            onClick={() => document.getElementById('fb-file-input').click()}
            style={{ border: `2px dashed ${file ? GREEN : 'var(--border)'}`, borderRadius: 12, padding: '2rem', textAlign: 'center', cursor: 'pointer', background: file ? GREEN + '08' : 'var(--bg-muted)', marginBottom: '.75rem', transition: 'all .2s' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.4rem' }}>{file ? '✅' : '📂'}</div>
            <div style={{ fontSize: '.8rem', color: file ? GREEN : 'var(--text-muted)' }}>
              {file ? file.name : 'Drop file here or click to browse'}
            </div>
            <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>CSV · XLSX · PDF · up to 20 MB</div>
          </div>
          <input id="fb-file-input" type="file" accept=".csv,.xlsx,.xls,.pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />

          {/* PDF password */}
          {pdfPwNeeded && (
            <div style={{ marginBottom: '.75rem' }}>
              <input key={fbPwAttempt} type="password" className="fi fs" autoFocus placeholder="PDF password" value={pdfPw} onChange={e => setFbPdfPw(e.target.value)} style={{ width: '100%' }} />
            </div>
          )}

          {/* Status message */}
          {msg && (
            <div style={{ ...msgStyle, borderRadius: 8, padding: '.6rem .9rem', fontSize: '.75rem', marginBottom: '.75rem', whiteSpace: 'pre-wrap', fontFamily: kind === 'debug' ? "'DM Mono',monospace" : 'inherit' }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => previewImport(file, form, pdfPw)} disabled={!file || uploading}
              style={{ padding: '.45rem 1rem', border: `1px solid ${BLUE}`, borderRadius: 8, background: 'transparent', color: BLUE, fontSize: '.78rem', cursor: 'pointer', opacity: file ? 1 : .5 }}>
              🔍 Preview
            </button>
            <button onClick={() => uploadStatement(file, form, pdfPw)} disabled={!canUpload || uploading}
              style={{ padding: '.45rem 1.2rem', background: canUpload && !uploading ? GOLD : 'var(--bg-muted)', color: canUpload ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: canUpload && !uploading ? 'pointer' : 'not-allowed', fontSize: '.82rem' }}>
              {uploading ? '⏳ Importing…' : '📥 Import'}
            </button>
            <button onClick={() => { setStep(1); setFile(null); fb.setFbUploadMsg(''); }}
              style={{ padding: '.45rem .8rem', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', fontSize: '.75rem', cursor: 'pointer' }}>
              Start over
            </button>
          </div>
            </>
          )}
        </div>
      )}

      {/* Recent imports */}
      {statements.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '.6rem', fontSize: '.8rem' }}>Recent imports</div>
          {statements.slice(0, 6).map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '.75rem' }}>
              <span style={{ flex: 1, color: 'var(--text-dim)' }}>{s.source} {s.custom_label ? `· ${s.custom_label}` : ''}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '.68rem' }}>{s.txn_count} txns</span>
              <span style={{ color: s.member_id ? 'var(--text-muted)' : RED, fontSize: '.65rem' }}>
                {s.member_id ? '👤' : '⚠️ unassigned'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
