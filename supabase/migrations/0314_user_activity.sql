-- 0314_user_activity.sql
-- Per-user "last seen" presence for the admin User Activity page. One row per
-- user, upserted by a lightweight client heartbeat while the app is open. The
-- admin/coo/vp read path (the user-activity function) also pulls last_sign_in_at
-- from Supabase auth and unions the existing per-feature audit logs, so this
-- table only needs to carry the live-presence signal auth doesn't.
--
-- Self-write RLS: a signed-in user maintains ONLY their own presence row. There
-- is no select policy — client roles can't read others' activity; the admin
-- page reads through the service-role function instead.

create table if not exists public.user_activity (
  user_id      uuid        primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_path    text,
  user_agent   text,
  updated_at   timestamptz not null default now()
);

create index if not exists user_activity_last_seen_idx
  on public.user_activity (last_seen_at desc);

alter table public.user_activity enable row level security;

-- A signed-in user maintains only their own presence row (insert + update, so
-- the client's on-conflict upsert works both ways). No select/delete policies.
drop policy if exists user_activity_self_insert on public.user_activity;
create policy user_activity_self_insert on public.user_activity
  for insert with check (auth.uid() = user_id);

drop policy if exists user_activity_self_update on public.user_activity;
create policy user_activity_self_update on public.user_activity
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
