// MembersTab.jsx — Family Profiles
// Identity-first view: PAN, DOB, nominee, email per member.
// Portfolio drill-down lives in Holdings (use the member filter bar above tabs).

import { useState } from 'react';
import { computeOutstanding } from '../../lib/amortization.js';

function fmtShort(n) {
  if (!n) return '—';
  const v = +n;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

function calcAge(dob) {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 864e5));
}

function fmtDob(dob) {
  if (!dob) return null;
  return new Date(dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function maskPan(pan) {
  if (!pan || pan.length < 4) return pan;
  return pan.slice(0, 2) + '•••••' + pan.slice(-3);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MembersTab({
  mSum,
  allHoldings,
  holdings,
  members,
  liabilities,
  valINRCache,
  openMemberModal,
  setMemberAction,
  deleteMember,
  mergeMembers,
  memberAction,
  fmt,
  fmtPct,
  AT,
  Overlay,
  FG,
  MA,
  onViewHoldings,
}) {
  const now = new Date();
  const allLiabilities = liabilities || [];
  const [revealedPan, setRevealedPan] = useState(new Set());

  function togglePan(id) {
    setRevealedPan(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.2rem' }}>
        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.1rem', color:'var(--text)' }}>Family Profiles</div>
        <button className="btn-sm" onClick={() => openMemberModal(null)}>+ Add Member</button>
      </div>

      {mSum.length === 0 && (
        <div className="empty">No family members yet. Add one to start tracking profiles and holdings per person.</div>
      )}

      {mSum.map(m => {
        const holdingCount = allHoldings.filter(h => h.member_id === m.id).length;
        const memberLiabs  = allLiabilities.filter(l => l.member_id === m.id);
        const totalLiab    = memberLiabs.reduce((s, l) => s + computeOutstanding(l, now), 0);
        const age          = calcAge(m.dob);
        const panRevealed  = revealedPan.has(m.id);
        const panDisplay   = m.pan_masked || (m.pan ? maskPan(m.pan) : null);

        return (
          <div key={m.id} className="card" style={{ marginBottom:'1rem' }}>

            {/* Profile header */}
            <div style={{ display:'flex', alignItems:'flex-start', gap:'.85rem', marginBottom:'1rem' }}>
              <div className="av" style={{ width:44, height:44, fontSize:'1.1rem', flexShrink:0 }}>{m.name[0]}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'1.2rem', color:'var(--text)', lineHeight:1.2 }}>{m.name}</div>
                <div style={{ fontSize:'.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.07em', marginTop:'.15rem' }}>
                  {m.relation}{age != null ? ` · ${age} yrs` : ''}
                </div>
              </div>
              <div style={{ display:'flex', gap:'.3rem', flexShrink:0 }}>
                <button className="delbtn" title="Edit" aria-label="Edit member"
                  onClick={() => openMemberModal(m.id)}
                  style={{ color:'var(--text-muted)', fontSize:'.78rem' }}>✏️</button>
                {members.length > 1 && holdingCount > 0 && (
                  <button className="delbtn" title="Merge" aria-label="Merge member"
                    onClick={() => setMemberAction({ type:'merge', memberId:m.id, reassignTo:'' })}
                    style={{ color:'rgba(160,132,202,.6)', fontSize:'.78rem' }}>🔗</button>
                )}
                <button className="delbtn" title="Delete" aria-label="Delete member"
                  onClick={() => setMemberAction({ type:'delete', memberId:m.id, reassignTo:'' })}
                  style={{ color:'rgba(224,124,90,.5)', fontSize:'.78rem' }}>🗑️</button>
              </div>
            </div>

            {/* Identity details */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'.55rem .75rem', marginBottom:'1rem' }}>

              {m.dob && (
                <div>
                  <div style={{ fontSize:'.6rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.2rem' }}>Date of birth</div>
                  <div style={{ fontSize:'.78rem', color:'var(--text)' }}>{fmtDob(m.dob)}</div>
                </div>
              )}

              {panDisplay && (
                <div>
                  <div style={{ fontSize:'.6rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.2rem' }}>PAN</div>
                  <div style={{ display:'flex', alignItems:'center', gap:'.4rem' }}>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'.78rem', color:'var(--text)', letterSpacing:'.05em' }}>
                      {panRevealed ? (m.pan || panDisplay) : maskPan(panDisplay)}
                    </div>
                    <button onClick={() => togglePan(m.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:'.65rem', color:'var(--text-muted)', padding:'.1rem .25rem', borderRadius:3, lineHeight:1 }}
                      title={panRevealed ? 'Hide PAN' : 'Reveal PAN'}>
                      {panRevealed ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              )}

              {m.email && (
                <div>
                  <div style={{ fontSize:'.6rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.2rem' }}>Email</div>
                  <div style={{ fontSize:'.78rem', color:'var(--text)', wordBreak:'break-all' }}>{m.email}</div>
                </div>
              )}

              {m.nominee_name && (
                <div>
                  <div style={{ fontSize:'.6rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:'.2rem' }}>Nominee</div>
                  <div style={{ fontSize:'.78rem', color:'var(--text)' }}>
                    {m.nominee_name}{m.nominee_relation ? ` (${m.nominee_relation})` : ''}
                  </div>
                </div>
              )}
            </div>

            {/* Portfolio quick stats + View Holdings link */}
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:'.7rem', display:'flex', alignItems:'center', gap:'.6rem', flexWrap:'wrap' }}>
              <div style={{ display:'flex', gap:'.45rem', flex:1, flexWrap:'wrap' }}>
                <div style={{ background:'var(--bg-muted)', borderRadius:6, padding:'.28rem .55rem' }}>
                  <div style={{ fontSize:'.58rem', color:'var(--text-muted)', marginBottom:'.1rem' }}>Portfolio</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'.78rem', color:'#c9a84c' }}>{fmt(m.cur)}</div>
                </div>
                {holdingCount > 0 && (
                  <div style={{ background:'var(--bg-muted)', borderRadius:6, padding:'.28rem .55rem' }}>
                    <div style={{ fontSize:'.58rem', color:'var(--text-muted)', marginBottom:'.1rem' }}>Holdings</div>
                    <div style={{ fontSize:'.78rem', color:'var(--text)' }}>{holdingCount}</div>
                  </div>
                )}
                {totalLiab > 0 && (
                  <div style={{ background:'rgba(224,124,90,.06)', border:'1px solid rgba(224,124,90,.18)', borderRadius:6, padding:'.28rem .55rem' }}>
                    <div style={{ fontSize:'.58rem', color:'var(--text-muted)', marginBottom:'.1rem' }}>Liabilities</div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'.78rem', color:'#e07c5a' }}>{fmtShort(totalLiab)}</div>
                  </div>
                )}
              </div>

              {holdingCount > 0 && onViewHoldings && (
                <button onClick={() => onViewHoldings(m.id)}
                  style={{ fontSize:'.72rem', padding:'.28rem .6rem', background:'rgba(201,168,76,.08)', border:'1px solid rgba(201,168,76,.22)', borderRadius:6, color:'#c9a84c', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
                  View holdings →
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Delete / Merge confirmation modal */}
      {memberAction && (() => {
        const m = members.find(x => x.id === memberAction.memberId);
        if (!m) return null;
        const holdingCount = holdings.filter(h => h.member_id === m.id).length;
        const otherMembers = members.filter(x => x.id !== m.id);
        const isDelete     = memberAction.type === 'delete';

        return (
          <Overlay onClose={() => setMemberAction(null)} narrow>
            <div className="modtitle">{isDelete ? '🗑️' : '🔗'} {isDelete ? `Delete "${m.name}"` : `Merge "${m.name}"`}</div>
            <div style={{ fontSize:'.8rem', color:'var(--text-dim)', marginBottom:'1rem', lineHeight:1.6 }}>
              {isDelete
                ? holdingCount > 0
                  ? `This member has ${holdingCount} holding${holdingCount > 1 ? 's' : ''}. Choose a member to reassign them to, or leave empty to unassign.`
                  : 'No holdings are assigned to this member.'
                : `Move all ${holdingCount} holding${holdingCount > 1 ? 's' : ''} from "${m.name}" to another member, then remove "${m.name}".`}
            </div>
            {(holdingCount > 0 || !isDelete) && otherMembers.length > 0 && (
              <FG label={isDelete ? 'Reassign holdings to' : 'Merge into'}>
                <select className="fi fs" value={memberAction.reassignTo}
                  onChange={e => setMemberAction(p => ({ ...p, reassignTo: e.target.value }))}>
                  {isDelete && <option value="">— Leave unassigned —</option>}
                  {!isDelete && <option value="">Select a member…</option>}
                  {otherMembers.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name}{o.relation ? ` (${o.relation})` : ''} — {holdings.filter(h => h.member_id === o.id).length} holdings
                    </option>
                  ))}
                </select>
              </FG>
            )}
            {holdingCount > 0 && memberAction.reassignTo && (
              <div style={{ background:'rgba(76,175,154,.08)', border:'1px solid rgba(76,175,154,.25)', borderRadius:8, padding:'.6rem .8rem', marginBottom:'.8rem', fontSize:'.73rem', color:'#4caf9a' }}>
                ✓ {holdingCount} holding{holdingCount > 1 ? 's' : ''} will be moved to <strong>{otherMembers.find(o => o.id === memberAction.reassignTo)?.name}</strong>
              </div>
            )}
            <MA>
              <button className="btnc" onClick={() => setMemberAction(null)}>Cancel</button>
              <button className="btns"
                disabled={!isDelete && !memberAction.reassignTo}
                style={isDelete ? { background:'rgba(224,124,90,.14)', borderColor:'rgba(224,124,90,.5)', color:'#e07c5a' } : {}}
                onClick={async () => {
                  if (isDelete) await deleteMember(m.id, memberAction.reassignTo || null);
                  else          await mergeMembers(m.id, memberAction.reassignTo);
                  setMemberAction(null);
                }}>
                {isDelete ? 'Delete Member' : 'Merge Members'}
              </button>
            </MA>
          </Overlay>
        );
      })()}
    </>
  );
}
