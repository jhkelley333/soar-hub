-- 0220_store_portal.sql
-- Store Command Center: a public, per-store page the store bookmarks on its
-- desktop. The URL carries a token minted by an admin; on first open the token
-- binds to that device (device_id from the browser), so a forwarded link does
-- not work elsewhere. Admins can revoke a token or reset its device binding.
-- Service-role gatekeeper: RLS on, no policies - store-portal.js checks
-- token + device on every read/write. Pure ASCII.

create table if not exists store_portal_tokens (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references stores(id) on delete cascade,
  token            text not null unique,
  label            text,
  is_active        boolean not null default true,
  device_id        text,                -- bound on first open; null = unclaimed
  device_bound_at  timestamptz,
  last_used_at     timestamptz,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists store_portal_tokens_store_idx on store_portal_tokens (store_id);

-- In-the-moment reports from the store floor (tardiness, safety, equipment).
create table if not exists store_portal_reports (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  token_id       uuid references store_portal_tokens(id) on delete set null,
  kind           text not null default 'issue',   -- tardiness | safety | equipment | issue
  message        text not null,
  reporter_name  text,
  emailed_to     text[] not null default '{}',
  created_at     timestamptz not null default now()
);
create index if not exists store_portal_reports_store_idx on store_portal_reports (store_id, created_at desc);

alter table store_portal_tokens  enable row level security;
alter table store_portal_reports enable row level security;

notify pgrst, 'reload schema';
