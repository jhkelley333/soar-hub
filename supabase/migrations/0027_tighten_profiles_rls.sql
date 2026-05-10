-- supabase/migrations/0027_tighten_profiles_rls.sql
--
-- Tighten same-store-coworker visibility on the profiles table and add
-- a phone-list helper.
--
-- BEFORE this migration the profiles_select_hierarchy RLS policy gave
-- any signed-in user with a primary_store_id full SELECT access to
-- every other profile sharing that store via direct PostgREST. That
-- exposed the email column to coworkers, which the operations team
-- considered too broad — coworkers should be able to call each other
-- by phone, not see each other's email addresses.
--
-- AFTER this migration:
--   - profiles_select_self : own row, full access (unchanged)
--   - profiles_select_admin: admin/payroll, full access (unchanged)
--   - profiles_select_hierarchy: DROPPED. Direct profiles SELECT from
--     a Shift Manager / GM / etc. only returns their own row.
--   - public.store_directory(): NEW. Returns same-store coworkers
--     plus anyone the caller can see via their scope chain, with a
--     limited column list (no email).
--
-- Leadership flows that need email (My Team, PAF queue, etc.) go
-- through netlify functions using the service role key, which bypass
-- RLS — so this change does NOT affect anything in the existing UI.
-- The browser-side direct profile read paths (AuthProvider hydrate +
-- AccountPage update) only touch the caller's own row.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

drop policy if exists profiles_select_hierarchy on public.profiles;

-- Phone-list of the caller's reachable team members, excluding email.
-- Use this RPC any time the UI needs coworker contact info for a
-- non-leadership audience (today: nothing, but a future "store phone
-- list" page would call it). SECURITY DEFINER so it can read profiles
-- past the tightened RLS, but the WHERE clause restricts to stores
-- the caller is authorized to see.
create or replace function public.store_directory()
returns table (
  id                 uuid,
  full_name          text,
  preferred_name     text,
  phone              text,
  role               public.user_role,
  primary_store_id   uuid,
  profile_photo_url  text
)
security definer
set search_path = public
language sql
stable
as $$
  select p.id, p.full_name, p.preferred_name, p.phone, p.role,
         p.primary_store_id, p.profile_photo_url
  from public.profiles p
  where p.is_active = true
    and p.primary_store_id is not null
    and can_see_store(p.primary_store_id);
$$;

revoke all on function public.store_directory() from public;
grant execute on function public.store_directory() to authenticated;

notify pgrst, 'reload schema';
