-- Rollback for 0072_stall_pop_stall_numbers.sql

alter table stores
  drop column if exists stall_pop_stall_numbers;
