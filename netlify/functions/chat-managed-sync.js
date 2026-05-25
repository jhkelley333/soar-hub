// netlify/functions/chat-managed-sync.js
//
// Netlify Scheduled Function — nightly safety sweep for managed group
// chats. Reconciles every active managed group against the live org
// roster (chat_sync_managed_groups), catching any drift the event-driven
// hooks in team-mgmt missed. Idempotent: a no-op when everything's in sync.
//
// Cron: "0 8 * * *" (08:00 UTC ≈ overnight in US Central).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[chat-managed-sync] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("chat_sync_managed_groups", { p_actor: null });
  if (error) {
    console.error("[chat-managed-sync] sync failed:", error.message);
    return { statusCode: 500, body: error.message };
  }
  console.log(`[chat-managed-sync] reconciled ${data ?? 0} managed group(s).`);
  return { statusCode: 200, body: `reconciled ${data ?? 0}` };
};

export const config = {
  schedule: "0 8 * * *",
};
