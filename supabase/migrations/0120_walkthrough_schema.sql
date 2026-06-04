-- supabase/migrations/0120_walkthrough_schema.sql
--
-- Store Walkthrough module — the GM in-field inspection flow. A GM checks in
-- at a store (GPS-gated), rates each template item Pass / Watch / Fail / N/A
-- across N sections, attaches photos (time + GPS stamped), and submits. Submit
-- is atomic (done in app code via service role): it writes a submission, emits
-- a corrective action for each qualifying Fail, notifies the DO, and stamps
-- the store's last-visit time.
--
-- Conventions mirror 0066_reno_scoping_schema.sql:
--   * stores referenced by uuid (stores.id), not SDI text. The app resolves
--     an SDI to a store_id before writing.
--   * user fks land on profiles(id), not auth.users(id).
--   * role gating uses role_level() + can_see_store() + is_admin() from
--     0001_init.sql / 0002_add_vp_coo_roles.sql.
--   * current_role() is unreliable from RLS on this project (reserved-word
--     clash) — we define a module-scoped walkthrough_caller_role() helper.
--   * updated_at reuses set_updated_at() from 0001.
--
-- Templates + sections/items are embedded as jsonb (the runner + the admin
-- builder both consume a single nested WalkthroughTemplate object); filled
-- responses live as jsonb on the submission. Submissions are immutable once
-- submitted — a guard trigger enforces it; revisions create a linked new row
-- via prior_submission_id.
--
-- Idempotent where Postgres allows. Run after applying, reload PostgREST.

-- ============================================================================
-- STORES: last-visit stamp (set on submit)
-- ============================================================================

alter table stores add column if not exists last_visit_at timestamptz;

comment on column stores.last_visit_at is
  'Most recent walkthrough submission time for this store (set by submit).';

-- ============================================================================
-- CALLER ROLE HELPER (safe-named; see 0066 note on current_role())
-- ============================================================================

create or replace function walkthrough_caller_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- ============================================================================
-- TEMPLATES — produced by the admin builder; stamped onto every submission
-- ============================================================================

create table if not exists walkthrough_templates (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  type          text        not null default 'walkthrough'
                  check (type in ('walkthrough', 'audit', 'safety')),
  version       text        not null,
  is_active     boolean     not null default true,
  -- Full nested structure: [{ code, name, items: [{ code, label, weight,
  -- severity, allowNa, rules:[...] }] }]
  sections      jsonb       not null default '[]'::jsonb,
  -- { pass, watch, fail } as fractions 0..1
  scoring       jsonb       not null default '{"pass":1,"watch":0.6,"fail":0}'::jsonb,
  -- { green, yellow } lower bounds
  tiers         jsonb       not null default '{"green":85,"yellow":70}'::jsonb,
  -- { photoOnEveryFail, allowNa }
  global_rules  jsonb       not null default '{"photoOnEveryFail":true,"allowNa":false}'::jsonb,
  created_by    uuid        references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (name, version)
);

comment on table walkthrough_templates is
  'Walkthrough/audit/safety templates. sections/scoring/tiers/global_rules '
  'embedded as jsonb to match the WalkthroughTemplate object the app consumes.';

-- ============================================================================
-- ASSIGNMENTS — a template handed to a GM for a store, with a due date
-- ============================================================================

create table if not exists walkthrough_assignments (
  id                uuid        primary key default gen_random_uuid(),
  template_id       uuid        not null references walkthrough_templates(id) on delete restrict,
  template_version  text        not null,
  store_id          uuid        not null references stores(id) on delete restrict,
  assignee_id       uuid        not null references profiles(id) on delete restrict,
  due_at            timestamptz,
  status            text        not null default 'not_started'
                      check (status in ('not_started', 'in_progress', 'submitted')),
  assigned_by       uuid        references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists walkthrough_assignments_store_idx    on walkthrough_assignments(store_id);
create index if not exists walkthrough_assignments_assignee_idx on walkthrough_assignments(assignee_id);
create index if not exists walkthrough_assignments_status_idx   on walkthrough_assignments(status);
create index if not exists walkthrough_assignments_due_idx      on walkthrough_assignments(due_at);

-- ============================================================================
-- CHECK-INS — GPS stamp that opens a session
-- ============================================================================

create table if not exists walkthrough_checkins (
  id                uuid        primary key default gen_random_uuid(),
  assignment_id     uuid        not null references walkthrough_assignments(id) on delete cascade,
  store_id          uuid        not null references stores(id) on delete restrict,
  user_id           uuid        not null references profiles(id) on delete restrict,
  at                timestamptz not null default now(),
  lat               double precision not null,
  lng               double precision not null,
  accuracy          double precision,
  geofence_result   text        not null
                      check (geofence_result in ('on_site', 'nearby', 'off_site')),
  exception_reason  text,
  created_at        timestamptz not null default now()
);

create index if not exists walkthrough_checkins_assignment_idx on walkthrough_checkins(assignment_id);
create index if not exists walkthrough_checkins_store_idx      on walkthrough_checkins(store_id);

-- ============================================================================
-- SUBMISSIONS — immutable once submitted; revisions chain via prior_submission_id
-- ============================================================================

create table if not exists walkthrough_submissions (
  id                  uuid        primary key default gen_random_uuid(),
  assignment_id       uuid        not null references walkthrough_assignments(id) on delete restrict,
  store_id            uuid        not null references stores(id) on delete restrict,
  template_id         uuid        not null references walkthrough_templates(id) on delete restrict,
  template_version    text        not null,
  check_in_id         uuid        references walkthrough_checkins(id) on delete set null,
  -- [{ code, note, items: [{ itemCode, value, reason, note, photoIds:[],
  --    raisedCorrectiveActionId }] }]
  sections            jsonb       not null default '[]'::jsonb,
  score               int         not null default 0,
  tier                text        not null default 'red'
                        check (tier in ('green', 'yellow', 'red')),
  flag_count          int         not null default 0,
  status              text        not null default 'draft'
                        check (status in ('draft', 'submitted', 'needs_revision', 'approved')),
  prior_submission_id uuid        references walkthrough_submissions(id) on delete set null,
  submitted_by        uuid        not null references profiles(id) on delete restrict,
  submitted_at        timestamptz,
  reviewed_by         uuid        references profiles(id) on delete set null,
  reviewed_at         timestamptz,
  review_notes        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists walkthrough_submissions_assignment_idx on walkthrough_submissions(assignment_id);
create index if not exists walkthrough_submissions_store_idx      on walkthrough_submissions(store_id);
create index if not exists walkthrough_submissions_status_idx     on walkthrough_submissions(status);
create index if not exists walkthrough_submissions_submitted_idx  on walkthrough_submissions(submitted_at desc);
create index if not exists walkthrough_submissions_tier_idx       on walkthrough_submissions(tier);

-- ============================================================================
-- PHOTOS — metadata + storage path; bytes live in the walkthrough-photos bucket
-- ============================================================================

create table if not exists walkthrough_photos (
  id              uuid        primary key default gen_random_uuid(),
  assignment_id   uuid        not null references walkthrough_assignments(id) on delete cascade,
  submission_id   uuid        references walkthrough_submissions(id) on delete set null,
  item_code       text        not null,
  storage_path    text,
  -- Capture metadata (overlay, not burned into pixels).
  taken_at        timestamptz,
  lat             double precision,
  lng             double precision,
  upload_status   text        not null default 'pending'
                    check (upload_status in ('pending', 'uploading', 'uploaded', 'error')),
  uploaded_by     uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  uploaded_at     timestamptz
);

create index if not exists walkthrough_photos_assignment_idx on walkthrough_photos(assignment_id);
create index if not exists walkthrough_photos_submission_idx on walkthrough_photos(submission_id);
create index if not exists walkthrough_photos_item_idx       on walkthrough_photos(item_code);

-- ============================================================================
-- CORRECTIVE ACTIONS — one per qualifying Fail (emitted by submit). The full
-- CAPA dashboard / verify flow is a separate ticket; this is the create side.
-- ============================================================================

create table if not exists corrective_actions (
  id                    uuid        primary key default gen_random_uuid(),
  source_submission_id  uuid        not null references walkthrough_submissions(id) on delete cascade,
  source_item_code      text        not null,
  store_id              uuid        not null references stores(id) on delete restrict,
  title                 text        not null,
  owner_id              uuid        not null references profiles(id) on delete restrict,
  due_at                timestamptz,
  priority              text        not null default 'med'
                          check (priority in ('low', 'med', 'high')),
  origin_photo_ids      uuid[]      not null default array[]::uuid[],
  status                text        not null default 'open'
                          check (status in ('open', 'in_progress', 'verified', 'closed')),
  resolution_notes      text,
  verified_by           uuid        references profiles(id) on delete set null,
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists corrective_actions_submission_idx on corrective_actions(source_submission_id);
create index if not exists corrective_actions_store_idx      on corrective_actions(store_id);
create index if not exists corrective_actions_owner_idx      on corrective_actions(owner_id);
create index if not exists corrective_actions_status_idx     on corrective_actions(status);

-- ============================================================================
-- AUDIT LOG — submit / review / approve transitions (service-role writes)
-- ============================================================================

create table if not exists walkthrough_audit_log (
  id             uuid        primary key default gen_random_uuid(),
  submission_id  uuid        references walkthrough_submissions(id) on delete set null,
  actor_id       uuid        references profiles(id) on delete set null,
  actor_email    text,
  action         text        not null, -- 'submit' | 'review' | 'needs_revision' | 'approve' | 'reopen'
  from_status    text,
  to_status      text,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists walkthrough_audit_log_submission_idx on walkthrough_audit_log(submission_id);
create index if not exists walkthrough_audit_log_created_idx     on walkthrough_audit_log(created_at desc);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- updated_at maintenance reuses set_updated_at() from 0001_init.sql.

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'walkthrough_templates_set_updated_at') then
    create trigger walkthrough_templates_set_updated_at
      before update on walkthrough_templates for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'walkthrough_assignments_set_updated_at') then
    create trigger walkthrough_assignments_set_updated_at
      before update on walkthrough_assignments for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'walkthrough_submissions_set_updated_at') then
    create trigger walkthrough_submissions_set_updated_at
      before update on walkthrough_submissions for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'corrective_actions_set_updated_at') then
    create trigger corrective_actions_set_updated_at
      before update on corrective_actions for each row execute function set_updated_at();
  end if;
end $$;

-- Immutability guard: once a submission is past 'draft', its scored content
-- (sections / score / tier / flag_count) is frozen. Only the review lane
-- (status, reviewed_*, review_notes, updated_at) may change. Revisions are a
-- NEW row linked by prior_submission_id, never an in-place edit.
create or replace function walkthrough_submissions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    if new.sections is distinct from old.sections
       or new.score is distinct from old.score
       or new.tier is distinct from old.tier
       or new.flag_count is distinct from old.flag_count
       or new.template_id is distinct from old.template_id
       or new.check_in_id is distinct from old.check_in_id then
      raise exception 'walkthrough_submissions: scored content is immutable once submitted (id=%)', old.id;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'walkthrough_submissions_immutable') then
    create trigger walkthrough_submissions_immutable
      before update on walkthrough_submissions for each row
      execute function walkthrough_submissions_guard_immutable();
  end if;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table walkthrough_templates    enable row level security;
alter table walkthrough_assignments  enable row level security;
alter table walkthrough_checkins     enable row level security;
alter table walkthrough_submissions  enable row level security;
alter table walkthrough_photos       enable row level security;
alter table corrective_actions       enable row level security;
alter table walkthrough_audit_log    enable row level security;

-- ----- templates: read-all authenticated, write DO+ (builder) / admin -------

create policy walkthrough_templates_read on walkthrough_templates
  for select using (auth.role() = 'authenticated');
create policy walkthrough_templates_write on walkthrough_templates
  for all using (
    role_level(walkthrough_caller_role()) >= role_level('do') or is_admin()
  ) with check (
    role_level(walkthrough_caller_role()) >= role_level('do') or is_admin()
  );

-- ----- assignments: read if you can see the store; DO+ assigns -------------

create policy walkthrough_assignments_read on walkthrough_assignments
  for select using (can_see_store(store_id) or assignee_id = auth.uid());

create policy walkthrough_assignments_write_leader on walkthrough_assignments
  for all using (
    can_see_store(store_id)
    and (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
  ) with check (
    can_see_store(store_id)
    and (role_level(walkthrough_caller_role()) >= role_level('do') or is_admin())
  );

-- Assignee may flip their own assignment to in_progress / submitted.
create policy walkthrough_assignments_update_assignee on walkthrough_assignments
  for update using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

-- ----- check-ins: the assignee creates their own; readable per store -------

create policy walkthrough_checkins_read on walkthrough_checkins
  for select using (can_see_store(store_id) or user_id = auth.uid());

create policy walkthrough_checkins_insert on walkthrough_checkins
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from walkthrough_assignments a
      where a.id = assignment_id and a.assignee_id = auth.uid()
    )
  );

-- ----- submissions: assignee fills own draft; DO+ reviews ------------------

create policy walkthrough_submissions_read on walkthrough_submissions
  for select using (can_see_store(store_id) or submitted_by = auth.uid());

create policy walkthrough_submissions_insert on walkthrough_submissions
  for insert with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from walkthrough_assignments a
      where a.id = assignment_id and a.assignee_id = auth.uid()
    )
  );

-- Owner editing their own draft / kicked-back submission.
create policy walkthrough_submissions_update_owner on walkthrough_submissions
  for update using (
    submitted_by = auth.uid() and status in ('draft', 'needs_revision')
  ) with check (
    submitted_by = auth.uid()
  );

-- DO+ reviewing (the immutability trigger still freezes scored content).
create policy walkthrough_submissions_update_reviewer on walkthrough_submissions
  for update using (
    role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(store_id)
  ) with check (
    can_see_store(store_id)
  );

-- ----- photos: inherit the assignment's ACL --------------------------------

create policy walkthrough_photos_read on walkthrough_photos
  for select using (
    exists (
      select 1 from walkthrough_assignments a
      where a.id = assignment_id
        and (can_see_store(a.store_id) or a.assignee_id = auth.uid())
    )
  );

create policy walkthrough_photos_write on walkthrough_photos
  for all using (
    exists (
      select 1 from walkthrough_assignments a
      where a.id = assignment_id
        and (
          a.assignee_id = auth.uid()
          or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(a.store_id))
        )
    )
  ) with check (
    exists (
      select 1 from walkthrough_assignments a
      where a.id = assignment_id
        and (
          a.assignee_id = auth.uid()
          or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(a.store_id))
        )
    )
  );

-- ----- corrective actions: read per store; owner/DO+ update; insert via app -

create policy corrective_actions_read on corrective_actions
  for select using (can_see_store(store_id) or owner_id = auth.uid());

create policy corrective_actions_update on corrective_actions
  for update using (
    owner_id = auth.uid()
    or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(store_id))
    or is_admin()
  ) with check (
    can_see_store(store_id) or owner_id = auth.uid() or is_admin()
  );
-- inserts happen via service role inside the submit transaction.

-- ----- audit log: read per submission's store; writes via service role -----

create policy walkthrough_audit_log_read on walkthrough_audit_log
  for select using (
    exists (
      select 1 from walkthrough_submissions s
      where s.id = submission_id and can_see_store(s.store_id)
    )
  );

-- ============================================================================
-- STORAGE BUCKET — walkthrough-photos (private). Path: <assignment_id>/<file>
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('walkthrough-photos', 'walkthrough-photos', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'walkthrough_photos_storage_read') then
    create policy walkthrough_photos_storage_read on storage.objects for select
      using (
        bucket_id = 'walkthrough-photos'
        and exists (
          select 1 from public.walkthrough_assignments a
          where a.id::text = (storage.foldername(name))[1]
            and (can_see_store(a.store_id) or a.assignee_id = auth.uid())
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'walkthrough_photos_storage_insert') then
    create policy walkthrough_photos_storage_insert on storage.objects for insert
      with check (
        bucket_id = 'walkthrough-photos'
        and auth.role() = 'authenticated'
        and exists (
          select 1 from public.walkthrough_assignments a
          where a.id::text = (storage.foldername(name))[1]
            and (
              a.assignee_id = auth.uid()
              or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(a.store_id))
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'walkthrough_photos_storage_update') then
    create policy walkthrough_photos_storage_update on storage.objects for update
      using (
        bucket_id = 'walkthrough-photos'
        and exists (
          select 1 from public.walkthrough_assignments a
          where a.id::text = (storage.foldername(name))[1]
            and (
              a.assignee_id = auth.uid()
              or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(a.store_id))
            )
        )
      );
  end if;

  if not exists (select 1 from pg_policies where policyname = 'walkthrough_photos_storage_delete') then
    create policy walkthrough_photos_storage_delete on storage.objects for delete
      using (
        bucket_id = 'walkthrough-photos'
        and exists (
          select 1 from public.walkthrough_assignments a
          where a.id::text = (storage.foldername(name))[1]
            and (
              a.assignee_id = auth.uid()
              or (role_level(walkthrough_caller_role()) >= role_level('do') and can_see_store(a.store_id))
            )
        )
      );
  end if;
end $$;
