-- 0338_ecosure_top_findings.sql
-- Database-side count of the most frequent EcoSure findings, optionally limited to a set of stores.

-- ─────────────────────────────────────────────────────────────────────────────
-- ecosure_top_findings(p_store_numbers, p_limit)
--   p_store_numbers  null = every store; otherwise only these store numbers
--   p_limit          rows to return (default 20, clamped to 1..100)
-- Returns one row per question_number, most frequent first, with the most
-- recently pulled non-null description for that question.
--
-- SECURITY INVOKER on purpose: ecosure_findings has RLS enabled with no
-- policies, so only service_role (which bypasses RLS) gets rows back.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ecosure_top_findings(
  p_store_numbers text[] default null,
  p_limit         int    default 20
)
returns table (
  question_number      text,
  standard_description text,
  finding_count        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    f.question_number,
    (array_agg(f.standard_description order by f.pulled_at desc, f.id)
       filter (where f.standard_description is not null))[1],
    count(*)
  from public.ecosure_findings f
  where p_store_numbers is null
     or f.store_number = any (p_store_numbers)
  group by f.question_number
  order by count(*) desc, f.question_number
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Only service_role may call it. Revoking from PUBLIC alone is not enough on
-- Supabase: new functions in public are also granted to anon/authenticated.
revoke execute on function public.ecosure_top_findings(text[], int) from public, anon, authenticated;
grant  execute on function public.ecosure_top_findings(text[], int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- Expect: security_definer = false, anon = false, authenticated = false,
-- service_role = true.
-- ─────────────────────────────────────────────────────────────────────────────
select
  p.proname,
  p.prosecdef                                               as security_definer,
  has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute')  as service_role_can_execute
from pg_proc p
where p.proname = 'ecosure_top_findings'
  and p.pronamespace = 'public'::regnamespace;
