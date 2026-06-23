-- 0180_store_message_links.sql
-- Add a links array to store messages: external URLs plus internal app links
-- (e.g. a link to a training course at /qsr/course/<id>). Each entry is
-- {label, url, training?}.

alter table store_messages
  add column if not exists links jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
