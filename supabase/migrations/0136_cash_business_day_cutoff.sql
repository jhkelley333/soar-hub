-- supabase/migrations/0136_cash_business_day_cutoff.sql
--
-- Business-day cutoff hour for night closeouts. Stores close as late as 3 AM
-- Central — when a team counts the drawer at 2 AM on the 8th, they're closing
-- the 7th's business. Without a cutoff the server stamps the closeout with
-- the wall-clock UTC date, which lands on the wrong day.
--
-- 5 AM Central is the default: anything submitted before 5 AM CT counts as
-- the prior business day. Admin-tunable via SettingsTab.
--
-- Idempotent.

alter table public.cash_settings
  add column if not exists business_day_cutoff_hour int not null default 5
  check (business_day_cutoff_hour between 0 and 23);

notify pgrst, 'reload schema';
