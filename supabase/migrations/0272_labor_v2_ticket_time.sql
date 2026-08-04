-- 0272_labor_v2_ticket_time.sql
-- Persist the feed's ticket-time fields (totalTicketTime + onTimeQuantity) into
-- labor_v2_daily for the daily / WTD / PTD bands, so the Execution Metrics Board
-- can show Avg Ticket Time = SUM(total_ticket_time) / SUM(on_time_quantity)
-- aggregated across a scope's stores. Capture strips these columns and retries
-- until this migration runs, so the hourly capture keeps landing without them.

alter table labor_v2_daily
  add column if not exists total_ticket_time       numeric,
  add column if not exists on_time_quantity        numeric,
  add column if not exists wtd_total_ticket_time   numeric,
  add column if not exists wtd_on_time_quantity    numeric,
  add column if not exists ptd_total_ticket_time   numeric,
  add column if not exists ptd_on_time_quantity    numeric;

notify pgrst, 'reload schema';
