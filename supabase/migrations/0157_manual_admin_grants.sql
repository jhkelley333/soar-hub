-- 0157_manual_admin_grants.sql
-- Manual & Guide Search — Phase 5. The admin UI creates manuals and uploads
-- versions directly via the client; the RLS write policies from 0154
-- (manual_can_manage() = RVP+/admin) gate them. Grant the table privileges so
-- those policies are reachable. manual_chunks stays read-only to clients — its
-- rows are written by the service-role ingest function.
grant insert, update, delete on manuals to authenticated;
grant insert, update, delete on doc_versions to authenticated;

notify pgrst, 'reload schema';
