-- supabase/migrations/0003_add_phone_to_profiles.sql
--
-- Phase 2b prep: optional phone identifier on profiles.
--
-- Email stays the canonical identifier on auth.users (always required, always
-- on file for password resets / notifications). Phone is an OPTIONAL second
-- way to log in: at sign-in time the React app detects whether the user typed
-- a phone or an email, and if it's a phone, calls a small public Netlify
-- function to translate phone -> the user's canonical email. Then signs in
-- with email + password as usual.
--
-- Storage rules:
--   - profiles.phone is text, nullable, unique-when-present.
--   - Stored as 10 normalized digits (no formatting, no country code prefix).
--     The frontend / API enforce normalization before write.
--
-- Apply via the Supabase SQL editor. Idempotent.

alter table profiles
  add column if not exists phone text;

-- Unique only when set (null != null in the partial-index sense). Postgres
-- allows multiple rows with NULL in a UNIQUE column by default — but we'll
-- still rely on normalization at the app layer to keep this clean.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'profiles'
      and indexname = 'profiles_phone_unique_idx'
  ) then
    create unique index profiles_phone_unique_idx
      on profiles (phone)
      where phone is not null;
  end if;
end$$;

-- Sanity check on shape: 10 digits exactly when present. Easy to soften
-- later if international numbers come into scope.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_phone_format_ck'
  ) then
    alter table profiles
      add constraint profiles_phone_format_ck
      check (phone is null or phone ~ '^[0-9]{10}$');
  end if;
end$$;
