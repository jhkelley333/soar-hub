-- =============================================================================
-- SOAR Hub — Seed data
-- Run AFTER 0001_init.sql against your Supabase project.
-- =============================================================================
-- This seed creates one region with two markets, four districts, and eight
-- stores so you can verify RLS policies end to end.
--
-- USERS: do NOT seed users here. Create users via Supabase Auth (dashboard
-- "Add user" or invite link). The on_auth_user_created trigger will insert
-- a profiles row automatically. Then run the role / scope assignments below.
-- =============================================================================

-- Wipe (idempotent during early dev — remove once you have real data).
truncate user_scopes, profiles, stores, districts, markets, regions
  restart identity cascade;

-- Org tree
insert into regions (id, name, code) values
  ('11111111-1111-1111-1111-111111111111', 'South Region', 'SOUTH');

insert into markets (id, name, code, region_id) values
  ('22222222-2222-2222-2222-222222222221', 'Dallas Market',  'DAL', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', 'Houston Market', 'HOU', '11111111-1111-1111-1111-111111111111');

insert into districts (id, name, code, market_id) values
  ('33333333-3333-3333-3333-333333333331', 'Dallas North',  'DAL-N', '22222222-2222-2222-2222-222222222221'),
  ('33333333-3333-3333-3333-333333333332', 'Dallas South',  'DAL-S', '22222222-2222-2222-2222-222222222221'),
  ('33333333-3333-3333-3333-333333333333', 'Houston East',  'HOU-E', '22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333334', 'Houston West',  'HOU-W', '22222222-2222-2222-2222-222222222222');

insert into stores (number, name, district_id, city, state) values
  ('1001', 'Sonic #1001', '33333333-3333-3333-3333-333333333331', 'Plano',     'TX'),
  ('1002', 'Sonic #1002', '33333333-3333-3333-3333-333333333331', 'Frisco',    'TX'),
  ('1003', 'Sonic #1003', '33333333-3333-3333-3333-333333333332', 'Dallas',    'TX'),
  ('1004', 'Sonic #1004', '33333333-3333-3333-3333-333333333332', 'Irving',    'TX'),
  ('1005', 'Sonic #1005', '33333333-3333-3333-3333-333333333333', 'Houston',   'TX'),
  ('1006', 'Sonic #1006', '33333333-3333-3333-3333-333333333333', 'Pasadena',  'TX'),
  ('1007', 'Sonic #1007', '33333333-3333-3333-3333-333333333334', 'Katy',      'TX'),
  ('1008', 'Sonic #1008', '33333333-3333-3333-3333-333333333334', 'Sugarland', 'TX');

-- =============================================================================
-- After creating real users in Supabase Auth, assign role + scope like this.
-- Replace the email values with users you actually invited.
-- =============================================================================
--
-- update profiles set role = 'admin', full_name = 'Admin User'
--   where email = 'admin@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select id, 'global', null from profiles where email = 'admin@example.com';
--
-- update profiles set role = 'payroll', full_name = 'Payroll Specialist'
--   where email = 'payroll@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select id, 'global', null from profiles where email = 'payroll@example.com';
--
-- update profiles set role = 'rvp', full_name = 'Regional VP'
--   where email = 'rvp@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select id, 'region', '11111111-1111-1111-1111-111111111111'
--   from profiles where email = 'rvp@example.com';
--
-- update profiles set role = 'sdo', full_name = 'Senior DO'
--   where email = 'sdo@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select id, 'market', '22222222-2222-2222-2222-222222222221'
--   from profiles where email = 'sdo@example.com';
--
-- update profiles set role = 'do', full_name = 'District Operator'
--   where email = 'do@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select id, 'district', '33333333-3333-3333-3333-333333333331'
--   from profiles where email = 'do@example.com';
--
-- update profiles set role = 'gm', full_name = 'General Manager',
--   primary_store_id = (select id from stores where number = '1001')
--   where email = 'gm@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select p.id, 'store', s.id
--   from profiles p, stores s
--   where p.email = 'gm@example.com' and s.number = '1001';
--
-- update profiles set role = 'shift_manager', full_name = 'Shift Lead',
--   primary_store_id = (select id from stores where number = '1001')
--   where email = 'shift@example.com';
-- insert into user_scopes (user_id, scope_type, scope_id)
--   select p.id, 'store', s.id
--   from profiles p, stores s
--   where p.email = 'shift@example.com' and s.number = '1001';
