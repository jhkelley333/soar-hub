-- 0146_site_audit_storage.sql
-- Private bucket for Site Audit photos (issue photos, completion-proof photos,
-- and signed-report signatures). Uploads/reads route through the service-role
-- site-audit function, so the bucket stays private with no public policies.

insert into storage.buckets (id, name, public)
values ('site-audit-photos', 'site-audit-photos', false)
on conflict (id) do nothing;
