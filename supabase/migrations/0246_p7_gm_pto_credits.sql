-- 0246_p7_gm_pto_credits.sql
-- Period 7 GM PTO weeks loaded as approved GM PTO in pto_requests so the
-- Labor v2 credit-adjust applies the GM PTO credit ($176/day). Each PTO
-- week = a Mon-Fri 5-day block (days_used 5 = $880/wk), per the decision to
-- treat a week-level PTO mark as a full work week. Idempotent.
-- 14 rows / 70 PTO days ($12320).

delete from pto_requests where notes like 'P7 PTO import%';

insert into pto_requests
  (submitter_id, submitter_email, submitter_name, store_number, gm_name, pto_start_date, pto_end_date, days_used, position, status, approved_at, notes)
select sub.id, 'info@heathkelley.com', 'Historical Import',
       v.store_number, v.gm_name, v.s::date, v.e::date, 5, 'GM', 'SDO/RVP Approved', now(),
       'P7 PTO import (wk '||v.wk||')'
from (values
  ('6191', 'Dymon Turner', '2026-07-06', '2026-07-10', 2),
  ('6670', 'Meghan Daly', '2026-06-29', '2026-07-03', 1),
  ('3426', 'Alexis Richardson', '2026-06-29', '2026-07-03', 1),
  ('3440', 'Bridget Lewis', '2026-07-06', '2026-07-10', 2),
  ('3574', 'Daeshia Smith', '2026-07-13', '2026-07-17', 3),
  ('3722', 'Denisha Vaughn', '2026-07-06', '2026-07-10', 2),
  ('3733', 'Teresa Russ', '2026-06-29', '2026-07-03', 1),
  ('4436', 'Elizabeth Gibson', '2026-06-29', '2026-07-03', 1),
  ('5267', 'Raven Fountain', '2026-07-13', '2026-07-17', 3),
  ('5718', 'Shakeiva Skipper', '2026-07-06', '2026-07-10', 2),
  ('6006', 'Triandos Lipscomb', '2026-07-13', '2026-07-17', 3),
  ('1759', 'Mark Lewis', '2026-06-29', '2026-07-03', 1),
  ('4762', 'Sally Johnson', '2026-07-06', '2026-07-10', 2),
  ('2266', 'Kristen Maloy', '2026-06-29', '2026-07-03', 1)
) as v(store_number, gm_name, s, e, wk)
cross join (select coalesce(
  (select id from profiles where lower(email)='info@heathkelley.com' limit 1),
  (select id from profiles where role='admin' order by created_at limit 1)
) as id) as sub;

notify pgrst, 'reload schema';
