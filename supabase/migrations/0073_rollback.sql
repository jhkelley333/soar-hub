-- Rollback for 0073_personal_contacts.sql
DROP TABLE IF EXISTS public.personal_contacts CASCADE;
DROP FUNCTION IF EXISTS public.personal_contacts_touch_updated_at();
NOTIFY pgrst, 'reload schema';
