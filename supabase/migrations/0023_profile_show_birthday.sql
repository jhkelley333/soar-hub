-- supabase/migrations/0023_profile_show_birthday.sql
--
-- Phase: My Stores + Birthdays.
--
-- Adds an opt-out flag for the dashboard birthday widget. Defaults to
-- true (auto opt-in) so existing users light up immediately. Only GMs
-- get a toggle to flip it off; DO/SDO/RVP/Payroll/Admin can't opt out
-- (enforced in app code, not schema). Confetti on the user's own
-- birthday fires regardless of this flag — it's their personal moment.

alter table profiles
  add column if not exists show_birthday boolean not null default true;

-- Belt-and-suspenders backfill for any pre-existing rows (NOT NULL +
-- default already covers it, but explicit update makes the intent
-- visible in the migration log).
update profiles
  set show_birthday = true
  where show_birthday is null;
