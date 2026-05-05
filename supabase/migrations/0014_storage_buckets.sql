-- supabase/migrations/0014_storage_buckets.sql
--
-- Creates the two Supabase Storage buckets used by My Account:
--
--   avatars     — profile photos. Public read so <img src="..."> works
--                 anywhere without signed-URL plumbing. JPEG/PNG/WEBP only,
--                 5 MB cap.
--
--   cfm-certs   — Certified Food Manager certificate files (PDF or scan
--                 image). PRIVATE — read access only via signed URLs the
--                 user (or admin) generates server-side. PDF/JPEG/PNG, 10 MB.
--
-- Path convention enforced by the RLS policies below:
--   <bucket>/<uid>/<filename>
--
-- This means a user can only insert/update/delete objects under their
-- own user-id folder. Reads on `avatars` are public; reads on
-- `cfm-certs` are gated to the owning user OR an admin.
--
-- Idempotent — INSERT ... ON CONFLICT, and policies check pg_policies
-- before creating.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',   'avatars',   true,  5242880,
    array['image/jpeg','image/png','image/webp']),
  ('cfm-certs', 'cfm-certs', false, 10485760,
    array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- RLS policies on storage.objects
-- ----------------------------------------------------------------------------
-- Supabase enables RLS on storage.objects by default in modern projects.
-- The helper storage.foldername(name) returns the path segments of an
-- object name; segment [1] is the top-level folder (the user's uid).

do $$
begin
  -- avatars: anyone can read
  if not exists (select 1 from pg_policies where policyname = 'avatars_public_read') then
    create policy avatars_public_read on storage.objects for select
      using (bucket_id = 'avatars');
  end if;

  -- avatars: signed-in users can write to their own folder
  if not exists (select 1 from pg_policies where policyname = 'avatars_owner_write') then
    create policy avatars_owner_write on storage.objects for insert
      with check (
        bucket_id = 'avatars'
        and auth.role() = 'authenticated'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'avatars_owner_update') then
    create policy avatars_owner_update on storage.objects for update
      using (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'avatars_owner_delete') then
    create policy avatars_owner_delete on storage.objects for delete
      using (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  -- cfm-certs: read your own + admin reads everyone's
  if not exists (select 1 from pg_policies where policyname = 'cfm_certs_owner_read') then
    create policy cfm_certs_owner_read on storage.objects for select
      using (
        bucket_id = 'cfm-certs'
        and (
          auth.uid()::text = (storage.foldername(name))[1]
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
          )
        )
      );
  end if;

  -- cfm-certs: write your own folder
  if not exists (select 1 from pg_policies where policyname = 'cfm_certs_owner_write') then
    create policy cfm_certs_owner_write on storage.objects for insert
      with check (
        bucket_id = 'cfm-certs'
        and auth.role() = 'authenticated'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'cfm_certs_owner_update') then
    create policy cfm_certs_owner_update on storage.objects for update
      using (
        bucket_id = 'cfm-certs'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'cfm_certs_owner_delete') then
    create policy cfm_certs_owner_delete on storage.objects for delete
      using (
        bucket_id = 'cfm-certs'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end$$;
