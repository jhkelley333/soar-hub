-- supabase/migrations/0129_cash_management_schema.sql
--
-- Cash Management module — the night-close → next-day deposit cycle that
-- lives "under one roof" in the hub (like Work Orders). Three tables:
--
--   cash_closeouts   — a store's nightly drawer count + deposit, reconciled
--                      against the day's expected cash-due (DSR). Variance
--                      over the $5 tolerance flags + escalates.
--   cash_deposits    — next-day validation of that deposit at the bank:
--                      bank-credited amount, stamped slip photo, and the
--                      amount carried over from the DSR.
--   cash_alerts      — discrepancy escalations routed to the store's DO/SDO
--                      with an acknowledge → resolve lifecycle.
--
-- All access goes through netlify/functions/cash-management.js with the
-- service-role key (same gatekeeper model as paf_submissions), so RLS is
-- enabled with NO public policies — only the service role can read/write.
--
-- Money is stored in integer cents to avoid float drift. Idempotent.

-- ============================================================================
-- cash_closeouts — nightly drawer count + deposit
-- ============================================================================
create table if not exists public.cash_closeouts (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete restrict,
  store_number    text not null,                       -- denormalized for display
  business_date   date not null,
  cash_due_cents     int not null,                     -- expected per DSR
  counted_cents      int not null,                     -- drawer counted total
  deposit_cents      int not null,                     -- deposit amount
  denominations      jsonb not null default '{}'::jsonb, -- { b100: 25, ... }
  variance_cents     int not null,                     -- deposit - cash_due
  carried_over_cents int not null default 0,           -- DSR carry snapshot at submit
  flagged         boolean not null default false,      -- over tolerance
  reason          text,                                -- required when flagged
  status          text not null default 'awaiting-deposit'
                    check (status in ('awaiting-deposit','flagged','verified')),
  submitted_by    uuid references public.profiles(id) on delete set null,
  submitted_by_name text,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, business_date)
);

create index if not exists cash_closeouts_store_idx on public.cash_closeouts(store_id);
create index if not exists cash_closeouts_date_idx  on public.cash_closeouts(business_date desc);

-- ============================================================================
-- cash_deposits — next-day bank validation of a closeout's deposit
-- ============================================================================
create table if not exists public.cash_deposits (
  id                  uuid primary key default gen_random_uuid(),
  closeout_id         uuid not null references public.cash_closeouts(id) on delete cascade,
  store_id            uuid not null references public.stores(id) on delete restrict,
  store_number        text not null,
  for_date            date not null,                   -- the closeout's business day
  expected_cents      int not null,                    -- deposit the closeout recorded
  bank_credited_cents int,                             -- entered at validation
  dsr_carried_over_cents int not null default 0,       -- reported from DSR (read-only)
  carried_fwd_cents   int not null default 0,
  variance_cents      int,                             -- bank - expected
  flagged             boolean not null default false,
  reason              text,
  slip_path           text,                            -- storage path to slip photo
  status              text not null default 'pending'
                        check (status in ('pending','verified','flagged')),
  verified_by         uuid references public.profiles(id) on delete set null,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists cash_deposits_store_idx  on public.cash_deposits(store_id);
create index if not exists cash_deposits_status_idx on public.cash_deposits(status);
create unique index if not exists cash_deposits_closeout_uidx on public.cash_deposits(closeout_id);

-- ============================================================================
-- cash_alerts — discrepancy escalations to the store's DO/SDO
-- ============================================================================
create table if not exists public.cash_alerts (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete restrict,
  store_number  text not null,
  closeout_id   uuid references public.cash_closeouts(id) on delete set null,
  source        text not null default 'closeout'
                  check (source in ('closeout','deposit')),
  variance_cents int not null,
  type          text not null check (type in ('short','over')),
  severity      text not null default 'medium'
                  check (severity in ('high','medium','low')),
  reason        text,
  manager_name  text,
  status        text not null default 'open'
                  check (status in ('open','acknowledged','resolved')),
  acked_by      uuid references public.profiles(id) on delete set null,
  acked_by_name text,
  acked_at      timestamptz,
  resolved_at   timestamptz,
  notified      text[] not null default '{}',          -- ["District Operator","Sr. District Officer"]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists cash_alerts_store_idx  on public.cash_alerts(store_id);
create index if not exists cash_alerts_status_idx on public.cash_alerts(status);

-- ============================================================================
-- RLS — enabled with no policies: service-role backend is the only door.
-- ============================================================================
alter table public.cash_closeouts enable row level security;
alter table public.cash_deposits  enable row level security;
alter table public.cash_alerts    enable row level security;

-- ============================================================================
-- Storage bucket — stamped deposit-slip photos (private). The client uploads
-- directly (authenticated insert); the app reads them via short-lived signed
-- URLs minted by the service-role function. Path convention: <store_id>/<file>.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cash-deposit-slips', 'cash-deposit-slips', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'cash_slips_insert') then
    create policy cash_slips_insert on storage.objects for insert
      with check (bucket_id = 'cash-deposit-slips' and auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'cash_slips_read') then
    create policy cash_slips_read on storage.objects for select
      using (bucket_id = 'cash-deposit-slips' and auth.role() = 'authenticated');
  end if;
end $$;

notify pgrst, 'reload schema';
