-- 0294_trait_playbook_cache.sql
-- Cache for AI-generated DO Playbook coaching, so repeated views of the same
-- team (same members + same traits) never re-bill the Anthropic API. Mirrors
-- the ranker_ai_summaries pattern (0034). Keyed by the leader + a hash of
-- their team's (member, trait) set, so it auto-invalidates when a trait changes
-- or a member joins/leaves.

create table if not exists public.trait_playbook_cache (
  id           uuid primary key default gen_random_uuid(),
  leader_id    uuid not null references public.profiles(id) on delete cascade,
  team_hash    text not null,
  content      jsonb not null,
  model        text,
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  unique (leader_id, team_hash)
);

alter table public.trait_playbook_cache enable row level security;

-- Writes happen via the service-role function only. A leader may read their own
-- cached playbooks directly if we ever want a client-side read path.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'trait_playbook_owner_read') then
    create policy trait_playbook_owner_read on public.trait_playbook_cache
      for select using (auth.uid() = leader_id);
  end if;
end$$;

notify pgrst, 'reload schema';
