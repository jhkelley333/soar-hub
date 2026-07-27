-- 0262_no_gm_credits_edit_log.sql
-- Add an append-only edit audit log to no_gm_credits so a tag can be edited at
-- any time (active, ended, or upcoming) with a note recorded per change. Each
-- entry is { at, by_id, by_email, note, changes }. Pure ASCII.

alter table no_gm_credits
  add column if not exists edit_log jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
