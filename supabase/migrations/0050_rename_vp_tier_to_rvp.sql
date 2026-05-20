-- supabase/migrations/0050_rename_vp_tier_to_rvp.sql
--
-- Renames the top approval tier label from "VP $1001-$1750" to
-- "RVP $1001-$1750" across both columns that store it. The cost
-- ladder is unchanged; only the role/label prefix on the tier
-- changes — because the operational approvers at that band are
-- Regional VPs, not corporate VPs.
--
-- Affected columns:
--   * tickets.approval_level
--   * ticket_approvals.approval_tier
--
-- Frontend constants + backend tier-resolution functions were
-- updated in code; this migration aligns existing data so the
-- recipient-routing branch matches every existing row instead
-- of just new ones going forward.
--
-- Idempotent. Run on Soar Hub v2.

update tickets
   set approval_level = 'RVP $1001-$1750'
 where approval_level = 'VP $1001-$1750';

update ticket_approvals
   set approval_tier = 'RVP $1001-$1750'
 where approval_tier = 'VP $1001-$1750';

notify pgrst, 'reload schema';
