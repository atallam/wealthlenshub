// ── Date helpers ───────────────────────────────────────────────────────────────
const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

function parseDateUS(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m1) { const y = m1[3].length===2?"20"+m1[3]:m1[3]; return `${y}-${m1[1].padStart(2,"0")}-${m1[2].padStart(2,"0")}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m2 = s.match(/^([a-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m2) { const mo=MONTHS[m2[1].toLowerCase()]; if(mo) return `${m2[3]}-${String(mo).padStart(2,"0")}-${m2[2].padStart(2,"0")}`; }
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${new Date().getFullYear()}-${m3[1].padStart(2,"0")}-${m3[2].padStart(2,"0")}`;
  return null;
}

export function parseDateIN(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m1) { const y = m1[3].length===2?"20"+m1[3]:m1[3]; return `${y}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // Credit-card statements commonly abbreviate the year with a leading quote,
  // e.g. "07 Jul '26" — the `'?` tolerates that without breaking the plain "07 Jul 2026" case.
  const m2 = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[\s-]+'?(\d{2,4})$/i);
  if (m2) { const mo=MONTHS[m2[2].toLowerCase()]; const y=m2[3].length===2?"20"+m2[3]:m2[3]; if(mo) return `${y}-${String(mo).padStart(2,"0")}-${m2[1].padStart(2,"0")}`; }
  return null;
}

export function parseDate(val) { return parseDateUS(val) || parseDateIN(val); }

export function parseAmtBudget(val) {
  if (!val) return 0;
  const s = String(val).trim();
  const neg = s.startsWith("(") || s.startsWith("-");
  const n = parseFloat(s.replace(/[₹$,()\s]/g, ""));
  return isNaN(n) ? 0 : Math.abs(n) * (neg ? -1 : 1);
}

export function parseDateForRegion(val, region) {
  if (region==="US") return parseDateUS(val);
  if (region==="IN") return parseDateIN(val);
  return parseDateUS(val) || parseDateIN(val);
}
