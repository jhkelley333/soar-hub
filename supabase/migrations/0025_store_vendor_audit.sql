-- supabase/migrations/0025_store_vendor_audit.sql
--
-- Audit log for changes to the food-vendor fields on public.stores.
-- Plate IQ Email + Soar Company are not editable from the UI (admin /
-- SQL only) and so are not tracked here.
--
-- Writes happen through the netlify/functions/org.js update-store-vendor
-- action (service role). Direct SELECT is admin-only; everyone else
-- reads through a future audit endpoint if/when we expose one in UI.
--
-- Idempotent. Apply via the Supabase SQL editor against Soar Hub v2.

create table if not exists store_vendor_audit (
  id          uuid        primary key default uuid_generate_v4(),
  store_id    uuid        not null references stores(id) on delete cascade,
  actor_id    uuid        references profiles(id) on delete set null,
  actor_email text,
  field       text        not null,
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists store_vendor_audit_store_id_idx
  on store_vendor_audit (store_id);
create index if not exists store_vendor_audit_created_at_idx
  on store_vendor_audit (created_at desc);

alter table store_vendor_audit enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'store_vendor_audit_admin_select'
  ) then
    create policy store_vendor_audit_admin_select on store_vendor_audit for select
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'admin'
        )
      );
  end if;
end$$;

notify pgrst, 'reload schema';
