import { useToast } from '../../components/shared/Toast.jsx';
import { Bar, GOLD, GREEN, RED, SectionCard, fmtAmt } from './budgetShared.jsx';

// ── Goals Panel ───────────────────────────────────────────────────
export function GoalsPanel({ fb }) {
  const { fbGoals: goals, fbEditGoal: editing, setFbEditGoal, fbNewGoal: newGoal, setFbNewGoal, saveGoal, deleteGoal, fbAiQuery: aiQuery, setFbAiQuery, fbAiResponse: aiResponse, fbAiLoading: aiLoading, askAiCoach, fbAnalytics: analytics } = fb;
  const toast = useToast();
  return (
    <div>
      {/* AI Spending Coach (Phase 5) */}
      <SectionCard title="🤖 AI Spending Coach">
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.7rem' }}>
          Ask about your spending, get advice to cut costs or improve savings.
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <input className="fi" placeholder="e.g. Where am I overspending this month?" value={aiQuery} onChange={e => setFbAiQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !aiLoading && askAiCoach(aiQuery, analytics)}
            style={{ flex: 1 }} />
          <button onClick={() => askAiCoach(aiQuery, analytics)} disabled={!aiQuery.trim() || aiLoading}
            style={{ padding: '.4rem 1rem', background: GOLD, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: aiQuery.trim() && !aiLoading ? 'pointer' : 'not-allowed', fontSize: '.8rem' }}>
            {aiLoading ? '⏳' : 'Ask'}
          </button>
        </div>
        {aiResponse && (
          <div style={{ marginTop: '.8rem', background: 'var(--bg-muted)', borderRadius: 8, padding: '.75rem', fontSize: '.78rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {aiResponse}
          </div>
        )}
      </SectionCard>

      {/* Savings Goals */}
      <SectionCard title="🎯 Savings Goals">
        {/* Add new goal */}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '.6rem', background: 'var(--bg-muted)', borderRadius: 8 }}>
          <input className="fi" placeholder="Goal name" value={newGoal.name} onChange={e => setFbNewGoal(p => ({ ...p, name: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
          <input className="fi" placeholder="Icon" value={newGoal.icon} onChange={e => setFbNewGoal(p => ({ ...p, icon: e.target.value }))} style={{ width: 50 }} />
          <input className="fi" type="number" placeholder="Target ₹" value={newGoal.target} onChange={e => setFbNewGoal(p => ({ ...p, target: e.target.value }))} style={{ width: 110 }} />
          <input className="fi" type="number" placeholder="Saved so far ₹" value={newGoal.saved} onChange={e => setFbNewGoal(p => ({ ...p, saved: e.target.value }))} style={{ width: 130 }} />
          <input className="fi" type="date" value={newGoal.due_date} onChange={e => setFbNewGoal(p => ({ ...p, due_date: e.target.value }))} style={{ width: 130 }} />
          <button onClick={() => saveGoal(newGoal, true)} disabled={!newGoal.name || !newGoal.target}
            style={{ padding: '.4rem .9rem', background: GREEN, color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '.78rem' }}>
            + Add Goal
          </button>
        </div>

        {/* Goals list */}
        {goals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '.8rem', textAlign: 'center', padding: '.8rem' }}>No goals yet — add your first savings goal above</div>
        ) : goals.map(g => {
          const progress = Math.min(100, g.target > 0 ? (g.saved / g.target) * 100 : 0);
          const daysLeft = g.due_date ? Math.max(0, Math.ceil((new Date(g.due_date) - new Date()) / 86400000)) : null;
          return editing?.id === g.id ? (
            <div key={g.id} style={{ padding: '.6rem', border: `1px solid ${GOLD}40`, borderRadius: 10, marginBottom: '.6rem' }}>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <input className="fi" value={editing.name} onChange={e => setFbEditGoal(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
                <input className="fi" type="number" placeholder="Target" value={editing.target} onChange={e => setFbEditGoal(p => ({ ...p, target: e.target.value }))} style={{ width: 110 }} />
                <input className="fi" type="number" placeholder="Saved" value={editing.saved} onChange={e => setFbEditGoal(p => ({ ...p, saved: e.target.value }))} style={{ width: 110 }} />
                <input className="fi" type="date" value={editing.due_date || ''} onChange={e => setFbEditGoal(p => ({ ...p, due_date: e.target.value }))} style={{ width: 130 }} />
                <button onClick={() => saveGoal(editing, false)} style={{ padding: '.3rem .8rem', background: GOLD, color: '#000', border: 'none', borderRadius: 6, fontSize: '.75rem', cursor: 'pointer' }}>Save</button>
                <button onClick={() => setFbEditGoal(null)} style={{ padding: '.3rem .6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.72rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={g.id} style={{ padding: '.75rem', border: '1px solid var(--border)', borderRadius: 10, marginBottom: '.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{g.icon || '🎯'}</span>
                  <span style={{ fontWeight: 600, fontSize: '.82rem', color: 'var(--text)' }}>{g.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <button onClick={() => setFbEditGoal({ ...g })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem' }}>✏️</button>
                  <button onClick={() => deleteGoal(g, toast.confirm)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, fontSize: '.75rem' }}>🗑</button>
                </div>
              </div>
              <Bar value={g.saved || 0} max={g.target || 1} color={g.color || GREEN} h={8} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.35rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: "'DM Mono',monospace" }}>{fmtAmt(g.saved || 0, true)} / {fmtAmt(g.target || 0, true)}</span>
                <span style={{ color: progress >= 100 ? GREEN : 'var(--text-muted)' }}>
                  {progress >= 100 ? '✅ Complete!' : `${progress.toFixed(0)}% · ${daysLeft !== null ? `${daysLeft}d left` : 'No deadline'}`}
                </span>
              </div>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}
