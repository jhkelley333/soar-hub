-- Rollback for 0069 — drop the reno_scope create-audit trigger.

drop trigger if exists reno_scopes_log_create on reno_scopes;
drop function if exists log_reno_scope_create();
