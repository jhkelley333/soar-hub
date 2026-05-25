-- supabase/migrations/0086_chat_group_identity.sql
--
-- Editable group identity: an avatar_url on the thread plus a public
-- chat-avatars bucket for group photos. Public-read (so the photo renders
-- without signed URLs); writes are gated to thread members by the
-- <bucket>/<thread_id>/<file> path convention.

alter table public.chat_threads
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-avatars', 'chat-avatars', true, 5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'chat_avatars_read') then
    create policy chat_avatars_read on storage.objects for select
      using (bucket_id = 'chat-avatars');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'chat_avatars_insert') then
    create policy chat_avatars_insert on storage.objects for insert
      with check (
        bucket_id = 'chat-avatars'
        and auth.role() = 'authenticated'
        and public.chat_is_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'chat_avatars_update') then
    create policy chat_avatars_update on storage.objects for update
      using (
        bucket_id = 'chat-avatars'
        and public.chat_is_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;
