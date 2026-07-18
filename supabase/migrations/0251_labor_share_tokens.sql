-- 0251_labor_share_tokens.sql
-- Public, read-only labor share links. One token per scope: the whole company,
-- or a single region (RVP). The token in the URL is the credential — resolved
-- server-side to a live drill-down (Company → RVP → SDO → DO → Store). Service-
-- role gatekeeper: RLS on, no policies; only the Netlify function reads/writes.

create table if not exists labor_share_tokens (
  id           uuid        primary key default gen_random_uuid(),
  token        text        not null unique,
  scope_kind   text        not null default 'region',   -- 'company' | 'region'
  region_id    uuid        references regions(id) on delete cascade,
  label        text,
  is_active    boolean     not null default true,
  created_by   uuid        references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- At most one active link per scope (one company-wide + one per region). The
-- coalesce folds the null region_id (company scope) into a fixed sentinel so the
-- partial unique still applies to it.
create unique index if not exists labor_share_tokens_active_scope_key
  on labor_share_tokens (coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;

alter table labor_share_tokens enable row level security;
-- No policies → client roles denied; service role (functions) bypasses RLS.

notify pgrst, 'reload schema';
