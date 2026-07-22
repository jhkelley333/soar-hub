-- 0256_store_visit_photos_bucket.sql
-- Private storage bucket for Store Visit photos (gap evidence on the walk +
-- summary photos). The store-visit function (service role) mints signed upload
-- and download URLs, so no storage.objects policies are needed — the signed
-- tokens authorize each transfer. Path convention: {visit_id}/{kind}/{file}.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-visit-photos', 'store-visit-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
