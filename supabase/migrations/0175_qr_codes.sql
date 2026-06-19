-- 0175_qr_codes.sql
-- Dynamic QR codes (Flowcode-style): a stable short code redirects to an
-- editable target URL, so a printed/shared QR can be repointed when a site
-- moves without reprinting. GM and above create + manage them.

create table if not exists qr_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- short slug used in the public /q/<code> URL
  label text not null,                  -- human name ("Drive-thru menu", "Store 4821 hiring")
  target_url text not null,             -- where it currently points (editable)
  is_active boolean not null default true,
  scan_count integer not null default 0,
  created_by_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qr_codes_created_by_idx on qr_codes (created_by_id);
create index if not exists qr_codes_code_idx on qr_codes (code);

-- Atomic scan counter for the public redirect (avoids a read-modify-write
-- race when two phones scan the same code at once). SECURITY DEFINER so the
-- service-role function can bump the count without a table-write policy.
create or replace function increment_qr_scan(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update qr_codes set scan_count = scan_count + 1 where id = p_id;
$$;

-- All access is brokered by the qr / qr-redirect Netlify functions (service
-- role), which re-check role server-side and serve the anonymous redirect.
-- RLS on with no policies blocks any direct PostgREST read/write.
alter table qr_codes enable row level security;

notify pgrst, 'reload schema';
