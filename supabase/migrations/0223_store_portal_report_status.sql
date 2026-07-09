-- 0223_store_portal_report_status.sql
-- Floor reports become a worklist instead of an email: each report carries a
-- status (new -> escalated -> resolved) shown in the leader Inbox on Chat.
-- Existing rows were already delivered by email under the old behavior, so
-- they backfill as resolved and the new Inbox starts clean. Pure ASCII.

alter table store_portal_reports
  add column if not exists status        text not null default 'new',
  add column if not exists escalated_by  uuid references profiles(id) on delete set null,
  add column if not exists escalated_at  timestamptz,
  add column if not exists resolved_by   uuid references profiles(id) on delete set null,
  add column if not exists resolved_at   timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_portal_reports_status_ck'
  ) then
    alter table store_portal_reports
      add constraint store_portal_reports_status_ck
      check (status in ('new', 'escalated', 'resolved'));
  end if;
end $$;

update store_portal_reports set status = 'resolved', resolved_at = now()
where status = 'new' and created_at < now();

create index if not exists store_portal_reports_status_idx
  on store_portal_reports (status, created_at desc);

notify pgrst, 'reload schema';
