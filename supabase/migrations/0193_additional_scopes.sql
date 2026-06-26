-- 0193_additional_scopes.sql
-- Additional ("acting") scope assignments for SDOs/RVPs (and any role) who
-- also cover a district/area/region below them — e.g. an RVP who is the acting
-- DO for a district, or an SDO covering an area. Kept in a SEPARATE table from
-- user_scopes so removing extra coverage can never touch a user's primary role
-- scope. Supports an optional end date for temporary acting coverage.
-- user_visible_stores() is extended to UNION in non-expired additional scopes,
-- so My Team, RLS, labor, and every other consumer pick them up automatically.

-- Audit actions for the new operations (mirrors 0107's pattern for 'delete').
alter type team_change_action add value if not exists 'add_scope';
alter type team_change_action add value if not exists 'remove_scope';

create table if not exists public.additional_scopes (
  id          uuid       primary key default uuid_generate_v4(),
  user_id     uuid       not null references public.profiles(id) on delete cascade,
  scope_type  scope_type not null,
  scope_id    uuid,
  note        text,
  expires_at  timestamptz,
  created_by  uuid       references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- scope_id required for every type we assign here (we never grant 'global'
  -- as an additional scope — change the role for that).
  constraint additional_scope_id_required check (
    scope_type in ('store','district','area','region') and scope_id is not null
  ),
  unique (user_id, scope_type, scope_id)
);
create index if not exists additional_scopes_user_id_idx on public.additional_scopes(user_id);
create index if not exists additional_scopes_lookup_idx  on public.additional_scopes(scope_type, scope_id);

-- Locked down: all access is via the service-role team-mgmt function and the
-- security-definer user_visible_stores() (which bypasses RLS). No client
-- policy needed; RLS-on with no policy denies direct anon/auth access.
alter table public.additional_scopes enable row level security;

-- Recreate user_visible_stores() = the 0032 body PLUS non-expired additional
-- scopes. The original branches are unchanged; we only append.
create or replace function user_visible_stores(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with u as (select role from profiles where id = uid)
  select s.id from stores s
  where s.is_active and exists (select 1 from u where role in ('admin','payroll'))
  union
  select us.scope_id from user_scopes us
  where us.user_id = uid and us.scope_type = 'store'
  union
  select s.id from user_scopes us
  join stores s on s.district_id = us.scope_id
  where us.user_id = uid and us.scope_type = 'district'
  union
  select s.id from user_scopes us
  join districts d on d.area_id = us.scope_id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'area'
  union
  select s.id from user_scopes us
  join areas a on a.region_id = us.scope_id
  join districts d on d.area_id = a.id
  join stores s on s.district_id = d.id
  where us.user_id = uid and us.scope_type = 'region'
  union
  select s.id from stores s where exists (
    select 1 from user_scopes us
    where us.user_id = uid and us.scope_type = 'global'
  )
  union
  select s.id from profiles p
  join stores s on s.id = p.primary_store_id
  where p.id = uid and p.primary_store_id is not null and s.is_active
  -- ── additional ("acting") scopes — non-expired only ──
  union
  select a_s.scope_id from additional_scopes a_s
  where a_s.user_id = uid and a_s.scope_type = 'store'
    and (a_s.expires_at is null or a_s.expires_at > now())
  union
  select s.id from additional_scopes a_s
  join stores s on s.district_id = a_s.scope_id
  where a_s.user_id = uid and a_s.scope_type = 'district'
    and (a_s.expires_at is null or a_s.expires_at > now())
  union
  select s.id from additional_scopes a_s
  join districts d on d.area_id = a_s.scope_id
  join stores s on s.district_id = d.id
  where a_s.user_id = uid and a_s.scope_type = 'area'
    and (a_s.expires_at is null or a_s.expires_at > now())
  union
  select s.id from additional_scopes a_s
  join areas a on a.region_id = a_s.scope_id
  join districts d on d.area_id = a.id
  join stores s on s.district_id = d.id
  where a_s.user_id = uid and a_s.scope_type = 'region'
    and (a_s.expires_at is null or a_s.expires_at > now());
$$;

notify pgrst, 'reload schema';
