-- supabase/migrations/0114_paf_offer_letter.sql
--
-- Phase 3 of the "New Hire (Salary Leader)" PAF category: attach a copy
-- of the offer letter.
--
--   paf_submissions.nh_offer_letter_path — storage path of the uploaded
--     letter, '<uploader_uid>/<uuid>.<ext>' in the paf-offer-letters bucket.
--
--   paf-offer-letters — private bucket, PDF / JPG / PNG, 10 MB cap.
--
-- Writes are gated to the uploader's own folder (the standard avatars /
-- cfm-certs pattern). There is intentionally NO client read policy:
-- offer letters carry pay + PII, and PAF visibility is role-scoped, so
-- reads are served by paf.js (service role) behind the same scope check
-- the PAF list uses — never by direct client storage access.

alter table paf_submissions
  add column if not exists nh_offer_letter_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('paf-offer-letters', 'paf-offer-letters', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

do $$
begin
  -- Write your own folder only (uploader_uid = first path segment).
  if not exists (select 1 from pg_policies where policyname = 'paf_offer_letters_owner_write') then
    create policy paf_offer_letters_owner_write on storage.objects for insert
      with check (
        bucket_id = 'paf-offer-letters'
        and auth.role() = 'authenticated'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

notify pgrst, 'reload schema';
