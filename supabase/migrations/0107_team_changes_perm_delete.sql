-- supabase/migrations/0107_team_changes_perm_delete.sql
--
-- Support admin "permanently delete user" while keeping the deletion in
-- the audit trail.
--
-- Two changes to team_changes:
--   1. Add a 'delete' action to the enum.
--   2. Relax the actor_id / target_id foreign keys so audit rows OUTLIVE
--      the profiles they reference:
--        - target_id was ON DELETE CASCADE → deleting a user wiped their
--          whole history (including the 'delete' row we just wrote).
--          Now ON DELETE SET NULL; team-mgmt.js denormalizes the deleted
--          user's email / name / role / scopes into before{} so the row
--          stays meaningful with a null target_id.
--        - actor_id was ON DELETE RESTRICT → you couldn't delete anyone
--          who had ever performed a team action. Now ON DELETE SET NULL.
--
-- Both columns become nullable to allow SET NULL.

-- 1. New action value. (ADD VALUE is idempotent via IF NOT EXISTS; if your
--    SQL editor wraps the whole script in one transaction and complains,
--    run just this line on its own first.)
alter type team_change_action add value if not exists 'delete';

-- 2. Relax the FKs.
alter table team_changes alter column actor_id  drop not null;
alter table team_changes alter column target_id drop not null;

alter table team_changes drop constraint team_changes_actor_id_fkey;
alter table team_changes add  constraint team_changes_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table team_changes drop constraint team_changes_target_id_fkey;
alter table team_changes add  constraint team_changes_target_id_fkey
  foreign key (target_id) references profiles(id) on delete set null;
