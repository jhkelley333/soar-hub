-- supabase/migrations/0125_approver_tokens.sql
--
-- Approver Portal — token-in-URL approvals. An admin mints a per-user link
-- (the URL is the credential, no login). The bearer of the link approves /
-- rejects Work Order quotes within their own approval authority. Mirrors
-- the vendor QR token table (0044) but binds to a profile, not a store.
--
-- All access is via the approver-portal Netlify function (service role); RLS
-- is on with no policies so the table is unreadable from the client.

create table if not exists public.approver_tokens (
  id             uuid        primary key default gen_random_uuid(),
  approver_id    uuid        not null references public.profiles(id) on delete cascade,
  approver_email text,
  token          text        not null unique,
  label          text,
  is_active      boolean     not null default true,
  expires_at     timestamptz,
  last_used_at   timestamptz,
  created_by_id  uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by_id  uuid        references public.profiles(id) on delete set null
);

create index if not exists approver_tokens_token_idx    on public.approver_tokens(token);
create index if not exists approver_tokens_approver_idx on public.approver_tokens(approver_id);

alter table public.approver_tokens enable row level security;
-- No policies: only the service-role function reads/writes this table.

notify pgrst, 'reload schema';
