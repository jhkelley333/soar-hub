-- 0155_manual_activate_rpc.sql
-- Manual & Guide Search — Phase 2 activation. Flip one doc_version live and the
-- previously-active one (for the same manual) inactive, in a single
-- transaction. Old version steps aside; its row + chunks are retained.
-- The one_active_version_per_manual partial unique index keeps this honest:
-- we clear actives first, then set the target, so the index never conflicts.
-- Gated to RVP-and-up + admin (same as manual_can_manage()); SECURITY DEFINER
-- so it can flip flags past RLS for an authorized caller.

create or replace function activate_doc_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual uuid;
begin
  if not manual_can_manage() then
    raise exception 'Not authorized to activate manual versions.' using errcode = '42501';
  end if;

  select manual_id into v_manual from doc_versions where id = p_version_id;
  if v_manual is null then
    raise exception 'doc_version % not found.', p_version_id using errcode = 'P0002';
  end if;

  update doc_versions set is_active = false
    where manual_id = v_manual and is_active and id <> p_version_id;
  update doc_versions set is_active = true
    where id = p_version_id;
end;
$$;

notify pgrst, 'reload schema';
