-- 0181_store_message_edited.sql
-- Track when a store message was edited (shown as an "edited" marker).

alter table store_messages
  add column if not exists edited_at timestamptz;

notify pgrst, 'reload schema';
