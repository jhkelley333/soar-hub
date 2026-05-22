-- supabase/migrations/0069_reno_scope_audit_create_trigger.sql
--
-- Adds a trigger that drops a "create" row into reno_scope_audit_log
-- whenever a reno_scopes row is inserted. Lets the Review-tab timeline
-- show the scope's origin even though scope creation happens via direct
-- client insert (not through the netlify function).
--
-- The transition actions (submit / review / needs_revision / approve /
-- reopen) flow through netlify/functions/reno-scoping.js which writes
-- its own audit row using the service-role key.
--
-- The function is SECURITY DEFINER so it can insert into
-- reno_scope_audit_log despite that table having no INSERT policy
-- (audit writes are intentionally not exposed to the anon/authed client).

create or replace function log_reno_scope_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  store_state text;
  actor_email text;
begin
  select state into store_state from stores where id = new.store_id;
  select email into actor_email from profiles where id = new.scoped_by;

  insert into reno_scope_audit_log (
    scope_id,
    actor_id,
    actor_email,
    action,
    from_status,
    to_status,
    detail
  ) values (
    new.id,
    new.scoped_by,
    actor_email,
    'create',
    null,
    new.status,
    jsonb_build_object(
      'store_id',      new.store_id,
      'store_state',   store_state,
      'building_type', new.building_type,
      'cohort',        new.cohort
    )
  );
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reno_scopes_log_create') then
    create trigger reno_scopes_log_create
      after insert on reno_scopes
      for each row execute function log_reno_scope_create();
  end if;
end $$;
