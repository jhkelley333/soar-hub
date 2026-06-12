-- 0145_site_audits_schema.sql
-- SOAR Site Audits (Audit Pro): a GM (or above) walks a store, captures
-- issues with a photo + note + severity + due date, and the team tracks each
-- to completion with required proof. One audit = one dated walk. Service-role
-- gatekeeper pattern: RLS on, no policies — the site-audit function scopes
-- every read/write.

create table if not exists public.site_audits (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  store_number    text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  status          text not null default 'open' check (status in ('open','shared','complete')),
  note            text,
  date            date not null default (now() at time zone 'America/Chicago')::date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists site_audits_store_idx on public.site_audits (store_id);
create index if not exists site_audits_created_by_idx on public.site_audits (created_by);
alter table public.site_audits enable row level security;

create table if not exists public.site_audit_issues (
  id             uuid primary key default gen_random_uuid(),
  audit_id       uuid not null references public.site_audits(id) on delete cascade,
  title          text not null,
  area           text,
  severity       text not null default 'medium' check (severity in ('high','medium','low')),
  comment        text,
  photo_url      text,                                   -- storage path
  due            date,
  proof_required text[] not null default '{}',           -- subset of {'photo','note'}
  completed      boolean not null default false,
  completion     jsonb,                                  -- { by, by_name, at, photo_url, note }
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists site_audit_issues_audit_idx on public.site_audit_issues (audit_id);
alter table public.site_audit_issues enable row level security;

create table if not exists public.site_audit_reports (
  id             uuid primary key default gen_random_uuid(),
  audit_id       uuid not null references public.site_audits(id) on delete cascade,
  signature_url  text,
  signed_by      uuid references public.profiles(id) on delete set null,
  signed_by_name text,
  recipients     jsonb not null default '[]',
  status         text not null default 'sent' check (status in ('sent','queued')),
  sent_at        timestamptz not null default now()
);
create index if not exists site_audit_reports_audit_idx on public.site_audit_reports (audit_id);
alter table public.site_audit_reports enable row level security;
