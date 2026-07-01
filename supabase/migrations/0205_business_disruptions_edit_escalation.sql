-- 0205_business_disruptions_edit_escalation.sql
-- Two additions for Business Disruptions:
--   * escalated_to_rvp_name — set when a report involves an employee/
--     customer injury or store damage, so the detail view can show who
--     (if anyone) was escalated to alongside the District Manager.
--   * updated_by_name — who last edited the report (edits are now allowed
--     by the original submitter or any DO+ reviewer in scope), so the
--     detail view can show "Last edited by X" instead of just a timestamp.

alter table public.business_disruptions
  add column if not exists escalated_to_rvp_name text,
  add column if not exists updated_by_name        text;

notify pgrst, 'reload schema';
