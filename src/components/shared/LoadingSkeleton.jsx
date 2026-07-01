// LoadingSkeleton.jsx — shimmer placeholder shown while the portfolio loads.
// Mimics the shape of the Overview tab: metric cards + holdings list rows.

export default function LoadingSkeleton() {
  const shimmer = {
    background: 'linear-gradient(90deg, var(--bg-card) 25%, rgba(255,255,255,.07) 50%, var(--bg-card) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.6s infinite',
    borderRadius: 8,
  };

  const card = (w = '100%', h = 80) => (
    <div style={{ ...shimmer, width: w, height: h, border: '1px solid var(--border)' }} />
  );

  const row = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
      <div style={{ ...shimmer, width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        <div style={{ ...shimmer, width: '45%', height: 13 }} />
        <div style={{ ...shimmer, width: '28%', height: 11 }} />
      </div>
      <div style={{ ...shimmer, width: 80, height: 13 }} />
      <div style={{ ...shimmer, width: 60, height: 13 }} />
    </div>
  );

  return (
    <>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* Top metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ ...shimmer, height: 90, border: '1px solid var(--border)', borderRadius: 12 }} />
        ))}
      </div>

      {/* Allocation strip */}
      <div style={{ ...shimmer, height: 8, borderRadius: 4, marginBottom: '1.5rem' }} />

      {/* Holdings list header */}
      <div style={{ display: 'flex', gap: '1rem', padding: '.5rem 1rem', marginBottom: '.25rem' }}>
        <div style={{ ...shimmer, width: '30%', height: 11 }} />
        <div style={{ ...shimmer, width: '15%', height: 11, marginLeft: 'auto' }} />
        <div style={{ ...shimmer, width: '12%', height: 11 }} />
        <div style={{ ...shimmer, width: '12%', height: 11 }} />
      </div>

      {/* Holding rows */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {[1,2,3,4,5,6,7].map(i => <div key={i}>{row()}</div>)}
      </div>
    </>
  );
}
