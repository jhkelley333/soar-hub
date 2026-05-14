-- Rollback for 0046_vendor_scopes.sql. Drops the entire scope
-- table. Any data in it is lost; dump first if you need to keep
-- the assignments.

drop table if exists vendor_scopes;

notify pgrst, 'reload schema';
