-- supabase/migrations/0105_store_pos_provider.sql
--
-- The store-data-points work (0104) mistakenly wired the free-text "POS"
-- field to stores.pos_system. But pos_system is an existing enum
-- ('infor' | 'micros', from 0029_contacts_and_vendors.sql) that the
-- Contacts module reads to filter vendor contacts by POS type — it is not
-- a free-text field, and arbitrary values (Toast, Square, …) violate its
-- CHECK constraint.
--
-- Add a dedicated free-text column for the store's actual POS system and
-- leave pos_system (and its constraint) alone for Contacts.

alter table stores
  add column if not exists pos_provider text;

notify pgrst, 'reload schema';
