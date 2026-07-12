-- 0239_ranking_band_seeds.sql
-- Seed the ranking scoring bands from the sheet's Config tab (received
-- 7/13) into ranking_config, effective from FY2026 start. Bands are
-- HLOOKUP-approximate [[threshold, score], ...] ascending. Also seeds the
-- distribution DRY_RUN flag + test recipient (brief section 8: while true,
-- every send routes to the test inbox with a [TEST] prefix).
--
-- NOT seeded, deliberately:
--   - labor chart / chart2 (on hold - IX target is the goal, DEVIATIONS B1/B2)
--   - labor_variance band: its values (0->4, 0.001->3, 0.005->2, 1->1) are
--     the engine's hard-coded laborScoreChart thresholds already
--   - avg_wage: seeded pinned at 12.84 by 0237 (matches the Config tab)
-- Pure ASCII.

create unique index if not exists ranking_config_key_eff_uq
  on ranking_config (key, effective_from);

insert into ranking_config (key, value, effective_from, note) values
  ('bands.sales_vs_ly',    '[[-6.6, 1], [-0.1, 2], [0, 3], [0.1, 4], [0.2, 5]]'::jsonb,                '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.food_cost',      '[[0, 1], [0.92, 2], [0.96, 3], [0.97, 4], [0.985, 5]]'::jsonb,             '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.bsc_training',   '[[0, 1], [0.7, 2], [0.75, 3], [0.8, 4], [0.9, 5]]'::jsonb,                 '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.on_time',        '[[0, 1], [0.6501, 2], [0.7001, 3], [0.7501, 4], [0.8001, 5]]'::jsonb,      '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.complaints',     '[[0, 5], [1.3001, 4], [1.701, 3], [2.001, 2], [2.5, 1]]'::jsonb,           '2025-12-29', 'Config tab 2026-07-13; lower is better'),
  ('bands.food_safety',    '[[0, 1], [0.84, 2], [0.88, 3], [0.92, 4], [0.950001, 5]]'::jsonb,          '2025-12-29', 'Config tab 2026-07-13 (EcoSure)'),
  ('bands.vog',            '[[0, 1], [0.4, 2], [0.5, 3], [0.6, 4], [0.7, 5]]'::jsonb,                  '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.total_training', '[[0, 1], [0.8, 2], [0.9, 3], [0.95, 4], [0.98, 5]]'::jsonb,                '2025-12-29', 'Config tab 2026-07-13'),
  ('bands.shops',          '[[0, 1], [0.8601, 2], [0.8801, 3], [0.9001, 4], [0.9201, 5]]'::jsonb,      '2025-12-29', 'Config tab 2026-07-13; mystery shops (info only, not in Total Points)'),
  ('distribution.dry_run', '{"enabled": true}'::jsonb,                                                  '2025-12-29', 'While enabled, all ranking emails go to the test recipient with a [TEST] prefix'),
  ('distribution.test_email', '{"email": "alex@soarqsr.com"}'::jsonb,                                   '2025-12-29', 'DRY_RUN recipient (Config tab 2026-07-13)')
on conflict (key, effective_from) do nothing;

notify pgrst, 'reload schema';
