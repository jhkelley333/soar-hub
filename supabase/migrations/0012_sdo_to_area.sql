-- supabase/migrations/0012_sdo_to_area.sql
--
-- Re-maps existing SDO assignments from district scope to their parent
-- area scope. Senior District Operators typically oversee a multi-
-- district area (e.g. Area 08 / North DFW), so storing them at district
-- level was always slightly wrong — they only got visibility into one
-- of the districts they actually run.
--
-- This migration walks every (user_id, scope_type='district', scope_id)
-- row whose user is an SDO, looks up that district's area_id, and
-- rewrites the row to (scope_type='area', scope_id=<area_id>). If the
-- district referenced no longer exists, the row is left alone and a
-- followup admin task can clean it up via My Team.
--
-- Idempotent: running twice is a no-op (the WHERE clause filters on
-- scope_type='district' so once converted the row won't match again).

update user_scopes us
   set scope_type = 'area',
       scope_id   = d.area_id
  from districts d, profiles p
 where us.scope_type = 'district'
   and us.scope_id   = d.id
   and us.user_id    = p.id
   and p.role        = 'sdo';
