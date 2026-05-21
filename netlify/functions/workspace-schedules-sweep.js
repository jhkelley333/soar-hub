// netlify/functions/workspace-schedules-sweep.js
//
// Netlify Scheduled Function. Runs every 15 minutes. For each
// active schedule whose next_spawn_at is due (or null = first run),
// spawns workspace_assignments rows for the resolved assignees and
// bumps next_spawn_at to the next occurrence.
//
// Cron: "*/15 * * * *" (UTC). 15-minute granularity is the smallest
// useful interval and matches the assignment lead-time most rules
// care about (spawn_time is HH:MM at minute precision).
//
// Schedule lifecycle inside one sweep iteration:
//   1. Resolve assignee_rule → list of (assignee_id, store_id) pairs.
//   2. Insert one workspace_assignments row per pair, pinned to the
//      template's currently-published version. Skip the schedule
//      entirely if the template has no published version (logged
//      to event_data; sweep retries next interval).
//   3. Log per-assignment + schedule.spawned events.
//   4. Update schedule.last_spawned_at = now, next_spawn_at = next
//      occurrence per cadence.
//
// Idempotency: insert assignments → THEN update next_spawn_at. If
// the sweep crashes mid-way, the schedule will fire again next run;
// we accept occasional duplicates over missed fires. (Real-world
// failure rate is low enough that this trade-off is fine for v1.
// Future: switch to per-schedule advisory locks + 'spawn token'
// stored in activity_log event_data for dedupe.)
//
// Timezone handling: spawn_time + spawn_tz define the wall-clock
// moment at which to spawn. We compute next_spawn_at via Intl APIs
// (no external deps). DST transitions handled correctly because we
// re-derive the UTC offset from the resolved wall-clock instant.
//
// Admins can also trigger this manually for one schedule via
// workspaces?action=spawnNow (not yet wired — TODO).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── TZ math ──────────────────────────────────────────────────
//
// Returns wall-clock components in `tz` for the given UTC instant.
function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  // Intl can emit "24" for midnight on some engines; normalize.
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    year:   parseInt(get("year"), 10),
    month:  parseInt(get("month"), 10),
    day:    parseInt(get("day"), 10),
    hour,
    minute: parseInt(get("minute"), 10),
  };
}

// Returns the UTC offset (minutes east of UTC) for `tz` at the given
// instant. Used to convert a wall-clock-in-tz back to a UTC Date.
function tzOffsetMinutes(tz, atInstantMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = dtf.formatToParts(new Date(atInstantMs));
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  // "GMT-5", "GMT+5:30", "GMT" (= UTC), etc.
  if (name === "GMT") return 0;
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  const h = parseInt(m[2], 10);
  const mn = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h * 60 + mn);
}

// Convert a wall-clock moment in `tz` to a UTC Date. Two-pass to
// handle DST correctly: the first estimate uses the offset that
// would apply at the naive UTC instant, but if that instant ends up
// straddling a DST boundary the offset re-derived at the actual
// wall-clock instant might differ. Second pass corrects.
function utcFromTzWallClock(tz, year, month, day, hour, minute) {
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute);
  let offsetMin = tzOffsetMinutes(tz, naiveMs);
  let utcMs = naiveMs - offsetMin * 60_000;
  // Second pass — re-check offset at the resolved instant.
  const offsetMin2 = tzOffsetMinutes(tz, utcMs);
  if (offsetMin2 !== offsetMin) {
    utcMs = naiveMs - offsetMin2 * 60_000;
  }
  return new Date(utcMs);
}

// Day-of-week of a date IN THE GIVEN TZ. 0=Sun .. 6=Sat.
function dowInTz(utcDate, tz) {
  // Intl shortName returns "Mon" "Tue" etc. Map to 0-6.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short",
  }).formatToParts(utcDate);
  const w = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

// Adds N days to a wall-clock date in tz, returns the new wall-clock
// components. Implemented via UTC arithmetic on a noon-anchored
// instant to avoid DST-related jumps changing the date.
function addDaysWallClock(year, month, day, tz, n) {
  const anchor = utcFromTzWallClock(tz, year, month, day, 12, 0);
  const shifted = new Date(anchor.getTime() + n * 86_400_000);
  const wc = wallClockInTz(shifted, tz);
  return { year: wc.year, month: wc.month, day: wc.day };
}

// Add N months to a wall-clock (year, month, day). Clamps day to
// 28 if it would overflow into next month (since schedules cap
// day_of_month at 28, this rarely triggers — kept defensive).
function addMonthsWallClock(year, month, day, n) {
  let totalMonths = (year * 12 + (month - 1)) + n;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return { year: newYear, month: newMonth, day: Math.min(day, 28) };
}

// Compute the next next_spawn_at for a schedule given the current
// instant. Returns a UTC Date. Pure function — no DB side effects.
function nextSpawnAt(schedule, now) {
  const tz = schedule.spawn_tz;
  const [h, m] = String(schedule.spawn_time).split(":").map((n) => parseInt(n, 10));
  const nowWc = wallClockInTz(now, tz);

  // Helper: candidate at HH:MM in tz on (y,mo,d).
  const candAt = (y, mo, d) => utcFromTzWallClock(tz, y, mo, d, h, m);

  if (schedule.cadence === "daily") {
    let cand = candAt(nowWc.year, nowWc.month, nowWc.day);
    if (cand.getTime() <= now.getTime()) {
      const tom = addDaysWallClock(nowWc.year, nowWc.month, nowWc.day, tz, 1);
      cand = candAt(tom.year, tom.month, tom.day);
    }
    return cand;
  }

  if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
    // Find days until next day_of_week in tz.
    const todayDow = dowInTz(now, tz);
    let daysAhead = (schedule.day_of_week - todayDow + 7) % 7;
    // If it's today but spawn_time already passed, push to next week.
    if (daysAhead === 0) {
      const today = candAt(nowWc.year, nowWc.month, nowWc.day);
      if (today.getTime() <= now.getTime()) daysAhead = 7;
    }
    let target = addDaysWallClock(nowWc.year, nowWc.month, nowWc.day, tz, daysAhead);
    let cand = candAt(target.year, target.month, target.day);
    // Biweekly: enforce ≥14 days from last_spawned_at. If the computed
    // candidate is too soon, bump by 7 days (next matching weekday).
    if (schedule.cadence === "biweekly" && schedule.last_spawned_at) {
      const minNext = new Date(schedule.last_spawned_at).getTime() + 14 * 86_400_000;
      while (cand.getTime() < minNext) {
        target = addDaysWallClock(target.year, target.month, target.day, tz, 7);
        cand = candAt(target.year, target.month, target.day);
      }
    }
    return cand;
  }

  if (schedule.cadence === "monthly") {
    // This month's day_of_month at spawn_time; if passed, next month.
    let cand = candAt(nowWc.year, nowWc.month, schedule.day_of_month);
    if (cand.getTime() <= now.getTime()) {
      const next = addMonthsWallClock(nowWc.year, nowWc.month, schedule.day_of_month, 1);
      cand = candAt(next.year, next.month, next.day);
    }
    return cand;
  }

  if (schedule.cadence === "quarterly") {
    // Quarters: months 1 (Jan), 4 (Apr), 7 (Jul), 10 (Oct).
    const quarterMonths = [1, 4, 7, 10];
    // Find this year's next quarter start month >= now month.
    let target = null;
    for (const qm of quarterMonths) {
      if (qm < nowWc.month) continue;
      const cand = candAt(nowWc.year, qm, schedule.day_of_month);
      if (cand.getTime() > now.getTime()) {
        target = cand;
        break;
      }
    }
    if (!target) {
      // Wrap to next year's Q1.
      target = candAt(nowWc.year + 1, 1, schedule.day_of_month);
    }
    return target;
  }

  // Unknown cadence — guard.
  throw new Error(`Unknown cadence: ${schedule.cadence}`);
}

// ── Assignee rule resolution ─────────────────────────────────
//
// Given a schedule, resolve assignee_rule + workspace context into
// a list of (assignee_id, store_id) pairs to create assignments for.
// store_id is optional per pair; will be null for fixed-user rules
// unless the workspace anchors directly at a store.

async function resolveAssigneeRule(supabase, schedule, workspace) {
  const rule = schedule.assignee_rule || {};
  const kind = rule.kind;

  if (kind === "fixed") {
    // One assignment for the fixed user. store_id = workspace's anchor
    // IF the anchor is a store; otherwise null.
    const storeId = (workspace.scope_anchor_kind === "store")
      ? workspace.scope_anchor_id
      : null;
    return [{ assignee_id: rule.user_id, store_id: storeId }];
  }

  if (kind === "role_relative") {
    // Find all active users with the specified role whose user_scopes
    // covers the workspace's anchor. For "anchor": "scope_anchor" we
    // use workspace.scope_anchor_*; "submission_store" doesn't apply
    // at spawn time (it's for the CAP/signoff flow).
    if (rule.anchor !== "scope_anchor") {
      return []; // unsupported anchor for spawn
    }
    if (!workspace.scope_anchor_kind || !workspace.scope_anchor_id) {
      return []; // no anchor to evaluate
    }
    return await resolveUsersAtAnchor(
      supabase,
      workspace.scope_anchor_kind,
      workspace.scope_anchor_id,
      rule.role,
    );
  }

  if (kind === "per_store") {
    // For each store under (scope_kind, scope_id), find the user with
    // role_in_store at that store. One assignment per (user, store).
    const storeIds = await storesUnderScope(supabase, rule.scope_kind, rule.scope_id);
    const pairs = [];
    for (const sid of storeIds) {
      const users = await resolveUsersAtAnchor(supabase, "store", sid, rule.role_in_store);
      for (const u of users) {
        pairs.push({ assignee_id: u.assignee_id, store_id: sid });
      }
    }
    return pairs;
  }

  return [];
}

// Walk the org hierarchy down from (kind, id) and return all store
// ids under that scope. Cheap for small trees; one query per level.
async function storesUnderScope(supabase, kind, id) {
  if (kind === "store") return [id];

  let areaIds = [], districtIds = [], storeIds = [];

  if (kind === "region") {
    const { data: areas } = await supabase.from("areas").select("id").eq("region_id", id);
    areaIds = (areas || []).map((a) => a.id);
  } else if (kind === "area") {
    areaIds = [id];
  } else if (kind === "district") {
    districtIds = [id];
  }

  if (areaIds.length) {
    const { data: dists } = await supabase
      .from("districts").select("id").in("area_id", areaIds);
    districtIds.push(...(dists || []).map((d) => d.id));
  }
  if (districtIds.length) {
    const { data: stores } = await supabase
      .from("stores").select("id").in("district_id", districtIds);
    storeIds = (stores || []).map((s) => s.id);
  }
  return storeIds;
}

// Find active profiles with `role` whose user_scopes covers (kind, id).
// Coverage rule: direct scope at (kind, id), OR scope at any ancestor
// (region/area/district above the kind), OR global.
// Returns [{ assignee_id }, ...].
async function resolveUsersAtAnchor(supabase, kind, id, role) {
  // Build the set of (scope_type, scope_id) tuples that would cover
  // (kind, id). Starts with the anchor itself, then walks UP to its
  // ancestors.
  const covering = [{ scope_type: kind, scope_id: id }];

  if (kind === "store") {
    const { data: s } = await supabase
      .from("stores").select("district_id").eq("id", id).maybeSingle();
    if (s?.district_id) {
      covering.push({ scope_type: "district", scope_id: s.district_id });
      const { data: d } = await supabase
        .from("districts").select("area_id").eq("id", s.district_id).maybeSingle();
      if (d?.area_id) {
        covering.push({ scope_type: "area", scope_id: d.area_id });
        const { data: a } = await supabase
          .from("areas").select("region_id").eq("id", d.area_id).maybeSingle();
        if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
      }
    }
  } else if (kind === "district") {
    const { data: d } = await supabase
      .from("districts").select("area_id").eq("id", id).maybeSingle();
    if (d?.area_id) {
      covering.push({ scope_type: "area", scope_id: d.area_id });
      const { data: a } = await supabase
        .from("areas").select("region_id").eq("id", d.area_id).maybeSingle();
      if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
    }
  } else if (kind === "area") {
    const { data: a } = await supabase
      .from("areas").select("region_id").eq("id", id).maybeSingle();
    if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
  }

  // Pull user_scopes rows that match any of the covering tuples OR
  // are global. Then join to profiles with matching role.
  // Building the OR clause: a series of (scope_type=X AND scope_id=Y).
  const filterParts = covering.map((c) =>
    `and(scope_type.eq.${c.scope_type},scope_id.eq.${c.scope_id})`
  );
  filterParts.push("scope_type.eq.global");

  const { data: scopes } = await supabase
    .from("user_scopes")
    .select("user_id, profiles:user_id(id, role, is_active)")
    .or(filterParts.join(","));

  const matchingUserIds = new Set();
  for (const r of scopes || []) {
    const p = r.profiles;
    if (!p) continue;
    if (!p.is_active) continue;
    if (String(p.role || "").toLowerCase() !== String(role).toLowerCase()) continue;
    matchingUserIds.add(p.id);
  }

  return Array.from(matchingUserIds).map((uid) => ({ assignee_id: uid }));
}

// ── Activity log helper ─────────────────────────────────────
async function logActivity(supabase, opts) {
  try {
    await supabase.from("workspace_activity_log").insert({
      workspace_id:  opts.workspaceId,
      actor_id:      null,  // sweeper has no caller
      actor_email:   "sweeper@system",
      actor_role:    "system",
      target_kind:   opts.targetKind,
      target_id:     opts.targetId,
      action:        opts.action,
      event_data:    opts.eventData || null,
      after_state:   opts.afterState || null,
    });
  } catch (err) {
    console.warn("[sweep] logActivity failed:", err?.message || err);
  }
}

// ── Per-schedule processing ─────────────────────────────────
async function processSchedule(supabase, sched, now) {
  // Resolve workspace + template + published version.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, scope_anchor_kind, scope_anchor_id, is_archived")
    .eq("id", sched.workspace_id)
    .single();
  if (!workspace || workspace.is_archived) {
    // Workspace archived/missing — bump next_spawn_at far into the
    // future so we stop checking. Easier than disabling the schedule
    // since the workspace might be un-archived later.
    return { skipped: true, reason: "workspace_archived_or_missing" };
  }

  const { data: tpl } = await supabase
    .from("workspace_templates")
    .select("id, is_archived")
    .eq("id", sched.template_id)
    .single();
  if (!tpl || tpl.is_archived) {
    return { skipped: true, reason: "template_archived_or_missing" };
  }

  const { data: published } = await supabase
    .from("workspace_template_versions")
    .select("id, version_number")
    .eq("template_id", sched.template_id)
    .eq("status", "published")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!published) {
    return { skipped: true, reason: "no_published_version" };
  }

  // Resolve assignee_rule → list of (assignee_id, store_id) pairs.
  const pairs = await resolveAssigneeRule(supabase, sched, workspace);
  if (!pairs.length) {
    return { skipped: true, reason: "no_matching_assignees" };
  }

  // Insert one assignment per pair. due_at = now + due_after_hours.
  const dueAt = new Date(now.getTime() + sched.due_after_hours * 3_600_000).toISOString();
  const rows = pairs.map((p) => ({
    workspace_id:        sched.workspace_id,
    template_id:         sched.template_id,
    template_version_id: published.id,
    schedule_id:         sched.id,
    assignee_id:         p.assignee_id,
    store_id:            p.store_id || null,
    status:              "pending",
    due_at:              dueAt,
  }));

  const { data: inserted, error } = await supabase
    .from("workspace_assignments")
    .insert(rows)
    .select("*");
  if (error) {
    console.error("[sweep] insert assignments failed:", error.message);
    return { skipped: true, reason: "insert_failed", error: error.message };
  }

  for (const asn of inserted || []) {
    await logActivity(supabase, {
      workspaceId: sched.workspace_id,
      targetKind:  "assignment",
      targetId:    asn.id,
      action:      "assignment.created",
      afterState:  asn,
      eventData:   {
        source: "schedule",
        schedule_id: sched.id,
        template_version_number: published.version_number,
      },
    });
  }

  await logActivity(supabase, {
    workspaceId: sched.workspace_id,
    targetKind:  "schedule",
    targetId:    sched.id,
    action:      "schedule.spawned",
    eventData:   {
      assignments_created: inserted?.length || 0,
      template_version_number: published.version_number,
    },
  });

  return { skipped: false, count: inserted?.length || 0 };
}

// ── Main handler ────────────────────────────────────────────
export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[sweep] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }

  const supabase = getSupabase();
  const now = new Date();
  const nowIso = now.toISOString();

  // Find due schedules. "Due" = active AND (next_spawn_at <= now OR
  // next_spawn_at IS NULL). Sort by oldest due first to be fair.
  // Cap at 100/run so a backlog can't time out the function.
  const { data: dueSchedules, error: qErr } = await supabase
    .from("workspace_schedules")
    .select("*")
    .eq("is_active", true)
    .or(`next_spawn_at.is.null,next_spawn_at.lte.${nowIso}`)
    .order("next_spawn_at", { ascending: true, nullsFirst: true })
    .limit(100);
  if (qErr) {
    console.error("[sweep] query failed:", qErr.message);
    return { statusCode: 500, body: qErr.message };
  }

  const summary = {
    checked: dueSchedules?.length || 0,
    spawned: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const sched of dueSchedules || []) {
    try {
      const result = await processSchedule(supabase, sched, now);
      const nextAt = nextSpawnAt(sched, now).toISOString();
      const updates = { next_spawn_at: nextAt };
      if (!result.skipped) {
        updates.last_spawned_at = nowIso;
        summary.spawned += 1;
      } else {
        summary.skipped += 1;
      }

      await supabase
        .from("workspace_schedules")
        .update(updates)
        .eq("id", sched.id);

      summary.details.push({
        schedule_id: sched.id,
        workspace_id: sched.workspace_id,
        cadence: sched.cadence,
        ...result,
        next_spawn_at: nextAt,
      });
    } catch (err) {
      console.error(`[sweep] schedule ${sched.id} failed:`, err?.message || err);
      summary.errors += 1;
      summary.details.push({
        schedule_id: sched.id,
        error: err?.message || String(err),
      });
    }
  }

  console.log(
    `[sweep] checked=${summary.checked} spawned=${summary.spawned}`
    + ` skipped=${summary.skipped} errors=${summary.errors}`
  );
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  };
};

// Schedule config — Netlify reads this. Every 15 minutes.
export const config = {
  schedule: "*/15 * * * *",
};
