// reports-dispatcher — Netlify Scheduled Function. Every 15 minutes it finds
// enabled scheduled reports whose cron just fired (in each report's timezone),
// claims the window for send-once idempotency, runs the handler, sends via
// Resend, and writes an immutable report_runs row.
//
// Netlify's cron is UTC; each report carries its own timezone and the matcher
// evaluates the cron against that wall clock, so "Mondays 7 AM Central" fires
// correctly across the DST switch without seasonal config.
//
// Manual invocation (HTTP GET), for ops:
//   (no params)   run a normal, idempotent dispatch now
//   ?force=1&token=REPORTS_DISPATCH_TOKEN   run every enabled schedule report now
//   ?only=<key>   limit to one report key

import { admin, envConfigured } from "./_lib/reports/core.js";
import { dispatchDue } from "./_lib/reports/dispatch.js";

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

export const handler = async (event) => {
  if (!envConfigured()) { console.warn("[reports-dispatcher] Supabase env missing"); return respond(200, { skipped: "env" }); }
  const params = (event && event.queryStringParameters) || {};

  // `force` bypasses idempotency + cron — guard it behind a token so a bare GET
  // can never spam sends. A normal (un-forced) dispatch is always safe: the
  // window claim makes it send-once.
  let force = false;
  if (params.force === "1") {
    const token = process.env.REPORTS_DISPATCH_TOKEN;
    if (!token || params.token !== token) return respond(403, { error: "force requires a valid token" });
    force = true;
  }

  const supa = admin();
  try {
    const results = await dispatchDue(supa, { now: new Date(), force, only: params.only || null });
    const ran = results.filter((r) => r.status).length;
    console.log(`[reports-dispatcher] evaluated=${results.length} ran=${ran} ${JSON.stringify(results)}`);
    return respond(200, { ok: true, evaluated: results.length, ran, results });
  } catch (e) {
    console.warn("[reports-dispatcher] failed", e?.message || e);
    return respond(500, { error: e?.message || "dispatch failed" });
  }
};

// Every 15 minutes. The handler applies each report's own cron + timezone.
export const config = {
  schedule: "*/15 * * * *",
};
