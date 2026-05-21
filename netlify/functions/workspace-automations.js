// netlify/functions/workspace-automations.js
//
// REST handler for the Workspace AUTOMATION layer. Sibling Netlify
// function to workspaces.js / workspace-submissions.js / workspace-caps.js.
//
// Automations are user-defined rules of the shape:
//   trigger:   when does this rule fire?
//   condition: optional filter — only fire if this passes
//   action:    what does the rule do?
//
// This file handles CRUD + a manual fire. The actual firing happens
// in workspace-automations-worker.js (Netlify scheduled function,
// follow-up PR). For event-driven triggers (on_submit, on_score_below,
// etc.) the firing will eventually be wired into the relevant write
// path in workspace-submissions.js + workspace-caps.js.
//
// Actions covered:
//   listAutomations, getAutomation, createAutomation,
//   updateAutomation, toggleAutomation, deleteAutomation,
//   runAutomationNow  (admin manual fire — for testing)
//
// Frontend calls /.netlify/functions/workspace-automations?action=...

import { createClient } from "@supabase/supabase-js";
import {
  isOrgAdmin,
  requireWorkspaceCap,
} from "./_lib/workspace_permissions.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCallerProfile(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = getSupabase();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isUuid(s) {
  return typeof s === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function logActivity(supabase, profile, opts) {
  try {
    await supabase.from("workspace_activity_log").insert({
      workspace_id:  opts.workspaceId,
      actor_id:      profile?.id || null,
      actor_email:   profile?.email || null,
      actor_role:    profile?.role || null,
      target_kind:   opts.targetKind,
      target_id:     opts.targetId,
      action:        opts.action,
      event_data:    opts.eventData || null,
      before_state:  opts.beforeState || null,
      after_state:   opts.afterState || null,
    });
  } catch (err) {
    console.warn("workspace-automations.logActivity failed:", err?.message || err);
  }
}

// ── DSL validators ──────────────────────────────────────────
//
// Triggers + actions are JSONB payloads. We shape-check them at write
// time so bad rules don't sit silently waiting to fail in the worker.

const ALLOWED_TRIGGER_KINDS = [
  "on_submit",
  "on_score_below",
  "on_cap_overdue",
  "on_cap_reopened",
  "on_repeat_finding",
  "scheduled",
];

const ALLOWED_ACTION_KINDS = [
  "send_email",
  "notify_in_app",
  "create_assignment",
  "create_cap",
  "log_only",       // for testing — no side effect
];

function validateTrigger(t) {
  if (!t || typeof t !== "object") return "trigger (JSON object) required.";
  const kind = String(t.kind || "");
  if (!ALLOWED_TRIGGER_KINDS.includes(kind)) {
    return `trigger.kind must be one of: ${ALLOWED_TRIGGER_KINDS.join(", ")}.`;
  }
  switch (kind) {
    case "on_submit":
      if (t.template_id && !isUuid(t.template_id)) return "trigger.template_id must be a uuid.";
      return null;
    case "on_score_below":
      if (t.template_id && !isUuid(t.template_id)) return "trigger.template_id must be a uuid.";
      if (t.threshold == null) return "trigger.threshold (0-100) required for on_score_below.";
      {
        const n = Number(t.threshold);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return "trigger.threshold must be 0-100.";
        }
      }
      return null;
    case "on_cap_overdue":
      // Optional: grace_hours (default 0 = fires the moment due_at passes)
      if (t.grace_hours != null) {
        const n = Number(t.grace_hours);
        if (!Number.isFinite(n) || n < 0) return "trigger.grace_hours must be >= 0.";
      }
      return null;
    case "on_cap_reopened":
      if (t.min_reopens != null) {
        const n = Number(t.min_reopens);
        if (!Number.isInteger(n) || n < 1) return "trigger.min_reopens must be a positive integer.";
      }
      return null;
    case "on_repeat_finding":
      if (t.min_occurrences != null) {
        const n = Number(t.min_occurrences);
        if (!Number.isInteger(n) || n < 2) return "trigger.min_occurrences must be >= 2.";
      }
      return null;
    case "scheduled":
      if (typeof t.cron !== "string" || !t.cron.trim()) {
        return "trigger.cron (cron expression) required for scheduled.";
      }
      // Basic format check — 5 fields. We don't fully parse here; the
      // worker uses a real cron lib.
      const fields = t.cron.trim().split(/\s+/);
      if (fields.length !== 5) {
        return "trigger.cron must have 5 fields (minute hour day month weekday).";
      }
      return null;
  }
  return null;
}

function validateAction(a) {
  if (!a || typeof a !== "object") return "action (JSON object) required.";
  const kind = String(a.kind || "");
  if (!ALLOWED_ACTION_KINDS.includes(kind)) {
    return `action.kind must be one of: ${ALLOWED_ACTION_KINDS.join(", ")}.`;
  }
  switch (kind) {
    case "send_email":
      // Exactly one of to_role / to_emails / to_user_ids required.
      const hasRecip = !!(a.to_role || a.to_emails || a.to_user_ids);
      if (!hasRecip) {
        return "action.send_email needs to_role OR to_emails[] OR to_user_ids[].";
      }
      if (a.to_emails && !Array.isArray(a.to_emails)) return "action.to_emails must be an array.";
      if (a.to_user_ids && !Array.isArray(a.to_user_ids)) return "action.to_user_ids must be an array.";
      if (a.to_user_ids) {
        for (const u of a.to_user_ids) {
          if (!isUuid(u)) return "action.to_user_ids must be uuids.";
        }
      }
      if (typeof a.subject !== "string" || !a.subject.trim()) {
        return "action.subject required for send_email.";
      }
      if (typeof a.body !== "string" || !a.body.trim()) {
        return "action.body required for send_email.";
      }
      return null;
    case "notify_in_app":
      if (!a.to_role && !a.to_user_ids) {
        return "action.notify_in_app needs to_role OR to_user_ids[].";
      }
      if (typeof a.message !== "string" || !a.message.trim()) {
        return "action.message required for notify_in_app.";
      }
      return null;
    case "create_assignment":
      if (!isUuid(a.template_id)) return "action.template_id (uuid) required for create_assignment.";
      if (!a.assignee_rule || typeof a.assignee_rule !== "object") {
        return "action.assignee_rule (JSON) required for create_assignment.";
      }
      return null;
    case "create_cap":
      // Auto-generated CAP based on the trigger context. Optional
      // overrides for due_days, assignee_rule, instructions.
      if (a.due_days != null) {
        const n = Number(a.due_days);
        if (!Number.isInteger(n) || n < 1) return "action.due_days must be a positive integer.";
      }
      return null;
    case "log_only":
      return null; // anything goes — used for testing
  }
  return null;
}

function validateCondition(c) {
  // Conditions are optional. NULL/undefined = no filter (always pass).
  if (c == null) return null;
  if (typeof c !== "object") return "condition must be a JSON object (or null).";
  // We allow the worker to interpret the shape, but flag a missing kind
  // since that's almost always a mistake.
  if (!c.kind && !c.all && !c.any) {
    return "condition must specify { kind, ... } or { all: [...] } or { any: [...] }.";
  }
  return null;
}

// ── Handler ─────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const profile = await getCallerProfile(event);
  if (!profile) {
    return respond(401, { ok: false, message: "Not authenticated." });
  }

  const action = (event.queryStringParameters || {}).action || "";
  const supabase = getSupabase();

  try {
    // ═══════════════════════════════════════════════════════════
    // AUTOMATIONS
    // ═══════════════════════════════════════════════════════════

    if (action === "listAutomations") {
      const qp = event.queryStringParameters || {};
      const wsId = qp.workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manage_automation");
      if (denied) return denied;

      let q = supabase
        .from("workspace_automations")
        .select("*, created_by:created_by_id(id, full_name, email)")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false });

      if (qp.is_active === "true") q = q.eq("is_active", true);
      if (qp.is_active === "false") q = q.eq("is_active", false);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, automations: data || [] });
    }

    if (action === "getAutomation") {
      const id = (event.queryStringParameters || {}).id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad automation id." });

      const { data, error } = await supabase
        .from("workspace_automations")
        .select("*, created_by:created_by_id(id, full_name, email)")
        .eq("id", id)
        .single();
      if (error || !data) return respond(404, { ok: false, message: "Automation not found." });

      const denied = await requireWorkspaceCap(supabase, profile, data.workspace_id, "manage_automation");
      if (denied) return denied;

      // Surface recent fire history from the activity log so the UI
      // can show "Last fired: X" + "Fired N times".
      const { data: recentFires } = await supabase
        .from("workspace_activity_log")
        .select("id, created_at, event_data, actor_email")
        .eq("workspace_id", data.workspace_id)
        .eq("target_kind", "automation")
        .eq("target_id", id)
        .eq("action", "automation.fired")
        .order("created_at", { ascending: false })
        .limit(20);

      return respond(200, {
        ok: true,
        automation: data,
        recent_fires: recentFires || [],
      });
    }

    if (action === "createAutomation" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const wsId = payload.workspace_id;
      if (!isUuid(wsId)) return respond(400, { ok: false, message: "Bad workspace_id." });

      const denied = await requireWorkspaceCap(supabase, profile, wsId, "manage_automation");
      if (denied) return denied;

      const name = (payload.name || "").trim();
      if (!name) return respond(400, { ok: false, message: "name required." });

      const trigErr = validateTrigger(payload.trigger);
      if (trigErr) return respond(400, { ok: false, message: trigErr });

      const actErr = validateAction(payload.action);
      if (actErr) return respond(400, { ok: false, message: actErr });

      const condErr = validateCondition(payload.condition);
      if (condErr) return respond(400, { ok: false, message: condErr });

      const { data: auto, error } = await supabase
        .from("workspace_automations")
        .insert({
          workspace_id: wsId,
          name,
          trigger: payload.trigger,
          condition: payload.condition || null,
          action: payload.action,
          is_active: payload.is_active !== false, // default true
          created_by_id: profile.id,
        })
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: wsId,
        targetKind: "automation",
        targetId: auto.id,
        action: "automation.created",
        afterState: auto,
      });

      return respond(200, { ok: true, automation: auto });
    }

    if (action === "updateAutomation" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad automation id." });

      const { data: before } = await supabase
        .from("workspace_automations").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Automation not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_automation");
      if (denied) return denied;

      const patch = {};
      if (typeof payload.name === "string") {
        const n = payload.name.trim();
        if (!n) return respond(400, { ok: false, message: "name cannot be empty." });
        patch.name = n;
      }
      if ("trigger" in payload) {
        const err = validateTrigger(payload.trigger);
        if (err) return respond(400, { ok: false, message: err });
        patch.trigger = payload.trigger;
      }
      if ("action" in payload) {
        const err = validateAction(payload.action);
        if (err) return respond(400, { ok: false, message: err });
        patch.action = payload.action;
      }
      if ("condition" in payload) {
        const err = validateCondition(payload.condition);
        if (err) return respond(400, { ok: false, message: err });
        patch.condition = payload.condition || null;
      }
      if (typeof payload.is_active === "boolean") {
        patch.is_active = payload.is_active;
      }

      if (!Object.keys(patch).length) {
        return respond(400, { ok: false, message: "Nothing to update." });
      }

      const { data: after, error } = await supabase
        .from("workspace_automations")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "automation",
        targetId: id,
        action: "automation.updated",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, automation: after });
    }

    // Convenience for the UI: dedicated enable/disable that logs
    // .enabled / .disabled instead of a generic .updated.
    if (action === "toggleAutomation" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad automation id." });
      if (typeof payload.is_active !== "boolean") {
        return respond(400, { ok: false, message: "is_active (boolean) required." });
      }

      const { data: before } = await supabase
        .from("workspace_automations").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Automation not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_automation");
      if (denied) return denied;

      if (before.is_active === payload.is_active) {
        return respond(200, { ok: true, automation: before, unchanged: true });
      }

      const { data: after, error } = await supabase
        .from("workspace_automations")
        .update({ is_active: payload.is_active })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;

      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "automation",
        targetId: id,
        action: payload.is_active ? "automation.enabled" : "automation.disabled",
        beforeState: before,
        afterState: after,
      });

      return respond(200, { ok: true, automation: after });
    }

    if (action === "deleteAutomation" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad automation id." });

      const { data: before } = await supabase
        .from("workspace_automations").select("*").eq("id", id).single();
      if (!before) return respond(404, { ok: false, message: "Automation not found." });

      const denied = await requireWorkspaceCap(supabase, profile, before.workspace_id, "manage_automation");
      if (denied) return denied;

      const { error } = await supabase
        .from("workspace_automations").delete().eq("id", id);
      if (error) throw error;

      // No automation.deleted in the CHECK vocabulary; we use .disabled
      // with a reason in event_data. The schema/CHECK doesn't currently
      // have a clean delete event — add in a future migration if this
      // gets noisy.
      await logActivity(supabase, profile, {
        workspaceId: before.workspace_id,
        targetKind: "automation",
        targetId: id,
        action: "automation.disabled",
        beforeState: before,
        eventData: { reason: "deleted" },
      });

      return respond(200, { ok: true });
    }

    // Admin-only manual fire. Useful for testing an automation
    // without waiting for its trigger. Bypasses the trigger check
    // entirely but still runs the condition + action.
    //
    // The worker isn't deployed yet (next slice), so for now we
    // just LOG the synthetic firing. Once the worker exists we'll
    // import its executor and dispatch the action for real.
    if (action === "runAutomationNow" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const id = payload.id;
      if (!isUuid(id)) return respond(400, { ok: false, message: "Bad automation id." });

      if (!isOrgAdmin(profile)) {
        return respond(403, { ok: false, message: "Admin only." });
      }

      const { data: auto } = await supabase
        .from("workspace_automations").select("*").eq("id", id).single();
      if (!auto) return respond(404, { ok: false, message: "Automation not found." });

      // TODO: when workspace-automations-worker.js exists, import the
      // executor here and dispatch auto.action for real. For now this
      // is a dry-run that just bumps fire_count + writes the audit row
      // so the operator can see manual fires in the log.
      await supabase
        .from("workspace_automations")
        .update({
          last_fired_at: new Date().toISOString(),
          fire_count: (auto.fire_count || 0) + 1,
        })
        .eq("id", id);

      await logActivity(supabase, profile, {
        workspaceId: auto.workspace_id,
        targetKind: "automation",
        targetId: id,
        action: "automation.fired",
        eventData: {
          source: "manual_run",
          dry_run: true,
          trigger: auto.trigger,
          action_kind: auto.action?.kind,
          note: "worker not yet deployed — action not dispatched",
        },
      });

      return respond(200, {
        ok: true,
        automation: auto,
        dry_run: true,
        message: "Manual fire logged. Worker not yet deployed; action not dispatched.",
      });
    }

    return respond(404, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("workspace-automations handler error:", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal server error.",
    });
  }
};
