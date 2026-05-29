-- supabase/migrations/0113_paf_new_hire_market_area.sql
--
-- Phase 2 of the "New Hire (Salary Leader)" PAF category. Records the
-- DO market (district) / SDO area selection and a snapshot of the stores
-- it auto-populated, so the PAF carries a permanent record independent of
-- the viewer's own store scope. (Display only — no access is assigned.)

alter table paf_submissions
  add column if not exists nh_market text,   -- district name (DO)
  add column if not exists nh_area   text,   -- area name (SDO)
  add column if not exists nh_stores text;   -- comma-joined store numbers snapshot

notify pgrst, 'reload schema';
