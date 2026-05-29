-- supabase/migrations/0111_role_module_access.sql
--
-- Per-role module/nav visibility overrides for the Role Access admin page.
-- Only stores DEVIATIONS from the code defaults in nav.ts: a row means
-- "for this module + role, force visible = <bool>", overriding the
-- hardcoded default. No row → the code default applies. So an empty table
-- reproduces today's behavior exactly.
--
-- module_key is the nav path (e.g. '/paf', '/admin/work-orders-v2').
-- Governs NAV visibility + (additively) route access — it is NOT the data
-- security boundary; backend role checks + RLS still enforce what data a
-- role can actually read.

create table if not exists role_module_access (
  module_key    text        not null,
  role          user_role   not null,
  visible       boolean     not null,
  updated_by_id uuid        references profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (module_key, role)
);

alter table role_module_access enable row level security;

-- Any signed-in user can read the matrix (the nav needs it to resolve).
create policy role_module_access_read on role_module_access
  for select to authenticated using (true);

-- Only admins can change it. (The role-access Netlify function uses the
-- service-role key and re-checks admin server-side regardless.)
create policy role_module_access_admin_write on role_module_access
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
