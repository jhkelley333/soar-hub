-- 0339_lock_down_scrapekit_loaders.sql
-- Revoke execute on the scrapekit SECURITY DEFINER loaders from anon/authenticated so only service_role can call them.

-- Migrations 0336 and 0337 revoked execute from PUBLIC only. On Supabase, new
-- functions in public are also granted to anon/authenticated by default, so
-- any signed-in user could still call these loaders and write to
-- kpi_backup_raw / ecosure_assessments / ecosure_findings.

revoke execute on function public.load_kpi_backup_raw(date, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.scrapekit_ecosure_upsert_assessments(jsonb)
  from public, anon, authenticated;
revoke execute on function public.scrapekit_ecosure_upsert_findings(jsonb)
  from public, anon, authenticated;

grant execute on function public.load_kpi_backup_raw(date, jsonb, jsonb, jsonb, text)  to service_role;
grant execute on function public.scrapekit_ecosure_upsert_assessments(jsonb)           to service_role;
grant execute on function public.scrapekit_ecosure_upsert_findings(jsonb)              to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- Expect three rows, each: anon = false, authenticated = false,
-- service_role = true.
-- ─────────────────────────────────────────────────────────────────────────────
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute')  as service_role_can_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'load_kpi_backup_raw',
    'scrapekit_ecosure_upsert_assessments',
    'scrapekit_ecosure_upsert_findings'
  )
order by p.proname;
