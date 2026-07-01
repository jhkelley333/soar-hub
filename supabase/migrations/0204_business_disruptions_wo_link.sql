-- 0204_business_disruptions_wo_link.sql
-- Two new conditional fields on Business Disruptions:
--   * solugenix_case_number — shown when Closure/Disruption Type includes
--     Internet Issue / POS Issues / Connectivity Issues.
--   * work_order_filed (+ the linked ticket) — shown when the type includes
--     Plumbing / Vandalism / Equipment Failure / Other. work_order_ticket_id
--     links to the existing Work Orders V2 tickets table; work_order_number
--     is denormalized (matches the store_number/store_name pattern already
--     used elsewhere) so the detail view doesn't need a join to display it.

alter table public.business_disruptions
  add column if not exists solugenix_case_number text,
  add column if not exists work_order_filed       boolean,
  add column if not exists work_order_ticket_id    uuid references public.tickets(id) on delete set null,
  add column if not exists work_order_number       text;

notify pgrst, 'reload schema';
