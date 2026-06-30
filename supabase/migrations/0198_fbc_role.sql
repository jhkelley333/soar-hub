-- 0198_fbc_role.sql
-- Add 'fbc' (Franchise Business Consultant) to user_role for external
-- consultants who need a narrow read-mostly slice of the hub.
--
-- Sits "below admin" in the enum (purely positional — fbc is a horizontal
-- back-office role like payroll / accounting / facilities; it's NOT in the
-- numeric hierarchy and role_level() returns null for it). Access is granted
-- per-module, not by tier.
--
-- What an FBC gets, in app code:
--   - /ranker                 (read)
--   - /my-stores              (read; includes the Birthdays widget)
--   - /qsr/manage             (Team Training — read)
--   - /operations + site-audits (Operations Tools hub)
-- Everything else (PAF, employee actions, labor reviews, cash mgmt, work
-- orders, message-board posting, escalation chains, manageable_users)
-- continues to filter them out via existing role checks.
--
-- Scoping: an FBC is assigned a user_scopes row (typically area) so
-- user_visible_stores() returns only the stores they oversee — no
-- changes needed there.

alter type user_role add value if not exists 'fbc' before 'admin';

notify pgrst, 'reload schema';
