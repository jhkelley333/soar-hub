-- 0212_tp_successors.sql
-- Succession depth chart for Team Pipeline. Each row is one successor for a
-- seat (a roster member — usually a GM), ranked, with a readiness tag
-- (ready now / 6mo / 12mo). Replaces the single free-text
-- tp_team_members.backfill with a ranked bench, so the Succession & Risk
-- roll-up can tell "covered but not ready" from "ready now". A successor is
-- either an internal roster member (successor_member_id) or a free-text name
-- (successor_name, e.g. an external candidate). The legacy backfill column
-- stays for back-compat and still counts as a developing (readiness-unknown)
-- successor in the roll-up until a bench entry replaces it.

create table if not exists tp_successors (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references stores(id) on delete cascade,
  incumbent_member_id  uuid not null references tp_team_members(id) on delete cascade,
  successor_member_id  uuid references tp_team_members(id) on delete set null,
  successor_name       text,
  readiness            text not null default '6mo',  -- now | 6mo | 12mo
  rank                 int  not null default 0,
  note                 text,
  created_by           uuid references profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists tp_successors_incumbent_idx on tp_successors (incumbent_member_id);
create index if not exists tp_successors_store_idx on tp_successors (store_id);

-- Service-role gatekeeper: RLS on, no policies — the function scope-checks.
alter table tp_successors enable row level security;

notify pgrst, 'reload schema';
