-- 0203_business_disruptions_schema.sql
-- Business Disruption Reporting — replaces the standalone "Sonic Business
-- Disruption Reporting" form with a SOAR Hub module. One row = one reported
-- closure/disruption at a store. Service-role gatekeeper pattern (matches
-- site_audits): RLS on, no policies — the business-disruptions function
-- scopes every read/write.

create table if not exists public.business_disruptions (
  id                      uuid primary key default gen_random_uuid(),

  disruption_date         date not null,
  store_id                uuid not null references public.stores(id) on delete cascade,
  store_number            text not null,
  district_manager_id     uuid references public.profiles(id) on delete set null,
  district_manager_name   text,
  hours_disrupted         numeric(6,2),

  store_closed            boolean not null default false,
  reopen_date             date,
  order_ahead_disabled    boolean not null,
  closure_types           text[] not null default '{}',
  closure_other_detail    text,

  employee_injured        boolean not null default false,
  store_damaged           boolean not null default false,
  customer_injured        boolean not null default false,
  issue_types              text[] not null default '{}',

  estimated_loss_sales    numeric(10,2) not null default 0,
  description              text not null,
  attachments              jsonb not null default '[]', -- [{path, name, type}]

  status                  text not null default 'open' check (status in ('open','reviewed','closed')),

  submitted_by             uuid references public.profiles(id) on delete set null,
  submitted_by_name        text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists business_disruptions_store_idx on public.business_disruptions (store_id);
create index if not exists business_disruptions_date_idx on public.business_disruptions (disruption_date desc);
create index if not exists business_disruptions_status_idx on public.business_disruptions (status);

alter table public.business_disruptions enable row level security;

-- Private bucket for attached pictures/documents. Uploads/reads route
-- through the service-role business-disruptions function.
insert into storage.buckets (id, name, public)
values ('business-disruption-attachments', 'business-disruption-attachments', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
