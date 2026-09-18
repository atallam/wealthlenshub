// MemberFormModal.jsx — the "Add / Edit Family Member" modal, extracted out of
// App.jsx (P3-5, step 3).
//
// Pure lift-and-shift, same convention as GoalFormModal.jsx / HoldingFormModal.jsx /
// AlertFormModal.jsx: state ownership (newMember, editingMemberId, modal) stays in
// App.jsx and is passed in as props.

const EMPTY_MEMBER = { name: '', relation: '', dob: '', email: '', nominee_name: '', nominee_relation: '' };

export default function MemberFormModal({
  modal, setModal,
  newMember, setNewMember, editingMemberId, setEditingMemberId,
  members,
  saveMember,
  Overlay, FG, MA,
}) {
  if (modal !== 'member') return null;

  const close = () => { setModal(null); setNewMember(EMPTY_MEMBER); setEditingMemberId(null); };

  return (
    <Overlay onClose={close} narrow>
      <div className="modtitle">{editingMemberId ? 'Edit Family Member' : 'Add Family Member'}</div>

      {/* ── Identity ── */}
      <div style={{fontSize:'.68rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'.5rem'}}>Identity</div>
      <FG label="Name">
        <input className="fi" placeholder="e.g. Priya" value={newMember.name}
          onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))}/>
      </FG>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(200px,100%),1fr))',gap:'.6rem'}}>
        <FG label="Relation">
          <select className="fi fs" value={newMember.relation} onChange={e => setNewMember(p => ({ ...p, relation: e.target.value }))}>
            {['Self','Spouse','Child','Parent','Sibling','Other'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </FG>
        <FG label="Date of birth">
          <input className="fi" type="date" value={newMember.dob || ''}
            onChange={e => setNewMember(p => ({ ...p, dob: e.target.value }))}/>
        </FG>
      </div>
      <FG label="PAN (optional)">
        <input className="fi" style={{textTransform:'uppercase',letterSpacing:'.08em'}} maxLength={10}
          placeholder={newMember.pan_masked ? `Saved: ${newMember.pan_masked} — type to replace` : 'e.g. ABCDE1234F'}
          value={newMember.pan || ''}
          onChange={e => setNewMember(p => ({ ...p, pan: e.target.value.toUpperCase() }))}/>
        <div style={{fontSize:'.65rem',color:'var(--text-muted)',marginTop:'.25rem'}}>
          Used for CAS import matching. Stored encrypted.
        </div>
      </FG>
      <FG label="Email (optional)">
        <input className="fi" type="email" placeholder="e.g. priya@gmail.com" value={newMember.email || ''}
          onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))}/>
      </FG>

      {/* ── Nominee ── */}
      <div style={{fontSize:'.68rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em',margin:'.85rem 0 .5rem'}}>Nominee</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(200px,100%),1fr))',gap:'.6rem'}}>
        <FG label="Nominee name">
          <input className="fi" placeholder="e.g. Rahul" value={newMember.nominee_name || ''}
            onChange={e => setNewMember(p => ({ ...p, nominee_name: e.target.value }))}/>
        </FG>
        <FG label="Nominee relation">
          <select className="fi fs" value={newMember.nominee_relation || ''} onChange={e => setNewMember(p => ({ ...p, nominee_relation: e.target.value }))}>
            <option value="">— Select —</option>
            {['Spouse','Child','Parent','Sibling','Other'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </FG>
      </div>

      <MA>
        <button className="btnc" onClick={close}>Cancel</button>
        <button className="btns" onClick={() => saveMember(newMember, editingMemberId, members, close)}>
          {editingMemberId ? 'Update' : 'Add Member'}
        </button>
      </MA>
    </Overlay>
  );
}
