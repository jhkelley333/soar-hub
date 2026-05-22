-- supabase/migrations/0066_reno_scoping_schema.sql
--
-- Reno Scoping module — Pre-Reskin Scoping (v1) for the Sonic Reskin
-- Full-to-Bright 2026 program. Field scopers (GMs + DOs) walk a store
-- against a 27-item checklist, capture 10 required + 8 generic-overflow
-- photos plus ad-hoc item photos, optionally upload 360-degree
-- equirectangular spheres, and submit for DO+ review.
--
-- Conventions (vs. the original draft authored against a generic
-- Role_Registry assumption):
--   * stores are referenced by uuid (stores.id), not store_number text.
--   * user fks land on profiles(id), not auth.users(id).
--   * role gating uses current_role() + role_level() + can_see_store()
--     from 0001_init.sql / 0002_add_vp_coo_roles.sql. There is no
--     user_district() helper and no stores.gm_user_id column in this
--     codebase; visibility is computed by walking user_scopes.
--   * updated_at trigger reuses the set_updated_at() helper from 0001.
--   * "Leadership" in the brief == role_level(current_role()) >=
--     role_level('rvp').
--
-- Closeout phase, POPS Optimization, Refresh / Rebrand project types,
-- 360 hotspots, vendor-per-item, and budget rollups are intentionally
-- deferred. Schema leaves room for them but does not implement.
--
-- Idempotent where Postgres allows. Run 0067_reno_scoping_seed.sql next.

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'scope_tier') then
    create type scope_tier as enum (
      'existing_condition',
      'minimum_standard',
      'plus_up',
      'optional'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'scope_item_status') then
    create type scope_item_status as enum (
      'pass',
      'fail',
      'needs_work',
      'na'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'scope_status') then
    create type scope_status as enum (
      'draft',
      'submitted',
      'reviewed',
      'needs_revision',
      'approved'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'building_type') then
    create type building_type as enum (
      'center_tower_curved',
      'dt_tower_curved',
      'center_tower_flat',
      'brick_stone'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'reno_cohort') then
    create type reno_cohort as enum (
      'cohort_1',
      'cohort_2',
      'cohort_3'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'scope_input_type') then
    create type scope_input_type as enum (
      'pass_fail_needs_work',
      'yes_no',
      'measurement',
      'multi_select'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- TEMPLATES
-- ----------------------------------------------------------------------------

create table if not exists scope_templates (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  module_type  text        not null default 'reno_scoping',
  version      text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (module_type, version)
);

comment on table scope_templates is
  'Reusable scope-template engine. v1 seeds one template for Sonic Reskin 2026.';

-- ----------------------------------------------------------------------------
-- TEMPLATE ITEMS
-- ----------------------------------------------------------------------------

create table if not exists scope_template_items (
  id                          uuid        primary key default gen_random_uuid(),
  template_id                 uuid        not null references scope_templates(id) on delete cascade,
  category                    text        not null,
  subcategory                 text,
  sort_order                  int         not null,
  item_label                  text        not null,
  item_description            text,
  tier                        scope_tier  not null,
  input_type                  scope_input_type not null default 'pass_fail_needs_work',
  photo_required              boolean     not null default false,
  applies_to_building_types   building_type[] not null default array[
    'center_tower_curved',
    'dt_tower_curved',
    'center_tower_flat',
    'brick_stone'
  ]::building_type[],
  -- NULL means "required for every building type in applies_to_building_types".
  -- Set explicitly only when an item shows for all types but is optional for
  -- some (e.g. Lenticulars: shown everywhere, required for everything except
  -- brick_stone). The UI / submission validator does:
  --   coalesce(required_for_building_types, applies_to_building_types)
  required_for_building_types building_type[],
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists scope_template_items_template_idx
  on scope_template_items(template_id);
create index if not exists scope_template_items_tier_idx
  on scope_template_items(tier);
create index if not exists scope_template_items_sort_idx
  on scope_template_items(template_id, sort_order);

-- ----------------------------------------------------------------------------
-- PHOTO SLOTS
-- ----------------------------------------------------------------------------
-- 10 required named slots (Front, Side-DT, Rear, etc.) +
-- 8 generic overflow slots for plus-up / repair photos.
-- Item-specific photos use reno_scope_photos with scope_item_id set and
-- photo_slot_id null.

create table if not exists scope_photo_slots (
  id             uuid        primary key default gen_random_uuid(),
  template_id    uuid        not null references scope_templates(id) on delete cascade,
  slot_number    int         not null,
  slot_name      text        not null,
  is_required    boolean     not null default true,
  is_conditional boolean     not null default false,
  sort_order     int         not null,
  created_at     timestamptz not null default now(),
  unique (template_id, slot_number)
);

create index if not exists scope_photo_slots_template_idx
  on scope_photo_slots(template_id);

-- ----------------------------------------------------------------------------
-- RENO SCOPES — one row per store visit
-- ----------------------------------------------------------------------------

create table if not exists reno_scopes (
  id                          uuid        primary key default gen_random_uuid(),
  store_id                    uuid        not null references stores(id) on delete restrict,
  scoped_by                   uuid        not null references profiles(id) on delete restrict,
  scope_date                  date        not null default current_date,
  building_type               building_type not null,
  cohort                      reno_cohort,
  template_id                 uuid        not null references scope_templates(id) on delete restrict,
  preferred_signage_vendor    text,
  preferred_canopy_vendor     text,
  preferred_gc                text,
  preferred_paint_contractor  text,
  status                      scope_status not null default 'draft',
  submitted_at                timestamptz,
  reviewed_at                 timestamptz,
  reviewed_by                 uuid        references profiles(id) on delete set null,
  review_notes                text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists reno_scopes_store_idx       on reno_scopes(store_id);
create index if not exists reno_scopes_scoped_by_idx   on reno_scopes(scoped_by);
create index if not exists reno_scopes_status_idx      on reno_scopes(status);
create index if not exists reno_scopes_cohort_idx      on reno_scopes(cohort);
create index if not exists reno_scopes_scope_date_idx  on reno_scopes(scope_date desc);

comment on column reno_scopes.cohort is
  'Auto-derived from stores.state on insert via derive_reno_cohort(). '
  'Cohort 1: TX/AZ/NM. Cohort 2: OK/NV/UT/CO/KS/TN/NC/SC/GA/AR/AL/MS/LA/FL. '
  'Cohort 3: everything else.';

-- ----------------------------------------------------------------------------
-- SCOPE ITEM RESPONSES
-- ----------------------------------------------------------------------------

create table if not exists reno_scope_items (
  id                    uuid        primary key default gen_random_uuid(),
  scope_id              uuid        not null references reno_scopes(id) on delete cascade,
  template_item_id      uuid        not null references scope_template_items(id) on delete restrict,
  status                scope_item_status,
  notes                 text,
  estimated_cost        numeric(10, 2),
  recommend_for_plus_up boolean,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (scope_id, template_item_id)
);

create index if not exists reno_scope_items_scope_idx  on reno_scope_items(scope_id);
create index if not exists reno_scope_items_status_idx on reno_scope_items(status);

-- ----------------------------------------------------------------------------
-- SCOPE PHOTOS
-- ----------------------------------------------------------------------------

create table if not exists reno_scope_photos (
  id             uuid        primary key default gen_random_uuid(),
  scope_id       uuid        not null references reno_scopes(id) on delete cascade,
  scope_item_id  uuid        references reno_scope_items(id) on delete set null,
  photo_slot_id  uuid        references scope_photo_slots(id) on delete set null,
  storage_path   text        not null,
  caption        text,
  taken_at       timestamptz,
  uploaded_by    uuid        references profiles(id) on delete set null,
  uploaded_at    timestamptz not null default now()
);

create index if not exists reno_scope_photos_scope_idx on reno_scope_photos(scope_id);
create index if not exists reno_scope_photos_item_idx  on reno_scope_photos(scope_item_id);
create index if not exists reno_scope_photos_slot_idx  on reno_scope_photos(photo_slot_id);

-- ----------------------------------------------------------------------------
-- 360 TOURS
-- ----------------------------------------------------------------------------

create table if not exists reno_scope_tours (
  id               uuid        primary key default gen_random_uuid(),
  scope_id         uuid        not null references reno_scopes(id) on delete cascade,
  storage_path     text        not null,
  capture_position text        not null,
  sort_order       int         not null default 0,
  uploaded_by      uuid        references profiles(id) on delete set null,
  uploaded_at      timestamptz not null default now()
);

create index if not exists reno_scope_tours_scope_idx on reno_scope_tours(scope_id);

-- ----------------------------------------------------------------------------
-- FREEFORM NOTES
-- ----------------------------------------------------------------------------

create table if not exists reno_scope_notes (
  id          uuid        primary key default gen_random_uuid(),
  scope_id    uuid        not null references reno_scopes(id) on delete cascade,
  note_text   text        not null,
  created_by  uuid        not null references profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);

create index if not exists reno_scope_notes_scope_idx on reno_scope_notes(scope_id);

-- ----------------------------------------------------------------------------
-- AUDIT LOG — submit / review / approve transitions
-- ----------------------------------------------------------------------------

create table if not exists reno_scope_audit_log (
  id           uuid        primary key default gen_random_uuid(),
  scope_id     uuid        references reno_scopes(id) on delete set null,
  actor_id     uuid        references profiles(id) on delete set null,
  actor_email  text,
  action       text        not null, -- 'create' | 'submit' | 'review' | 'needs_revision' | 'approve' | 'reopen'
  from_status  scope_status,
  to_status    scope_status,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists reno_scope_audit_log_scope_idx
  on reno_scope_audit_log(scope_id);
create index if not exists reno_scope_audit_log_created_at_idx
  on reno_scope_audit_log(created_at desc);

-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------
-- updated_at maintenance reuses set_updated_at() from 0001_init.sql.

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'scope_templates_set_updated_at') then
    create trigger scope_templates_set_updated_at
      before update on scope_templates for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'scope_template_items_set_updated_at') then
    create trigger scope_template_items_set_updated_at
      before update on scope_template_items for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'reno_scopes_set_updated_at') then
    create trigger reno_scopes_set_updated_at
      before update on reno_scopes for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'reno_scope_items_set_updated_at') then
    create trigger reno_scope_items_set_updated_at
      before update on reno_scope_items for each row execute function set_updated_at();
  end if;
end $$;

-- Caller's role. 0001_init.sql defines current_role() but the name
-- collides with a reserved SQL keyword and the function is not
-- reliably resolvable from RLS expressions on this project (the
-- parser intercepts the bareword, and even public.current_role()
-- errors out with "function does not exist" on Soar Hub v2). Define
-- our own helper with a safe name and use it everywhere below.
create or replace function reno_caller_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- Cohort derivation: pulls stores.state on insert.
create or replace function derive_reno_cohort()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  store_state text;
begin
  if new.cohort is null then
    select state into store_state from stores where id = new.store_id;

    new.cohort := case
      when store_state in ('TX', 'AZ', 'NM') then 'cohort_1'::reno_cohort
      when store_state in ('OK', 'NV', 'UT', 'CO', 'KS', 'TN', 'NC', 'SC',
                           'GA', 'AR', 'AL', 'MS', 'LA', 'FL') then 'cohort_2'::reno_cohort
      else 'cohort_3'::reno_cohort
    end;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reno_scopes_derive_cohort') then
    create trigger reno_scopes_derive_cohort
      before insert on reno_scopes for each row execute function derive_reno_cohort();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Visibility for every scope-bound table follows can_see_store(store_id).
-- Write rules:
--   * Scopers (gm+) can insert a scope on a store they can see.
--   * Scopers can update their own draft / needs_revision rows.
--   * DO+ can update any scope they can see (review actions).
--   * Admin can do anything.
-- App code is responsible for enforcing legal status transitions; the
-- update policies only gate "can this user touch this row at all".

alter table scope_templates       enable row level security;
alter table scope_template_items  enable row level security;
alter table scope_photo_slots     enable row level security;
alter table reno_scopes           enable row level security;
alter table reno_scope_items      enable row level security;
alter table reno_scope_photos     enable row level security;
alter table reno_scope_tours      enable row level security;
alter table reno_scope_notes      enable row level security;
alter table reno_scope_audit_log  enable row level security;

-- ----- templates / template items / photo slots: read-all, write-admin -----

create policy scope_templates_read_authenticated on scope_templates
  for select using (auth.role() = 'authenticated');
create policy scope_templates_write_admin on scope_templates
  for all using (is_admin()) with check (is_admin());

create policy scope_template_items_read_authenticated on scope_template_items
  for select using (auth.role() = 'authenticated');
create policy scope_template_items_write_admin on scope_template_items
  for all using (is_admin()) with check (is_admin());

create policy scope_photo_slots_read_authenticated on scope_photo_slots
  for select using (auth.role() = 'authenticated');
create policy scope_photo_slots_write_admin on scope_photo_slots
  for all using (is_admin()) with check (is_admin());

-- ----- reno_scopes -----

create policy reno_scopes_read_visible on reno_scopes
  for select using (can_see_store(store_id));

create policy reno_scopes_insert_scoper on reno_scopes
  for insert with check (
    can_see_store(store_id)
    and scoped_by = auth.uid()
    and role_level(reno_caller_role()) >= role_level('gm')
  );

-- Scoper editing their own draft (or kicked-back) scope.
create policy reno_scopes_update_own_draft on reno_scopes
  for update using (
    scoped_by = auth.uid()
    and status in ('draft', 'needs_revision')
    and can_see_store(store_id)
  ) with check (
    scoped_by = auth.uid()
    and can_see_store(store_id)
  );

-- DO+ reviewing.
create policy reno_scopes_update_reviewer on reno_scopes
  for update using (
    role_level(reno_caller_role()) >= role_level('do')
    and can_see_store(store_id)
  ) with check (
    can_see_store(store_id)
  );

create policy reno_scopes_delete_own_draft on reno_scopes
  for delete using (
    (scoped_by = auth.uid() and status = 'draft')
    or is_admin()
  );

-- ----- child tables (items / photos / tours / notes): inherit parent ACL ---

create policy reno_scope_items_read on reno_scope_items
  for select using (
    exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );
create policy reno_scope_items_write on reno_scope_items
  for all using (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  ) with check (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  );

create policy reno_scope_photos_read on reno_scope_photos
  for select using (
    exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );
create policy reno_scope_photos_write on reno_scope_photos
  for all using (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  ) with check (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  );

create policy reno_scope_tours_read on reno_scope_tours
  for select using (
    exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );
create policy reno_scope_tours_write on reno_scope_tours
  for all using (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  ) with check (
    exists (
      select 1 from reno_scopes s
      where s.id = scope_id
        and can_see_store(s.store_id)
        and (
          (s.scoped_by = auth.uid() and s.status in ('draft', 'needs_revision'))
          or role_level(reno_caller_role()) >= role_level('do')
        )
    )
  );

create policy reno_scope_notes_read on reno_scope_notes
  for select using (
    exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );
create policy reno_scope_notes_insert on reno_scope_notes
  for insert with check (
    created_by = auth.uid()
    and exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );

-- ----- audit log: read by anyone who can see the scope, no client writes ---

create policy reno_scope_audit_log_read on reno_scope_audit_log
  for select using (
    exists (select 1 from reno_scopes s where s.id = scope_id and can_see_store(s.store_id))
  );
-- writes happen via service-role inside app code on submit/review/approve.
