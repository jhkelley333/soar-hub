-- Rollback for 0074_personal_contact_photos_bucket.sql
do $$
begin
  drop policy if exists personal_contact_photos_read   on storage.objects;
  drop policy if exists personal_contact_photos_insert on storage.objects;
  drop policy if exists personal_contact_photos_update on storage.objects;
  drop policy if exists personal_contact_photos_delete on storage.objects;
end$$;

-- Remove any remaining objects, then the bucket itself.
delete from storage.objects where bucket_id = 'personal-contact-photos';
delete from storage.buckets where id = 'personal-contact-photos';
