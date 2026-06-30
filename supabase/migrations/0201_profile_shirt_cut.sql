-- 0201_profile_shirt_cut.sql
-- Adds profiles.shirt_cut so My Account can collect Men's/Women's cut
-- alongside the existing shirt_size. Mirrors shirt_size: free text, but
-- constrained to the two known values since the app's dropdown only ever
-- writes 'mens' or 'womens'.
--
-- Idempotent.

alter table profiles
  add column if not exists shirt_cut text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_shirt_cut_check'
  ) then
    alter table profiles
      add constraint profiles_shirt_cut_check
      check (shirt_cut is null or shirt_cut in ('mens', 'womens'));
  end if;
end$$;

notify pgrst, 'reload schema';
