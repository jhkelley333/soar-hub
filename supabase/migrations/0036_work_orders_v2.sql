-- supabase/migrations/0036_work_orders_v2.sql
--
-- Work Orders V2 schema. All tables prefixed `wo2_` so they never
-- collide with the existing v1 Work Orders module on main while v2
-- is in development on the claude/work-orders-v2 branch.
--
-- Direct table SELECT is admin-only via RLS; all reads + writes from
-- the UI flow through netlify/functions/facilities-v2 (service role).
--
-- Required Supabase Storage bucket (create manually in the dashboard
-- before testing uploads):
--   Name: wo2-ticket-photos
--   Public: true
--   File-size limit: 10 MB
--
-- DO NOT APPLY YET — this lives on a long-running branch and only
-- runs when v2 is ready to be tested in the Soar Hub v2 Supabase
-- project.

create table wo2_tickets (
  id                       uuid        primary key default uuid_generate_v4(),
  wo_number                text        unique not null,
  store_number             text        not null,
  store_name               text,
  store_email              text,
  do_email                 text,
  sdo_email                text,
  submitted_by             text,
  submitted_by_user_id     uuid,
  category                 text,
  asset_type               text,
  model_number             text,
  issue_description        text,
  status                   text        not null default 'Received',
  priority                 text        not null default 'Standard',
  is_business_critical     boolean     not null default false,
  troubleshooting_checked  boolean     not null default false,
  vendor_contacted         boolean     not null default false,
  vendor_id                uuid,
  vendor_name              text,
  vendor_eta               timestamptz,
  cost_estimate            numeric(12,2),
  latest_comment           text,
  approval_level           text,
  approval_request_notes   text,
  approval_status          text,
  approval_approved_by     text,
  approval_approved_at     timestamptz,
  date_submitted           timestamptz not null default now(),
  date_status_updated      timestamptz,
  date_completed           timestamptz,
  updated_at               timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create index wo2_tickets_store_idx  on wo2_tickets (store_number);
create index wo2_tickets_status_idx on wo2_tickets (status);
create index wo2_tickets_date_idx   on wo2_tickets (date_submitted desc);

create table wo2_ticket_photos (
  id          uuid        primary key default uuid_generate_v4(),
  ticket_id   uuid        not null references wo2_tickets(id) on delete cascade,
  file_url    text        not null,
  file_name   text,
  file_size   bigint,
  mime_type   text,
  uploaded_by text,
  upload_type text        not null default 'update',
  created_at  timestamptz not null default now()
);
create index wo2_ticket_photos_ticket_idx on wo2_ticket_photos (ticket_id);

create table wo2_ticket_updates (
  id           uuid        primary key default uuid_generate_v4(),
  ticket_id    uuid        not null references wo2_tickets(id) on delete cascade,
  user_id      uuid,
  user_name    text,
  user_role    text,
  update_type  text        not null,
  old_value    text,
  new_value    text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index wo2_ticket_updates_ticket_idx  on wo2_ticket_updates (ticket_id);
create index wo2_ticket_updates_created_idx on wo2_ticket_updates (created_at desc);

create table wo2_ticket_approvals (
  id            uuid        primary key default uuid_generate_v4(),
  ticket_id     uuid        not null references wo2_tickets(id) on delete cascade,
  approval_tier text        not null,
  status        text        not null default 'Pending',
  requested_by  text,
  requested_at  timestamptz not null default now(),
  approved_by   text,
  approved_at   timestamptz,
  notes         text,
  quote_url     text
);
create index wo2_ticket_approvals_ticket_idx on wo2_ticket_approvals (ticket_id);
create index wo2_ticket_approvals_status_idx on wo2_ticket_approvals (status);

create table wo2_ticket_messages (
  id          uuid        primary key default uuid_generate_v4(),
  ticket_id   uuid        not null references wo2_tickets(id) on delete cascade,
  user_id     uuid,
  user_name   text,
  user_role   text,
  message     text        not null,
  thread_type text        not null check (thread_type in ('internal', 'vendor')),
  created_at  timestamptz not null default now()
);
create index wo2_ticket_messages_ticket_idx on wo2_ticket_messages (ticket_id);
create index wo2_ticket_messages_thread_idx on wo2_ticket_messages (thread_type);

create table wo2_vendors (
  id             uuid        primary key default uuid_generate_v4(),
  name           text        not null,
  category       text,
  service_area   text,
  services       text,
  phone          text,
  email          text,
  website        text,
  contact_person text,
  notes          text,
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index wo2_vendors_name_idx   on wo2_vendors (name);
create index wo2_vendors_active_idx on wo2_vendors (is_active);

create table wo2_vendor_ratings (
  id           uuid        primary key default uuid_generate_v4(),
  vendor_id    uuid        not null references wo2_vendors(id) on delete cascade,
  ticket_id    uuid        references wo2_tickets(id) on delete set null,
  store_number text,
  rating       smallint    not null check (rating between 1 and 5),
  comment      text,
  rated_by     text,
  rated_at     timestamptz not null default now()
);
create index wo2_vendor_ratings_vendor_idx on wo2_vendor_ratings (vendor_id);

create table wo2_issue_library (
  id           uuid    primary key default uuid_generate_v4(),
  category     text    not null,
  asset_type   text    not null,
  display_name text    not null,
  sort_order   integer not null default 0
);
create index wo2_issue_library_cat_idx on wo2_issue_library (category, sort_order);

create table wo2_sequences (
  store_number   text    primary key,
  last_sequence  integer not null default 0
);

-- Atomic WO-number generator. Used by the netlify function to
-- assign sequential numbers per store ("WO-1082-001", "WO-1082-002").
-- Function name kept generic so future modules could reuse if needed,
-- but the table it touches is the wo2-prefixed sequences table.
create or replace function next_wo_sequence(p_store text)
returns integer
language plpgsql
as $$
declare
  next_seq integer;
begin
  insert into wo2_sequences (store_number, last_sequence)
  values (p_store, 1)
  on conflict (store_number)
  do update set last_sequence = wo2_sequences.last_sequence + 1
  returning last_sequence into next_seq;
  return next_seq;
end;
$$;

-- RLS — all tables admin-only direct SELECT; everything else flows
-- through netlify functions on the service-role key.
alter table wo2_tickets           enable row level security;
alter table wo2_ticket_photos     enable row level security;
alter table wo2_ticket_updates    enable row level security;
alter table wo2_ticket_approvals  enable row level security;
alter table wo2_ticket_messages   enable row level security;
alter table wo2_vendors           enable row level security;
alter table wo2_vendor_ratings    enable row level security;
alter table wo2_issue_library     enable row level security;
alter table wo2_sequences         enable row level security;

create policy wo2_tickets_admin_select on wo2_tickets
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_ticket_photos_admin_select on wo2_ticket_photos
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_ticket_updates_admin_select on wo2_ticket_updates
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_ticket_approvals_admin_select on wo2_ticket_approvals
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_ticket_messages_admin_select on wo2_ticket_messages
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_vendors_admin_select on wo2_vendors
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_vendor_ratings_admin_select on wo2_vendor_ratings
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy wo2_issue_library_admin_select on wo2_issue_library
  for select using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

comment on table wo2_tickets is 'Work Orders V2 — in-development on claude/work-orders-v2 branch. Do not surface in production until UI ports complete.';

notify pgrst, 'reload schema';
