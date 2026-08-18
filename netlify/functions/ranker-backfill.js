// netlify/functions/ranker-backfill.js
//
// Synchronous companion to ranker-backfill-background.js.
//   GET ?action=status -> { rows_total, rows_sheet, rows_db, last_imported_at }
// The page POSTs the background function directly to start a run, then polls
// this status. Admin only.

import { supabaseAdmin, getCallerProfile } from "./_lib/ranker-sheets.js";

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function count(supa, refine) {
  let q = supa.from("ranker_week_history").select("*", { count: "exact", head: true });
  if (refine) q = refine(q);
  const { count: c, error } = await q;
  if (error) return 0;
  return c || 0;
}

async function status(supa) {
  const [total, sheet, db] = await Promise.all([
    count(supa),
    count(supa, (q) => q.eq("source", "sheet")),
    count(supa, (q) => q.eq("source", "db")),
  ]);
  const { data: last } = await supa
    .from("ranker_week_history")
    .select("imported_at")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { rows_total: total, rows_sheet: sheet, rows_db: db, last_imported_at: last?.imported_at || null };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let profile;
  try {
    profile = await getCallerProfile(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!profile) return respond(401, { error: "unauthorized" });
  if (profile.role !== "admin") return respond(403, { error: "Ranker backfill is admin-only." });

  const action = (event.queryStringParameters || {}).action || "status";
  try {
    const supa = supabaseAdmin();
    if (event.httpMethod === "GET" && action === "status") return respond(200, await status(supa));
    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    console.error("[ranker-backfill-status] error:", e);
    return respond(500, { error: e.message || "server error" });
  }
};
