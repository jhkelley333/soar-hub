-- 0307_backfill_station_training_wtd.sql
-- Backfill Station Training on the Comms Board for existing runs. Total Training
-- (totalTrainingPct, from TotZone) was written to each run's PTD store rows but
-- not the WTD rows, and the Comms Board reads WTD per week — so historical weeks
-- showed "—". Total Training is a point-in-time snapshot (same for PTD and WTD
-- within a run), so copy each store's PTD value onto its WTD row.
--
-- Idempotent: only fills WTD rows that don't already have the value. New runs
-- set it directly (migration/PR that mirrored it onto WTD), so this is a
-- one-time catch-up for runs computed before that change.

update public.ranking_rows w
set metrics = jsonb_set(w.metrics, '{totalTrainingPct}', p.metrics->'totalTrainingPct', true)
from public.ranking_rows p
where p.run_id = w.run_id
  and p.entity_key = w.entity_key
  and p.tier = 'store' and w.tier = 'store'
  and p.scope = 'ptd' and w.scope = 'wtd'
  and (p.metrics ? 'totalTrainingPct')
  and p.metrics->'totalTrainingPct' <> 'null'::jsonb
  and (w.metrics->>'totalTrainingPct') is null;

notify pgrst, 'reload schema';
