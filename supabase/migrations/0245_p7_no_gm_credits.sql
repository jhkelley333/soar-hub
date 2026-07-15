-- 0245_p7_no_gm_credits.sql
-- Period 7 "No Salary GM" (open-store) weeks loaded as no_gm labor credits
-- from the weekly GM-coverage grid. $880/week spread per day feeds the
-- ranker + Labor v2 credit-adjust. Idempotent: clears prior P7-import rows.
-- 26 rows / 82 open GM-weeks. PTO weeks are NOT credited (not a no_gm reason).

delete from no_gm_credits where reason = 'no_gm' and note like 'P7 coverage import%';

insert into no_gm_credits (store_number, reason, start_date, end_date, note) values
  ('5935', 'no_gm', '2026-07-06', '2026-07-12', 'P7 coverage import (wk 2-2; GM: Mateo Medina)'),
  ('6433', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('6568', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('3072', 'no_gm', '2026-06-29', '2026-07-05', 'P7 coverage import (wk 1-1; GM: Jeremy Powel)'),
  ('4361', 'no_gm', '2026-06-29', '2026-07-19', 'P7 coverage import (wk 1-3; GM: OPEN)'),
  ('4410', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('5288', 'no_gm', '2026-06-29', '2026-07-12', 'P7 coverage import (wk 1-2; GM: Gerald Dunden)'),
  ('5694', 'no_gm', '2026-07-06', '2026-07-26', 'P7 coverage import (wk 2-4; GM blank)'),
  ('6794', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Open)'),
  ('2220', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('3477', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Cassandra Miller)'),
  ('4377', 'no_gm', '2026-06-29', '2026-07-05', 'P7 coverage import (wk 1-1; GM: Chloe Minor)'),
  ('4728', 'no_gm', '2026-06-29', '2026-07-12', 'P7 coverage import (wk 1-2; GM: Shelby Reid)'),
  ('2326', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Mary Anderberg)'),
  ('5972', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Open)'),
  ('6116', 'no_gm', '2026-07-06', '2026-07-26', 'P7 coverage import (wk 2-4; GM: OPEN)'),
  ('6276', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('6286', 'no_gm', '2026-07-06', '2026-07-26', 'P7 coverage import (wk 2-4; GM: Open)'),
  ('6001', 'no_gm', '2026-06-29', '2026-07-19', 'P7 coverage import (wk 1-3; GM: Open)'),
  ('6883', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Open)'),
  ('6886', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: OPEN)'),
  ('1832', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Bobby Gibson)'),
  ('2266', 'no_gm', '2026-07-06', '2026-07-19', 'P7 coverage import (wk 2-3; GM: Kristen Maloy)'),
  ('3522', 'no_gm', '2026-07-06', '2026-07-26', 'P7 coverage import (wk 2-4; GM: OPEN)'),
  ('3610', 'no_gm', '2026-06-29', '2026-07-26', 'P7 coverage import (wk 1-4; GM: Michael Cooper)'),
  ('5122', 'no_gm', '2026-07-06', '2026-07-26', 'P7 coverage import (wk 2-4; GM: OPEN)');

notify pgrst, 'reload schema';
