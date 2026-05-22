-- Rollback for 0067_reno_scoping_seed — removes the Sonic Reskin 2026
-- template and all of its items + photo slots. Safe to re-run.
-- Leaves the schema (tables, enums, triggers, RLS) intact; use the
-- 0066 rollback for that.

delete from scope_template_items
  where template_id = '11111111-1111-1111-1111-111111111111';

delete from scope_photo_slots
  where template_id = '11111111-1111-1111-1111-111111111111';

delete from scope_templates
  where id = '11111111-1111-1111-1111-111111111111';
