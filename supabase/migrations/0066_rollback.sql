-- Rollback for 0066_reno_scoping_schema — drop all reno_scoping objects
-- in reverse dependency order.

drop policy if exists reno_scope_audit_log_read on reno_scope_audit_log;

drop policy if exists reno_scope_notes_insert on reno_scope_notes;
drop policy if exists reno_scope_notes_read on reno_scope_notes;

drop policy if exists reno_scope_tours_write on reno_scope_tours;
drop policy if exists reno_scope_tours_read on reno_scope_tours;

drop policy if exists reno_scope_photos_write on reno_scope_photos;
drop policy if exists reno_scope_photos_read on reno_scope_photos;

drop policy if exists reno_scope_items_write on reno_scope_items;
drop policy if exists reno_scope_items_read on reno_scope_items;

drop policy if exists reno_scopes_delete_own_draft on reno_scopes;
drop policy if exists reno_scopes_update_reviewer on reno_scopes;
drop policy if exists reno_scopes_update_own_draft on reno_scopes;
drop policy if exists reno_scopes_insert_scoper on reno_scopes;
drop policy if exists reno_scopes_read_visible on reno_scopes;

drop policy if exists scope_photo_slots_write_admin on scope_photo_slots;
drop policy if exists scope_photo_slots_read_authenticated on scope_photo_slots;

drop policy if exists scope_template_items_write_admin on scope_template_items;
drop policy if exists scope_template_items_read_authenticated on scope_template_items;

drop policy if exists scope_templates_write_admin on scope_templates;
drop policy if exists scope_templates_read_authenticated on scope_templates;

drop trigger if exists reno_scopes_derive_cohort           on reno_scopes;
drop trigger if exists reno_scope_items_set_updated_at     on reno_scope_items;
drop trigger if exists reno_scopes_set_updated_at          on reno_scopes;
drop trigger if exists scope_template_items_set_updated_at on scope_template_items;
drop trigger if exists scope_templates_set_updated_at      on scope_templates;

drop function if exists derive_reno_cohort();

drop table if exists reno_scope_audit_log;
drop table if exists reno_scope_notes;
drop table if exists reno_scope_tours;
drop table if exists reno_scope_photos;
drop table if exists reno_scope_items;
drop table if exists reno_scopes;
drop table if exists scope_photo_slots;
drop table if exists scope_template_items;
drop table if exists scope_templates;

drop type if exists scope_input_type;
drop type if exists reno_cohort;
drop type if exists building_type;
drop type if exists scope_status;
drop type if exists scope_item_status;
drop type if exists scope_tier;
