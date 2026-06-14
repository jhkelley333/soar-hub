-- 0154_manual_search_schema.sql
-- Manual & Guide Search — Phase 1 (v1 = Postgres full-text search).
--
-- The pgvector `embedding` column is RESERVED now and populated later; the
-- ivfflat/hnsw vector index is intentionally NOT created yet (it'll be added in
-- a later migration once embeddings exist, so it builds against real data).
--
-- RLS is REAL row-level scoping (matching contacts/vendors), using the existing
-- org helpers:
--   • user_visible_scope_ids(uid, kind)  — visible ids for region|area|district|store
--   • is_admin()                          — admin override
-- Manage actions (create manual / upload version / activate / re-index) are
-- gated to RVP-and-up + admin via a new module-scoped helper. There is no
-- is_rvp() helper in this repo, so manual_can_manage() mirrors the is_admin()
-- SECURITY DEFINER shape. <<< confirm the manage role set if rvp+ is wrong.

create extension if not exists vector;

-- Logical document (e.g. "Operations Manual", "Cash Handling Guide")
create table if not exists manuals (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  slug        text unique not null,
  description text,
  scope       text not null default 'company',  -- company | region | area | district | store
  scope_ref   text,                             -- org id (uuid as text) when scope <> 'company'
  created_at  timestamptz default now()
);

-- Each uploaded version of a manual
create table if not exists doc_versions (
  id            uuid primary key default gen_random_uuid(),
  manual_id     uuid not null references manuals(id) on delete cascade,
  version_label text not null,                  -- e.g. "2026.2"
  storage_path  text not null,                  -- path in the `manuals` storage bucket
  is_active     boolean not null default false,
  uploaded_by   uuid references auth.users(id),
  uploaded_at   timestamptz default now(),
  indexed_at    timestamptz                     -- set when chunking completes
);

-- Exactly one active version per manual
create unique index if not exists one_active_version_per_manual
  on doc_versions (manual_id) where is_active;

-- Per-section content chunks
create table if not exists manual_chunks (
  id              uuid primary key default gen_random_uuid(),
  manual_id       uuid not null references manuals(id) on delete cascade,
  doc_version_id  uuid not null references doc_versions(id) on delete cascade,
  section_path    text,                          -- "4.2 Fryer Procedures"
  heading         text,
  content         text not null,
  ordinal         int,
  fts tsvector generated always as (
    to_tsvector('english', coalesce(heading,'') || ' ' || content)
  ) stored,
  embedding       vector(1024),                  -- RESERVED for pgvector; nullable in v1
  created_at      timestamptz default now()
);

create index if not exists manual_chunks_fts_idx on manual_chunks using gin (fts);
create index if not exists manual_chunks_active_lookup on manual_chunks (manual_id, doc_version_id);
-- NOTE: do NOT create the ivfflat/hnsw vector index yet — added later once
-- embeddings are populated so it builds against real data.

-- ── Manage gate: admin + RVP and up ──────────────────────────────────────────
create or replace function manual_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role::text in ('rvp', 'vp', 'coo', 'admin') from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table manuals       enable row level security;
alter table doc_versions  enable row level security;
alter table manual_chunks enable row level security;

-- manuals: company-wide manuals are readable by every authenticated user; a
-- scoped manual is readable when its scope_ref falls inside the caller's org
-- reach. Admin sees all. (company short-circuits before the helper is called.)
drop policy if exists manuals_select on manuals;
create policy manuals_select on manuals for select using (
  is_admin()
  or scope = 'company'
  or (
    scope <> 'company'
    and scope_ref is not null
    and scope_ref::uuid in (select user_visible_scope_ids(auth.uid(), scope))
  )
);
drop policy if exists manuals_insert on manuals;
create policy manuals_insert on manuals for insert with check (manual_can_manage());
drop policy if exists manuals_update on manuals;
create policy manuals_update on manuals for update using (manual_can_manage()) with check (manual_can_manage());
drop policy if exists manuals_delete on manuals;
create policy manuals_delete on manuals for delete using (manual_can_manage());

-- doc_versions: readable whenever the parent manual is readable (RLS on manuals
-- applies inside the EXISTS). Manage = RVP+.
drop policy if exists doc_versions_select on doc_versions;
create policy doc_versions_select on doc_versions for select using (
  exists (select 1 from manuals m where m.id = doc_versions.manual_id)
);
drop policy if exists doc_versions_insert on doc_versions;
create policy doc_versions_insert on doc_versions for insert with check (manual_can_manage());
drop policy if exists doc_versions_update on doc_versions;
create policy doc_versions_update on doc_versions for update using (manual_can_manage()) with check (manual_can_manage());
drop policy if exists doc_versions_delete on doc_versions;
create policy doc_versions_delete on doc_versions for delete using (manual_can_manage());

-- manual_chunks: same parent-manual visibility for reads. Chunk writes happen
-- via the service-role ingest function (bypasses RLS); these are belt-and-braces.
drop policy if exists manual_chunks_select on manual_chunks;
create policy manual_chunks_select on manual_chunks for select using (
  exists (select 1 from manuals m where m.id = manual_chunks.manual_id)
);
drop policy if exists manual_chunks_insert on manual_chunks;
create policy manual_chunks_insert on manual_chunks for insert with check (manual_can_manage());
drop policy if exists manual_chunks_update on manual_chunks;
create policy manual_chunks_update on manual_chunks for update using (manual_can_manage()) with check (manual_can_manage());
drop policy if exists manual_chunks_delete on manual_chunks;
create policy manual_chunks_delete on manual_chunks for delete using (manual_can_manage());

-- ── Private storage bucket for source files ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('manuals', 'manuals', false)
on conflict (id) do nothing;

-- Source files are manager-managed; users search the extracted chunks, not the
-- bucket. Restrict all object access to RVP+/admin (service-role ingest bypasses
-- these). Path convention: manuals/{manual_id}/{doc_version_id}.<ext>
drop policy if exists manuals_obj_read on storage.objects;
create policy manuals_obj_read on storage.objects for select using (
  bucket_id = 'manuals' and manual_can_manage()
);
drop policy if exists manuals_obj_write on storage.objects;
create policy manuals_obj_write on storage.objects for insert with check (
  bucket_id = 'manuals' and manual_can_manage()
);
drop policy if exists manuals_obj_update on storage.objects;
create policy manuals_obj_update on storage.objects for update using (
  bucket_id = 'manuals' and manual_can_manage()
);
drop policy if exists manuals_obj_delete on storage.objects;
create policy manuals_obj_delete on storage.objects for delete using (
  bucket_id = 'manuals' and manual_can_manage()
);

notify pgrst, 'reload schema';
