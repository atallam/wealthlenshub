// Shared authenticated API helper — attaches the Supabase JWT to every request.
// Import in any module that needs to call /api/* routes.
import { supabase } from '../supabase.js';

export async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  // Read as text first: an empty or non-JSON body (proxy error, HTML fallback,
  // gateway page) should surface as a readable message, not a JSON parse crash.
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const detail = body?.error || (text ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "") || res.statusText;
    throw new Error(`${detail} (HTTP ${res.status} from ${path})`);
  }
  if (body === null) {
    throw new Error(`Empty or non-JSON response from ${path} (HTTP ${res.status}${text ? ": " + text.slice(0, 120) : ""}) — is the backend running on port 3000?`);
  }
  return body;
}
