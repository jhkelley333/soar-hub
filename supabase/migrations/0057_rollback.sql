-- supabase/migrations/0057_rollback.sql
--
-- Reverses 0057_equipment_register.sql. WARNING: drops the table
-- entirely, including any rows the team has entered.

drop trigger if exists equipment_register_set_updated_at_trg on public.equipment_register;
drop function if exists public.equipment_register_set_updated_at();
drop table if exists public.equipment_register;

notify pgrst, 'reload schema';
