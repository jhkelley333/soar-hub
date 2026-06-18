-- supabase/migrations/0161_region_module_access.sql
--
-- Per-region module/nav visibility overrides for the Region Access admin
-- page. Mirrors role_module_access (0111) but the axis is region instead of
-- role. Only stores DEVIATIONS from the default: every region can see every
-- module by default, so a row means "for this module + region, force
-- visible = <bool>" (in practice, hide it). No row → the module is visible.
-- An empty table reproduces today's behavior exactly.
--
-- module_key is the nav path (e.g. '/paf', '/admin/work-orders-v2').
-- region_id references the org-hierarchy regions table.
--
-- Governs NAV visibility + (additively) route access for users whose scope
-- resolves to a region. It is NOT the data security boundary — backend role
-- checks + RLS still enforce what data anyone can actually read. Effective
-- visibility = role allows AND region allows.

create table if not exists region_module_access (
  module_key    text        not null,
  region_id     uuid        not null references regions(id) on delete cascade,
  visible       boolean     not null,
  updated_by_id uuid        references profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (module_key, region_id)
);

alter table region_module_access enable row level security;

-- Any signed-in user can read the matrix (the nav + route guards need it to
-- resolve their own region's access).
create policy region_module_access_read on region_module_access
  for select to authenticated using (true);

-- Only admins can change it. (The region-access Netlify function uses the
-- service-role key and re-checks admin server-side regardless.)
create policy region_module_access_admin_write on region_module_access
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
