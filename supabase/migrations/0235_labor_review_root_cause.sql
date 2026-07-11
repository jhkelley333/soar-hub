-- 0235_labor_review_root_cause.sql
-- Labor miss explanations get a structured root cause (picked from a fixed
-- list before the free-text note) and a snapshot of how many hours the day
-- ran over chart at the time the explanation was filed. Pure ASCII.

alter table labor_reviews
  add column if not exists root_cause text,
  add column if not exists hours_over numeric;

notify pgrst, 'reload schema';
