-- 0202_passport_on_file.sql
-- Passport tracking for international team trips (e.g. the annual Cancun
-- trip) — lets a team member upload a scan of their passport's photo page
-- and record its expiration date, so leadership can verify trip eligibility
-- without re-asking everyone individually.
--
-- Deliberately does NOT store a passport number: there's no operational need
-- for leadership to see the actual government ID number, only whether a
-- valid passport is on file and when it expires. Mirrors the existing CFM
-- cert pattern (0013/0014) exactly otherwise — same private-bucket,
-- owner-or-admin-read shape.
--
-- Idempotent.

alter table profiles
  add column if not exists passport_expires_at date;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('passports', 'passports', false, 10485760,
  array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

do $$
begin
  -- passports: read your own + admin reads everyone's (trip-eligibility checks)
  if not exists (select 1 from pg_policies where policyname = 'passports_owner_read') then
    create policy passports_owner_read on storage.objects for select
      using (
        bucket_id = 'passports'
        and (
          auth.uid()::text = (storage.foldername(name))[1]
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
          )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'passports_owner_write') then
    create policy passports_owner_write on storage.objects for insert
      with check (
        bucket_id = 'passports'
        and auth.role() = 'authenticated'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'passports_owner_update') then
    create policy passports_owner_update on storage.objects for update
      using (
        bucket_id = 'passports'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'passports_owner_delete') then
    create policy passports_owner_delete on storage.objects for delete
      using (
        bucket_id = 'passports'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end$$;

notify pgrst, 'reload schema';
