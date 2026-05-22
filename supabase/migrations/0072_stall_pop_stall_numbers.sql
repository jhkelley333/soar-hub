-- supabase/migrations/0072_stall_pop_stall_numbers.sql
--
-- Mirror of the patio_pop_stall_numbers field: lets the scoper record
-- WHICH stalls have POP menus on them (e.g. "1,2,5"), not just the count.
-- Lives on stores.* so the canonical store row carries it.
--
-- Idempotent.

alter table stores
  add column if not exists stall_pop_stall_numbers text;
