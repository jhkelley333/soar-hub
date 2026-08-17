-- 0293_profile_workstyle_apparel.sql
-- Add self-service profile fields: work-style assessment results (Cultural
-- Index, DISC, SCARF) and two more apparel sizes (jacket + quarter-zip), each
-- with a cut like the existing shirt_size / shirt_cut pair.

alter table public.profiles
  add column if not exists cultural_index_trait text,
  add column if not exists disc_profile         text,
  add column if not exists scarf_results        text,
  add column if not exists jacket_size          text,
  add column if not exists jacket_cut           text,  -- "mens" | "womens" | null
  add column if not exists quarter_zip_size     text,
  add column if not exists quarter_zip_cut      text;  -- "mens" | "womens" | null

-- No new RLS needed: these are columns on profiles, covered by the existing
-- "user can update their own row" policy, same as shirt_size / favorite_quote.
