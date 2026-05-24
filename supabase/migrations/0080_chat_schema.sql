-- Chat backend: threads, members, messages. Threads carry their last
-- message + updated_at (maintained by a trigger) so the inbox is one
-- cheap query. Unread is derived from a member's last_read_at vs message
-- timestamps. RLS limits direct access to a thread's members; the
-- chat.js function uses the service key and enforces membership in its
-- queries (RLS here is defense-in-depth for any anon-key access).

create table if not exists public.chat_threads (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('direct','group','submission','workorder','broadcast')),
  title             text not null default '',
  subtitle          text not null default '',
  scope_kind        text check (scope_kind in ('submission','workorder','store')),
  scope_ref         text,
  external          boolean not null default false,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_message_at   timestamptz,
  last_message_text text,
  last_message_from uuid
);

create table if not exists public.chat_thread_members (
  thread_id   uuid not null references public.chat_threads(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  pinned      boolean not null default false,
  muted_until timestamptz,
  last_read_at timestamptz,
  joined_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.chat_threads(id) on delete cascade,
  from_user_id uuid references public.profiles(id),
  text         text not null,
  system       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_chat_messages_thread on public.chat_messages (thread_id, created_at);
create index if not exists idx_chat_members_user on public.chat_thread_members (user_id);
create index if not exists idx_chat_threads_updated on public.chat_threads (updated_at desc);

-- Keep the thread's denormalized last-message fields current.
create or replace function public.chat_touch_thread() returns trigger
language plpgsql security definer as $$
begin
  update public.chat_threads
     set last_message_at = new.created_at,
         last_message_text = new.text,
         last_message_from = new.from_user_id,
         updated_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_touch_thread on public.chat_messages;
create trigger trg_chat_touch_thread
  after insert on public.chat_messages
  for each row execute function public.chat_touch_thread();

-- Membership check that bypasses RLS, so the member policies below don't
-- recurse when they query chat_thread_members.
create or replace function public.chat_is_member(p_thread uuid, p_user uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.chat_thread_members
     where thread_id = p_thread and user_id = p_user
  );
$$;

alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads for select
  using (public.chat_is_member(id, auth.uid()));

drop policy if exists chat_members_select on public.chat_thread_members;
create policy chat_members_select on public.chat_thread_members for select
  using (public.chat_is_member(thread_id, auth.uid()));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select
  using (public.chat_is_member(thread_id, auth.uid()));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert
  with check (from_user_id = auth.uid() and public.chat_is_member(thread_id, auth.uid()));
