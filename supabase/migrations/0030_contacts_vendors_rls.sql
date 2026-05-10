-- supabase/migrations/0030_contacts_vendors_rls.sql
--
-- RLS for the new contacts / vendors / vendor_docs / audit-log tables
-- introduced in 0029. Reuses existing helpers (is_admin,
-- user_visible_stores, user_scopes table) — does NOT introduce a new
-- auth model.
--
-- Three-tier visibility (per the planning spec):
--
--   tier='company'   : visible to everyone signed in (incl. all stores)
--   tier='regional'  : visible to anyone whose visible scope reaches
--                      this region; store-level employees can be
--                      hidden via the contact's hidden_for_store_ids
--   tier='store'     : visible to anyone whose visible scope reaches
--                      this store
--
-- Edit semantics:
--   - Admin (and other ORG_WIDE roles): edit any tier
--   - Regional contacts/vendors: editable by users with leadership
--     reach (a user_scopes row at district / area / region / global)
--     within the relevant region
--   - Store contacts/vendors: editable by anyone whose visible
--     stores include the target store (so a GM can edit their own
--     store's contacts; DOs/SDOs/RVPs can edit any store in scope)
--
-- Audit log tables: RLS enabled with NO policies = service-role only.
-- The triggers in 0029 are SECURITY DEFINER and write past this.
--
-- Storage bucket policy for vendor-docs is set at the bottom.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

-- ============================================================
-- Helpers
-- ============================================================

-- Regions visible to a user, derived from the stores they can see.
-- Uses the existing user_visible_stores() so we never re-derive scope.
create or replace function user_visible_regions(uid uuid)
returns setof uuid
language sql stable as $$
  select distinct a.region_id
  from stores s
  join districts d on d.id = s.district_id
  join areas a     on a.id = d.area_id
  where s.id in (select user_visible_stores(uid));
$$;

-- The user's primary store id, used by the hidden_for_store_ids check.
-- Returns null for users without a primary store (typical for DO+).
create or replace function user_primary_store(uid uuid)
returns uuid
language sql stable as $$
  select primary_store_id from profiles where id = uid;
$$;

-- True if the caller has leadership reach (a user_scopes row at
-- district / area / region / global level). Used to gate regional
-- edits — store-level employees and GMs don't get regional edit
-- access through this check.
create or replace function user_has_leadership_reach()
returns boolean
language sql stable as $$
  select exists (
    select 1 from user_scopes
    where user_id = auth.uid()
      and scope_type in ('district', 'area', 'region', 'global')
  );
$$;

-- ============================================================
-- Enable RLS
-- ============================================================

alter table vendors            enable row level security;
alter table vendor_docs        enable row level security;
alter table contacts           enable row level security;
alter table contact_audit_log  enable row level security;
alter table vendor_audit_log   enable row level security;

-- ============================================================
-- CONTACTS
-- ============================================================

-- SELECT: tier-aware visibility
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'contacts_select') then
    create policy contacts_select on contacts for select using (
      is_admin()
      or tier = 'company'
      or (
        tier = 'regional'
        and region_id in (select user_visible_regions(auth.uid()))
        and not (user_primary_store(auth.uid()) = any(hidden_for_store_ids))
      )
      or (
        tier = 'store'
        and store_id in (select user_visible_stores(auth.uid()))
      )
    );
  end if;
end $$;

-- INSERT
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'contacts_insert') then
    create policy contacts_insert on contacts for insert with check (
      is_admin()
      or (
        tier = 'regional'
        and region_id in (select user_visible_regions(auth.uid()))
        and user_has_leadership_reach()
      )
      or (
        tier = 'store'
        and store_id in (select user_visible_stores(auth.uid()))
      )
    );
  end if;
end $$;

-- UPDATE
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'contacts_update') then
    create policy contacts_update on contacts for update
    using (
      is_admin()
      or (
        tier = 'regional'
        and region_id in (select user_visible_regions(auth.uid()))
        and user_has_leadership_reach()
      )
      or (
        tier = 'store'
        and store_id in (select user_visible_stores(auth.uid()))
      )
    )
    with check (
      is_admin()
      or (
        tier = 'regional'
        and region_id in (select user_visible_regions(auth.uid()))
        and user_has_leadership_reach()
      )
      or (
        tier = 'store'
        and store_id in (select user_visible_stores(auth.uid()))
      )
    );
  end if;
end $$;

-- DELETE
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'contacts_delete') then
    create policy contacts_delete on contacts for delete using (
      is_admin()
      or (
        tier = 'regional'
        and region_id in (select user_visible_regions(auth.uid()))
        and user_has_leadership_reach()
      )
      or (
        tier = 'store'
        and store_id in (select user_visible_stores(auth.uid()))
      )
    );
  end if;
end $$;

-- ============================================================
-- VENDORS — same shape as contacts
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'vendors_select') then
    create policy vendors_select on vendors for select using (
      is_admin()
      or tier = 'company'
      or (tier = 'regional' and region_id in (select user_visible_regions(auth.uid())))
      or (tier = 'store'    and store_id  in (select user_visible_stores(auth.uid())))
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'vendors_insert') then
    create policy vendors_insert on vendors for insert with check (
      is_admin()
      or (tier = 'regional'
          and region_id in (select user_visible_regions(auth.uid()))
          and user_has_leadership_reach())
      or (tier = 'store' and store_id in (select user_visible_stores(auth.uid())))
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'vendors_update') then
    create policy vendors_update on vendors for update
    using (
      is_admin()
      or (tier = 'regional'
          and region_id in (select user_visible_regions(auth.uid()))
          and user_has_leadership_reach())
      or (tier = 'store' and store_id in (select user_visible_stores(auth.uid())))
    )
    with check (
      is_admin()
      or (tier = 'regional'
          and region_id in (select user_visible_regions(auth.uid()))
          and user_has_leadership_reach())
      or (tier = 'store' and store_id in (select user_visible_stores(auth.uid())))
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'vendors_delete') then
    create policy vendors_delete on vendors for delete using (
      is_admin()
      or (tier = 'regional'
          and region_id in (select user_visible_regions(auth.uid()))
          and user_has_leadership_reach())
      or (tier = 'store' and store_id in (select user_visible_stores(auth.uid())))
    );
  end if;
end $$;

-- ============================================================
-- VENDOR_DOCS — derive access from parent vendor
-- ============================================================
--
-- A doc row is visible / writable iff the caller can see / write the
-- parent vendor row (RLS on vendors gate that). EXISTS subquery against
-- vendors with the parent vendor_id will already be subject to vendors'
-- RLS, so this is safe + consistent.

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'vendor_docs_select') then
    create policy vendor_docs_select on vendor_docs for select using (
      exists (select 1 from vendors v where v.id = vendor_docs.vendor_id)
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'vendor_docs_write') then
    create policy vendor_docs_write on vendor_docs for all
    using (
      exists (select 1 from vendors v where v.id = vendor_docs.vendor_id)
    )
    with check (
      exists (select 1 from vendors v where v.id = vendor_docs.vendor_id)
    );
  end if;
end $$;

-- ============================================================
-- AUDIT LOGS — service-role only (RLS enabled with no policies).
-- The trigger functions in 0029 are SECURITY DEFINER and write past
-- RLS. Direct SELECT requires service role.
-- ============================================================
-- (no policies — intentional)

-- ============================================================
-- Storage bucket: vendor-docs
-- ============================================================
--
-- Creates the private bucket if it doesn't exist. Per-object RLS uses
-- a path convention: vendor-docs/{vendor_id}/{filename}. A user can
-- read/write an object iff they can SELECT/UPDATE the vendor row with
-- that id (i.e. RLS on `vendors` is the source of truth for storage
-- access too — single permission model).

insert into storage.buckets (id, name, public)
values ('vendor-docs', 'vendor-docs', false)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'vendor_docs_read'
  ) then
    create policy vendor_docs_read on storage.objects for select using (
      bucket_id = 'vendor-docs'
      and exists (
        select 1 from vendors v
        where v.id::text = split_part(name, '/', 1)
      )
    );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'vendor_docs_write'
  ) then
    create policy vendor_docs_write on storage.objects for all
    using (
      bucket_id = 'vendor-docs'
      and exists (
        select 1 from vendors v
        where v.id::text = split_part(name, '/', 1)
      )
    )
    with check (
      bucket_id = 'vendor-docs'
      and exists (
        select 1 from vendors v
        where v.id::text = split_part(name, '/', 1)
      )
    );
  end if;
end $$;

notify pgrst, 'reload schema';
