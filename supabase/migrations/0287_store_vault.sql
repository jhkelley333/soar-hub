-- 0287_store_vault.sql
-- Per-store username/password vault (store operations logins: alarm, vendor
-- portals, POS, etc.). GM and above for a store they can see. Passwords are
-- stored ENCRYPTED (AES-256-GCM) by the store-vault function using the VAULT_KEY
-- env secret — never plaintext. Service-role gatekeeper: RLS on, no policies;
-- the function checks role + store scope, and decrypts only on an explicit
-- per-entry reveal.

create table if not exists store_vault_entries (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid references stores(id) on delete cascade,
  store_number  text not null,
  label         text not null,          -- what this login is for
  username      text,
  password_enc  text,                   -- AES-256-GCM, base64(iv|tag|ciphertext); null if none
  url           text,
  notes         text,
  updated_by    uuid references profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists store_vault_store_idx on store_vault_entries (store_number);

alter table store_vault_entries enable row level security;

notify pgrst, 'reload schema';
