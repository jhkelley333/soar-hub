-- supabase/migrations/0084_chat_managed_sync.sql
--
-- Bulk reconcile for managed groups. Reconciles every active (non-archived)
-- managed group against the live org roster. Called after My Team mutations
-- (hire / deactivate / role change / transfer) and by the nightly sweep, so
-- rosters stay correct without per-event bookkeeping. Reuses the verified
-- per-thread chat_reconcile_managed_group(); archived groups are left alone.

create or replace function chat_sync_managed_groups(p_actor uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  n_count integer := 0;
begin
  for r in
    select id from public.chat_threads
    where managed = true and archived_at is null
  loop
    perform public.chat_reconcile_managed_group(r.id, p_actor);
    n_count := n_count + 1;
  end loop;
  return n_count;
end;
$$;
