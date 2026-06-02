// netlify/functions/workspace-automations-worker.js
//
// Netlify Scheduled Function. Runs every 15 minutes. Evaluates active
// workspace_automations and dispatches their actions when triggers
// match.
//
// Cron: "*/15 * * * *" (UTC). Matches the sweeper pattern. 15-minute
// granularity is fine for compliance-flavored automations (cap-overdue
// alerts, daily/weekly reports). For finer than 15-minute resolution
// on a `scheduled` trigger, the cron expression's minute field is
// matched against THIS run's minute — so "*/5 * * * *" effectively
// fires at most every 15 min anyway.
//
// Trigger handling (all 6 kinds):
//   - Time-based (scheduled, on_cap_overdue)
//     ↓ direct table scans
//   - Event-based (on_submit, on_score_below, on_cap_reopened,
//                  on_repeat_finding)
//     ↓ poll for events in the last ~15 min from workspace_activity_log
//
// Polling means event-based actions fire WITH LATENCY (up to 15 min).
// For instant firing we'd need to wire executor calls into the write
// paths in workspace-submissions.js + workspace-caps.js. That's a
// future-PR optimization; the polling approach is self-contained.
//
// Idempotency: we use the activity_log automation.fired entries as
// the dedupe table. Before firing an automation for an event, we
// check whether a fire row already exists referencing that event.

import { createClient } from "@supabase/supabase-js";
import { usersAtAnchorWithRole } from "./_lib/workspace_resolvers.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Email config — reuses the same env vars as PAF (already provisioned
// in Netlify). Fallback to PAF's address so a brand-new env doesn't
// crash on first run.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.WORKSPACE_FROM_EMAIL
  || process.env.RESEND_FROM_EMAIL
  || "paf@mysoarhub.com";
const FROM_NAME =
  process.env.WORKSPACE_FROM_NAME
  || process.env.RESEND_FROM_NAME
  || "SOAR Workspace";

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Cron matching ───────────────────────────────────────────
//
// Tiny 5-field cron evaluator (minute hour dom month dow). Supports
// "*", "*/N", "M,N,O", "M-N", and integers. No fancy stuff (no
// L/W/?/named months); these would-be-nice if a user ever asks.
//
// Matches the SECOND-precision UTC instant `now` against `expr`.
// Returns true iff the cron pattern matches this minute.
function matchCronField(value, field, min, max) {
  if (field === "*") return true;
  for (const token of field.split(",")) {
    if (token === "*") return true;
    if (token.includes("/")) {
      const [base, stepStr] = token.split("/");
      const step = parseInt(stepStr, 10);
      if (!Number.isFinite(step) || step <= 0) continue;
      if (base === "*") {
        if ((value - min) % step === 0) return true;
        continue;
      }
      if (base.includes("-")) {
        const [a, b] = base.split("-").map((n) => parseInt(n, 10));
        for (let v = a; v <= b; v += step) {
          if (v === value) return true;
        }
        continue;
      }
      const baseN = parseInt(base, 10);
      if (Number.isFinite(baseN)) {
        for (let v = baseN; v <= max; v += step) {
          if (v === value) return true;
        }
      }
      continue;
    }
    if (token.includes("-")) {
      const [a, b] = token.split("-").map((n) => parseInt(n, 10));
      if (Number.isFinite(a) && Number.isFinite(b) && value >= a && value <= b) {
        return true;
      }
      continue;
    }
    const n = parseInt(token, 10);
    if (Number.isFinite(n) && n === value) return true;
  }
  return false;
}

function cronMatches(expr, now) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minStr, hourStr, domStr, monStr, dowStr] = parts;
  const u = {
    min:   now.getUTCMinutes(),
    hour:  now.getUTCHours(),
    dom:   now.getUTCDate(),
    mon:   now.getUTCMonth() + 1, // cron is 1-12
    dow:   now.getUTCDay(),       // 0-6, Sun=0
  };
  return matchCronField(u.min,  minStr,  0,  59)
      && matchCronField(u.hour, hourStr, 0,  23)
      && matchCronField(u.dom,  domStr,  1,  31)
      && matchCronField(u.mon,  monStr,  1,  12)
      && matchCronField(u.dow,  dowStr,  0,  6);
}

// ── Condition evaluator ─────────────────────────────────────
//
// Conditions filter trigger matches before firing. Shapes:
//   { kind: "store_in",      store_ids: [uuid...] }
//   { kind: "tier_at_least", tier: "rvp" }
//   { all: [...] }   AND of sub-conditions
//   { any: [...] }   OR of sub-conditions
//
// `ctx` is the trigger-specific context, typically:
//   { workspaceId, storeId?, submissionId?, capId?, scorePercent?,
//     submitterRole? }
function evaluateCondition(cond, ctx) {
  if (cond == null) return true;
  if (cond.all && Array.isArray(cond.all)) {
    return cond.all.every((c) => evaluateCondition(c, ctx));
  }
  if (cond.any && Array.isArray(cond.any)) {
    return cond.any.some((c) => evaluateCondition(c, ctx));
  }
  switch (cond.kind) {
    case "store_in":
      if (!ctx.storeId) return false;
      return Array.isArray(cond.store_ids) && cond.store_ids.includes(ctx.storeId);
    case "tier_at_least": {
      const TIER_RANK = {
        admin: 0, coo: 0, vp: 1, rvp: 1, sdo: 1, do: 2,
        gm: 3,
        shift_manager: 4, first_assistant_manager: 4, associate_manager: 4,
        crew_leader: 4, crew_member: 4, carhop: 4,
        payroll: 5,
      };
      const need = TIER_RANK[String(cond.tier || "").toLowerCase()];
      const have = TIER_RANK[String(ctx.submitterRole || "").toLowerCase()];
      if (need == null || have == null) return false;
      return have <= need;
    }
    default:
      // Unknown kind → fail closed.
      console.warn("[automations-worker] unknown condition kind:", cond.kind);
      return false;
  }
}

// ── Recipient resolution for send_email ─────────────────────
async function resolveEmailRecipients(supabase, action, ctx) {
  const emails = new Set();

  if (Array.isArray(action.to_emails)) {
    for (const e of action.to_emails) {
      if (typeof e === "string" && e.includes("@")) emails.add(e.toLowerCase());
    }
  }

  if (Array.isArray(action.to_user_ids) && action.to_user_ids.length) {
    const { data } = await supabase
      .from("profiles")
      .select("email, is_active")
      .in("id", action.to_user_ids);
    for (const p of data || []) {
      if (p.is_active && p.email) emails.add(p.email.toLowerCase());
    }
  }

  if (action.to_role) {
    // Anchor preference: submission_store > workspace anchor.
    let anchorKind = null, anchorId = null;
    if (ctx.storeId) {
      anchorKind = "store";
      anchorId = ctx.storeId;
    } else if (ctx.workspaceScopeKind && ctx.workspaceScopeId) {
      anchorKind = ctx.workspaceScopeKind;
      anchorId = ctx.workspaceScopeId;
    }
    if (anchorKind) {
      const userIds = await usersAtAnchorWithRole(supabase, anchorKind, anchorId, action.to_role);
      if (userIds.length) {
        const { data } = await supabase
          .from("profiles").select("email, is_active").in("id", userIds);
        for (const p of data || []) {
          if (p.is_active && p.email) emails.add(p.email.toLowerCase());
        }
      }
    } else {
      // No anchor — fall back to ALL active users with the role (rare,
      // log as such so the operator can see why a blast went out).
      const { data } = await supabase
        .from("profiles")
        .select("email, is_active")
        .ilike("role", action.to_role);
      for (const p of data || []) {
        if (p.is_active && p.email) emails.add(p.email.toLowerCase());
      }
      console.warn("[automations-worker] to_role without anchor — broadcast:", action.to_role);
    }
  }

  return Array.from(emails);
}

// ── Action dispatchers ──────────────────────────────────────
async function dispatchSendEmail(supabase, automation, action, ctx) {
  if (!RESEND_API_KEY) {
    console.warn("[automations-worker] RESEND_API_KEY missing; cannot send email.");
    return { ok: false, reason: "missing_resend_key" };
  }
  const recipients = await resolveEmailRecipients(supabase, action, ctx);
  if (!recipients.length) {
    return { ok: false, reason: "no_recipients" };
  }

  // Variable substitution: {{ var }} → ctx[var]. Simple, no escaping.
  const subst = (s) => String(s || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = ctx[k];
    return v == null ? "" : String(v);
  });
  const subject = subst(action.subject);
  const body = subst(action.body);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: recipients,
      subject,
      // Plain text body. If admins want HTML they can pass HTML in
      // `body` and we'd swap to html: subst(action.body) — single-line
      // change. For v1, text is safer (no XSS risk in unknown content).
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn("[automations-worker] Resend failed:", res.status, errText);
    return { ok: false, reason: "resend_failed", status: res.status };
  }
  return { ok: true, recipients };
}

async function dispatchCreateAssignment(supabase, automation, action, ctx) {
  if (ctx.storeId == null && action.assignee_rule?.kind === "role_relative"
      && action.assignee_rule.anchor === "submission_store") {
    return { ok: false, reason: "no_store_for_role_relative" };
  }

  // Resolve the template's currently published version.
  const { data: published } = await supabase
    .from("workspace_template_versions")
    .select("id")
    .eq("template_id", action.template_id)
    .eq("status", "published")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!published) return { ok: false, reason: "no_published_version" };

  // Resolve assignee.
  let assigneeId = null;
  const rule = action.assignee_rule || {};
  if (rule.kind === "fixed") {
    assigneeId = rule.user_id;
  } else if (rule.kind === "role_relative" && rule.anchor === "submission_store" && ctx.storeId) {
    const users = await usersAtAnchorWithRole(supabase, "store", ctx.storeId, rule.role);
    assigneeId = users[0] || null;
  }
  if (!assigneeId) return { ok: false, reason: "could_not_resolve_assignee" };

  const dueAt = new Date(Date.now() + (action.due_after_hours || 24) * 3_600_000).toISOString();

  const { data: asn, error } = await supabase
    .from("workspace_assignments")
    .insert({
      workspace_id: automation.workspace_id,
      template_id: action.template_id,
      template_version_id: published.id,
      assignee_id: assigneeId,
      store_id: ctx.storeId || null,
      status: "pending",
      due_at: dueAt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, reason: "insert_failed", error: error.message };

  return { ok: true, assignment_id: asn.id };
}

async function dispatchCreateCap(supabase, automation, action, ctx) {
  if (!ctx.submissionId || !ctx.answerId || !ctx.questionId) {
    return { ok: false, reason: "create_cap_requires_submission_answer_question_in_ctx" };
  }

  // Resolve assignee — prefer rule, fall back to ctx.submitterId.
  let assigneeId = ctx.submitterId;
  const rule = action.assignee_rule || {};
  if (rule.kind === "fixed" && typeof rule.user_id === "string") {
    assigneeId = rule.user_id;
  } else if (rule.kind === "role_relative" && rule.anchor === "submission_store" && ctx.storeId) {
    const users = await usersAtAnchorWithRole(supabase, "store", ctx.storeId, rule.role);
    if (users.length) assigneeId = users[0];
  }

  const dueDays = action.due_days || 7;
  const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString();

  const { data: cap, error } = await supabase
    .from("workspace_corrective_action_plans")
    .insert({
      workspace_id: automation.workspace_id,
      submission_id: ctx.submissionId,
      answer_id: ctx.answerId,
      question_id: ctx.questionId,
      store_id: ctx.storeId || null,
      assignee_id: assigneeId,
      status: "open",
      template_instructions: action.instructions || null,
      due_at: dueAt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, reason: "insert_failed", error: error.message };

  return { ok: true, cap_id: cap.id };
}

async function dispatchAction(supabase, automation, ctx) {
  const action = automation.action || {};
  switch (action.kind) {
    case "send_email":        return await dispatchSendEmail(supabase, automation, action, ctx);
    case "create_assignment": return await dispatchCreateAssignment(supabase, automation, action, ctx);
    case "create_cap":        return await dispatchCreateCap(supabase, automation, action, ctx);
    case "notify_in_app":     return { ok: false, reason: "notify_in_app_not_implemented" };
    case "log_only":          return { ok: true, dry_run: true };
    default:                  return { ok: false, reason: "unknown_action_kind" };
  }
}

// ── Idempotency: has this automation already fired for this event? ─
//
// Checks workspace_activity_log for an automation.fired row in the
// last 24h whose event_data.dedupe_key matches the current key.
// Cheap query thanks to the (target_kind, target_id, created_at) idx
// from the schema.
async function checkDedupeKeyById(supabase, automationId, since, dedupeKey) {
  const { data } = await supabase
    .from("workspace_activity_log")
    .select("event_data")
    .eq("target_kind", "automation")
    .eq("target_id", automationId)
    .eq("action", "automation.fired")
    .gte("created_at", since)
    .limit(200);
  return (data || []).some((r) => r.event_data?.dedupe_key === dedupeKey);
}

// ── Log a fire ──────────────────────────────────────────────
async function logFire(supabase, automation, ctx, result, dedupeKey, source) {
  await supabase.from("workspace_activity_log").insert({
    workspace_id: automation.workspace_id,
    actor_id:     null,
    actor_email:  "automation-worker@system",
    actor_role:   "system",
    target_kind:  "automation",
    target_id:    automation.id,
    action:       "automation.fired",
    event_data:   {
      source,
      dedupe_key: dedupeKey,
      trigger_kind: automation.trigger?.kind,
      action_kind:  automation.action?.kind,
      result,
      context: ctx,
    },
  });
  // Bump fire_count + last_fired_at on the automation row.
  await supabase
    .from("workspace_automations")
    .update({
      last_fired_at: new Date().toISOString(),
      fire_count: (automation.fire_count || 0) + 1,
    })
    .eq("id", automation.id);
}

// ── Trigger processors ─────────────────────────────────────

async function processScheduledTriggers(supabase, automations, now) {
  let fired = 0;
  for (const auto of automations) {
    if (auto.trigger?.kind !== "scheduled") continue;
    if (!cronMatches(auto.trigger.cron, now)) continue;
    // Dedupe by the cron minute so we don't double-fire within the
    // same 15-min sweep window if the cron matches multiple minutes.
    const dedupeKey = `scheduled:${auto.id}:${now.toISOString().slice(0, 13)}`; // hour resolution
    if (await checkDedupeKeyById(supabase, auto.id, new Date(Date.now() - 24 * 3600 * 1000).toISOString(), dedupeKey)) {
      continue;
    }

    const ctx = { workspaceId: auto.workspace_id, now: now.toISOString() };
    if (!evaluateCondition(auto.condition, ctx)) continue;

    const result = await dispatchAction(supabase, auto, ctx);
    await logFire(supabase, auto, ctx, result, dedupeKey, "scheduled");
    fired += 1;
  }
  return fired;
}

async function processCapOverdueTriggers(supabase, automations, now) {
  let fired = 0;
  for (const auto of automations) {
    if (auto.trigger?.kind !== "on_cap_overdue") continue;
    const graceMs = (auto.trigger.grace_hours || 0) * 3600 * 1000;
    const cutoff = new Date(now.getTime() - graceMs).toISOString();

    const { data: overdueCaps } = await supabase
      .from("workspace_corrective_action_plans")
      .select("id, store_id, assignee_id, question_id, submission_id, answer_id, due_at")
      .eq("workspace_id", auto.workspace_id)
      .in("status", ["open", "in_progress", "reopened"])
      .lt("due_at", cutoff);

    for (const cap of overdueCaps || []) {
      const dedupeKey = `cap_overdue:${auto.id}:${cap.id}`;
      if (await checkDedupeKeyById(supabase, auto.id, new Date(Date.now() - 7 * 86400 * 1000).toISOString(), dedupeKey)) {
        continue;
      }
      const ctx = {
        workspaceId: auto.workspace_id,
        storeId: cap.store_id,
        capId: cap.id,
        submissionId: cap.submission_id,
        answerId: cap.answer_id,
        questionId: cap.question_id,
        submitterId: cap.assignee_id,
        dueAt: cap.due_at,
      };
      if (!evaluateCondition(auto.condition, ctx)) continue;

      const result = await dispatchAction(supabase, auto, ctx);
      await logFire(supabase, auto, ctx, result, dedupeKey, "cap_overdue");
      fired += 1;
    }
  }
  return fired;
}

// Event-based triggers — poll workspace_activity_log for recent rows
// matching the trigger kind, then for each match fire the matching
// automations.
async function processEventBasedTriggers(supabase, automations, now) {
  let fired = 0;
  const since = new Date(now.getTime() - 20 * 60 * 1000).toISOString(); // 20-min window for overlap safety

  // on_submit
  const submitAutos = automations.filter((a) => a.trigger?.kind === "on_submit");
  if (submitAutos.length) {
    const { data: submitEvents } = await supabase
      .from("workspace_activity_log")
      .select("workspace_id, target_id, event_data, created_at")
      .eq("action", "submission.created")
      .gte("created_at", since)
      .limit(500);
    for (const ev of submitEvents || []) {
      for (const auto of submitAutos) {
        if (auto.workspace_id !== ev.workspace_id) continue;
        if (auto.trigger.template_id && auto.trigger.template_id !== ev.event_data?.template_id) continue;
        const dedupeKey = `on_submit:${auto.id}:${ev.target_id}`;
        if (await checkDedupeKeyById(supabase, auto.id, since, dedupeKey)) continue;

        const ctx = {
          workspaceId: auto.workspace_id,
          submissionId: ev.target_id,
          templateId: ev.event_data?.template_id,
          scorePercent: ev.event_data?.audit_score_percent,
        };
        if (!evaluateCondition(auto.condition, ctx)) continue;
        const result = await dispatchAction(supabase, auto, ctx);
        await logFire(supabase, auto, ctx, result, dedupeKey, "on_submit");
        fired += 1;
      }
    }
  }

  // on_score_below — same source events, but additional threshold check.
  const scoreAutos = automations.filter((a) => a.trigger?.kind === "on_score_below");
  if (scoreAutos.length) {
    const { data: submitEvents } = await supabase
      .from("workspace_activity_log")
      .select("workspace_id, target_id, event_data, created_at")
      .eq("action", "submission.created")
      .gte("created_at", since)
      .not("event_data", "is", null)
      .limit(500);
    for (const ev of submitEvents || []) {
      const score = ev.event_data?.audit_score_percent;
      if (score == null) continue;
      for (const auto of scoreAutos) {
        if (auto.workspace_id !== ev.workspace_id) continue;
        if (auto.trigger.template_id && auto.trigger.template_id !== ev.event_data?.template_id) continue;
        if (Number(score) >= Number(auto.trigger.threshold)) continue;
        const dedupeKey = `on_score_below:${auto.id}:${ev.target_id}`;
        if (await checkDedupeKeyById(supabase, auto.id, since, dedupeKey)) continue;

        const ctx = {
          workspaceId: auto.workspace_id,
          submissionId: ev.target_id,
          templateId: ev.event_data?.template_id,
          scorePercent: score,
          threshold: auto.trigger.threshold,
        };
        if (!evaluateCondition(auto.condition, ctx)) continue;
        const result = await dispatchAction(supabase, auto, ctx);
        await logFire(supabase, auto, ctx, result, dedupeKey, "on_score_below");
        fired += 1;
      }
    }
  }

  // on_cap_reopened — count reopened events per CAP.
  const reopenAutos = automations.filter((a) => a.trigger?.kind === "on_cap_reopened");
  if (reopenAutos.length) {
    const { data: reopenEvents } = await supabase
      .from("workspace_activity_log")
      .select("workspace_id, target_id, event_data, created_at")
      .eq("action", "cap.reopened")
      .gte("created_at", since)
      .limit(500);
    for (const ev of reopenEvents || []) {
      for (const auto of reopenAutos) {
        if (auto.workspace_id !== ev.workspace_id) continue;
        const minReopens = auto.trigger.min_reopens || 1;
        const reopenedCount = ev.event_data?.reopened_count;
        if (reopenedCount != null && reopenedCount < minReopens) continue;
        const dedupeKey = `on_cap_reopened:${auto.id}:${ev.target_id}:${reopenedCount}`;
        if (await checkDedupeKeyById(supabase, auto.id, since, dedupeKey)) continue;

        const ctx = {
          workspaceId: auto.workspace_id,
          capId: ev.target_id,
          reopenedCount,
        };
        if (!evaluateCondition(auto.condition, ctx)) continue;
        const result = await dispatchAction(supabase, auto, ctx);
        await logFire(supabase, auto, ctx, result, dedupeKey, "on_cap_reopened");
        fired += 1;
      }
    }
  }

  // on_repeat_finding — fires when a repeat finding is detected
  // OR when the occurrence_count crosses the threshold.
  const repeatAutos = automations.filter((a) => a.trigger?.kind === "on_repeat_finding");
  if (repeatAutos.length) {
    const { data: detectEvents } = await supabase
      .from("workspace_activity_log")
      .select("workspace_id, target_id, event_data, created_at")
      .eq("action", "repeat_finding.detected")
      .gte("created_at", since)
      .limit(500);
    for (const ev of detectEvents || []) {
      for (const auto of repeatAutos) {
        if (auto.workspace_id !== ev.workspace_id) continue;
        const minOcc = auto.trigger.min_occurrences || 2;
        const occCount = ev.event_data?.occurrence_count;
        if (occCount != null && occCount < minOcc) continue;
        const dedupeKey = `on_repeat_finding:${auto.id}:${ev.target_id}:${occCount}`;
        if (await checkDedupeKeyById(supabase, auto.id, since, dedupeKey)) continue;

        const ctx = {
          workspaceId: auto.workspace_id,
          findingId: ev.target_id,
          occurrenceCount: occCount,
        };
        if (!evaluateCondition(auto.condition, ctx)) continue;
        const result = await dispatchAction(supabase, auto, ctx);
        await logFire(supabase, auto, ctx, result, dedupeKey, "on_repeat_finding");
        fired += 1;
      }
    }
  }

  return fired;
}

// ── Main handler ────────────────────────────────────────────
export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[automations-worker] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }

  const supabase = getSupabase();
  const now = new Date();

  // Pull all active automations once; partition by trigger kind below.
  const { data: automations, error } = await supabase
    .from("workspace_automations")
    .select("*")
    .eq("is_active", true)
    .order("workspace_id");
  if (error) {
    console.error("[automations-worker] query failed:", error.message);
    return { statusCode: 500, body: error.message };
  }

  const summary = {
    automations_checked: (automations || []).length,
    scheduled_fired: 0,
    cap_overdue_fired: 0,
    event_based_fired: 0,
  };

  try {
    summary.scheduled_fired = await processScheduledTriggers(supabase, automations || [], now);
    summary.cap_overdue_fired = await processCapOverdueTriggers(supabase, automations || [], now);
    summary.event_based_fired = await processEventBasedTriggers(supabase, automations || [], now);
  } catch (err) {
    console.error("[automations-worker] processing error:", err?.message || err);
  }

  console.log(
    `[automations-worker] checked=${summary.automations_checked}`
    + ` scheduled=${summary.scheduled_fired}`
    + ` cap_overdue=${summary.cap_overdue_fired}`
    + ` event_based=${summary.event_based_fired}`
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  };
};

// Schedule config — Netlify reads this. Every 15 minutes, matching
// the sweeper. Could move to */5 if response latency matters more.
export const config = {
  schedule: "*/15 * * * *",
};
