-- supabase/migrations/0035_store_attribute_audit.sql
--
-- Audit trail for changes to the free-form stores.attributes jsonb bag.
-- One row per (store, attribute key) per write, regardless of whether
-- the write came from the single-store edit drawer (My Stores → store
-- detail) or the admin bulk-set tool (/admin/bulk-attributes).
--
-- bulk_operation_id is null for single-store edits; populated with a
-- shared uuid v4 for every row produced by a single bulk apply call so
-- the UI / SQL can group "this batch of 47 changes was one click."
--
-- old_value / new_value are jsonb so we can faithfully record the
-- original type (number 4 vs string "4" matters when an attribute is
-- numeric). Reads gated to admin via RLS; the rest of the app reads
-- the live `stores.attributes` column directly and doesn't need this
-- table.

create table store_attribute_audit (
  id                 uuid        primary key default uuid_generate_v4(),
  store_id           uuid        not null references stores(id) on delete cascade,
  actor_id           uuid        not null references profiles(id) on delete restrict,
  actor_email        text,
  attribute_key      text        not null,
  old_value          jsonb,
  new_value          jsonb,
  action             text        not null check (action in ('set', 'delete')),
  bulk_operation_id  uuid,
  created_at         timestamptz not null default now()
);

create index store_attribute_audit_store_id_idx
  on store_attribute_audit (store_id);
create index store_attribute_audit_actor_id_idx
  on store_attribute_audit (actor_id);
create index store_attribute_audit_bulk_op_idx
  on store_attribute_audit (bulk_operation_id)
  where bulk_operation_id is not null;
create index store_attribute_audit_created_at_idx
  on store_attribute_audit (created_at desc);
create index store_attribute_audit_key_idx
  on store_attribute_audit (attribute_key);

alter table store_attribute_audit enable row level security;

create policy store_attribute_audit_admin_select on store_attribute_audit
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

comment on table store_attribute_audit is
  'Audit log for stores.attributes jsonb bag changes (single + bulk). bulk_operation_id groups one admin batch. Read via netlify/functions/org-mgmt; direct SELECT admin-only.';

notify pgrst, 'reload schema';
