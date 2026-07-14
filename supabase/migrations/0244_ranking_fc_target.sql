-- 0244_ranking_fc_target.sql
-- Food-cost miss is measured against a TARGET efficiency (default 96%), per
-- the SOAR Ranking category definitions: "dollars lost by running below 96%
-- efficiency = actual food cost minus what it would have been at 96%
-- efficiency; at/above 96% the miss is $0." Adjustable in Ranking System
-- Settings. Versioned like the bands. Pure ASCII.

insert into ranking_config (key, value, effective_from, note)
values ('fc_target_efficiency', '{"efficiency": 0.96}'::jsonb, '2025-12-29',
        'Food cost miss threshold: actual minus ideal/target, floored at 0. Adjustable.')
on conflict (key, effective_from) do nothing;

notify pgrst, 'reload schema';
