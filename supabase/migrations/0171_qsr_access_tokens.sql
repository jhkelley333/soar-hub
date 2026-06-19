-- 0171_qsr_access_tokens.sql
-- SOAR QSR — public per-store access tokens for the no-login QR player.
-- One durable token per store: a learner scans the store's QR, the public
-- player resolves the token to the store, they self-select their name from the
-- store roster, and completion is recorded against their real profile (so it
-- flows into the existing manager-dashboard rollups). The token is the entry
-- credential only — it never grants write access on its own; the public
-- Netlify function uses the service role and validates learner ∈ store.

create table if not exists qsr_access_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  store_id    uuid not null references stores(id) on delete cascade,
  label       text,
  is_active   boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references profiles(id) on delete set null
);
create index if not exists qsr_access_tokens_store_idx on qsr_access_tokens (store_id);
create index if not exists qsr_access_tokens_token_idx on qsr_access_tokens (token);

alter table qsr_access_tokens enable row level security;

-- Authors/admins manage tokens. Anonymous resolution happens server-side via
-- the service role (qsr-public function), so no anon SELECT policy is needed.
create policy qsr_access_tokens_author on qsr_access_tokens for all to authenticated
  using (qsr_can_author()) with check (qsr_can_author());

grant select, insert, update, delete on qsr_access_tokens to authenticated;

notify pgrst, 'reload schema';
