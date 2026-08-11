-- 0284_hours_reconciliation.sql
-- Track how each store's hours discrepancy (System / RAP / Itsacheckmate / Google
-- / physical sign) was investigated and fixed, plus the Itsacheckmate-update and
-- sign-order worklists.

create table if not exists hours_reconciliation (
  store_id                    uuid primary key references stores(id) on delete cascade,
  status                      text not null default 'open',   -- open | in_progress | resolved
  -- Which sources were found wrong: any of 'system','rap','itsacheckmate','google','sign'.
  wrong_systems               text[] not null default '{}',
  action_taken                text,                            -- what the SDO/RVP did / corrected
  itsacheckmate_update_needed boolean not null default false,
  itsacheckmate_done          boolean not null default false,
  sign_order_needed           boolean not null default false,
  sign_ordered                boolean not null default false,
  reviewed_by                 uuid references profiles(id),
  reviewed_at                 timestamptz,
  updated_at                  timestamptz not null default now()
);

-- Export worklists filter on these; a small partial index keeps them quick.
create index if not exists hours_recon_itsacheckmate_idx
  on hours_reconciliation (store_id) where itsacheckmate_update_needed and not itsacheckmate_done;
create index if not exists hours_recon_sign_idx
  on hours_reconciliation (store_id) where sign_order_needed and not sign_ordered;

notify pgrst, 'reload schema';
