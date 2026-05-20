-- Rollback for 0050_rename_vp_tier_to_rvp.sql.
-- Reverts the tier label back to "VP $1001-$1750". Code changes
-- in vendor-portal, facilities-v2, and the frontend dropdown have
-- to be reverted separately if you actually want to roll back —
-- otherwise new rows will keep writing "RVP $1001-$1750" while
-- old rows say "VP $1001-$1750".

update tickets
   set approval_level = 'VP $1001-$1750'
 where approval_level = 'RVP $1001-$1750';

update ticket_approvals
   set approval_tier = 'VP $1001-$1750'
 where approval_tier = 'RVP $1001-$1750';

notify pgrst, 'reload schema';
