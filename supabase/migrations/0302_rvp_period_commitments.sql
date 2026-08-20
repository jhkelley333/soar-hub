-- 0302_rvp_period_commitments.sql
-- Phase 6: RVP period commitments — each RVP records free-text commitments per
-- fiscal period, with an editable target and status. Every edit to a tracked
-- field is captured in an IMMUTABLE history table by a trigger (not by app
-- code, which can be bypassed). History + its immutability enforcement ship in
-- this same migration — retrofitting an audit trail later loses every earlier
-- edit. This is a distinct feature from the metric-target rvp_commitments
-- scoreboard (0258); the two coexist.

-- ── rvp_period_commitments ───────────────────────────────────────────────────
-- One row per commitment. Keyed to a fiscal period by (fiscal_year, period)
-- rather than a fiscal_period_id FK — this app models fiscal periods from dates
-- (netlify/_lib/fiscal.js), it has no fiscal_periods table. updated_by is set by
-- the app on every edit so the history trigger can attribute the change.
-- rvp_user_id is ON DELETE RESTRICT, not CASCADE: a commitment is a permanent,
-- audited record, so removing the RVP's profile must not silently erase it (the
-- app deactivates profiles rather than hard-deleting them anyway).
create table if not exists public.rvp_period_commitments (
  id              uuid primary key default gen_random_uuid(),
  rvp_user_id     uuid not null references public.profiles(id) on delete restrict,
  fiscal_year     text not null,                       -- e.g. 'FY2026'
  period          int  not null check (period between 1 and 12),
  commitment_text text not null,
  target_value    numeric,
  target_unit     text,                                -- free text: '%', 'h', '$', 'pts'…
  status          text not null default 'active'
                    check (status in ('active','met','missed')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

create index if not exists rvp_period_commitments_period_idx
  on public.rvp_period_commitments (fiscal_year, period);
create index if not exists rvp_period_commitments_rvp_idx
  on public.rvp_period_commitments (rvp_user_id);

alter table public.rvp_period_commitments enable row level security;
-- No client policies — the Netlify function is the sole gatekeeper (service
-- role bypasses RLS). RLS on with zero policies denies all direct client access.

-- ── rvp_period_commitment_history (IMMUTABLE) ────────────────────────────────
-- Append-only audit of every edit to a tracked field. Written by trigger, never
-- by app code. One row per changed field per UPDATE.
create table if not exists public.rvp_period_commitment_history (
  id            uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.rvp_period_commitments(id) on delete cascade,
  changed_at    timestamptz not null default now(),
  changed_by    uuid references public.profiles(id) on delete set null,
  field         text not null,
  old_value     text,
  new_value     text
);

create index if not exists rvp_period_commitment_history_cid_idx
  on public.rvp_period_commitment_history (commitment_id, changed_at desc);

alter table public.rvp_period_commitment_history enable row level security;
-- Service-role only (no client policies). Immutability is enforced below.

-- ── history-writing trigger ──────────────────────────────────────────────────
-- On UPDATE of a commitment, record one history row per tracked field that
-- actually changed. Attribution comes from NEW.updated_by (set by the app on
-- every edit). Metadata-only updates (updated_at/updated_by alone) write nothing.
create or replace function public.rvp_period_commitment_log_change()
returns trigger language plpgsql as $$
begin
  if new.commitment_text is distinct from old.commitment_text then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'commitment_text', old.commitment_text, new.commitment_text);
  end if;
  if new.target_value is distinct from old.target_value then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'target_value',
            old.target_value::text, new.target_value::text);
  end if;
  if new.target_unit is distinct from old.target_unit then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'target_unit', old.target_unit, new.target_unit);
  end if;
  if new.status is distinct from old.status then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'status', old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists rvp_period_commitment_history_write on public.rvp_period_commitments;
create trigger rvp_period_commitment_history_write
  after update on public.rvp_period_commitments
  for each row execute function public.rvp_period_commitment_log_change();

-- ── immutability trigger on the history table ────────────────────────────────
-- Block every UPDATE and DELETE at the DB layer — fires even for the service
-- role, so a recorded edit can never be altered or erased. This also means a
-- commitment that has any history cannot be deleted: the parent's ON DELETE
-- CASCADE would try to remove these rows and this trigger aborts it. That is
-- intentional — an audited commitment is permanent (correct it by editing,
-- which is itself audited), so no delete path is exposed anywhere.
create or replace function public.rvp_period_commitment_history_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'rvp_period_commitment_history is immutable (% blocked)', tg_op;
end;
$$;

drop trigger if exists rvp_period_commitment_history_no_mutate on public.rvp_period_commitment_history;
create trigger rvp_period_commitment_history_no_mutate
  before update or delete on public.rvp_period_commitment_history
  for each row execute function public.rvp_period_commitment_history_immutable();

notify pgrst, 'reload schema';
