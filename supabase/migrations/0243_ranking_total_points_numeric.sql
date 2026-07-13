-- 0243_ranking_total_points_numeric.sql
-- Total points can be fractional at WTD leader tiers: the engine averages
-- member scores there (a DO's WTD BSC score is the plain average of its
-- stores' 1-5s, e.g. 3.4), so a leader's total lands like 19.8. The column
-- was wrongly typed int in 0237; widen it to numeric. rank stays int
-- (RANK.EQ is always whole). Pure ASCII.

alter table ranking_rows
  alter column total_points type numeric using total_points::numeric;

notify pgrst, 'reload schema';
