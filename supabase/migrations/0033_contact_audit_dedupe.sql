-- supabase/migrations/0033_contact_audit_dedupe.sql
--
-- Updates log_contact_change() so that a per-store hide/unhide write
-- (the only change being hidden_for_store_ids) no longer produces a
-- second 'update' audit row. The application already inserts an
-- explicit 'hide' / 'unhide' row in netlify/functions/contacts.js, so
-- the trigger-generated 'update' was duplicative.
--
-- Logic: compare to_jsonb(old) minus updated_at minus hidden_for_store_ids
-- against the same projection of new. If they're equal AND hidden_for_store_ids
-- did change, this is a hide/unhide-only update — return without logging.
-- Any other column change still logs as before.

create or replace function log_contact_change() returns trigger
language plpgsql security definer as $$
declare
  actor uuid := auth.uid();
  before_proj jsonb;
  after_proj jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (new.id, actor, 'create', to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    before_proj := to_jsonb(old) - 'updated_at' - 'hidden_for_store_ids';
    after_proj  := to_jsonb(new) - 'updated_at' - 'hidden_for_store_ids';
    if before_proj = after_proj
       and old.hidden_for_store_ids is distinct from new.hidden_for_store_ids then
      -- hide/unhide-only update — app inserts an explicit row separately
      return new;
    end if;
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (
      new.id,
      actor,
      'update',
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    );
    return new;
  elsif TG_OP = 'DELETE' then
    insert into contact_audit_log (contact_id, changed_by, action, changes)
    values (old.id, actor, 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

notify pgrst, 'reload schema';
