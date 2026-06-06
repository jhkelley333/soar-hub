# Migrations

Migrations live in `supabase/migrations/` and are applied by pasting the SQL
into the **Supabase SQL editor** (Soar Hub v2 project). To stop the recurring
"the page 400s because a migration wasn't run" problem, the database now tracks
what's applied in `public.schema_migrations`.

## How it works

- `0135_schema_migrations.sql` created the tracking table and **backfilled
  every migration through 0134** as applied.
- **Every migration from 0135 onward records itself** — its last statement is:
  ```sql
  insert into public.schema_migrations (id) values ('0136_my_change')
  on conflict (id) do nothing;
  ```
  So once you run a migration, the DB knows. No separate step.
- CI (`npm run check:migrations`, `scripts/check-migrations.mjs`) **fails the
  PR** if a new migration file forgets that line — the convention can't be
  silently dropped.

## Authoring a new migration

1. Create `supabase/migrations/NNNN_short_name.sql` (next number, 4 digits).
2. Write the change. End it with the self-record line using the file's own id
   (the filename without `.sql`):
   ```sql
   insert into public.schema_migrations (id) values ('NNNN_short_name')
   on conflict (id) do nothing;

   notify pgrst, 'reload schema';
   ```
3. Open the PR — CI checks it self-records.

## Applying + checking what's live

Paste the migration SQL into the Supabase editor and run it (it records
itself). To see what's applied:

```sql
-- everything applied, newest first
select id, applied_at from public.schema_migrations order by id desc;

-- the latest applied id — should match the newest file in supabase/migrations/
select max(id) from public.schema_migrations;
```

**What's pending?** Compare the newest filenames in `supabase/migrations/`
(excluding `*_rollback.sql`) to the rows above. Any forward migration whose id
is **not** in `schema_migrations` hasn't been run — run it.

> Backfill caveat: `0135` assumed every migration through `0134` was already
> applied. If you ever discover one wasn't, delete its row from
> `schema_migrations`, then run that migration so it re-records cleanly.

## Conventions

- 4-digit zero-padded prefix, then `_snake_case`.
- `ALTER TYPE ... ADD VALUE` (enum additions) can't be used in the same
  transaction they're added — run those on their own (see `0119`, `0131`).
- Enable RLS on new tables; if the table is only touched by a service-role
  Netlify function, enable RLS with **no policies** (the function is the
  gatekeeper). End schema changes with `notify pgrst, 'reload schema';`.
