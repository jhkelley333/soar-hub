-- 0313_period_commitment_metric_actions.sql
-- Redesign RVP period commitments into a metric-anchored, action-driven format:
-- anchor each commitment to a Ranker metric, capture a 4-week baseline, and
-- record the SPECIFIC actions (what / owner / cadence / expected impact) that
-- will move it. Adds metric_key, metric_label, baseline_value and an actions
-- jsonb array to rvp_period_commitments, and extends the immutable history
-- trigger to log the new fields. Additive + idempotent; existing free-text
-- rows keep working (new columns default to null / '[]').

alter table public.rvp_period_commitments
  add column if not exists metric_key     text,
  add column if not exists metric_label   text,
  add column if not exists baseline_value numeric,
  add column if not exists actions        jsonb not null default '[]'::jsonb;

-- Extend the history trigger to also log metric, baseline_value and actions.
-- Redefining the function is picked up on the next UPDATE; the trigger binding
-- (rvp_period_commitment_history_write) is unchanged. actions is a structured
-- list, so its edits are captured as a single 'actions' count diff rather than
-- a per-field explosion.
create or replace function public.rvp_period_commitment_log_change()
returns trigger language plpgsql as $$
begin
  if new.commitment_text is distinct from old.commitment_text then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'commitment_text', old.commitment_text, new.commitment_text);
  end if;
  if new.metric_key is distinct from old.metric_key then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'metric', old.metric_label, new.metric_label);
  end if;
  if new.baseline_value is distinct from old.baseline_value then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'baseline_value', old.baseline_value::text, new.baseline_value::text);
  end if;
  if new.target_value is distinct from old.target_value then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'target_value', old.target_value::text, new.target_value::text);
  end if;
  if new.target_unit is distinct from old.target_unit then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'target_unit', old.target_unit, new.target_unit);
  end if;
  if new.actions is distinct from old.actions then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'actions',
            jsonb_array_length(old.actions)::text || ' action(s)',
            jsonb_array_length(new.actions)::text || ' action(s)');
  end if;
  if new.status is distinct from old.status then
    insert into public.rvp_period_commitment_history (commitment_id, changed_by, field, old_value, new_value)
    values (new.id, new.updated_by, 'status', old.status, new.status);
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
