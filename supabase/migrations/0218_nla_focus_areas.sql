-- 0218_nla_focus_areas.sql
-- NLA Phase 3: the 2-3 aligned focus areas a leader and team member choose
-- together from the comparison. Each becomes a development goal in Phase 4.
-- Service-role gatekeeper: RLS on, no policies - the nla function scope-checks.
-- Pure ASCII, minimal string literals (paste-safe).

create table if not exists tp_nla_focus_areas (
  id                 uuid primary key default gen_random_uuid(),
  assessment_id      uuid not null references tp_nla_assessments(id) on delete cascade,
  competency_key     text not null,
  template_item_id   uuid references tp_nla_template_items(id) on delete set null,
  gap_type           text,               -- aligned | blind_spot | confidence_gap
  note               text,
  suggested_resource text,
  sort_order         int not null default 0,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists tp_nla_focus_unique on tp_nla_focus_areas (assessment_id, competency_key);
create index if not exists tp_nla_focus_assess_idx on tp_nla_focus_areas (assessment_id);

drop trigger if exists tp_nla_focus_touch on tp_nla_focus_areas;
create trigger tp_nla_focus_touch before update on tp_nla_focus_areas
  for each row execute function tp_touch_updated_at();

alter table tp_nla_focus_areas enable row level security;

notify pgrst, 'reload schema';
