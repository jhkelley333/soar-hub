-- supabase/migrations/0013_profile_extras.sql
--
-- Adds personal profile fields used by the My Account page:
--   profile_photo_url  text  — public URL to the user's avatar (avatars bucket)
--   birthday           date  — optional, used for celebratory surfaces
--   shirt_size         text  — uniform sizing (XS..5XL etc., free-form text)
--   favorite_quote     text  — optional flavor; rendered on profile views
--   cfm_cert_number    text  — Certified Food Manager certificate number
--   cfm_issued_at      date  — date the CFM cert was issued
--   cfm_expires_at     date  — generated: cfm_issued_at + 5 years (CFM rule)
--
-- The cfm_expires_at column is a stored generated column so dashboard
-- queries ("expiring in 60 days") can index/order on it without
-- re-computing every read. Setting / clearing cfm_issued_at flips
-- expires_at automatically.
--
-- Idempotent.

alter table profiles
  add column if not exists profile_photo_url text,
  add column if not exists birthday          date,
  add column if not exists shirt_size        text,
  add column if not exists favorite_quote    text,
  add column if not exists cfm_cert_number   text,
  add column if not exists cfm_issued_at     date;

-- Generated column has to be added on its own (Postgres limitation:
-- can't combine GENERATED with the other ADD COLUMN entries above).
-- Skip if it already exists so re-running is safe.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'cfm_expires_at'
  ) then
    alter table profiles
      add column cfm_expires_at date
      generated always as (cfm_issued_at + interval '5 years') stored;
  end if;
end$$;

-- Index for the dashboard "expiring in 60 days" rollup we'll wire up
-- once the data is populated.
create index if not exists profiles_cfm_expires_at_idx
  on profiles (cfm_expires_at)
  where cfm_expires_at is not null;
