// netlify/functions/walkthrough.js
//
// Store Walkthrough backend. Auth bridge mirrors paf.js / team-mgmt.js:
// validate the Supabase JWT with the service-role key, look up the caller's
// profile, gate each action on role.
//
// The submit transaction is the reason this lives behind a function instead
// of going direct-to-Supabase like reno-scoping: it needs the service role to
// (a) write corrective_actions + the audit log, and (b) stamp
// stores.last_visit_at — none of which the assignee can do under RLS. Scoring
// is recomputed server-side from the stamped template so the client can't
// post a doctored score/tier.
//
// Actions:
//   GET  ?action=my-assignments   -> assignments assigned to the caller (+ template, store)
//   GET  ?action=list             -> recent submissions the caller can see
//   POST ?action=save-draft       -> upsert the in-progress draft submission
//   POST ?action=submit           -> atomic publish: submission + corrective
//                                    actions + assignment flip + store stamp +
//                                    audit + DO notify (best-effort)
//   POST ?action=dev-seed (admin) -> create a sample template + assignment
//                                    against the caller's first visible store

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_SCORING = { pass: 1, watch: 0.6, fail: 0 };
const DEFAULT_TIERS = { green: 85, yellow: 70 };
const CA_DUE_DAYS = 7;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("walkthrough env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function unwrap(result) {
  if (result && result.error) {
    return respond(result.status || 400, { error: result.error });
  }
  return respond(200, result);
}

// ----------------------------------------------------------------------------
// Scoring — authoritative server-side mirror of src/modules/walkthrough/
// scoring.ts + rules.ts. (template + sections) -> score / tier / flags.
// ----------------------------------------------------------------------------

function indexTemplate(template) {
  const map = new Map();
  for (const section of template.sections || []) {
    for (const item of section.items || []) {
      map.set(item.code, item);
    }
  }
  return map;
}

function earned(value, scoring) {
  if (value === "pass") return scoring.pass;
  if (value === "watch") return scoring.watch;
  if (value === "fail") return scoring.fail;
  return null; // na / null excluded from denominator
}

function tierFor(score, tiers) {
  if (score >= tiers.green) return "green";
  if (score >= tiers.yellow) return "yellow";
  return "red";
}

/** The fail rule in effect for an item, with photoOnEveryFail folded in. */
function effectiveFailRule(item, globalRules) {
  const base = (item.rules || []).find((r) => r.trigger === "fail");
  if (globalRules?.photoOnEveryFail) {
    const merged = base
      ? { ...base, require: { ...base.require } }
      : { trigger: "fail", require: {}, raiseCorrectiveAction: true };
    merged.require.photo = Math.max(1, merged.require.photo || 0);
    return merged;
  }
  return base || null;
}

function scoreSections(template, sections) {
  const scoring = template.scoring || DEFAULT_SCORING;
  const tiers = template.tiers || DEFAULT_TIERS;
  let weightedEarned = 0;
  let weightTotal = 0;
  let failCount = 0;
  let watchCount = 0;

  const index = indexTemplate(template);
  for (const section of sections || []) {
    for (const resp of section.items || []) {
      const item = index.get(resp.itemCode);
      const weight = (item && item.weight) || 1;
      if (resp.value === "fail") failCount++;
      if (resp.value === "watch") watchCount++;
      const e = earned(resp.value, scoring);
      if (e != null) {
        weightedEarned += e * weight;
        weightTotal += weight;
      }
    }
  }
  const score = weightTotal === 0 ? 0 : Math.round((weightedEarned / weightTotal) * 100);
  return { score, tier: tierFor(score, tiers), flagCount: failCount + watchCount, failCount, watchCount };
}

/** Validate that every required answer + Fail follow-up is present. Returns
 *  an array of human-readable problems (empty == clean). Authoritative gate;
 *  the client shows the same via rules.ts but the server is the source. */
function validateSubmission(template, sections) {
  const problems = [];
  const globalRules = template.global_rules || template.globalRules || {};
  const index = indexTemplate(template);
  for (const section of sections || []) {
    for (const resp of section.items || []) {
      const item = index.get(resp.itemCode);
      if (!item) continue;
      const canNa = globalRules.allowNa && item.allowNa !== false;
      if ((resp.value == null) && !canNa) {
        problems.push(`${resp.itemCode}: unanswered`);
        continue;
      }
      if (resp.value === "fail") {
        const rule = effectiveFailRule(item, globalRules);
        if (rule) {
          const need = rule.require || {};
          const photos = resp.photoIds || [];
          if (need.photo && photos.length < need.photo) {
            problems.push(`${resp.itemCode}: needs ${need.photo} photo(s)`);
          }
          if (need.reason && !(resp.reason || "").trim()) {
            problems.push(`${resp.itemCode}: needs a reason`);
          }
          if (need.note && !(resp.note || "").trim()) {
            problems.push(`${resp.itemCode}: needs a note`);
          }
        }
      }
    }
  }
  return problems;
}

// ----------------------------------------------------------------------------
// Email (best-effort via Resend) — never fails the submit.
// ----------------------------------------------------------------------------

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME =
  process.env.WALKTHROUGH_FROM_NAME || process.env.RESEND_FROM_NAME || "SOAR Walkthrough";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY || !to) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "a team member";
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

async function myAssignments(supa, user) {
  const { data, error } = await supa
    .from("walkthrough_assignments")
    .select(
      "id, template_id, template_version, store_id, assignee_id, due_at, status, " +
        "template:walkthrough_templates(*), store:stores(id, number, name, city, state, latitude, longitude, geofence_radius_m)",
    )
    .eq("assignee_id", user.id)
    .neq("status", "submitted")
    .order("due_at", { ascending: true });
  if (error) return { error: error.message, status: 500 };
  return { assignments: data || [] };
}

async function listSubmissions(supa, user) {
  // RLS would scope this for a user-scoped client; with the service client we
  // filter to the caller's own submissions to stay conservative. The DO/admin
  // review list is a separate ticket.
  const { data, error } = await supa
    .from("walkthrough_submissions")
    .select("id, store_id, template_version, score, tier, flag_count, status, submitted_at")
    .eq("submitted_by", user.id)
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message, status: 500 };
  return { submissions: data || [] };
}

// ----------------------------------------------------------------------------
// Draft upsert — one draft submission per assignment for the owner.
// ----------------------------------------------------------------------------

async function saveDraft(supa, user, body) {
  const { assignmentId, sections, checkInId } = body || {};
  if (!assignmentId) return { error: "assignmentId is required", status: 400 };

  const { data: asg, error: aErr } = await supa
    .from("walkthrough_assignments")
    .select("id, store_id, template_id, template_version, assignee_id")
    .eq("id", assignmentId)
    .single();
  if (aErr || !asg) return { error: "assignment not found", status: 404 };
  if (asg.assignee_id !== user.id) return { error: "not your assignment", status: 403 };

  const { data: existing } = await supa
    .from("walkthrough_submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("submitted_by", user.id)
    .eq("status", "draft")
    .maybeSingle();

  const row = {
    assignment_id: assignmentId,
    store_id: asg.store_id,
    template_id: asg.template_id,
    template_version: asg.template_version,
    check_in_id: checkInId || null,
    sections: sections || [],
    status: "draft",
    submitted_by: user.id,
  };

  if (existing) {
    const { error } = await supa
      .from("walkthrough_submissions")
      .update({ sections: row.sections, check_in_id: row.check_in_id })
      .eq("id", existing.id);
    if (error) return { error: error.message, status: 500 };
    return { id: existing.id };
  }
  const { data, error } = await supa
    .from("walkthrough_submissions")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: error.message, status: 500 };
  return { id: data.id };
}

// ----------------------------------------------------------------------------
// Submit — the atomic publish.
// ----------------------------------------------------------------------------

async function submit(supa, user, body) {
  const { assignmentId, checkInId, sections } = body || {};
  if (!assignmentId) return { error: "assignmentId is required", status: 400 };
  if (!Array.isArray(sections)) return { error: "sections[] is required", status: 400 };

  // Load assignment + its stamped template.
  const { data: asg, error: aErr } = await supa
    .from("walkthrough_assignments")
    .select(
      "id, store_id, template_id, template_version, assignee_id, assigned_by, status, " +
        "template:walkthrough_templates(*)",
    )
    .eq("id", assignmentId)
    .single();
  if (aErr || !asg) return { error: "assignment not found", status: 404 };
  if (asg.assignee_id !== user.id) return { error: "not your assignment", status: 403 };
  if (asg.status === "submitted") return { error: "already submitted", status: 409 };

  const template = asg.template;
  if (!template) return { error: "template missing for assignment", status: 500 };

  // Authoritative validation + scoring (ignore any client-sent score).
  const problems = validateSubmission(template, sections);
  if (problems.length) {
    return { error: `incomplete: ${problems.slice(0, 6).join("; ")}`, status: 422 };
  }
  const { score, tier, flagCount } = scoreSections(template, sections);

  // 1) Submission row.
  const { data: sub, error: sErr } = await supa
    .from("walkthrough_submissions")
    .insert({
      assignment_id: assignmentId,
      store_id: asg.store_id,
      template_id: asg.template_id,
      template_version: asg.template_version,
      check_in_id: checkInId || null,
      sections,
      score,
      tier,
      flag_count: flagCount,
      status: "submitted",
      submitted_by: user.id,
      submitted_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (sErr) return { error: sErr.message, status: 500 };

  // 2) Corrective actions — one per qualifying Fail.
  const globalRules = template.global_rules || {};
  const index = indexTemplate(template);
  const dueAt = new Date(Date.now() + CA_DUE_DAYS * 86_400_000).toISOString();
  const caRows = [];
  for (const section of sections) {
    for (const resp of section.items || []) {
      if (resp.value !== "fail") continue;
      const item = index.get(resp.itemCode);
      if (!item) continue;
      const rule = effectiveFailRule(item, globalRules);
      if (rule && rule.raiseCorrectiveAction === false) continue;
      caRows.push({
        source_submission_id: sub.id,
        source_item_code: resp.itemCode,
        store_id: asg.store_id,
        title: item.label || resp.itemCode,
        owner_id: asg.assignee_id,
        due_at: dueAt,
        priority: item.severity || "med",
        origin_photo_ids: Array.isArray(resp.photoIds) ? resp.photoIds : [],
        status: "open",
      });
    }
  }
  let correctiveActions = [];
  if (caRows.length) {
    const { data: ca, error: caErr } = await supa
      .from("corrective_actions")
      .insert(caRows)
      .select("id, source_item_code");
    if (caErr) {
      // Roll back the submission so we never leave a published row without its
      // corrective actions.
      await supa.from("walkthrough_submissions").delete().eq("id", sub.id);
      return { error: `corrective actions failed: ${caErr.message}`, status: 500 };
    }
    correctiveActions = ca || [];
  }

  // 3) Flip the assignment + stamp the store.
  await supa
    .from("walkthrough_assignments")
    .update({ status: "submitted" })
    .eq("id", assignmentId);
  await supa
    .from("stores")
    .update({ last_visit_at: sub.submitted_at })
    .eq("id", asg.store_id);

  // 4) Audit.
  await supa.from("walkthrough_audit_log").insert({
    submission_id: sub.id,
    actor_id: user.id,
    actor_email: user.email,
    action: "submit",
    from_status: "draft",
    to_status: "submitted",
    detail: { score, tier, flagCount, correctiveActions: correctiveActions.length },
  });

  // 5) Notify the DO (best-effort). assigned_by is the DO who created the walk.
  let notified = false;
  if (asg.assigned_by) {
    const { data: doProfile } = await supa
      .from("profiles")
      .select("email, full_name, preferred_name")
      .eq("id", asg.assigned_by)
      .single();
    const { data: store } = await supa
      .from("stores")
      .select("number, name")
      .eq("id", asg.store_id)
      .single();
    if (doProfile?.email) {
      const storeLabel = store ? `${store.number} · ${store.name}` : asg.store_id;
      const r = await sendEmail({
        to: doProfile.email,
        subject: `Walkthrough submitted — ${storeLabel} (${tier.toUpperCase()} ${score})`,
        text:
          `${displayName(user)} submitted a ${template.name} for ${storeLabel}.\n\n` +
          `Score: ${score} (${tier})\nFlags: ${flagCount}\n` +
          `Corrective actions raised: ${correctiveActions.length}\n\n` +
          `Review: ${appBaseUrl()}/walkthrough`,
      });
      notified = !!r.ok;
    }
  }

  return {
    submission: sub,
    correctiveActions: correctiveActions.length,
    notified,
  };
}

// ----------------------------------------------------------------------------
// Dev seed — admin convenience to exercise the real flow end-to-end before the
// admin builder / assignment UI lands. Creates (idempotently) a sample
// template + an in-progress assignment for the caller against their first
// visible store.
// ----------------------------------------------------------------------------

const SEED_SECTIONS = [
  {
    code: "LOT",
    name: "Lot & exterior",
    items: [
      { code: "LOT.01", label: "Lot free of litter & debris", weight: 1, severity: "low",
        rules: [{ trigger: "fail", require: { photo: 1, reason: true }, raiseCorrectiveAction: true }] },
      { code: "LOT.02", label: "Stall canopies & lighting intact", weight: 1, severity: "med",
        rules: [{ trigger: "fail", require: { photo: 1, reason: true }, raiseCorrectiveAction: true }] },
    ],
  },
  {
    code: "FRY",
    name: "Fryer & line",
    items: [
      { code: "FRY.01", label: "Oil quality within spec (TPM)", weight: 2, severity: "high",
        rules: [{ trigger: "fail", require: { photo: 1, reason: true }, raiseCorrectiveAction: true }] },
      { code: "FRY.02", label: "Line temps logged this shift", weight: 2, severity: "high",
        rules: [{ trigger: "fail", require: { photo: 1, reason: true }, raiseCorrectiveAction: true }] },
    ],
  },
];

async function devSeed(supa, user) {
  if (user.role !== "admin") return { error: "admin only", status: 403 };

  // Template (idempotent on name+version).
  let templateId;
  const { data: existingTpl } = await supa
    .from("walkthrough_templates")
    .select("id")
    .eq("name", "Weekly Walkthrough (seed)")
    .eq("version", "1.0")
    .maybeSingle();
  if (existingTpl) {
    templateId = existingTpl.id;
  } else {
    const { data: tpl, error } = await supa
      .from("walkthrough_templates")
      .insert({
        name: "Weekly Walkthrough (seed)",
        type: "walkthrough",
        version: "1.0",
        sections: SEED_SECTIONS,
        scoring: DEFAULT_SCORING,
        tiers: DEFAULT_TIERS,
        global_rules: { photoOnEveryFail: true, allowNa: false },
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message, status: 500 };
    templateId = tpl.id;
  }

  // First visible store. user_scopes -> stores is the canonical path, but for a
  // seed we just grab any store the caller's profile can reach; admins see all.
  const { data: store, error: stErr } = await supa
    .from("stores")
    .select("id, number, name")
    .order("number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (stErr || !store) return { error: "no stores available to seed against", status: 404 };

  // Reuse an existing open seed assignment if present.
  const { data: openAsg } = await supa
    .from("walkthrough_assignments")
    .select("id")
    .eq("assignee_id", user.id)
    .eq("template_id", templateId)
    .neq("status", "submitted")
    .maybeSingle();
  if (openAsg) return { assignmentId: openAsg.id, storeId: store.id, reused: true };

  const { data: asg, error: asgErr } = await supa
    .from("walkthrough_assignments")
    .insert({
      template_id: templateId,
      template_version: "1.0",
      store_id: store.id,
      assignee_id: user.id,
      assigned_by: user.id,
      due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      status: "in_progress",
    })
    .select("id")
    .single();
  if (asgErr) return { error: asgErr.message, status: 500 };
  return { assignmentId: asg.id, storeId: store.id };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const params = event.queryStringParameters || {};
  const action = params.action || "my-assignments";

  try {
    const supa = admin();

    let user;
    try {
      user = await getSessionUser(event);
    } catch (e) {
      return respond(500, { error: e.message || "auth failed" });
    }
    if (!user) return respond(401, { error: "unauthorized" });

    if (event.httpMethod === "GET") {
      if (action === "my-assignments") return unwrap(await myAssignments(supa, user));
      if (action === "list") return unwrap(await listSubmissions(supa, user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "save-draft") return unwrap(await saveDraft(supa, user, body));
      if (action === "submit") return unwrap(await submit(supa, user, body));
      if (action === "dev-seed") return unwrap(await devSeed(supa, user));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
