-- 0073_personal_contacts.sql
-- Per-user private contacts. Owned by the creator, invisible to
-- everyone else (RLS uses auth.uid() = user_id). Lives in the
-- Directory page's "Mine" tab.
--
-- Photo upload arrives in a follow-up migration that creates the
-- storage bucket + bucket-scoped RLS. The photo_url column lands now
-- so we don't need another ALTER when that ships.

CREATE TABLE IF NOT EXISTS public.personal_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       text,
  category    text,
  notes       text,
  photo_url   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_contacts_user_created_idx
  ON public.personal_contacts (user_id, created_at DESC);

-- updated_at maintenance — same pattern other tables use.
CREATE OR REPLACE FUNCTION public.personal_contacts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_contacts_touch_updated_at ON public.personal_contacts;
CREATE TRIGGER personal_contacts_touch_updated_at
  BEFORE UPDATE ON public.personal_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.personal_contacts_touch_updated_at();

ALTER TABLE public.personal_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_contacts_select_own ON public.personal_contacts;
CREATE POLICY personal_contacts_select_own
  ON public.personal_contacts
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_contacts_insert_own ON public.personal_contacts;
CREATE POLICY personal_contacts_insert_own
  ON public.personal_contacts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_contacts_update_own ON public.personal_contacts;
CREATE POLICY personal_contacts_update_own
  ON public.personal_contacts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_contacts_delete_own ON public.personal_contacts;
CREATE POLICY personal_contacts_delete_own
  ON public.personal_contacts
  FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_contacts TO authenticated;

NOTIFY pgrst, 'reload schema';
