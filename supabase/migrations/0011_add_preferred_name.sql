-- supabase/migrations/0011_add_preferred_name.sql
--
-- Adds an optional preferred_name to profiles. UI uses preferred_name
-- in greetings / "from" lines / mentions when set, falling back to the
-- first token of full_name.
--
-- Idempotent.

alter table profiles
  add column if not exists preferred_name text;
