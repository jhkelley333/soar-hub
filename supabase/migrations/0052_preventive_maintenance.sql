-- supabase/migrations/0052_preventive_maintenance.sql
--
-- Preventive Maintenance (PM) MVP. Two new tables + one column on
-- tickets to back the recurring-work-order flow.
--
-- Model:
--   pm_templates   = what work needs to happen and how often
--                    (e.g., "Quarterly hood cleaning", every 90 days,
--                    performed by vendor X with est. cost $400)
--   pm_schedule    = per-store assignment of a template + when it's
--                    next due. One row per (template, store) pair.
--   tickets.pm_schedule_id = links a spawned ticket back to its
--                    schedule row so the close-hook knows to bump
--                    next_due_at and clear last_ticket_id.
--
-- Two performer types:
--   * vendor:   spawned ticket auto-assigned to the template's
--               default vendor (or per-store override). Vendor sees
--               it in the QR portal alongside ad-hoc tickets.
--   * internal: spawned ticket goes to the store inbox with a link
--               to the checklist (template.checklist_url). Internal
--               staff completes the form and uploads the result as
--               a completion photo.
--
-- Two cadence modes:
--   * rolling:  next_due_at = last_completed_at + cadence_days
--               (e.g., "every 90 days from last completion")
--   * fixed:    next_due_at = next future date matching fixed_months
--               + fixed_day_of_month (e.g., "always on the 15th of
--               Jan/Apr/Jul/Oct")
--
-- Idempotent. Run on Soar Hub v2.

create table if not exists pm_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category            text,
  description         text,
  instructions        text,
  -- performer_type drives where the spawned ticket goes. 'vendor'
  -- assigns to the default vendor; 'internal' lands in the store
  -- inbox with the checklist URL exposed in the ticket UI.
  performer_type      text not null check (performer_type in ('vendor', 'internal')),
  default_vendor_id   uuid references vendors(id) on delete set null,
  -- cadence_type controls how next_due_at is computed on completion.
  cadence_type        text not null check (cadence_type in ('rolling', 'fixed')),
  -- rolling cadence: bump next_due_at by this many days on close.
  cadence_days        int,
  -- fixed cadence: array of months (1-12) and day-of-month the PM
  -- recurs on. e.g., months {1,4,7,10} day 15 = quarterly on the 15th.
  fixed_months        int[],
  fixed_day_of_month  int,
  -- How many days before next_due_at the spawner should fire. Lets
  -- the assigned performer see the ticket with enough runway.
  lead_days           int not null default 7,
  est_cost            numeric(10,2),
  -- External link (Google Doc / PDF) to the checklist or inspection
  -- form. Surfaced in the ticket UI for internal PMs.
  checklist_url       text,
  priority            text default 'Standard',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists pm_schedule (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references pm_templates(id) on delete cascade,
  store_id            uuid not null references stores(id) on delete cascade,
  -- Per-store vendor override. When null, spawner uses the template's
  -- default_vendor_id. Used when one store in a market wants a
  -- different hood cleaner than the rest.
  override_vendor_id  uuid references vendors(id) on delete set null,
  -- next_due_at is the target completion date. Spawner fires the
  -- ticket when next_due_at <= now() + lead_days.
  next_due_at         timestamptz not null,
  last_completed_at   timestamptz,
  -- last_ticket_id pins the currently-open spawned ticket so we don't
  -- double-spawn. Cleared on PM ticket close so the next cycle can
  -- spawn.
  last_ticket_id      uuid references tickets(id) on delete set null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (template_id, store_id)
);

alter table tickets
  add column if not exists pm_schedule_id uuid references pm_schedule(id) on delete set null;

-- Indexes for the spawner's hot path and the admin UI's list views.
create index if not exists idx_pm_schedule_due
  on pm_schedule (next_due_at)
  where is_active = true;
create index if not exists idx_pm_schedule_store on pm_schedule (store_id);
create index if not exists idx_pm_schedule_template on pm_schedule (template_id);
create index if not exists idx_tickets_pm_schedule on tickets (pm_schedule_id);

-- Generic touch-updated_at trigger function. Identical body to the
-- one feature_flags uses; declared standalone here so dropping the
-- feature_flags migration doesn't break PM updates.
create or replace function pm_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pm_templates_updated_at on pm_templates;
create trigger pm_templates_updated_at
  before update on pm_templates
  for each row execute function pm_touch_updated_at();

drop trigger if exists pm_schedule_updated_at on pm_schedule;
create trigger pm_schedule_updated_at
  before update on pm_schedule
  for each row execute function pm_touch_updated_at();

notify pgrst, 'reload schema';
