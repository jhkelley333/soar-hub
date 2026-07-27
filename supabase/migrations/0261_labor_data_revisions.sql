-- 0261_labor_data_revisions.sql
-- Restatement log: whenever a daily KPI/labor pull changes a value that was
-- already captured for a (store, business_date), record the field-level change
-- (old -> new). The pull still auto-updates the sheet (latest wins); this is
-- the audit trail so admins can see what moved and when. Covers both the labor
-- feed (labor_v2_daily) and the count feed (count_daily). Service-only: RLS on.

create table if not exists labor_data_revisions (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('labor', 'count')),
  store_number  text not null,
  business_date date not null,
  field         text not null,
  old_value     numeric,
  new_value     numeric,
  pull_source   text,               -- 'refresh' | 'cron' | 'self-heal'
  detected_at   timestamptz not null default now()
);

create index if not exists labor_data_revisions_detected_idx on labor_data_revisions (detected_at desc);
create index if not exists labor_data_revisions_bd_idx on labor_data_revisions (business_date, store_number);

alter table labor_data_revisions enable row level security;

notify pgrst, 'reload schema';
