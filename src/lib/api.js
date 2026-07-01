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
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || res.statusText);
  }
  return res.json();
}
