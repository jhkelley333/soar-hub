// Report engine — dispatch core. Runs one report end-to-end (handler → send →
// immutable run log) and finds/claims due scheduled reports. The dispatcher
// function and the admin API both call in here.

import { sendEmail, resolveRecipients, lastFireWithin } from "./core.js";
import { getHandler } from "./registry.js";

// Insert the immutable run row and stamp the definition's last-run summary
// (skipped for test sends so a test doesn't overwrite the real last status).
async function finalize(supa, definition, run) {
  const { data } = await supa.from("report_runs").insert(run).select().maybeSingle();
  if (!run.payload_summary?.test) {
    await supa.from("report_definitions")
      .update({ last_run_at: run.completed_at || run.started_at, last_status: run.status })
      .eq("key", definition.key);
  }
  return data || run;
}

// Execute one report definition: run its handler, send to the resolved
// recipients (or a single testTo), and write exactly one report_runs row.
export async function runReport(supa, definition, { now = new Date(), windowStart = null, testTo = null } = {}) {
  const base = {
    report_key: definition.key,
    window_start: windowStart ? windowStart.toISOString() : null,
    started_at: new Date().toISOString(),
  };
  const handler = getHandler(definition.key);
  if (!handler) {
    return finalize(supa, definition, { ...base, status: "failed", completed_at: new Date().toISOString(), error: `No handler registered for '${definition.key}'`, payload_summary: { test: !!testTo } });
  }

  let result;
  try {
    result = await handler({ supa, definition, now });
  } catch (e) {
    return finalize(supa, definition, { ...base, status: "failed", completed_at: new Date().toISOString(), error: String(e?.message || e).slice(0, 1000), payload_summary: { test: !!testTo } });
  }

  const rowCount = Number.isFinite(result?.rowCount) ? result.rowCount : 0;
  // Empty result + not send-when-empty → log a skip, send nothing.
  if (rowCount === 0 && definition.send_when_empty === false && !testTo) {
    return finalize(supa, definition, { ...base, status: "skipped", completed_at: new Date().toISOString(), row_count: 0, recipient_count: 0, payload_summary: { reason: "empty", ...(result.summary || {}) } });
  }

  let recipientCount = 0;
  let sendErr = null;
  try {
    if (Array.isArray(result.perRecipient) && !testTo) {
      for (const msg of result.perRecipient) {
        const r = await sendEmail(msg);
        if (r.ok) recipientCount += r.count || (Array.isArray(msg.to) ? msg.to.length : 1);
        else if (!r.skipped) sendErr = sendErr || `${r.status}: ${r.detail || ""}`;
      }
    } else {
      const to = testTo ? [testTo] : await resolveRecipients(supa, definition.recipients);
      const r = await sendEmail({ to, subject: result.subject, text: result.text, html: result.html });
      if (r.ok) recipientCount = r.count || to.length;
      else if (r.skipped) sendErr = testTo ? null : (r.reason || "no recipients resolved");
      else sendErr = `${r.status}: ${r.detail || ""}`;
    }
  } catch (e) {
    sendErr = String(e?.message || e);
  }

  return finalize(supa, definition, {
    ...base,
    status: sendErr ? "failed" : "success",
    completed_at: new Date().toISOString(),
    row_count: rowCount,
    recipient_count: recipientCount,
    error: sendErr ? String(sendErr).slice(0, 1000) : null,
    payload_summary: { ...(result.summary || {}), test: !!testTo },
  });
}

// Load a definition by key and run it (used by the admin "send test" + the
// event path). testTo → send only to that address; otherwise real recipients.
export async function runReportByKey(supa, key, { testTo = null, now = new Date() } = {}) {
  const { data: def } = await supa.from("report_definitions").select("*").eq("key", key).maybeSingle();
  if (!def) return { error: `Unknown report '${key}'`, status: 404 };
  return runReport(supa, def, { now, testTo });
}

// Find enabled scheduled reports due this tick, claim each window, and run.
// `force` runs every enabled scheduled report now regardless of cron; `only`
// limits to one key. The dispatcher runs ~every 15 min.
export async function dispatchDue(supa, { now = new Date(), force = false, only = null } = {}) {
  const LOOKBACK_MIN = 16; // small overlap over the ~15-min dispatcher interval
  let q = supa.from("report_definitions").select("*").eq("trigger_type", "schedule").eq("enabled", true);
  if (only) q = q.eq("key", only);
  const { data: defs } = await q;

  const results = [];
  for (const def of defs || []) {
    if (!def.cron && !force) continue;

    let windowStart;
    if (force) {
      windowStart = new Date(now);
      windowStart.setUTCSeconds(0, 0);
    } else {
      windowStart = lastFireWithin(def.cron, def.timezone || "America/Chicago", now, LOOKBACK_MIN);
      if (!windowStart) continue; // not due this tick
    }

    // Claim the window. ignoreDuplicates → a concurrent/second dispatcher that
    // already claimed this window gets an empty result and skips (send-once).
    const { data: claim, error: claimErr } = await supa
      .from("report_run_windows")
      .upsert({ report_key: def.key, window_start: windowStart.toISOString() }, { onConflict: "report_key,window_start", ignoreDuplicates: true })
      .select();
    if (claimErr) { results.push({ key: def.key, skipped: "claim-error", error: claimErr.message }); continue; }
    if (!force && (!claim || claim.length === 0)) { results.push({ key: def.key, skipped: "window-already-ran" }); continue; }

    const run = await runReport(supa, def, { now, windowStart });
    results.push({ key: def.key, status: run.status, recipients: run.recipient_count, rows: run.row_count, error: run.error || undefined });
  }
  return results;
}
