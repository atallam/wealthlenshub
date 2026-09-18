import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const { data: ports, error: pe } = await sb.from('portfolio').select('user_id, members');
if (pe) { console.error(pe); process.exit(1); }
const valid = new Set(); const names = {};
for (const p of ports) for (const m of (p.members||[])) { valid.add(String(m.id)); names[m.id]=m.name; }
console.log('valid members:', names);
const { data: hs, error: he } = await sb.from('holdings').select('*');
if (he) { console.error(he); process.exit(1); }
const orphan = hs.filter(h => !h.member_id || h.member_id==='' || !valid.has(String(h.member_id)));
console.log('total holdings:', hs.length, 'unassigned/orphan:', orphan.length);
const byMember = {};
for (const h of orphan) { const k = h.member_id ?? 'NULL'; byMember[k]=(byMember[k]||0)+1; }
console.log('orphan breakdown by member_id:', byMember);
for (const h of orphan.slice(0,40)) console.log(h.id, '|', h.member_id, '|', h.type, '|', h.name||h.ticker, '|', h.source);
