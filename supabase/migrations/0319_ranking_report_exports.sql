-- 0319_ranking_report_exports.sql
-- Append-only audit log of executive-summary PDF exports off the Ranker page.
-- Immutability is enforced at the database layer: insert only, no update, no
-- delete. RLS lives in this same migration. Role source is profiles.role (this
-- Hub has no user_roles table — the handoff assumed one; corrected here).

create table if not exists public.ranking_report_exports (
  id             uuid primary key default gen_random_uuid(),
  run_id         text        not null,
  report_key     text        not null,
  period_label   text        not null,
  week_ending    date        not null,
  store_count    integer     not null,
  filename       text        not null,
  data_warnings  jsonb       not null default '[]'::jsonb,
  render_ms      integer,
  exported_by    uuid        not null default auth.uid() references auth.users (id),
  exported_at    timestamptz not null default now()
);

create index if not exists ranking_report_exports_run_idx
  on public.ranking_report_exports (run_id, exported_at desc);
create index if not exists ranking_report_exports_user_idx
  on public.ranking_report_exports (exported_by, exported_at desc);

-- ---------------------------------------------------------------------------
-- Immutability — reject every UPDATE and DELETE at the row level, so the log
-- is append-only even for the service role.
-- ---------------------------------------------------------------------------
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ranking_report_exports is append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists ranking_report_exports_no_update on public.ranking_report_exports;
create trigger ranking_report_exports_no_update
  before update on public.ranking_report_exports
  for each row execute function public.reject_mutation();

drop trigger if exists ranking_report_exports_no_delete on public.ranking_report_exports;
create trigger ranking_report_exports_no_delete
  before delete on public.ranking_report_exports
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ranking_report_exports enable row level security;

-- Anyone signed in may record their own export.
drop policy if exists ranking_report_exports_insert_own on public.ranking_report_exports;
create policy ranking_report_exports_insert_own
  on public.ranking_report_exports
  for insert
  to authenticated
  with check (exported_by = auth.uid());

-- Users see their own exports; COO and admin see everything.
drop policy if exists ranking_report_exports_select on public.ranking_report_exports;
create policy ranking_report_exports_select
  on public.ranking_report_exports
  for select
  to authenticated
  using (
    exported_by = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coo', 'admin')
    )
  );

-- No UPDATE or DELETE policies are granted; the triggers above reject those
-- operations regardless of policy or role.

comment on table public.ranking_report_exports is
  'Append-only record of executive-summary PDF exports from the Ranker page.';

notify pgrst, 'reload schema';
