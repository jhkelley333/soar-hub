-- 0077_wo_approval_thresholds.sql
--
-- Editable approval authority ladder for work orders. Each role has a
-- not-to-exceed (NTE) amount it can approve solo; a quote routes to the
-- lowest ACTIVE role whose NTE covers it. Above the top active tier the
-- approval is handled out-of-system (verbal / WhatsApp) and recorded.
--
-- Seeded with the current real bands (DO $500 baseline, SDO $1,000,
-- RVP $1,750) plus VP ($2,500) and COO ($5,000) pre-seeded but INACTIVE
-- until the org turns them on — flip is_active in Work Orders → Settings
-- → Approval Limits. Anything over the top active tier → Owner / verbal.
--
-- Service-role only (no RLS) like the other WO tables; edits go through
-- facilities-v2.js (gated to RVP+).

create table if not exists wo_approval_thresholds (
  role        text primary key,
  label       text not null,
  nte_cents   integer not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  updated_at  timestamptz default now()
);

insert into wo_approval_thresholds (role, label, nte_cents, is_active, sort_order) values
  ('do',  'DO',   50000,  true,  1),
  ('sdo', 'SDO',  100000, true,  2),
  ('rvp', 'RVP',  175000, true,  3),
  ('vp',  'VP',   250000, false, 4),
  ('coo', 'COO',  500000, false, 5)
on conflict (role) do nothing;
