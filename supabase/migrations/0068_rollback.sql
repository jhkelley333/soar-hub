-- Rollback for 0068_reno_storage_buckets — drops the policies and
-- buckets. Does NOT delete objects within the buckets first, so if you
-- have real photos in there, empty them via the dashboard before
-- running this.

drop policy if exists reno_scope_tours_storage_delete on storage.objects;
drop policy if exists reno_scope_tours_storage_update on storage.objects;
drop policy if exists reno_scope_tours_storage_insert on storage.objects;
drop policy if exists reno_scope_tours_storage_read   on storage.objects;

drop policy if exists reno_scope_photos_storage_delete on storage.objects;
drop policy if exists reno_scope_photos_storage_update on storage.objects;
drop policy if exists reno_scope_photos_storage_insert on storage.objects;
drop policy if exists reno_scope_photos_storage_read   on storage.objects;

delete from storage.buckets where id in ('reno-scope-photos', 'reno-scope-tours');
