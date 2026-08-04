-- 0275_board_ticket_time_and_targets.sql
-- Two Execution Metrics Board additions:
--  1. average_ticket_time (daily/WTD/PTD) on labor_v2_daily — the feed's own
--     averageTicketTime per store, so the board's Avg Ticket Time is a ticket-
--     weighted mean of it (more reliable than total/quantity when those are null).
--  2. board_metric_targets — admin-set target overrides per metric id, edited in
--     the board's Targets panel. Labor's target stays data-driven (from the feed)
--     and is not stored here.

alter table labor_v2_daily
  add column if not exists average_ticket_time      numeric,
  add column if not exists wtd_average_ticket_time  numeric,
  add column if not exists ptd_average_ticket_time  numeric;

create table if not exists board_metric_targets (
  metric_id   text        primary key,
  target      numeric,
  updated_by  uuid        references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Service-role writes only (kpi-board sets these); RLS on with no policies.
alter table board_metric_targets enable row level security;

notify pgrst, 'reload schema';
