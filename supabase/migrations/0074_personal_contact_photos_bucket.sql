-- 0074_personal_contact_photos_bucket.sql
--
-- Storage bucket for the photos attached to per-user personal contacts
-- (Directory → Mine tab). Public read so <img src="..."> works without
-- signed-URL plumbing — the same approach the `avatars` bucket uses
-- (migration 0014). Writes are owner-only: a user can only touch objects
-- under their own uid folder.
--
-- Path convention enforced by the RLS policies below:
--   personal-contact-photos/<uid>/<filename>
--
-- The photo_url column on public.personal_contacts (added in 0073) holds
-- the resulting public URL. Deleting a contact does NOT auto-delete its
-- photo object; the client removes it best-effort. Orphans are harmless
-- (unguessable UUID path, owner-only writes) and can be swept later.
--
-- Idempotent — INSERT ... ON CONFLICT + pg_policies guards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('personal-contact-photos', 'personal-contact-photos', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  -- Public read (bucket is public; this makes the intent explicit and
  -- survives a future flip of the bucket's public flag).
  if not exists (select 1 from pg_policies where policyname = 'personal_contact_photos_read') then
    create policy personal_contact_photos_read on storage.objects for select
      using (bucket_id = 'personal-contact-photos');
  end if;

  -- Owner-only writes: first path segment must equal the caller's uid.
  if not exists (select 1 from pg_policies where policyname = 'personal_contact_photos_insert') then
    create policy personal_contact_photos_insert on storage.objects for insert
      with check (
        bucket_id = 'personal-contact-photos'
        and auth.role() = 'authenticated'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'personal_contact_photos_update') then
    create policy personal_contact_photos_update on storage.objects for update
      using (
        bucket_id = 'personal-contact-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'personal_contact_photos_delete') then
    create policy personal_contact_photos_delete on storage.objects for delete
      using (
        bucket_id = 'personal-contact-photos'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end$$;
