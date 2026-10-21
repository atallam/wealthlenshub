// Authenticated export helpers. Plain <a href="/api/export/..."> links cannot
// send the Supabase Bearer token, so the server's auth middleware replies 401.
// Always fetch with the token and hand the result to the browser as a blob.
import { supabase } from '../supabase.js';

export const exportToday = () => new Date().toISOString().slice(0, 10);

async function getToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  } catch { return ''; }
}

async function authedFetch(path) {
  const token = await getToken();
  if (!token) throw new Error('Not signed in — please log in again and retry.');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* non-JSON body */ }
    throw new Error(`Export failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

export async function downloadExport(path, filename) {
  const res  = await authedFetch(path);
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Opens the print-ready report in a new tab. The tab is opened synchronously
// (inside the click gesture) so popup blockers allow it, then filled once the
// authenticated fetch resolves.
export async function openReportExport() {
  const win = window.open('', '_blank');
  try {
    const res  = await authedFetch('/api/export/report');
    const html = await res.text();
    const url  = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (win) win.location.href = url; else window.open(url, '_blank');
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}
