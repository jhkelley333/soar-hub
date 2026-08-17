-- 0290_changeover_district.sql
-- DO changeovers are district-level: record the district on the checklist so it
-- can be shown/identified by District # (the store columns stay populated with a
-- representative store in that district so existing scope + FK logic is unchanged).

alter table changeover_checklists add column if not exists district_code text;
alter table changeover_checklists add column if not exists district_name text;

notify pgrst, 'reload schema';
