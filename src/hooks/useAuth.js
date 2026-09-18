import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

// Auth state + Supabase session listener, extracted out of App.jsx (P3-5,
// step 1 — smallest self-contained slice: no other state in App.jsx reads
// or writes user/authLoading/authErr, so this is a pure lift-and-shift with
// identical behavior). See RESTRUCTURE_PLAN.md.
export function useAuth() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authErr, setAuthErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { user, authLoading, authErr };
}
