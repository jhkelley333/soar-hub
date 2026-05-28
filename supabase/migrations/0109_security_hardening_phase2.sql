-- supabase/migrations/0109_security_hardening_phase2.sql
--
-- Defense-in-depth follow-up to 0108 (which enabled RLS everywhere).
-- Two hardening passes, both designed to be INVISIBLE to the app:
--   A) Revoke the leftover anon (logged-out) table privileges.
--   B) Pin search_path on SECURITY DEFINER functions.
--
-- Neither changes app behavior: the app only ever reads as the logged-in
-- `authenticated` role (gated by RLS), never as `anon`; and no
-- SECURITY DEFINER function body calls unqualified objects outside
-- public/extensions, so pinning the path is a no-op functionally.

-- ---------------------------------------------------------------------------
-- A) Strip anon's default table privileges.
--
-- After 0108 every table has RLS on, so anon is already denied. This
-- removes the underlying GRANT too, so a FUTURE table that forgets to
-- enable RLS isn't silently exposed to the public anon key. `authenticated`
-- and `service_role` keep their grants (the app + Netlify functions need
-- them). Idempotent.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','v','m','p')   -- tables, views, matviews, partitioned
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

-- Stop future migration-created objects from auto-granting to anon.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- B) Pin search_path on every SECURITY DEFINER function in public that
--    doesn't already set it. A fixed search_path closes the mutable-
--    search_path privilege-escalation vector flagged by Supabase's linter.
--    We include `extensions` so any unqualified extension call still
--    resolves; nonexistent schemas in the path are harmlessly ignored.
--    Idempotent (skips functions that already pin it).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef                                   -- SECURITY DEFINER
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format(
      'alter function public.%I(%s) set search_path = public, extensions, pg_temp',
      r.proname, r.args
    );
    raise notice 'search_path pinned: %(%)', r.proname, r.args;
  end loop;
end $$;
