-- ─────────────────────────────────────────────────────────────────
-- WealthLens — Keep-alive RPC
-- Run this in Supabase → SQL Editor → Run
-- Lets the GitHub keep-alive workflow hit the database with the anon key
-- WITHOUT granting the anon role any access to real tables (holdings etc).
-- ─────────────────────────────────────────────────────────────────

create or replace function public.keepalive()
returns integer
language sql
stable
security invoker
as $$ select 1 $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
