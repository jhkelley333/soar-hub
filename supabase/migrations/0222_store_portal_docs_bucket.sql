-- 0222_store_portal_docs_bucket.sql
-- Public storage bucket for documents attached to Command Center quick-link
-- panels (parts lists, guides, reference PDFs). Uploads go through the
-- store-portal Netlify function with the service key (admin-gated), so the
-- bucket needs no storage policies -- public read via the public URL only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-portal-docs',
  'store-portal-docs',
  true,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;
