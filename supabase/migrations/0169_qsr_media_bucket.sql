-- 0169_qsr_media_bucket.sql
-- SOAR QSR — public Storage bucket for course media (images + video).
-- Authors upload from the card editor; learners read via the public URL we
-- store in the card's data (videoUrl / imageUrl). Write access is gated to
-- authors via qsr_can_author(); read is public (training content, not
-- sensitive), which lets <video>/<img> load the URL directly.
--
-- Path convention: qsr-media/<card_id>/<timestamp>-<filename>
-- Idempotent — INSERT ... ON CONFLICT + pg_policies guards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('qsr-media', 'qsr-media', true, 524288000,   -- 500 MB cap (HeyGen MP4s)
    array[
      'video/mp4', 'video/webm', 'video/quicktime',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif'
    ])
on conflict (id) do nothing;

do $$
begin
  -- Public read — anyone can load the asset by URL.
  if not exists (select 1 from pg_policies where policyname = 'qsr_media_read') then
    create policy qsr_media_read on storage.objects for select
      using (bucket_id = 'qsr-media');
  end if;

  -- Writes (insert / update / delete) require an author.
  if not exists (select 1 from pg_policies where policyname = 'qsr_media_insert') then
    create policy qsr_media_insert on storage.objects for insert
      with check (bucket_id = 'qsr-media' and qsr_can_author());
  end if;

  if not exists (select 1 from pg_policies where policyname = 'qsr_media_update') then
    create policy qsr_media_update on storage.objects for update
      using (bucket_id = 'qsr-media' and qsr_can_author());
  end if;

  if not exists (select 1 from pg_policies where policyname = 'qsr_media_delete') then
    create policy qsr_media_delete on storage.objects for delete
      using (bucket_id = 'qsr-media' and qsr_can_author());
  end if;
end $$;
