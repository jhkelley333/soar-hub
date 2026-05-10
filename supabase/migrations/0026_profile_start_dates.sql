-- supabase/migrations/0026_profile_start_dates.sql
--
-- Adds two date fields to public.profiles for HR / leadership tracking:
--
--   start_date         — when the person joined SOAR (one date per person)
--   gm_assigned_date   — when the person was assigned as GM at their
--                        current store. Resets when the GM transfers to
--                        a different store. Only meaningful for role='gm'
--                        but stored on every profile so the UI can
--                        display it without a join.
--
-- Both nullable. Editable only via leadership flow (team-mgmt.js
-- update-user); not surfaced in self-service Account Settings.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

alter table profiles
  add column if not exists start_date       date,
  add column if not exists gm_assigned_date date;

notify pgrst, 'reload schema';
