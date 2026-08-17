-- 0292_paf_offboarding_confirmed.sql
-- Record the Termination off-boarding attestation (removed from TR, POS,
-- ToteZone, WhatsApp, and deactivated in MySOARHUB) so it shows on the PAF.

alter table paf_submissions add column if not exists offboarding_confirmed boolean;

notify pgrst, 'reload schema';
