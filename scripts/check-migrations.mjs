// CI guard for migration tracking. Every migration from 0135 onward must
// record itself in public.schema_migrations (see 0135 + docs/MIGRATIONS.md),
// so the DB always knows what's applied. Legacy migrations (<= 0134) were
// backfilled by 0135 and are exempt. Fails the build if a new migration
// forgets its self-record line.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const MIN = 135;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
  .sort();

const failures = [];
let enforced = 0;

for (const f of files) {
  const m = f.match(/^(\d+)_/);
  if (!m) continue;
  if (parseInt(m[1], 10) < MIN) continue; // backfilled, not retrofitted
  enforced++;
  const id = f.replace(/\.sql$/, "");
  const sql = readFileSync(join(DIR, f), "utf8");
  if (!(/schema_migrations/i.test(sql) && sql.includes(`'${id}'`))) {
    failures.push(
      `  ${f}\n    Add as the last statement:\n` +
        `    insert into public.schema_migrations (id) values ('${id}') on conflict (id) do nothing;`
    );
  }
}

if (failures.length) {
  console.error("✗ Migration tracking check failed — these migrations don't record themselves:\n");
  console.error(failures.join("\n\n"));
  console.error("\nSee docs/MIGRATIONS.md.");
  process.exit(1);
}

console.log(`✓ Migration tracking OK — ${files.length} forward migrations, ${enforced} self-recording (>= ${MIN}).`);
