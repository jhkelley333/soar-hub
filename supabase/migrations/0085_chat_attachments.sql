-- supabase/migrations/0085_chat_attachments.sql
--
-- File attachments for chat messages. Mirrors the reno-scoping storage
-- pattern: a private bucket with membership-gated RLS, path convention
-- <bucket>/<thread_id>/<file>, plus a metadata table joined to the message.
-- Clients upload directly and read via short-lived signed URLs; the chat
-- function (service role) writes the chat_attachments rows.

-- ── storage bucket ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments', 'chat-attachments', false, 26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic',
    'application/pdf','text/plain','text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'chat_attach_storage_read') then
    create policy chat_attach_storage_read on storage.objects for select
      using (
        bucket_id = 'chat-attachments'
        and public.chat_is_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'chat_attach_storage_insert') then
    create policy chat_attach_storage_insert on storage.objects for insert
      with check (
        bucket_id = 'chat-attachments'
        and auth.role() = 'authenticated'
        and public.chat_is_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'chat_attach_storage_delete') then
    create policy chat_attach_storage_delete on storage.objects for delete
      using (
        bucket_id = 'chat-attachments'
        and public.chat_is_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;

-- ── metadata table ───────────────────────────────────────────────────
create table if not exists public.chat_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  thread_id    uuid not null references public.chat_threads(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_chat_attachments_thread
  on public.chat_attachments (thread_id, created_at desc);
create index if not exists idx_chat_attachments_message
  on public.chat_attachments (message_id);

alter table public.chat_attachments enable row level security;

drop policy if exists chat_attachments_select on public.chat_attachments;
create policy chat_attachments_select on public.chat_attachments for select
  using (public.chat_is_member(thread_id, auth.uid()));
