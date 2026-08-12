-- 0285_gm_roster_no_credit.sql
-- Add a per-store "no GM credit" flag to the GM roster — marks a store that
-- should not be credited to a GM (e.g. vacant, interim, or excluded from GM
-- standings). Defaults false; edited by DO and above from the roster.
alter table gm_roster add column if not exists no_gm_credit boolean not null default false;
