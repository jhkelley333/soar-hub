-- supabase/migrations/0089_employee_actions.sql
--
-- Employee Action module — V1 framework.
--
-- Two new request forms grouped under a new "Employee Actions" section,
-- modeled on the PAF pattern (one explicit-column row per submission +
-- a shared audit log). Submitting fires an email to the store's DO + RVP
-- and an on-screen confirmation toast; the approval / tracking / sign-off
-- layer is intentionally deferred to a later PR. The `status` column is
-- seeded with 'Submitted' so that later workflow has somewhere to go.
--
-- RLS: enabled with NO policies — every read/write goes through
-- netlify/functions/employee-actions.js, which uses the service-role key
-- and enforces scope rules in code via user_visible_stores(), exactly
-- like paf.js. (See migration 0016 for the precedent.)
--
-- Idempotent.

-- ----------------------------------------------------------------------------
-- Training Credit Request
-- ----------------------------------------------------------------------------
create table if not exists training_credit_requests (
  id                uuid          primary key default uuid_generate_v4(),

  -- Provenance
  submitter_id      uuid          not null references profiles(id) on delete restrict,
  submitter_email   text          not null,
  submitter_name    text,

  -- Form fields (mirrors the Training Credit Request form)
  store_number      text          not null,
  employee_name     text          not null,
  hourly_wage       numeric(10,2) not null default 0,
  training_type     text          not null,
  training_other    text,
  start_date        date,
  requested_amount  numeric(10,2) not null default 0,
  training_days     jsonb         not null default '[]',
  send_copy         boolean       not null default false,

  -- Workflow (approvals layered in later)
  status            text          not null default 'Submitted',
  notes             text,

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists training_credit_requests_store_idx
  on training_credit_requests (store_number);
create index if not exists training_credit_requests_submitter_idx
  on training_credit_requests (submitter_id);
create index if not exists training_credit_requests_status_idx
  on training_credit_requests (status);

-- If an earlier run of this migration created training_days as a text[] (the
-- original day-of-week multi-select), convert it to jsonb so each training day
-- can carry its own start/end time + computed amount. No-op on a fresh table,
-- and this brand-new table has no production data to preserve.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'training_credit_requests'
      and column_name = 'training_days'
      and data_type = 'ARRAY'
  ) then
    alter table training_credit_requests drop column training_days;
    alter table training_credit_requests
      add column training_days jsonb not null default '[]'::jsonb;
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- PTO Request (GM Vacation Request & Approval Tracker)
-- ----------------------------------------------------------------------------
create table if not exists pto_requests (
  id                uuid          primary key default uuid_generate_v4(),

  -- Provenance
  submitter_id      uuid          not null references profiles(id) on delete restrict,
  submitter_email   text          not null,
  submitter_name    text,

  -- Form fields (mirrors the PTO Request form)
  store_number      text          not null,
  gm_name           text          not null,
  pto_start_date    date          not null,
  pto_end_date      date          not null,
  days_used         numeric(5,1)  not null default 0,
  send_copy         boolean       not null default false,

  -- Workflow (approvals layered in later)
  status            text          not null default 'Submitted',
  notes             text,

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists pto_requests_store_idx
  on pto_requests (store_number);
create index if not exists pto_requests_submitter_idx
  on pto_requests (submitter_id);
create index if not exists pto_requests_status_idx
  on pto_requests (status);

-- ----------------------------------------------------------------------------
-- Shared audit log for both request types.
-- ----------------------------------------------------------------------------
create table if not exists employee_action_audit_log (
  id            uuid        primary key default uuid_generate_v4(),
  request_type  text        not null,   -- 'training_credit' | 'pto'
  request_id    uuid        not null,
  actor_id      uuid        references profiles(id) on delete set null,
  actor_email   text,
  action        text        not null,   -- 'submit' | (future: 'approve' | 'reject' | ...)
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists employee_action_audit_log_request_idx
  on employee_action_audit_log (request_type, request_id);
create index if not exists employee_action_audit_log_created_at_idx
  on employee_action_audit_log (created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at triggers (reuse the helper from 0001_init.sql).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'training_credit_requests_set_updated_at'
  ) then
    create trigger training_credit_requests_set_updated_at
      before update on training_credit_requests
      for each row execute function set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'pto_requests_set_updated_at'
  ) then
    create trigger pto_requests_set_updated_at
      before update on pto_requests
      for each row execute function set_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- RLS: service-role only (no policies). The netlify function is the sole
-- entry point and enforces scope in code, mirroring paf_submissions.
-- ----------------------------------------------------------------------------
alter table training_credit_requests   enable row level security;
alter table pto_requests                enable row level security;
alter table employee_action_audit_log   enable row level security;

-- Admin-only direct SELECT on the audit log (writes via service role only),
-- matching paf_audit_log_admin_select.
do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'employee_action_audit_log_admin_select'
  ) then
    create policy employee_action_audit_log_admin_select on employee_action_audit_log for select
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
      );
  end if;
end$$;
