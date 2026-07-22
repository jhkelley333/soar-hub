-- 0255_store_visit_schema.sql
-- Store Visit app (mobile, DO+): visits, walk checklists, action items,
-- review requests, computed Top-3 gaps, and per-visit metric snapshots for
-- trend. Stores can be visited more than once per week — nothing here assumes
-- one-visit-per-store-per-week. RLS on with no policies: only the Netlify
-- function (service key) reads/writes and it role-checks + strips private notes.

-- Config-driven gap metrics. The gaps engine ranks a store's metrics by how far
-- past target they are and takes the worst three. Adding a metric here (with a
-- wired source) needs no UI change. target_raw may be null for metrics whose
-- target is dynamic per store (e.g. labor chart resolved from the feed).
create table if not exists store_visit_metrics (
  key         text primary key,
  label       text not null,
  unit        text not null default 'pct',      -- 'pct' | 'time' | 'number'
  direction   text not null default 'higher',   -- 'higher' | 'lower' (better)
  target_raw  numeric,                           -- fallback/fixed target; null = dynamic
  source      text not null default 'manual',    -- 'labor' | 'walk' | 'manual' | ...
  is_active   boolean not null default true,
  sort        int not null default 100
);

create table if not exists checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_role  text not null default 'do',
  is_active   boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists checklist_items (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references checklist_templates(id) on delete cascade,
  category         text not null default 'General',
  label            text not null,
  sort             int not null default 100,
  required_by_role text,                          -- who flagged it (review push-down)
  created_at       timestamptz not null default now()
);
create index if not exists checklist_items_template_idx on checklist_items (template_id);

create table if not exists store_visits (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  visitor_id     uuid references profiles(id) on delete set null,
  visitor_role   text,
  template_id    uuid references checklist_templates(id) on delete set null,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  status         text not null default 'in_progress',  -- 'in_progress' | 'submitted'
  walk_score     numeric,                               -- % pass of scored items
  summary        text,                                  -- shared, store-visible
  summary_photos jsonb not null default '[]',
  private_note   text,                                  -- leadership-only (role >= sdo)
  funds_reviewed boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists store_visits_store_idx on store_visits (store_id, started_at desc);

create table if not exists walk_results (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references store_visits(id) on delete cascade,
  item_id    uuid references checklist_items(id) on delete set null,
  category   text,
  label      text,
  status     text not null default 'pass',   -- 'pass' | 'gap' | 'na'
  note       text,
  photos     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (visit_id, item_id)
);
create index if not exists walk_results_visit_idx on walk_results (visit_id);

create table if not exists action_items (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  origin_visit_id uuid references store_visits(id) on delete set null,
  text           text not null,
  owner          text,
  priority       text not null default 'med',   -- 'high' | 'med' | 'low'
  due            date,
  status         text not null default 'open',  -- 'open' | 'improved' | 'worse' | 'resolved'
  work_order_id  uuid,
  log            jsonb not null default '[]',    -- [{ who, at, text }]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists action_items_store_idx on action_items (store_id, status);

create table if not exists review_requests (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references stores(id) on delete cascade,
  by_user_id       uuid references profiles(id) on delete set null,
  by_role          text,
  text             text not null,
  item_id          uuid references checklist_items(id) on delete set null,
  open_until_visit_id uuid references store_visits(id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists review_requests_store_idx on review_requests (store_id) where resolved_at is null;

-- Per-visit snapshot of each metric's value + target, so the NEXT visit can show
-- trend (improved/worsened) against the last completed visit.
create table if not exists visit_metric_snapshots (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references store_visits(id) on delete cascade,
  store_id    uuid not null references stores(id) on delete cascade,
  metric_key  text not null,
  value_raw   numeric,
  target_raw  numeric,
  severity    numeric,
  captured_at timestamptz not null default now()
);
create index if not exists visit_metric_snapshots_store_idx on visit_metric_snapshots (store_id, metric_key, captured_at desc);

alter table store_visit_metrics   enable row level security;
alter table checklist_templates   enable row level security;
alter table checklist_items       enable row level security;
alter table store_visits          enable row level security;
alter table walk_results          enable row level security;
alter table action_items          enable row level security;
alter table review_requests       enable row level security;
alter table visit_metric_snapshots enable row level security;

-- Seed the default gap metrics. labor_to_chart's target is dynamic (per-store
-- chart from the labor feed) so target_raw stays null.
insert into store_visit_metrics (key, label, unit, direction, target_raw, source, sort) values
  ('labor_to_chart', 'Labor to Chart',      'pct',  'lower',  null, 'labor',  10),
  ('cleanliness',    'Cleanliness',         'pct',  'higher', 0.90, 'walk',   20),
  ('speed_of_service','Speed of Service',   'time', 'lower',  210,  'manual', 30),
  ('food_safety',    'Food Safety Log',     'pct',  'higher', 1.00, 'manual', 40),
  ('guest_sat',      'Guest Satisfaction',  'pct',  'higher', 0.85, 'manual', 50)
on conflict (key) do nothing;

-- A default store-walk checklist so a visit can start out of the box.
do $$
declare tpl uuid;
begin
  if not exists (select 1 from checklist_templates where name = 'Standard Store Walk') then
    insert into checklist_templates (name, owner_role) values ('Standard Store Walk', 'do') returning id into tpl;
    insert into checklist_items (template_id, category, label, sort) values
      (tpl, 'Exterior',    'Lot, landscaping & signage clean and lit', 10),
      (tpl, 'Exterior',    'Drive-thru menu boards clean & correct',   20),
      (tpl, 'Dining',      'Dining room & patio clean and stocked',    30),
      (tpl, 'Dining',      'Guest-facing team in proper uniform',      40),
      (tpl, 'Kitchen',     'Line organized, stocked, clean',           50),
      (tpl, 'Kitchen',     'Build-to charts followed',                 60),
      (tpl, 'Food Safety', 'Temp & food safety logs current',          70),
      (tpl, 'Food Safety', 'Handwashing & glove compliance',           80),
      (tpl, 'Restrooms',   'Restrooms clean & stocked',                90),
      (tpl, 'Team',        'Shift huddle / goals posted',              100);
  end if;
end $$;

notify pgrst, 'reload schema';
