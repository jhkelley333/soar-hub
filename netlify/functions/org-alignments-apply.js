// org-alignments-apply — scheduled auto-applier for the Org Alignment tool
// (migration 0308). Once a day it applies any alignment that is 'scheduled' and
// whose effective date (America/Chicago) has arrived. Idempotent: applyAlignment
// skips anything already applied, and a partial failure resumes on the next run.
// A GitHub Actions cron also pings this (Netlify scheduling is unreliable here).

import { createClient } from "@supabase/supabase-js";
import { dueAlignments, applyAlignment } from "./_lib/orgAlignment.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(s, p) { return { statusCode: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }; }

// ~6:00 AM America/Chicago (11:00 UTC). GitHub Actions drives it too.
export const config = { schedule: "0 11 * * *" };

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "env not configured" });
  const supa = admin();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  let due;
  try { due = await dueAlignments(supa, today); }
  catch (e) { return respond(500, { error: e?.message || "lookup failed" }); }

  const results = [];
  for (const a of due) {
    const r = await applyAlignment(supa, a.id, null);
    if (r.error) { console.error(`[org-alignments-apply] ${a.name}: ${r.error}`); results.push({ id: a.id, name: a.name, error: r.error }); }
    else { console.log(`[org-alignments-apply] applied "${a.name}" — ${r.created} new node(s), ${r.moved} move(s)`); results.push({ id: a.id, name: a.name, applied: true, created: r.created, moved: r.moved }); }
  }
  return respond(200, { ok: true, today, due: due.length, results });
};
