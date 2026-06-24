-- 0183_app_secrets.sql
-- Service-only key/value secret store. Lets large credentials (e.g. the Google
-- service-account JSON, ~2.3KB) live in the DB instead of the 4KB-capped
-- Netlify function env. RLS is enabled with NO policies, so anon/authenticated
-- access is fully denied; only the service role (used by Netlify functions)
-- can read or write. Idempotent. Apply via the Supabase SQL editor on Soar Hub v2.

create table if not exists app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_secrets enable row level security;
-- Intentionally no policies → all client roles denied; service role bypasses RLS.

-- Reload PostgREST schema cache so the API picks up the new table.
notify pgrst, 'reload schema';
