-- 0316_hub_tickets.sql
-- MyHub issue tracker — a shared feedback board for the Hub itself. Anyone
-- signed in can file an issue or idea and follow it; everyone sees the board and
-- can upvote; admins triage/resolve. Reporters are notified (email + push) when
-- their ticket is resolved or an admin replies, and a nav badge flags updates.
--
-- Service-role only (the hub-tickets function mediates all reads/writes): RLS on
-- with no policies, consistent with the other cash/report tables.

create table if not exists public.hub_tickets (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'issue' check (kind in ('issue','idea')),
  title           text not null,
  description     text,
  status          text not null default 'open'
                    check (status in ('open','planned','in_progress','resolved','declined')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  resolution_note text,
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  upvotes         integer not null default 0,   -- denormalized count of hub_ticket_votes
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists hub_tickets_status_idx on public.hub_tickets (status, created_at desc);
create index if not exists hub_tickets_creator_idx on public.hub_tickets (created_by, updated_at desc);

-- One upvote per user per ticket.
create table if not exists public.hub_ticket_votes (
  ticket_id  uuid not null references public.hub_tickets(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

-- Comment thread: reporter follow-ups + admin replies.
create table if not exists public.hub_ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.hub_tickets(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  is_admin    boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists hub_ticket_comments_ticket_idx on public.hub_ticket_comments (ticket_id, created_at);

-- Per-user read state, powering the "your ticket updated" nav badge.
create table if not exists public.hub_ticket_reads (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  ticket_id uuid not null references public.hub_tickets(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

alter table public.hub_tickets         enable row level security;
alter table public.hub_ticket_votes    enable row level security;
alter table public.hub_ticket_comments enable row level security;
alter table public.hub_ticket_reads    enable row level security;
-- No policies → client roles denied; the service-role function bypasses RLS.

notify pgrst, 'reload schema';
