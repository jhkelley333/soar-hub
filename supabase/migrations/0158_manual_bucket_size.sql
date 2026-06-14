-- 0158_manual_bucket_size.sql
-- The manuals bucket was created without a file_size_limit, so it fell back to
-- a small default and large operations-manual PDFs were rejected on upload.
-- Raise it to 100 MB.
--
-- NOTE: a bucket's file_size_limit cannot exceed the project-wide upload limit
-- (Dashboard → Project Settings → Storage → "Upload file size limit"). If your
-- manuals are larger than that global cap, raise it there too.
update storage.buckets
set file_size_limit = 104857600   -- 100 MB
where id = 'manuals';
