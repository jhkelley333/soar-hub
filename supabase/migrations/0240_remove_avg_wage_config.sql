-- 0240_remove_avg_wage_config.sql
-- avg wage now comes LIVE from Labor v2 at run time (company average =
-- total labor cost / total labor hours from the run's anchor rows,
-- credit-adjusted - DEVIATIONS B8, Heath 7/13). The pinned config row is
-- removed so the Ranking System Settings page no longer carries a number
-- that is not actually used. Pure ASCII.

delete from ranking_config where key = 'avg_wage';

notify pgrst, 'reload schema';
