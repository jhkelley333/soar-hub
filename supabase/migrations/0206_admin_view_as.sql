-- 0206_admin_view_as.sql
-- Audit trail for admin "View As" — a read-only debugging mode where an
-- admin can see the app (starting with My CAPs / My Assignments / Sign-off
-- Queue) exactly as another user would see it, without being able to take
-- any action while doing so. Every session (start → end) is recorded here;
-- there is no per-request logging, the session row IS the audit trail.
--
-- Service-role gatekeeper pattern (matches business_disruptions,
-- site_audits): RLS on, no policies — the admin-view-as function scopes
-- every read/write.

create table if not exists public.admin_view_as_sessions (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null references public.profiles(id) on delete cascade,
  admin_name       text,
  target_user_id   uuid not null references public.profiles(id) on delete cascade,
  target_user_name text,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create index if not exists admin_view_as_sessions_admin_idx on public.admin_view_as_sessions (admin_id, started_at desc);
create index if not exists admin_view_as_sessions_open_idx on public.admin_view_as_sessions (admin_id) where ended_at is null;

alter table public.admin_view_as_sessions enable row level security;

notify pgrst, 'reload schema';
