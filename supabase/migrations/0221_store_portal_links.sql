-- 0221_store_portal_links.sql
-- Quick Links for the Store Command Center. Each link is either a straight
-- redirect (kind = link, opens url) or an info panel (kind = panel, opens a
-- pop-over with a subtitle, contact lines, and sub-links - the Coke Support
-- pattern). Global across stores, ordered, admin-managed from the Command
-- Center Links page. Service-role gatekeeper: RLS on, no policies. Pure ASCII.

create table if not exists store_portal_links (
  id          uuid primary key default gen_random_uuid(),
  sort_order  int not null default 0,
  label       text not null,
  emoji       text,                        -- small icon on the pill (optional)
  description text,                        -- one-liner under the label (optional)
  kind        text not null default 'link',   -- link | panel
  url         text,                        -- kind = link
  panel       jsonb,                       -- kind = panel: { subtitle, lines[], links[{label, description, url}] }
  is_active   boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists store_portal_links_order_idx on store_portal_links (is_active, sort_order);

alter table store_portal_links enable row level security;

notify pgrst, 'reload schema';
