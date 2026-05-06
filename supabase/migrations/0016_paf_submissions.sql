-- supabase/migrations/0016_paf_submissions.sql
--
-- Phase: PR B-1 — actual PAF flow (replacing the App Script version).
--
-- One row per PAF submission. Mirrors the field set defined in
-- form_config (paf_form, v1) so the renderer + the storage stay
-- aligned. config_version pins each submission to the exact form
-- config it was submitted under, so future schema changes don't
-- corrupt historical PAFs.
--
-- Cost calculation lives in code (server + client), never in config.
-- estimated_cost is recomputed on every submit/update from the canonical
-- formula; see calcPafCost() in netlify/functions/paf.js + the matching
-- client helper.
--
-- Workflow / status transitions (locked statuses from form_config.lists.lockedStatuses):
--
--   Pending          -> Approved | Rejected | "Needs Approval" | Processed
--   "Needs Approval" -> Approved | Rejected | Processed
--   Approved         -> Processed
--   Rejected         -> (terminal; can re-submit a new row)
--   Processed        -> (terminal; archived after 90 days in PR B-3)
--
-- RLS: enabled with NO policies — every read/write must go through the
-- netlify function, which uses the service-role key to bypass RLS and
-- enforces scope rules in code via user_visible_stores().
--
-- Idempotent.

create table if not exists paf_submissions (
  id                       uuid        primary key default uuid_generate_v4(),

  -- Provenance
  config_version           integer     not null,
  submitter_id             uuid        not null references profiles(id) on delete restrict,
  submitter_email          text        not null,
  submitter_name           text,

  -- Top-level (always shown)
  pay_period_end           date        not null,
  drive_in                 text        not null,
  market_do                text,
  employee_name            text        not null,
  last4_ssn                text        not null check (last4_ssn ~ '^[0-9]{4}$'),
  category                 text        not null,
  explanation              text        not null,

  -- Position & Pay
  job_position             text,
  approving_mgr            text,
  reg_pay_rate             numeric(10,2) not null default 0,
  reg_hours                numeric(10,2) not null default 0,
  ot_hours                 numeric(10,2) not null default 0,

  -- Tips
  cc_tips                  numeric(10,2) not null default 0,
  declared_tips            numeric(10,2) not null default 0,

  -- Leave / illness
  pto_hours                numeric(10,2) not null default 0,
  illness_hours            numeric(10,2) not null default 0,

  -- Store routing (Cross Store Work / Transfer)
  original_store           text,
  temp_new_store           text,
  store_chrged_ot          text,
  current_store            text,
  new_store                text,

  -- Termination / Final Check / Demotion
  last_day_worked          date,
  term_demotion            text,
  final_check_hrs          numeric(10,2) not null default 0,
  termed_in_tr             text,

  -- Bonus
  spot_bonus_amt           numeric(10,2) not null default 0,
  bonus_type               text,

  -- Workflow
  status                   text        not null default 'Pending',
  estimated_cost           numeric(10,2) not null default 0,
  notes                    text,
  rejection_reason         text,

  -- "Needs Approval" external flow
  approving_email          text,
  approval_notes           text,
  action_token             text        unique,
  token_expires_at         timestamptz,

  -- Approval / processing
  approved_at              timestamptz,
  approved_by              uuid        references profiles(id) on delete set null,
  approved_by_email        text,
  payroll_processed_at     timestamptz,
  payroll_processed_by     uuid        references profiles(id) on delete set null,

  -- Archive lifecycle (PR B-3)
  archived                 boolean     not null default false,
  archived_at              timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists paf_submissions_drive_in_idx
  on paf_submissions (drive_in);
create index if not exists paf_submissions_status_idx
  on paf_submissions (status)
  where archived = false;
create index if not exists paf_submissions_submitter_idx
  on paf_submissions (submitter_id);
create index if not exists paf_submissions_token_idx
  on paf_submissions (action_token)
  where action_token is not null;
create index if not exists paf_submissions_archive_clock_idx
  on paf_submissions (payroll_processed_at)
  where archived = false and status = 'Processed';

-- updated_at trigger reuses the existing helper from 0001_init.sql.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'paf_submissions_set_updated_at'
  ) then
    create trigger paf_submissions_set_updated_at
      before update on paf_submissions
      for each row execute function set_updated_at();
  end if;
end$$;

alter table paf_submissions enable row level security;
-- Intentionally no policies — service-role only. The netlify function is
-- the sole entry point for read/write and enforces scope rules in code.

-- ----------------------------------------------------------------------------
-- Audit log for PAF actions (admin-only direct read, write via service role).
-- ----------------------------------------------------------------------------

create table if not exists paf_audit_log (
  id           uuid        primary key default uuid_generate_v4(),
  paf_id       uuid        references paf_submissions(id) on delete set null,
  actor_id     uuid        references profiles(id) on delete set null,
  actor_email  text,
  action       text        not null, -- 'submit' | 'reject' | 'needs-approval' | 'token-approved' | 'mark-processed'
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists paf_audit_log_paf_id_idx
  on paf_audit_log (paf_id);
create index if not exists paf_audit_log_created_at_idx
  on paf_audit_log (created_at desc);

alter table paf_audit_log enable row level security;
-- admins-only direct SELECT; writes through service role only.
do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'paf_audit_log_admin_select'
  ) then
    create policy paf_audit_log_admin_select on paf_audit_log for select
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
      );
  end if;
end$$;
