// Nightly Talent Pipeline roster sync.
//
// Real-time hooks in team-mgmt keep the pipeline seat in step with My Team on
// every account write, but a GM can also be (re)assigned through other paths
// (Org Admin tree, GM Roster, bulk import). This scheduled sweep reconciles
// every account-linked seat against its live profile so nothing drifts for
// more than a day. Idempotent — safe to run repeatedly.

import { createClient } from "@supabase/supabase-js";
import { reconcileAllProfiles } from "./_lib/tpSync.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase env vars not configured" }) };
  }
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const r = await reconcileAllProfiles(supa);
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || "sync failed" }) };
  }
};

// 08:20 UTC daily (a quiet hour, offset from the other digests).
export const config = { schedule: "20 8 * * *" };
