-- supabase/migrations/0124_walkthrough_public_templates.sql
--
-- Template-level "public / self-serve": a template can be marked public so
-- anyone (who runs walkthroughs) can self-start it from My Walks at one of
-- their own stores — no per-assignment posting needed. Complements the
-- existing per-assignment is_public (a one-off open walk).
--
--   * walkthrough_templates.is_public — the standing self-serve flag.
--   * walkthrough_assignments.source_template_id — set on a copy claimed
--     directly from a public template (vs source_assignment_id for a copy
--     claimed from a public assignment). Lets us hide a template the caller
--     already has an open run of.
--
-- No enum change — safe single block.

alter table public.walkthrough_templates
  add column if not exists is_public boolean not null default false;

alter table public.walkthrough_assignments
  add column if not exists source_template_id uuid
    references public.walkthrough_templates(id) on delete set null;

notify pgrst, 'reload schema';
