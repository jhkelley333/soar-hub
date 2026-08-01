-- 0267_pl_budget_target_enabled.sql
-- Per-line on/off for the P&L review. When a budget line is disabled it keeps
-- its target for reference but the review no longer flags stores against it.
-- Defaults on, so existing lines keep flagging.

alter table pl_budget_targets
  add column if not exists enabled boolean not null default true;

notify pgrst, 'reload schema';
