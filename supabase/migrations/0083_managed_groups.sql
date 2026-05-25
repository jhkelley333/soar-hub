-- supabase/migrations/0083_managed_groups.sql
--
-- "Managed" (seat-owned) group chats. Instead of a hand-picked roster, a
-- managed group is defined by an org node + a target role — e.g.
-- (district 14B, gm) = "all GMs in District 14B". Membership is derived
-- from the org tree and kept in sync; the OWNER is whoever currently
-- holds that seat (the DO of 14B), so it transfers automatically when the
-- seat changes hands.
--
-- Retention: membership changes are logged (chat_membership_log) and we
-- never hard-delete a managed group — "delete" is a soft archive
-- (archived_at) so history survives for legal hold.

-- ── thread metadata ──────────────────────────────────────────────────
alter table public.chat_threads
  add column if not exists managed        boolean not null default false,
  add column if not exists description    text,
  add column if not exists org_scope_type scope_type,
  add column if not exists org_scope_id   uuid,
  add column if not exists target_role    user_role,
  add column if not exists archived_at    timestamptz;

-- One canonical managed group per (scope node, target role).
create unique index if not exists uq_chat_threads_managed_scope
  on public.chat_threads (org_scope_type, org_scope_id, target_role)
  where managed;

-- ── membership audit (legal hold) ────────────────────────────────────
create table if not exists public.chat_membership_log (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  action     text not null check (action in ('added','removed')),
  actor_id   uuid references public.profiles(id),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_membership_log_thread
  on public.chat_membership_log (thread_id, created_at);

alter table public.chat_membership_log enable row level security;

-- ── roster: active users of a role within an org node ────────────────
-- Store-attached roles (shift_manager, gm) place via their primary store;
-- scope-assigned roles (do, sdo, rvp) place via their user_scopes rows.
create or replace function chat_org_roster(
  p_scope_type scope_type,
  p_scope_id   uuid,
  p_role       user_role
)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from profiles p
  join stores s    on s.id = p.primary_store_id
  join districts d on d.id = s.district_id
  join areas a     on a.id = d.area_id
  where p.is_active and p.role = p_role
    and (
      p_scope_type = 'global'
      or (p_scope_type = 'store'    and s.id = p_scope_id)
      or (p_scope_type = 'district' and d.id = p_scope_id)
      or (p_scope_type = 'area'     and a.id = p_scope_id)
      or (p_scope_type = 'region'   and a.region_id = p_scope_id)
    )

  union

  select p.id
  from profiles p
  join user_scopes us on us.user_id = p.id
  left join districts ud on us.scope_type = 'district' and ud.id = us.scope_id
  left join areas     ua on ua.id = ud.area_id
  left join areas     sa on us.scope_type = 'area' and sa.id = us.scope_id
  where p.is_active and p.role = p_role
    and (
      p_scope_type = 'global'
      or (us.scope_type = p_scope_type and us.scope_id = p_scope_id)
      or (p_scope_type = 'area'   and us.scope_type = 'district' and ud.area_id   = p_scope_id)
      or (p_scope_type = 'region' and us.scope_type = 'district' and ua.region_id = p_scope_id)
      or (p_scope_type = 'region' and us.scope_type = 'area'     and sa.region_id = p_scope_id)
    );
$$;

-- ── reconcile a managed group's membership against the live roster ───
-- Adds new roster members, removes those who left the scope/were
-- deactivated, sets the current seat holder as owner, and logs every
-- change. Existing rows keep their role, so manually-promoted admins are
-- preserved as long as they remain in the roster.
create or replace function chat_reconcile_managed_group(
  p_thread uuid,
  p_actor  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t          record;
  owner_role user_role;
begin
  select * into t from public.chat_threads where id = p_thread and managed = true;
  if not found then return; end if;

  owner_role := case t.org_scope_type
    when 'store'    then 'gm'
    when 'district' then 'do'
    when 'area'     then 'sdo'
    when 'region'   then 'rvp'
    else 'admin'
  end::user_role;

  drop table if exists _desired;
  create temp table _desired (user_id uuid primary key, role text);

  -- target-role roster → members
  insert into _desired (user_id, role)
  select r.user_id, 'member'
  from chat_org_roster(t.org_scope_type, t.org_scope_id, t.target_role) r
  on conflict (user_id) do nothing;

  -- current seat holder(s) → owner (wins over member)
  insert into _desired (user_id, role)
  select p.id, 'owner'
  from public.profiles p
  join public.user_scopes us on us.user_id = p.id
  where p.is_active
    and p.role = owner_role
    and (
      t.org_scope_type = 'global'
      or (us.scope_type = t.org_scope_type and us.scope_id = t.org_scope_id)
    )
  on conflict (user_id) do update set role = 'owner';

  -- remove (with audit) anyone no longer desired
  insert into public.chat_membership_log (thread_id, user_id, action, actor_id, reason)
  select p_thread, m.user_id, 'removed', p_actor, 'roster-sync'
  from public.chat_thread_members m
  where m.thread_id = p_thread
    and not exists (select 1 from _desired d where d.user_id = m.user_id);

  delete from public.chat_thread_members m
  where m.thread_id = p_thread
    and not exists (select 1 from _desired d where d.user_id = m.user_id);

  -- add (with audit) anyone newly desired
  insert into public.chat_membership_log (thread_id, user_id, action, actor_id, reason)
  select p_thread, d.user_id, 'added', p_actor, 'roster-sync'
  from _desired d
  where not exists (
    select 1 from public.chat_thread_members m
    where m.thread_id = p_thread and m.user_id = d.user_id
  );

  insert into public.chat_thread_members (thread_id, user_id, role, joined_at)
  select p_thread, d.user_id, d.role, now()
  from _desired d
  where not exists (
    select 1 from public.chat_thread_members m
    where m.thread_id = p_thread and m.user_id = d.user_id
  );

  drop table if exists _desired;
end;
$$;
