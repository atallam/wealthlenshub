// GoalFormModal.jsx — the "Add / Edit Goal" modal, extracted out of App.jsx (P3-5).
//
// This is a pure lift-and-shift: the JSX and logic are unchanged from the inline
// block that used to live in App.jsx's render (the `modal === 'goal'` branch).
// State ownership (goalForm, editGoalId, modal) stays in App.jsx and is passed in
// as props — this extraction only moves markup/layout out, it does not move state,
// so it carries much lower risk than a full useState migration would.
//
// Renders null when the goal modal isn't open, so it's safe to mount unconditionally.

import { BG } from '../../constants.js';

export default function GoalFormModal({
  modal, setModal,
  goalForm, setGoalForm,
  editGoalId, setEditGoalId,
  members, AT, allHoldings, valINRCache, goals,
  addGoal,
  Overlay, FG, MA, FmtInput, HoldingsPicker,
}) {
  if (modal !== 'goal') return null;

  // Live "what would this goal count today" preview — mirrors goalCur() in GoalsTab.jsx
  const lt = goalForm.linkedTypes    || [];
  const lm = goalForm.linkedMembers  || ['all'];
  const lh = new Set(goalForm.linkedHoldingIds || []);
  const memberH = lm.includes('all') || lm.length === 0
    ? allHoldings
    : allHoldings.filter(h => lm.includes(h.member_id));
  const typeSet = new Set(lt);
  const typeMatched = new Set(
    (lt.length > 0 ? memberH.filter(h => typeSet.has(h.type)) : memberH).map(h => h.id)
  );
  const matchedIds = new Set([...typeMatched, ...lh]);
  const matchedHoldings = allHoldings.filter(h => matchedIds.has(h.id));
  const previewVal = matchedHoldings.reduce((s, h) => s + (valINRCache.get(h.id) || 0), 0);
  const isEntirePortfolio = lt.length === 0 && lh.size === 0;

  return (
    <Overlay onClose={() => { setModal(null); setGoalForm(BG); setEditGoalId(null); }} wide>
      <div className="modtitle">{editGoalId ? 'Edit Goal' : 'New Goal'}</div>
      <div className="frow">
        <FG label="Goal Name">
          <input className="fi" placeholder="e.g. Retirement Corpus" value={goalForm.name}
            onChange={e => setGoalForm(p => ({ ...p, name: e.target.value }))}/>
        </FG>
        <FG label="Category">
          <select className="fi fs" value={goalForm.category} onChange={e => setGoalForm(p => ({ ...p, category: e.target.value }))}>
            {['Retirement','Education','Real Estate','Emergency Fund','Wealth','Travel','Other'].map(c =>
              <option key={c} value={c}>{c}</option>)}
          </select>
        </FG>
      </div>
      <div className="frow">
        <FG label="Target Amount ₹">
          <FmtInput value={goalForm.targetAmount} placeholder="e.g. 10000000"
            onChange={e => setGoalForm(p => ({ ...p, targetAmount: e.target.value }))}/>
        </FG>
        <FG label="Target Date">
          <input type="date" className="fi" value={goalForm.targetDate}
            onChange={e => setGoalForm(p => ({ ...p, targetDate: e.target.value }))}/>
        </FG>
      </div>
      <div className="frow">
        <FG label="Monthly SIP ₹ (optional)">
          <FmtInput value={goalForm.monthlyContribution} placeholder="e.g. 25000"
            onChange={e => setGoalForm(p => ({ ...p, monthlyContribution: e.target.value }))}/>
        </FG>
        <FG label="Priority">
          <input type="number" className="fi" min={1} max={10} value={goalForm.priority}
            onChange={e => setGoalForm(p => ({ ...p, priority: +e.target.value }))}/>
        </FG>
      </div>
      <FG label="Link Members">
        <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginTop:'.3rem'}}>
          <button type="button" className={goalForm.linkedMembers.includes('all') ? 'tag-btn active' : 'tag-btn'}
            onClick={() => setGoalForm(p => ({ ...p, linkedMembers: ['all'] }))}>All Members</button>
          {members.map(m => (
            <button key={m.id} type="button"
              className={goalForm.linkedMembers.includes(m.id) ? 'tag-btn active' : 'tag-btn'}
              onClick={() => setGoalForm(p => {
                const lm = p.linkedMembers.filter(x => x !== 'all');
                return { ...p, linkedMembers: lm.includes(m.id) ? lm.filter(x => x !== m.id) : [...lm, m.id] };
              })}>{m.name}</button>
          ))}
        </div>
      </FG>
      <FG label="Link Asset Types">
        <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap',marginTop:'.3rem'}}>
          {Object.entries(AT).map(([k, v]) => (
            <button key={k} type="button"
              className={goalForm.linkedTypes.includes(k) ? 'tag-btn active' : 'tag-btn'}
              onClick={() => setGoalForm(p => ({
                ...p, linkedTypes: p.linkedTypes.includes(k)
                  ? p.linkedTypes.filter(x => x !== k)
                  : [...p.linkedTypes, k],
              }))}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </FG>
      <FG label="Earmark Specific Holdings (optional)">
        <div style={{fontSize:'.68rem',color:'var(--text-muted)',marginBottom:'.4rem',lineHeight:1.5}}>
          Selected holdings are always counted toward this goal — on top of any linked asset types above. Useful for FDs, PPF accounts, or specific stocks you've mentally set aside.
        </div>
        <HoldingsPicker
          allHoldings={allHoldings}
          valINRCache={valINRCache}
          AT={AT}
          members={members}
          selected={goalForm.linkedHoldingIds || []}
          onChange={ids => setGoalForm(p => ({ ...p, linkedHoldingIds: ids }))}
          goals={goals}
          currentGoalId={editGoalId}
        />
      </FG>

      {/* Live funded-amount preview — recomputes as members/types/earmarks change above */}
      <div style={{
        display:'flex', alignItems:'center', gap:'.6rem', marginTop:'.2rem', marginBottom:'.9rem',
        padding:'.6rem .8rem', borderRadius:6,
        background: isEntirePortfolio ? 'rgba(224,124,90,.08)' : 'rgba(76,175,154,.08)',
        border: `1px solid ${isEntirePortfolio ? 'rgba(224,124,90,.3)' : 'rgba(76,175,154,.25)'}`,
      }}>
        <span style={{fontSize:'.95rem'}}>{isEntirePortfolio ? '⚠️' : '✓'}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:'.78rem', color:'var(--text)'}}>
            This goal would currently count{' '}
            <span style={{fontFamily:"'DM Mono',monospace", fontWeight:600}}>
              ₹{previewVal.toLocaleString('en-IN')}
            </span>
            {' '}across <strong>{matchedHoldings.length}</strong> holding{matchedHoldings.length === 1 ? '' : 's'}
          </div>
          <div style={{fontSize:'.68rem', color: isEntirePortfolio ? '#e07c5a' : 'var(--text-muted)', marginTop:'.15rem'}}>
            {isEntirePortfolio
              ? 'No asset types or earmarked holdings selected — this counts your ENTIRE portfolio. Pick specific types above to scope it.'
              : `Scoped to ${lm.includes('all') || lm.length === 0 ? 'all members' : `${lm.length} member${lm.length === 1 ? '' : 's'}`}${lt.length ? `, ${lt.length} asset type${lt.length === 1 ? '' : 's'}` : ''}${lh.size ? `, ${lh.size} earmarked holding${lh.size === 1 ? '' : 's'}` : ''}.`}
          </div>
        </div>
      </div>

      <FG label="Notes (optional)">
        <input className="fi" placeholder="Notes about this goal…" value={goalForm.notes}
          onChange={e => setGoalForm(p => ({ ...p, notes: e.target.value }))}/>
      </FG>
      <MA>
        <button className="btnc" onClick={() => { setModal(null); setGoalForm(BG); setEditGoalId(null); }}>Cancel</button>
        <button className="btns" onClick={() => { addGoal(goalForm, editGoalId); setModal(null); setGoalForm(BG); setEditGoalId(null); }}>
          {editGoalId ? 'Update Goal' : 'Save Goal'}
        </button>
      </MA>
    </Overlay>
  );
}
