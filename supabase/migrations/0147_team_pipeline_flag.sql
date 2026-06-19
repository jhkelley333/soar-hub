-- 0147_team_pipeline_flag.sql
-- Register the Team Pipeline (Talent Planning) feature flag. Gated + scoped:
-- the module is hidden until this flag resolves true for the user. Seeded
-- DISABLED with empty allowlists so it's dark until an admin turns it on or
-- allowlists specific DOs/stores for a pilot (Admin → Feature Flags).
insert into feature_flags (key, enabled, allowlist_stores, allowlist_user_ids, notes)
values (
  'team_pipeline',
  false,
  '{}',
  '{}',
  'Team Pipeline — Talent Planning (succession, staffing, hiring reqs, corrective-action docs). Pilot: enable globally or allowlist specific DOs/SDOs.'
)
on conflict (key) do nothing;
