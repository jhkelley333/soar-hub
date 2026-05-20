// netlify/functions/pm-spawner.js
//
// Netlify Scheduled Function. Runs daily at 11:00 UTC (~7 AM ET /
// 4 AM PT) — early enough that PM tickets land in inboxes before
// the start of business but late enough that overnight admin
// changes settle first.
//
// Each invocation:
//   1. Scans pm_schedule for rows whose next_due_at is within the
//      template's lead window.
//   2. For each due row, creates a ticket and links it back via
//      pm_schedule_id. Skips rows whose prior ticket is still open.
//   3. Fires the standard "submitted" notification so the GM/DO/
//      vendor get pinged.
//
// Admins can also trigger this manually from /admin/work-orders-v2
// (PM tab → "Spawn due now") via pm.js?action=spawnDueNow.

import { createClient } from "@supabase/supabase-js";
import { spawnDuePMs } from "./_lib/pm.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[pm-spawner] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const result = await spawnDuePMs(supabase, { dryRun: false });
    console.log(
      `[pm-spawner] spawned ${result.spawned.length}; skipped ${result.skipped.length}`,
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (err) {
    console.error("[pm-spawner] failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: err?.message || "spawn failed" }),
    };
  }
};

// Schedule config — Netlify reads this export. Cron format.
// "0 11 * * *" = every day at 11:00 UTC.
export const config = {
  schedule: "0 11 * * *",
};
