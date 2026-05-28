-- supabase/migrations/0108_rls_lockdown_unprotected_tables.sql
--
-- SECURITY: close the anon-key exposure on tables that never had RLS.
--
-- In this project the `anon` and `authenticated` roles hold the Supabase
-- default grants (SELECT/INSERT/UPDATE/DELETE) on every table in `public`.
-- That is fine for the ~55 tables that enable Row Level Security — RLS
-- denies by default until a policy allows. But ~24 tables (the Work
-- Orders V2 / facilities tables, vendor sub-tables, store_qr_tokens,
-- email_templates, feature_flags, etc.) never enabled RLS, so anyone
-- holding the PUBLIC anon key could read / write / delete them directly
-- through the REST API, bypassing the app entirely.
--
-- These tables are only ever accessed by the service-role Netlify
-- functions, which BYPASS RLS (service_role has BYPASSRLS). The frontend
-- never queries any of them directly (no supabase.from(...) and no
-- supabase.rpc(...) against them). So enabling RLS with NO policies =
-- deny-by-default for anon/authenticated, zero impact on the app.
--
-- Idempotent: only flips tables that currently have RLS off, so it is
-- safe to re-run and won't touch tables that already manage their own
-- policies.

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'              -- ordinary tables only
      and not c.relrowsecurity         -- RLS currently OFF
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'RLS enabled (deny-by-default): public.%', r.relname;
  end loop;
end $$;
