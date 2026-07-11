-- 0233_paf_cutoffs.sql
-- Payroll cutoff for PAFs: Wednesday 10:00 AM Central by default. A PAF
-- submitted after the current week's cutoff is flagged late and stamped into
-- the NEXT week's processing batch. paf_cutoffs holds per-week overrides
-- (holiday weeks, planned in advance) keyed by the pay week's Sunday.
-- Service-role gatekeeper: RLS on, no policies. Pure ASCII.

create table if not exists paf_cutoffs (
  week_sunday  date primary key,
  cutoff_at    timestamptz not null,
  note         text,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table paf_cutoffs enable row level security;

alter table paf_submissions
  add column if not exists late_for_week boolean not null default false,
  add column if not exists process_week  date;

notify pgrst, 'reload schema';
