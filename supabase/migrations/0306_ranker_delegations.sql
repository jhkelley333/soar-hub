-- 0306_ranker_delegations.sql
-- Temporary Ranker access for RVPs. An admin can delegate the weekly ranker
-- upload task to one or more RVPs for a date window. While a grant is active
-- (not revoked, and today within [starts_on, ends_on]) the RVP can reach the
-- Ranker upload panels + the credential vault (to log in and pull the files);
-- config, labor pad, and running remain what the app already allows.
--
-- Enforcement lives in the Netlify functions (service role); RLS here is
-- defense in depth: admins manage all rows, an RVP may read their own grants.

create table if not exists public.ranker_delegations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  note        text,
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,
  check (ends_on >= starts_on)
);

create index if not exists ranker_delegations_user_idx
  on public.ranker_delegations (user_id) where revoked_at is null;

alter table public.ranker_delegations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'ranker_delegations_admin_all') then
    create policy ranker_delegations_admin_all on public.ranker_delegations
      for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'ranker_delegations_self_read') then
    create policy ranker_delegations_self_read on public.ranker_delegations
      for select using (auth.uid() = user_id);
  end if;
end$$;

notify pgrst, 'reload schema';
