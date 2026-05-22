-- Rollback for migration 0065 — drop the self-serve flag + index.

drop index if exists workspace_templates_self_serve_idx;
alter table workspace_templates drop column if exists is_self_serve;
