-- Migration 0063 — Workspace template SECTIONS as first-class objects.
--
-- Before: sections were just a string label on each question
-- (workspace_template_questions.section_label). That worked for visual
-- grouping but had no identity, no position you could reorder, and —
-- the breaking limitation — no place to attach section-level conditional
-- logic. The renderer needs `show_if` on sections too (Smartsheet-style),
-- so sections need to be real rows.
--
-- After:
--   • workspace_template_sections — { id, version_id, position, label,
--     conditional_logic, created_at }. Per-version, ordered.
--   • workspace_template_questions.section_id — FK to the new table.
--     Set NULL means "unsectioned" (a fine state; the renderer just
--     groups those at the top).
--   • The existing section_label string stays for display fallback and
--     for the existing builder's upsertQuestions flow (which doesn't
--     know about section_id yet — see the backend backfill helper).
--
-- The backfill below: for each (version_id, distinct section_label),
-- create one section row at position = order-of-first-appearance, then
-- point each question.section_id at the new row.

create table workspace_template_sections (
  id                  uuid        primary key default gen_random_uuid(),
  version_id          uuid        not null references workspace_template_versions(id) on delete cascade,
  position            int         not null,
  label               text        not null,
  conditional_logic   jsonb,
  created_at          timestamptz not null default now(),
  unique (version_id, position)
);

comment on table workspace_template_sections is
  'First-class sections for a template version. Carries position + label + show_if rules.';
comment on column workspace_template_sections.conditional_logic is
  'show_if DSL: { show_if: [{ question_id, op, value }] } — multiple rules implicit AND.';

create index workspace_template_sections_version_idx
  on workspace_template_sections (version_id, position);

alter table workspace_template_questions
  add column section_id uuid references workspace_template_sections(id) on delete set null;

create index workspace_template_questions_section_idx
  on workspace_template_questions (section_id);

-- Backfill. Use a CTE to assign positions deterministically: order
-- sections by the min(position) of the questions that share the label,
-- so the new section order matches the original visual flow.
with section_seed as (
  select
    version_id,
    section_label,
    min(position)                                     as min_q_position,
    row_number() over (
      partition by version_id
      order by min(position)
    )                                                  as section_position
  from workspace_template_questions
  where section_label is not null and section_label <> ''
  group by version_id, section_label
),
inserted as (
  insert into workspace_template_sections (version_id, position, label)
  select version_id, section_position, section_label
  from section_seed
  returning id, version_id, label
)
update workspace_template_questions q
  set section_id = i.id
from inserted i
where q.version_id = i.version_id
  and q.section_label = i.label;

-- Sanity check: every question with a section_label should now have a
-- section_id. (Questions with NULL/empty section_label intentionally
-- stay NULL.)
do $$
declare
  orphan_count int;
begin
  select count(*) into orphan_count
  from workspace_template_questions
  where section_label is not null
    and section_label <> ''
    and section_id is null;
  if orphan_count > 0 then
    raise exception 'Backfill missed % questions — sections backfill failed.', orphan_count;
  end if;
end
$$;
