-- 0149_team_pipeline_backfill.sql
-- Add the GM-bench "Identified backfill" succession note to roster members.
-- Applies to leadership seats (primarily GM); null until a DO records a plan.
alter table tp_team_members add column if not exists backfill text;
