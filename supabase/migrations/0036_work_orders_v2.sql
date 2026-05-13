-- supabase/migrations/0036_work_orders_v2.sql
--
-- Work Orders V2 (Facilities V2) — schema for the long-running
-- claude/work-orders-v2 branch. Built from the user's original
-- prototype schema with two updates from the v2 setup:
--   * Tables keep their bare names (tickets, vendors, …) — v1
--     work-orders talks to Smartsheet, so there's no name collision
--     in Supabase.
--   * Storage bucket is `wo2-ticket-photos` (public). Existing photos
--     live on a different Supabase project; this migration provisions
--     the bucket fresh on Soar Hub v2.
--
-- Additions on top of the original schema (required by the v2 UI but
-- missing from the original SQL):
--   * ticket_messages   — internal/vendor chat threads
--   * vendor_ratings    — star ratings per closed ticket
--   * next_wo_sequence  — RPC used by facilities-v2.js for atomic WO #s
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) so the migration
-- is safe to re-run if anything was already in place.

-- ── WO SEQUENCES ─────────────────────────────────────────────
create table if not exists wo_sequences (
  store_number  text primary key,
  last_sequence int  not null default 0
);

-- ── ISSUE LIBRARY ────────────────────────────────────────────
create table if not exists issue_library (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,
  asset_type   text not null,
  display_name text not null,
  sort_order   int  default 0
);

-- ── VENDORS ──────────────────────────────────────────────────
create table if not exists vendors (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  category                text,
  service_area            text,
  contact_person          text,
  phone                   text,
  email                   text,
  notification_preference text default 'email',
  is_active               boolean default true,
  notes                   text,
  website                 text,
  services                text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ── TICKETS ──────────────────────────────────────────────────
create table if not exists tickets (
  id                       uuid primary key default gen_random_uuid(),
  wo_number                text unique not null,
  store_number             text not null,
  store_name               text,
  store_email              text,
  do_email                 text,
  sdo_email                text,
  submitted_by             text,
  submitted_by_user_id     text,
  category                 text,
  asset_type               text,
  model_number             text,
  issue_description        text,
  status                   text not null default 'Received',
  priority                 text default 'Standard',
  is_business_critical     boolean default false,
  troubleshooting_checked  boolean default false,
  vendor_contacted         boolean default false,
  vendor_id                uuid references vendors(id),
  vendor_name              text,
  vendor_eta               text,
  vendor_status            text,
  vendor_response_notes    text,
  vendor_sent_date         timestamptz,
  vendor_response_date     timestamptz,
  cost_estimate            decimal(10,2),
  approval_level           text,
  approval_request_notes   text,
  approval_status          text default 'None',
  approval_approved_by     text,
  approval_approved_at     timestamptz,
  latest_comment           text,
  date_submitted           timestamptz default now(),
  date_status_updated      timestamptz,
  date_completed           timestamptz,
  days_to_completion       int,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- ── TICKET UPDATES ───────────────────────────────────────────
create table if not exists ticket_updates (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  user_id     text,
  user_name   text,
  user_role   text,
  update_type text not null,
  old_value   text,
  new_value   text,
  notes       text,
  created_at  timestamptz default now()
);

-- ── TICKET PHOTOS ────────────────────────────────────────────
create table if not exists ticket_photos (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  file_url    text not null,
  file_name   text,
  file_size   int,
  mime_type   text,
  uploaded_by text,
  upload_type text default 'update',
  created_at  timestamptz default now()
);

-- ── TICKET APPROVALS ─────────────────────────────────────────
create table if not exists ticket_approvals (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references tickets(id) on delete cascade,
  approval_tier text not null,
  requested_by  text,
  requested_at  timestamptz default now(),
  approved_by   text,
  approved_at   timestamptz,
  status        text default 'Pending',
  notes         text,
  quote_url     text,
  created_at    timestamptz default now()
);

-- ── TICKET NOTIFICATIONS ─────────────────────────────────────
create table if not exists ticket_notifications (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references tickets(id) on delete cascade,
  recipient_email   text,
  recipient_name    text,
  notification_type text,
  subject           text,
  message           text,
  sent_at           timestamptz default now(),
  status            text default 'sent'
);

-- ── TICKET MESSAGES (chat, not in original schema) ──────────
create table if not exists ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  user_id     text,
  user_name   text,
  user_role   text,
  message     text not null,
  thread_type text not null check (thread_type in ('internal', 'vendor')),
  created_at  timestamptz default now()
);

-- ── VENDOR RATINGS (not in original schema) ─────────────────
create table if not exists vendor_ratings (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references vendors(id) on delete cascade,
  ticket_id    uuid references tickets(id) on delete set null,
  store_number text,
  rating       smallint not null check (rating between 1 and 5),
  comment      text,
  rated_by     text,
  rated_at     timestamptz default now()
);

-- ── INDEXES ──────────────────────────────────────────────────
create index if not exists idx_tickets_store           on tickets (store_number);
create index if not exists idx_tickets_status          on tickets (status);
create index if not exists idx_tickets_wo_number       on tickets (wo_number);
create index if not exists idx_tickets_submitted       on tickets (date_submitted desc);
create index if not exists idx_ticket_updates_ticket   on ticket_updates (ticket_id);
create index if not exists idx_ticket_photos_ticket    on ticket_photos (ticket_id);
create index if not exists idx_ticket_approvals_ticket on ticket_approvals (ticket_id);
create index if not exists idx_issue_library_category  on issue_library (category);
create index if not exists idx_ticket_messages_ticket  on ticket_messages (ticket_id);
create index if not exists idx_ticket_messages_thread  on ticket_messages (thread_type);
create index if not exists idx_vendor_ratings_vendor   on vendor_ratings (vendor_id);

-- ── UPDATED_AT TRIGGER ───────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Drop-and-recreate so the migration is safe to re-run.
drop trigger if exists tickets_updated_at on tickets;
create trigger tickets_updated_at
  before update on tickets
  for each row execute function update_updated_at();

drop trigger if exists vendors_updated_at on vendors;
create trigger vendors_updated_at
  before update on vendors
  for each row execute function update_updated_at();

-- ── NEXT_WO_SEQUENCE RPC (used by facilities-v2.js) ─────────
create or replace function next_wo_sequence(p_store text)
returns integer
language plpgsql
as $$
declare
  next_seq integer;
begin
  insert into wo_sequences (store_number, last_sequence)
  values (p_store, 1)
  on conflict (store_number)
  do update set last_sequence = wo_sequences.last_sequence + 1
  returning last_sequence into next_seq;
  return next_seq;
end;
$$;

-- ── ISSUE LIBRARY SEED ───────────────────────────────────────
insert into issue_library (category, asset_type, display_name, sort_order) values
-- Facilities & Infrastructure
('Facilities & Infrastructure', 'Backflow',     'Backflow Repair',                          1),
('Facilities & Infrastructure', 'Backflow',     'Backflow Testing',                         2),
('Facilities & Infrastructure', 'Signage',      'Building Sign',                            3),
('Facilities & Infrastructure', 'Signage',      'Canopy / Bull Nose',                       4),
('Facilities & Infrastructure', 'Handyman',     'Combined Handyman',                        5),
('Facilities & Infrastructure', 'Ceiling',      'Ceiling Tile (Mold / Water Damage)',       6),
('Facilities & Infrastructure', 'Ceiling',      'Ceiling Tile Broke',                       7),
('Facilities & Infrastructure', 'Doors',        'Door – Back Door',                         8),
('Facilities & Infrastructure', 'Doors',        'Door - Front',                             9),
('Facilities & Infrastructure', 'Doors',        'Door – Restroom Door',                    10),
('Facilities & Infrastructure', 'Doors',        'Door – Walk-In Cooler',                   11),
('Facilities & Infrastructure', 'Doors',        'Door – Walk-In Freezer',                  12),
('Facilities & Infrastructure', 'Plumbing',     'Floor Drain',                             13),
('Facilities & Infrastructure', 'Flooring',     'Floors (Broken Tile)',                    14),
('Facilities & Infrastructure', 'Plumbing',     'General Plumbing',                        15),
('Facilities & Infrastructure', 'Sinks',        'Handwashing Sink – FOH',                  16),
('Facilities & Infrastructure', 'Sinks',        'Handwashing Sink – BOH',                  17),
('Facilities & Infrastructure', 'Sinks',        'Handwashing Sink – Women''s Restroom',    18),
('Facilities & Infrastructure', 'Sinks',        'Handwashing Sink – Men''s Restroom',      19),
('Facilities & Infrastructure', 'HVAC',         'HVAC 1',                                  20),
('Facilities & Infrastructure', 'HVAC',         'HVAC 2',                                  21),
('Facilities & Infrastructure', 'Landscaping',  'Irrigation',                              22),
('Facilities & Infrastructure', 'Landscaping',  'Landscaping',                             23),
('Facilities & Infrastructure', 'Lighting',     'Lighting (Exterior)',                     24),
('Facilities & Infrastructure', 'Lighting',     'Lighting (Interior)',                     25),
('Facilities & Infrastructure', 'Plumbing',     'Mop Sink',                                26),
('Facilities & Infrastructure', 'Signage',      'Pylon Sign',                              27),
('Facilities & Infrastructure', 'Roofing',      'Roof Leak',                               28),
('Facilities & Infrastructure', 'Security',     'Safe (Quick Drop Safe)',                  29),
('Facilities & Infrastructure', 'Storage',      'Shelving (Wall, Dry Storage, Walk-In)',   30),
('Facilities & Infrastructure', 'Signage',      'Sign - Building',                         31),
('Facilities & Infrastructure', 'Signage',      'Sign- Pylon / Monument',                  32),
('Facilities & Infrastructure', 'Sinks',        'Three Compartment Sink (BOH)',            33),
('Facilities & Infrastructure', 'Sinks',        'Three Compartment Sink (FOH)',            34),
('Facilities & Infrastructure', 'Restrooms',    'Toilet – Men''s',                         35),
('Facilities & Infrastructure', 'Restrooms',    'Toilet – Women''s',                       36),
('Facilities & Infrastructure', 'Flooring',     'Wall Tile',                               37),
('Facilities & Infrastructure', 'Plumbing',     'Water Heater',                            38),
('Facilities & Infrastructure', 'Water',        'Hi-Water Usage',                          39),
-- Equipment Type
('Equipment Type', 'Ice',          'Ice Machine (Left)',         40),
('Equipment Type', 'Ice',          'Ice Machine (Right)',        41),
('Equipment Type', 'Ice',          'Ice Machine (Center)',       42),
('Equipment Type', 'Ice',          'Ice Bin',                    43),
('Equipment Type', 'Refrigeration','Walk-In Cooler',             44),
('Equipment Type', 'Refrigeration','Walk-In Freezer',            45),
('Equipment Type', 'Refrigeration','Freezer (Upright)',          46),
('Equipment Type', 'Refrigeration','Refrigerator (Upright)',     47),
('Equipment Type', 'Refrigeration','Undercounter Refrigerator',  48),
('Equipment Type', 'Refrigeration','Undercounter Freezer',       49),
('Equipment Type', 'Refrigeration','Dual Door Reach - In',       50),
('Equipment Type', 'Refrigeration','Dual Temp Reach In',         51),
('Equipment Type', 'Refrigeration','Chiller (Roof Top)',         52),
('Equipment Type', 'Refrigeration','Meat Freezer',               53),
('Equipment Type', 'Cooking',      'Fryer',                      54),
('Equipment Type', 'Cooking',      'Fryer Vent Hood',            55),
('Equipment Type', 'Cooking',      'Griddle',                    56),
('Equipment Type', 'Cooking',      'Steamer',                    57),
('Equipment Type', 'Cooking',      'Bun Toaster',                58),
('Equipment Type', 'Cooking',      'Hot Dog Roller',             59),
('Equipment Type', 'Cooking',      'Fry Dump',                   60),
('Equipment Type', 'Cooking',      'AP Warmer',                  61),
('Equipment Type', 'Cooking',      'Dresser',                    62),
('Equipment Type', 'Cooking',      'Vent Hood',                  63),
('Equipment Type', 'Beverage',     'Shake Machine',              64),
('Equipment Type', 'Beverage',     'Soft Serve',                 65),
-- POS & POPS
('POS & POPS', 'POS',  'Ordermatic',                                 70),
('POS & POPS', 'POS',  'POS Switch',                                 71),
('POS & POPS', 'POPS', 'POP – Screen (Black)',                       72),
('POS & POPS', 'POPS', 'POPs - LED Light Board',                     73),
('POS & POPS', 'POS',  'IDTech SmartPAYS Terminal and Accessories',  74),
-- Beverage
('Beverage', 'Beverage', 'Lemonade Bubbler', 80),
('Beverage', 'Beverage', 'Slush Machine',    81),
('Beverage', 'Beverage', 'Leaky Filter',     82),
-- Other
('Other', 'Other',    'Gaskets',     90),
('Other', 'Other',    'DT speaker',  91),
('Other', 'Security', 'Alarm',       92),
('Other', 'Security', 'Cameras',     93)
on conflict do nothing;

-- ── STORAGE BUCKET (wo2-ticket-photos, public) ───────────────
-- Public so the function's getPublicUrl() resolves anonymously when
-- thumbnails render in the v2 UI.
insert into storage.buckets (id, name, public)
values ('wo2-ticket-photos', 'wo2-ticket-photos', true)
on conflict (id) do update set public = excluded.public;

notify pgrst, 'reload schema';
