-- 0179_store_message_board.sql
-- Home-screen message board. GM and above post announcements scoped to their
-- stores, targeted at chosen store positions (audience_roles). Recipients see
-- the board on the dashboard, open attachments, and tick "I've read this"
-- (recorded in store_message_reads). RLS is on with NO policies — the
-- store-messages Netlify function (service role) brokers every read/write and
-- re-checks role + scope server-side. Attachments live in a public
-- 'store-messages' Storage bucket.

create table if not exists store_messages (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid references profiles(id) on delete set null,
  author_name   text,
  store_numbers text[]  not null default '{}',          -- stores this targets
  audience_roles text[] not null default '{}',          -- positions that can see it
  title         text    not null,
  body          text    not null default '',
  attachments   jsonb   not null default '[]'::jsonb,    -- [{url,name,type,size}]
  is_pinned     boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists store_messages_active_idx on store_messages (is_active, created_at desc);
create index if not exists store_messages_stores_idx on store_messages using gin (store_numbers);

create table if not exists store_message_reads (
  message_id uuid not null references store_messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  user_name  text,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table store_messages       enable row level security;
alter table store_message_reads  enable row level security;

-- Public bucket for message attachments (images / PDF). Public read; writes are
-- done by the service-role function, which bypasses RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-messages', 'store-messages', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'store_messages_attach_read') then
    create policy store_messages_attach_read on storage.objects for select
      using (bucket_id = 'store-messages');
  end if;
end $$;

notify pgrst, 'reload schema';
