-- 0308_org_alignments.sql
-- Org Alignment tool: stage a structural org realignment (create regions /
-- areas / districts and reparent existing stores / districts / areas) and have
-- it go live on an effective date. Nothing touches the live org tree until the
-- alignment is applied — automatically on its effective date (a scheduled job)
-- or manually. Each move snapshots the prior parent so an applied alignment can
-- be rolled back. Structure only; leadership stays in Org Admin / GM Roster.
--
-- Admin-only. RLS on; the Netlify service-role functions are the gatekeeper,
-- with an admin policy as defense in depth.

-- ── org_alignments ───────────────────────────────────────────────────────────
create table if not exists public.org_alignments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  effective_date date not null,
  status         text not null default 'draft'
                   check (status in ('draft','scheduled','applied','canceled')),
  notes          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  applied_at     timestamptz,
  applied_by     uuid references public.profiles(id) on delete set null
);

-- ── org_alignment_nodes — new nodes to create on apply ───────────────────────
-- parent is either an existing node id (parent_id) OR a ref to another new node
-- in this same alignment (parent_ref), resolved at apply time. created_real_id
-- is filled in when the node is actually created.
create table if not exists public.org_alignment_nodes (
  id              uuid primary key default gen_random_uuid(),
  alignment_id    uuid not null references public.org_alignments(id) on delete cascade,
  ref             text not null,      -- client temp key, unique within the alignment
  kind            text not null check (kind in ('region','area','district')),
  name            text not null,
  code            text not null,
  parent_id       uuid,               -- existing parent (region for area, area for district); null for region
  parent_ref      text,               -- OR a new-node ref in this alignment
  created_real_id uuid,               -- set on apply
  unique (alignment_id, ref)
);

-- ── org_alignment_moves — reparent existing nodes on apply ───────────────────
-- kind store -> new district, district -> new area, area -> new region. The new
-- parent is an existing id (new_parent_id) OR a new-node ref (new_parent_ref).
-- prior_parent_id is snapshotted on apply for rollback.
create table if not exists public.org_alignment_moves (
  id              uuid primary key default gen_random_uuid(),
  alignment_id    uuid not null references public.org_alignments(id) on delete cascade,
  kind            text not null check (kind in ('store','district','area')),
  node_id         uuid not null,      -- existing node id (store.id / district.id / area.id)
  new_parent_id   uuid,               -- existing new parent
  new_parent_ref  text,               -- OR a new-node ref in this alignment
  prior_parent_id uuid                -- snapshot on apply
);

create index if not exists org_alignment_nodes_aid_idx on public.org_alignment_nodes (alignment_id);
create index if not exists org_alignment_moves_aid_idx on public.org_alignment_moves (alignment_id);
create index if not exists org_alignments_due_idx on public.org_alignments (status, effective_date);

alter table public.org_alignments       enable row level security;
alter table public.org_alignment_nodes  enable row level security;
alter table public.org_alignment_moves  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'org_alignments_admin_all') then
    create policy org_alignments_admin_all on public.org_alignments for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'org_alignment_nodes_admin_all') then
    create policy org_alignment_nodes_admin_all on public.org_alignment_nodes for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'org_alignment_moves_admin_all') then
    create policy org_alignment_moves_admin_all on public.org_alignment_moves for all using (is_admin()) with check (is_admin());
  end if;
end$$;

notify pgrst, 'reload schema';
