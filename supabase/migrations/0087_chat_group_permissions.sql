-- supabase/migrations/0087_chat_group_permissions.sql
--
-- Per-group permission settings. Each is 'everyone' or 'admins' (owner +
-- admins). Enforced server-side in the chat function:
--   perm_send → who can post messages
--   perm_add  → who can add members
--   perm_edit → who can edit group info (name/description/photo)
-- Defaults mirror the design (send open, the rest admins-only).
--
-- "Who can pin" and "Approve new members" are intentionally omitted until
-- message pinning + a join-request flow exist.

alter table public.chat_threads
  add column if not exists perm_send text not null default 'everyone'
    check (perm_send in ('everyone', 'admins')),
  add column if not exists perm_add text not null default 'admins'
    check (perm_add in ('everyone', 'admins')),
  add column if not exists perm_edit text not null default 'admins'
    check (perm_edit in ('everyone', 'admins'));
