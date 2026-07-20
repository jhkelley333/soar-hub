-- 0253_access_tokens.sql
-- Standing "stay logged in" links. A token in the URL is bound to a specific
-- profile; opening /go/<token> signs that person in (the server mints a fresh
-- one-time Supabase login each open) and the device then stays logged in as
-- normal. The token is reusable until revoked — so a leaked link is a full
-- credential for that user. Mint/revoke is admin/VP/COO only; every open is
-- logged (last_used_at / ua / ip) for auditing. Service-role gatekeeper.

create table if not exists access_tokens (
  id           uuid        primary key default gen_random_uuid(),
  token        text        not null unique,
  user_id      uuid        not null references profiles(id) on delete cascade,
  label        text,
  is_active    boolean     not null default true,
  created_by   uuid        references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_ua text,
  last_used_ip text,
  revoked_at   timestamptz,
  expires_at   timestamptz            -- null = never expires (until revoked)
);

create index if not exists access_tokens_user_idx on access_tokens (user_id);

alter table access_tokens enable row level security;
-- No policies → client roles denied; only the Netlify function (service key)
-- reads/writes, and it role-checks minting/revoking.

notify pgrst, 'reload schema';
