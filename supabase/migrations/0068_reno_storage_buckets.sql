-- supabase/migrations/0068_reno_storage_buckets.sql
--
-- Creates the two Supabase Storage buckets used by the Reno Scoping
-- module:
--
--   reno-scope-photos — JPEGs (and PNGs) captured against a scope. After
--                       client-side compression they should land under
--                       ~1 MB each, but the bucket cap is 5 MB to give
--                       headroom for users who skip compression (e.g.
--                       DOs reviewing on desktop). Private.
--
--   reno-scope-tours  — Equirectangular 360 spheres. 30 MB cap matches
--                       the brief; these are large because they're not
--                       compressed by the client. Private.
--
-- Path convention enforced by the RLS policies below:
--   <bucket>/<scope_id>/<filename>
--
-- Access is gated to "can the caller see the parent reno_scope row?"
-- via can_see_store(), which mirrors the table-level RLS in 0066. Writes
-- additionally require the caller to be either the scoper (during draft /
-- needs_revision) or DO+ — same rule the reno_scope_photos table uses.
--
-- Idempotent — INSERT ... ON CONFLICT + pg_policies guards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('reno-scope-photos', 'reno-scope-photos', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('reno-scope-tours',  'reno-scope-tours',  false, 31457280,
    array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- RLS policies on storage.objects
-- ----------------------------------------------------------------------------

do $$
begin
  -- ----- reno-scope-photos: read by anyone who can see the parent scope ---
  if not exists (select 1 from pg_policies where policyname = 'reno_scope_photos_storage_read') then
    create policy reno_scope_photos_storage_read on storage.objects for select
      using (
        bucket_id = 'reno-scope-photos'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
        )
      );
  end if;

  -- writes (insert / update / delete) require write access to the parent
  -- scope: scoper on a draft / needs_revision row, or DO+ on any row.
  if not exists (select 1 from pg_policies where policyname = 'reno_scope_photos_storage_insert') then
    create policy reno_scope_photos_storage_insert on storage.objects for insert
      with check (
        bucket_id = 'reno-scope-photos'
        and auth.role() = 'authenticated'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'reno_scope_photos_storage_update') then
    create policy reno_scope_photos_storage_update on storage.objects for update
      using (
        bucket_id = 'reno-scope-photos'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'reno_scope_photos_storage_delete') then
    create policy reno_scope_photos_storage_delete on storage.objects for delete
      using (
        bucket_id = 'reno-scope-photos'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;

  -- ----- reno-scope-tours: identical access pattern, different bucket ----
  if not exists (select 1 from pg_policies where policyname = 'reno_scope_tours_storage_read') then
    create policy reno_scope_tours_storage_read on storage.objects for select
      using (
        bucket_id = 'reno-scope-tours'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'reno_scope_tours_storage_insert') then
    create policy reno_scope_tours_storage_insert on storage.objects for insert
      with check (
        bucket_id = 'reno-scope-tours'
        and auth.role() = 'authenticated'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'reno_scope_tours_storage_update') then
    create policy reno_scope_tours_storage_update on storage.objects for update
      using (
        bucket_id = 'reno-scope-tours'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'reno_scope_tours_storage_delete') then
    create policy reno_scope_tours_storage_delete on storage.objects for delete
      using (
        bucket_id = 'reno-scope-tours'
        and exists (
          select 1 from public.reno_scopes s
          where s.id::text = (storage.foldername(name))[1]
            and can_see_store(s.store_id)
            and (
              (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
              or role_level(reno_caller_role()) >= role_level('do')
            )
        )
      );
  end if;
end $$;
