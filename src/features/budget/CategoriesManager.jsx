import { useEffect, useState } from 'react';
import { useToast } from '../../components/shared/Toast.jsx';
import { GOLD, RED, SectionCard, fmtAmt } from './budgetShared.jsx';

// ── Per-member category limit field (migrations/0032) ──────────────
// Shown next to a category row when a specific family member is selected.
// Defaults to the shared family limit until the user sets an override; a
// ↺ button appears once one exists, to revert back to the shared value.
function MemberLimitField({ category, memberId, memberName, override, fb }) {
  const shared = category.monthly_limit || 0;
  const current = override ? override.monthly_limit : shared;
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(current); }, [current]);

  async function commit() {
    const n = Number(val) || 0;
    if (n === current) return;
    setSaving(true);
    try { await fb.setCategoryLimit(category.id, memberId, n); }
    catch (e) { console.error('setCategoryLimit', e); setVal(current); }
    setSaving(false);
  }
  async function reset() {
    setSaving(true);
    try { await fb.resetCategoryLimit(category.id, memberId, shared); }
    catch (e) { console.error('resetCategoryLimit', e); }
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
      <input className="fi" type="number" value={val || ''} placeholder={String(shared)}
        onChange={e => setVal(e.target.value)} onBlur={commit} disabled={saving}
        title={override ? `Custom limit for ${memberName}` : `Using shared limit (${fmtAmt(shared, true)}) — set one for ${memberName}`}
        style={{ width: 84, fontSize: '.7rem', padding: '.2rem .4rem', ...(override ? { borderColor: GOLD } : {}) }} />
      {override && (
        <button onClick={reset} disabled={saving} title={`Reset to shared limit (${fmtAmt(shared, true)})`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem' }}>↺</button>
      )}
    </div>
  );
}

// ── Categories Manager ────────────────────────────────────────────
export function CategoriesManager({ fb, members = [], selectedMember }) {
  const { fbCategories: cats, fbEditCat: editing, setFbEditCat, fbNewCat: newCat, setFbNewCat, saveCategory, deleteCategory, fbCatLimits } = fb;
  const toast = useToast();
  const memberName = selectedMember ? (members.find(m => m.id === selectedMember)?.name || 'this member') : null;

  const essential = cats.filter(c => c.is_essential);
  const discretionary = cats.filter(c => !c.is_essential);
  const total = cats.reduce((s, c) => s + (c.monthly_limit || 0), 0);

  return (
    <div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {cats.filter(c => c.monthly_limit > 0).length} categories with limits · Total budget: {fmtAmt(total)}
        {selectedMember && <> · setting limits for <strong style={{ color: 'var(--text)' }}>{memberName}</strong> (falls back to the shared limit until you set one)</>}
      </div>

      {/* Add new category inline */}
      <SectionCard title="New Category">
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="fi" placeholder="Name" value={newCat.name} onChange={e => setFbNewCat(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
          <input className="fi" placeholder="Icon 📦" value={newCat.icon} onChange={e => setFbNewCat(p => ({ ...p, icon: e.target.value }))} style={{ width: 60 }} />
          <input type="color" value={newCat.color} onChange={e => setFbNewCat(p => ({ ...p, color: e.target.value }))} style={{ width: 36, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer' }} />
          <input className="fi" type="number" placeholder="Monthly limit ₹" value={newCat.monthly_limit || ''} onChange={e => setFbNewCat(p => ({ ...p, monthly_limit: Number(e.target.value) }))} style={{ width: 130 }} />
          <input className="fi" placeholder="Keywords (comma-sep)" value={newCat.keywords} onChange={e => setFbNewCat(p => ({ ...p, keywords: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={newCat.is_essential || false} onChange={e => setFbNewCat(p => ({ ...p, is_essential: e.target.checked }))} />Essential
          </label>
          <button onClick={() => saveCategory(newCat, true)} disabled={!newCat.name}
            style={{ padding: '.4rem .9rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: newCat.name ? 'pointer' : 'not-allowed', fontSize: '.78rem' }}>
            + Add
          </button>
        </div>
      </SectionCard>

      {/* Essential vs Discretionary */}
      {[{ label: '✅ Essential', items: essential }, { label: '💸 Discretionary', items: discretionary }].map(({ label, items }) => (
        items.length > 0 && (
          <SectionCard key={label} title={label} badge={`${items.length}`}>
            {items.map(c => (
              editing?.id === c.id ? (
                <div key={c.id} style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', padding: '.4rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <input className="fi" value={editing.name} onChange={e => setFbEditCat(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 100 }} />
                  <input className="fi" value={editing.icon} onChange={e => setFbEditCat(p => ({ ...p, icon: e.target.value }))} style={{ width: 54 }} />
                  <input type="color" value={editing.color} onChange={e => setFbEditCat(p => ({ ...p, color: e.target.value }))} style={{ width: 32, height: 30, border: 'none', borderRadius: 5 }} />
                  <input className="fi" type="number" placeholder="Limit ₹" value={editing.monthly_limit || ''} onChange={e => setFbEditCat(p => ({ ...p, monthly_limit: Number(e.target.value) }))} style={{ width: 110 }} />
                  <input className="fi" placeholder="Keywords" value={editing.keywords || ''} onChange={e => setFbEditCat(p => ({ ...p, keywords: e.target.value }))} style={{ flex: 1, minWidth: 150 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.2rem', fontSize: '.72rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.is_essential || false} onChange={e => setFbEditCat(p => ({ ...p, is_essential: e.target.checked }))} />Essential
                  </label>
                  <button onClick={() => saveCategory(editing, false)} style={{ padding: '.3rem .7rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setFbEditCat(null)} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                </div>
              ) : (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color || GOLD, flexShrink: 0 }} />
                  <span style={{ fontSize: '.75rem', color: 'var(--text)', flex: 1 }}>{c.icon} {c.name}</span>
                  {selectedMember ? (
                    <MemberLimitField category={c} memberId={selectedMember} memberName={memberName} override={fbCatLimits[c.id]} fb={fb} />
                  ) : (
                    c.monthly_limit > 0 && <span style={{ fontSize: '.7rem', fontFamily: "'DM Mono',monospace", color: 'var(--text-muted)' }}>{fmtAmt(c.monthly_limit, true)}/mo</span>
                  )}
                  <button onClick={() => setFbEditCat({ ...c })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem' }}>✏️</button>
                  <button onClick={() => deleteCategory(c, toast.confirm)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: '.75rem' }}>🗑</button>
                </div>
              )
            ))}
          </SectionCard>
        )
      ))}
    </div>
  );
}
