-- Enable Supabase Realtime for chat. Adding the tables to the
-- supabase_realtime publication makes INSERT/UPDATE events stream to
-- subscribed clients. Authorization is the table's RLS select policy
-- (chat_is_member), so a client only receives changes for threads it
-- belongs to — the same scoping the chat.js function enforces.
--
-- Idempotent: skip a table that is already in the publication.

do $$
declare
  t text;
begin
  foreach t in array array['chat_messages', 'chat_thread_members'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
