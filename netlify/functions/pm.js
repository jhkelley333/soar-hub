// netlify/functions/pm.js
//
// Preventive Maintenance admin endpoints. All writes require admin
// role; reads are gated to operational roles that have a reason to
// see PM schedules (admin, payroll, RVP+, SDO, DO).
//
// Actions:
//   GET  ?action=listTemplates           — all PM templates
//   POST ?action=upsertTemplate          — create/update (admin)
//   POST ?action=deleteTemplate          — delete (admin)
//   GET  ?action=listSchedules           — joined view of schedules
//   POST ?action=upsertSchedule          — assign template to store(s)
//   POST ?action=deleteSchedule          — drop schedule row
//   POST ?action=spawnDueNow             — manual trigger (admin)

import { createClient } from "@supabase/supabase-js";
import { computeNextDueAt, spawnDuePMs } from "./_lib/pm.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const READ_ROLES = new Set(["admin", "coo", "vp", "rvp", "sdo", "do", "payroll"]);
const WRITE_ROLES = new Set(["admin"]);

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

function cleanTemplatePayload(body) {
  const performer = body.performer_type === "vendor" ? "vendor" : "internal";
  const cadence = body.cadence_type === "fixed" ? "fixed" : "rolling";
  const monthsRaw = Array.isArray(body.fixed_months) ? body.fixed_months : [];
  const months = monthsRaw
    .map((m) => parseInt(m, 10))
    .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
  const fixedDay = body.fixed_day_of_month != null
    ? Math.min(28, Math.max(1, parseInt(body.fixed_day_of_month, 10) || 1))
    : null;
  const cadenceDays = body.cadence_days != null
    ? Math.max(1, parseInt(body.cadence_days, 10) || 90)
    : null;
  return {
    name: String(body.name || "").trim(),
    category: body.category ? String(body.category).trim() : null,
    description: body.description ? String(body.description).trim() : null,
    instructions: body.instructions ? String(body.instructions).trim() : null,
    performer_type: performer,
    default_vendor_id: performer === "vendor" && body.default_vendor_id
      ? String(body.default_vendor_id) : null,
    cadence_type: cadence,
    cadence_days: cadence === "rolling" ? (cadenceDays || 90) : null,
    fixed_months: cadence === "fixed" ? (months.length ? months : [1, 4, 7, 10]) : null,
    fixed_day_of_month: cadence === "fixed" ? (fixedDay || 1) : null,
    lead_days: Math.max(0, parseInt(body.lead_days, 10) || 7),
    est_cost: body.est_cost != null && body.est_cost !== ""
      ? parseFloat(body.est_cost) : null,
    checklist_url: body.checklist_url ? String(body.checklist_url).trim() : null,
    priority: body.priority || "Standard",
    is_active: body.is_active !== false,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    const profile = await getCallerProfile(event);
    if (!profile) return respond(401, { ok: false, message: "Sign in required." });
    const role = String(profile.role || "").toLowerCase();
    if (!READ_ROLES.has(role)) {
      return respond(403, { ok: false, message: "Not authorized." });
    }
    const supabase = getSupabase();
    const action = (event.queryStringParameters || {}).action || "";

    if (action === "listTemplates") {
      const { data, error } = await supabase
        .from("pm_templates")
        .select(`
          id, name, category, description, instructions, performer_type,
          default_vendor_id, cadence_type, cadence_days, fixed_months,
          fixed_day_of_month, lead_days, est_cost, checklist_url,
          priority, is_active, created_at, updated_at,
          vendors:default_vendor_id ( id, name )
        `)
        .order("name", { ascending: true });
      if (error) throw error;
      return respond(200, { ok: true, templates: data || [] });
    }

    if (action === "listSchedules") {
      const params = event.queryStringParameters || {};
      let query = supabase
        .from("pm_schedule")
        .select(`
          id, template_id, store_id, override_vendor_id,
          next_due_at, last_completed_at, last_ticket_id, is_active,
          created_at, updated_at,
          pm_templates:template_id (
            id, name, category, performer_type, default_vendor_id,
            cadence_type, cadence_days, fixed_months, fixed_day_of_month,
            lead_days, est_cost, checklist_url, priority, is_active
          ),
          stores:store_id ( id, number, name ),
          vendors_override:override_vendor_id ( id, name )
        `)
        .order("next_due_at", { ascending: true });
      if (params.template_id) query = query.eq("template_id", params.template_id);
      if (params.store_id) query = query.eq("store_id", params.store_id);
      const { data, error } = await query;
      if (error) throw error;
      return respond(200, { ok: true, schedules: data || [] });
    }

    // ── writes require admin ──
    if (!WRITE_ROLES.has(role)) {
      return respond(403, { ok: false, message: "Admin only." });
    }

    if (action === "upsertTemplate" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const payload = cleanTemplatePayload(body);
      if (!payload.name) {
        return respond(400, { ok: false, message: "name is required." });
      }
      if (payload.performer_type === "vendor" && !payload.default_vendor_id) {
        return respond(400, {
          ok: false,
          message: "Vendor PM templates need a default vendor.",
        });
      }
      const upsertPayload = body.id
        ? { id: body.id, ...payload }
        : payload;
      const { data, error } = await supabase
        .from("pm_templates")
        .upsert(upsertPayload, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, template: data });
    }

    if (action === "deleteTemplate" && event.httpMethod === "POST") {
      const { id } = JSON.parse(event.body || "{}");
      if (!id) return respond(400, { ok: false, message: "id required." });
      const { error } = await supabase.from("pm_templates").delete().eq("id", id);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    if (action === "upsertSchedule" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const templateId = String(body.template_id || "").trim();
      const storeIds = Array.isArray(body.store_ids)
        ? body.store_ids.filter(Boolean)
        : (body.store_id ? [String(body.store_id)] : []);
      if (!templateId || storeIds.length === 0) {
        return respond(400, {
          ok: false,
          message: "template_id and at least one store_id are required.",
        });
      }
      // Pull the template so we can compute next_due_at when caller
      // doesn't supply one.
      const { data: tmpl, error: tErr } = await supabase
        .from("pm_templates")
        .select("cadence_type, cadence_days, fixed_months, fixed_day_of_month")
        .eq("id", templateId)
        .single();
      if (tErr || !tmpl) {
        return respond(404, { ok: false, message: "Template not found." });
      }
      const explicitDue = body.next_due_at ? new Date(body.next_due_at) : null;
      const overrideVendorId = body.override_vendor_id
        ? String(body.override_vendor_id) : null;
      const isActive = body.is_active !== false;

      const rows = storeIds.map((sid) => ({
        template_id: templateId,
        store_id: sid,
        override_vendor_id: overrideVendorId,
        next_due_at: (explicitDue && !isNaN(explicitDue.getTime())
          ? explicitDue
          : computeNextDueAt(tmpl, new Date())
        ).toISOString(),
        is_active: isActive,
      }));

      // Upsert by (template_id, store_id) so re-assigning is idempotent.
      const { data, error } = await supabase
        .from("pm_schedule")
        .upsert(rows, { onConflict: "template_id,store_id" })
        .select();
      if (error) throw error;
      return respond(200, { ok: true, schedules: data || [] });
    }

    if (action === "deleteSchedule" && event.httpMethod === "POST") {
      const { id } = JSON.parse(event.body || "{}");
      if (!id) return respond(400, { ok: false, message: "id required." });
      const { error } = await supabase.from("pm_schedule").delete().eq("id", id);
      if (error) throw error;
      return respond(200, { ok: true });
    }

    if (action === "spawnDueNow" && event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      const result = await spawnDuePMs(supabase, { dryRun: !!body.dryRun });
      return respond(200, { ok: true, ...result });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[pm] error:", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal error.",
    });
  }
};
