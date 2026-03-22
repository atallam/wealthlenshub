import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Google OAuth ──────────────────────────────────────────────────
export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });

// ── Email / Password ──────────────────────────────────────────────
export const signUpWithEmail = (email, password, displayName) =>
  supabase.auth.signUp({
    email, password,
    options: { data: { full_name: displayName } }
  });

export const signInWithEmail = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const resetPassword = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/reset-password"
  });

export const signInWithGitHub = () =>
  supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: window.location.origin }
  });

export const signOut = () => supabase.auth.signOut();
