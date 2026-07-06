// SOAR Business Disruption Reporting — backend.
//
// Replaces the standalone "Sonic Business Disruption Reporting" form. A GM
// (or above) reports a closure/disruption at a store; it routes to the
// selected District Manager by email and lands in a DO+ queue scoped the
// same way Site Audits is. Service-role gatekeeper: this function uses the
// service key and scopes every read/write to the caller's stores.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "business-disruption-attachments";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 6;

// GM and above may submit a report.
const CAPTURE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
// DO and above may review/close a report (GM is just the reporter).
const REVIEW_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
// CSV date-range export — SDO and above only (per request).
const EXPORT_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);
const ORG_WIDE = new Set(["vp", "coo", "admin"]);
const CLOSURE_TYPES = new Set([
  "Weather", "Power Outage", "Equipment Failure", "Staffing", "Plumbing",
  "Fire/Safety", "Robbery/Theft", "Vandalism", "Health Department",
  "Internet Issue", "POS Issues", "Connectivity Issues", "Other",
]);
const ISSUE_TYPES = new Set([
  "Slip/Fall", "Food Safety", "Equipment", "Vehicle Accident", "Altercation", "Other",
]);
// Closure/Disruption Type selections that trigger their own follow-up field.
const SOLUGENIX_TRIGGER = new Set(["Internet Issue", "POS Issues", "Connectivity Issues"]);
const WO_TRIGGER = new Set(["Plumbing", "Vandalism", "Equipment Failure", "Other"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("business-disruptions env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}
function sanitize(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Someone";
}
function strArray(v, allowed, max) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && allowed.has(x)).slice(0, max);
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Stores the caller can see (org-wide roles see all; others by user_scopes).
// Mirrors site-audit.js's storesForUser exactly.
async function storesForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE.has(role)) {
    const { data } = await supa.from("stores").select("id, number, name, district_id").eq("is_active", true).limit(2000);
    return { all: true, ids: new Set((data || []).map((s) => s.id)), rows: data || [] };
  }
  const { data: scopes } = await supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, ids: new Set(), rows: [] };
  const directStoreIds = scopes.filter((s) => s.scope_type === "store").map((s) => s.scope_id);
  const districtIds = scopes.filter((s) => s.scope_type === "district").map((s) => s.scope_id);
  const areaIds = scopes.filter((s) => s.scope_type === "area").map((s) => s.scope_id);
  const regionIds = scopes.filter((s) => s.scope_type === "region").map((s) => s.scope_id);
  if (regionIds.length) {
    const { data } = await supa.from("areas").select("id").in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supa.from("districts").select("id").in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supa.from("stores").select("id").in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, ids: new Set(), rows: [] };
  const { data: rows } = await supa.from("stores").select("id, number, name, district_id").in("id", Array.from(storeIds));
  return { all: false, ids: storeIds, rows: rows || [] };
}

// Decode a base64 / data-URL file and upload it; returns { path, name, type }.
async function uploadFile(supa, file, prefix) {
  if (!file?.data) return null;
  let b64 = String(file.data);
  let type = sanitize(file.type, 60);
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma > -1) {
    if (!type) type = b64.slice(5, comma).split(";")[0] || "";
    b64 = b64.slice(comma + 1);
  }
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || buf.length > MAX_FILE_BYTES) return null;
  type = type || "application/octet-stream";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp"
    : type.includes("pdf") ? "pdf" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : "bin";
  const path = `${prefix}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return { path, name: sanitize(file.name, 200) || `attachment.${ext}`, type };
}
async function signedAttachments(supa, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return [];
  return Promise.all(list.map(async (a) => {
    const { data } = await supa.storage.from(BUCKET).createSignedUrl(a.path, 60 * 60 * 24 * 7);
    return { name: a.name, type: a.type, url: data?.signedUrl || null };
  }));
}

// ── Email ────────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME =
  process.env.BIZ_DISRUPTION_FROM_NAME || process.env.RESEND_FROM_NAME || "SOAR Business Disruptions";

async function sendEmailViaResend({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.warn("[business-disruptions] RESEND_API_KEY not set; skipping send", { to, subject });
    return { skipped: true };
  }
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`, to: recipients, subject, text }),
    });
    if (!res.ok) {
      console.warn("[business-disruptions] Resend send failed", res.status, await res.text().catch(() => ""));
      return { ok: false, status: res.status };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    console.warn("[business-disruptions] Resend send threw", e);
    return { ok: false, error: e?.message };
  }
}

function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

function reportSummaryLines(row) {
  return [
    `Date: ${row.disruption_date}`,
    `Reported by: ${row.submitted_by_name}`,
    `Store closed: ${row.store_closed ? "Yes" : "No"}${row.reopen_date ? ` (reopened ${row.reopen_date})` : ""}`,
    `Order Ahead disabled: ${row.order_ahead_disabled ? "Yes" : "No"}`,
    row.closure_types.length ? `Disruption type: ${row.closure_types.join(", ")}` : null,
    row.closure_other_detail ? `Other detail: ${row.closure_other_detail}` : null,
    row.solugenix_case_number ? `Solugenix Case #: ${row.solugenix_case_number}` : null,
    row.work_order_filed === true ? `Work Order filed: Yes (${row.work_order_number || "—"})` : row.work_order_filed === false ? "Work Order filed: No" : null,
    `Employee injured: ${row.employee_injured ? "Yes" : "No"} · Store damaged: ${row.store_damaged ? "Yes" : "No"} · Customer injured: ${row.customer_injured ? "Yes" : "No"}`,
    row.issue_types.length ? `Issue type: ${row.issue_types.join(", ")}` : null,
    `Estimated loss sales: $${num(row.estimated_loss_sales).toFixed(2)}`,
    "",
    "Description:",
    row.description,
  ].filter((l) => l !== null);
}

function notifyEmailBody(row, store) {
  const lines = [
    `A business disruption was reported for store #${row.store_number}${store?.name ? ` (${store.name})` : ""}.`,
    "",
    ...reportSummaryLines(row),
    "",
    `View in SOAR Hub: ${appBaseUrl()}/business-disruptions`,
  ];
  return lines.join("\n");
}

// Escalation trigger: any of the incident-severity Yes/No fields. Store
// damage / an injury is a bigger deal than a routine closure, so it also
// goes to the store's RVP (and, if configured, a fixed ops distribution
// list) — not just the DM.
function needsEscalation(row) {
  return row.employee_injured || row.customer_injured || row.store_damaged;
}
function escalationEmailBody(row, store) {
  const why = [
    row.employee_injured && "an employee injury",
    row.customer_injured && "a customer injury",
    row.store_damaged && "store damage",
  ].filter(Boolean).join(", ");
  const lines = [
    `A business disruption reported for store #${row.store_number}${store?.name ? ` (${store.name})` : ""} involves ${why} — flagging for visibility.`,
    "",
    ...reportSummaryLines(row),
    "",
    `View in SOAR Hub: ${appBaseUrl()}/business-disruptions`,
  ];
  return lines.join("\n");
}
function confirmationEmailBody(row, store) {
  const lines = [
    `Your business disruption report for store #${row.store_number}${store?.name ? ` (${store.name})` : ""} was submitted.`,
    row.district_manager_name ? `It was routed to ${row.district_manager_name}.` : "No District Manager is on file for this store yet, so no one was auto-notified — let your leadership know directly.",
    "",
    ...reportSummaryLines(row),
    "",
    `View or edit in SOAR Hub: ${appBaseUrl()}/business-disruptions`,
  ];
  return lines.join("\n");
}

// ── Actions ──────────────────────────────────────────────────────────────

// Work order typeahead for the "look up that WO" field — scoped to the
// report's store so a GM can't browse other stores' tickets, matching the
// WO # / issue text the submitter would actually recognize.
async function lookupWorkOrders(supa, user, storeNumber, term) {
  const store = sanitize(storeNumber, 20);
  const q = sanitize(term, 100);
  if (!store || q.length < 2) return { tickets: [] };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.rows.some((s) => String(s.number) === store)) return { tickets: [] };
  const { data } = await supa
    .from("tickets")
    .select("id, wo_number, work_requested, status")
    .eq("store_number", store)
    .ilike("wo_number", `%${q}%`)
    .order("date_submitted", { ascending: false })
    .limit(10);
  return { tickets: (data || []).map((t) => ({ id: t.id, wo_number: t.wo_number, work_requested: t.work_requested, status: t.status })) };
}

// Stores the caller can submit a report for (for the New Report picker).
async function listStores(supa, user) {
  const scope = await storesForUser(supa, user);
  const rows = (scope.rows || []).slice().sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  return { stores: rows.map((s) => ({ id: s.id, number: String(s.number), name: s.name })) };
}

// Resolve the District Manager (DO) for a store automatically from its
// district's user_scopes — the submitter no longer hand-picks one. Mirrors
// the leadership-resolution join kpi-snapshot.js's resolveOrg() does, scoped
// down to a single district since this only ever needs one store's DO.
async function resolveDistrictManager(supa, districtId) {
  if (!districtId) return null;
  const { data: scopeRows } = await supa
    .from("user_scopes").select("user_id").eq("scope_type", "district").eq("scope_id", districtId);
  const userIds = (scopeRows || []).map((s) => s.user_id);
  if (!userIds.length) return null;
  const { data: profiles } = await supa
    .from("profiles").select("id, full_name, preferred_name, email, role")
    .in("id", userIds).eq("role", "do").eq("is_active", true).limit(1);
  return profiles?.[0] || null;
}

// Same idea, walked up two more levels (district → area → region) to find
// the region's RVP, for the injury/damage escalation email.
async function resolveRegionalVp(supa, districtId) {
  if (!districtId) return null;
  const { data: district } = await supa.from("districts").select("area_id").eq("id", districtId).maybeSingle();
  if (!district?.area_id) return null;
  const { data: area } = await supa.from("areas").select("region_id").eq("id", district.area_id).maybeSingle();
  if (!area?.region_id) return null;
  const { data: scopeRows } = await supa
    .from("user_scopes").select("user_id").eq("scope_type", "region").eq("scope_id", area.region_id);
  const userIds = (scopeRows || []).map((s) => s.user_id);
  if (!userIds.length) return null;
  const { data: profiles } = await supa
    .from("profiles").select("id, full_name, preferred_name, email, role")
    .in("id", userIds).eq("role", "rvp").eq("is_active", true).limit(1);
  return profiles?.[0] || null;
}

async function listDisruptions(supa, user) {
  const scope = await storesForUser(supa, user);
  let q = supa.from("business_disruptions").select("*").order("disruption_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (!scope.all) {
    if (scope.ids.size === 0) return { reports: [], can_write: CAPTURE_ROLES.has(String(user.role)) };
    q = q.in("store_id", Array.from(scope.ids));
  }
  const { data: rows, error } = await q;
  if (error) return { error: error.message, status: 500 };
  const storeName = new Map(scope.rows.map((s) => [s.id, s.name]));
  const role = String(user.role || "").toLowerCase();
  // Every row returned here is already in this caller's scope (that's what
  // the query above filtered on / scope.all means), so a reviewer can edit
  // any of them; a plain submitter can only edit their own.
  const out = await Promise.all((rows || []).map(async (r) => ({
    ...r,
    store_name: storeName.get(r.store_id) || null,
    attachments: await signedAttachments(supa, r.attachments),
    can_review: REVIEW_ROLES.has(role),
    can_edit: REVIEW_ROLES.has(role) || r.submitted_by === user.id,
  })));
  return { reports: out, can_write: CAPTURE_ROLES.has(role), can_review: REVIEW_ROLES.has(role) };
}

// Date-range export (SDO+). Same scope as the list, but filtered to
// [start, end] by disruption_date with no 300-row cap, so a CSV over a
// window is complete. Returns raw rows + store name; the client builds
// the CSV so money/date formatting stays in one place.
async function exportDisruptions(supa, user, params) {
  const role = String(user.role || "").toLowerCase();
  if (!EXPORT_ROLES.has(role)) return { error: "Your role can't export reports.", status: 403 };
  const start = String(params.start || "").trim();
  const end = String(params.end || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: "start and end dates (YYYY-MM-DD) are required.", status: 400 };
  }
  if (start > end) return { error: "start date must be on or before the end date.", status: 400 };

  const scope = await storesForUser(supa, user);
  let q = supa
    .from("business_disruptions")
    .select("*")
    .gte("disruption_date", start)
    .lte("disruption_date", end)
    .order("disruption_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (!scope.all) {
    if (scope.ids.size === 0) return { rows: [] };
    q = q.in("store_id", Array.from(scope.ids));
  }
  const { data: rows, error } = await q;
  if (error) return { error: error.message, status: 500 };
  const storeName = new Map(scope.rows.map((s) => [s.id, s.name]));
  return {
    rows: (rows || []).map((r) => ({
      disruption_date: r.disruption_date,
      store_number: r.store_number,
      store_name: storeName.get(r.store_id) || r.store_name || "",
      status: r.status,
      store_closed: r.store_closed,
      reopen_date: r.reopen_date,
      closure_types: r.closure_types || [],
      issue_types: r.issue_types || [],
      estimated_loss_sales: r.estimated_loss_sales,
      work_order_filed: r.work_order_filed,
      work_order_number: r.work_order_number,
      submitted_by_name: r.submitted_by_name,
      description: r.description,
    })),
  };
}

// Shared by create + update: resolves the store/DM/RVP and validates every
// field. Returns { error, status } on failure, or { store, dm, rvp, fields }
// where `fields` is everything except submitted_by/status/attachments —
// callers own those since create vs. edit handle them differently.
async function validateAndResolve(supa, user, body) {
  const disruptionDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.disruption_date || "") ? body.disruption_date : null;
  if (!disruptionDate) return { error: "Date of closure or disruption is required.", status: 400 };
  const storeNumber = sanitize(body?.store_number, 20);
  if (!storeNumber) return { error: "Store # is required.", status: 400 };
  const { data: store } = await supa.from("stores").select("id, number, name, district_id").eq("number", storeNumber).maybeSingle();
  if (!store) return { error: `Store ${storeNumber} not found.`, status: 404 };

  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(store.id)) return { error: "That store is outside your scope.", status: 403 };

  // No manual DM picker — the store is already scope-resolved, so the
  // District Manager comes straight from the org chart. Missing entirely
  // (a district with no DO on file) shouldn't block the report; it just
  // skips the notification email.
  const dm = await resolveDistrictManager(supa, store.district_id);

  const storeClosed = body?.store_closed === true;
  const orderAheadDisabled = body?.order_ahead_disabled === true;
  if (typeof body?.order_ahead_disabled !== "boolean") {
    return { error: "Please answer whether Order Ahead was disabled.", status: 400 };
  }
  const description = sanitize(body?.description, 4000);
  if (!description) return { error: "Description is required.", status: 400 };
  const closureTypes = strArray(body?.closure_types, CLOSURE_TYPES, CLOSURE_TYPES.size);
  const issueTypes = strArray(body?.issue_types, ISSUE_TYPES, ISSUE_TYPES.size);
  if (closureTypes.includes("Other") && !sanitize(body?.closure_other_detail, 2000)) {
    return { error: "Please describe the issue when \"Other\" is selected.", status: 400 };
  }

  // Solugenix Case # — required when the closure type points at IT/telecom
  // (Internet, POS, Connectivity), since that's who those tickets route to.
  const needsSolugenix = closureTypes.some((t) => SOLUGENIX_TRIGGER.has(t));
  const solugenixCase = sanitize(body?.solugenix_case_number, 100);
  if (needsSolugenix && !solugenixCase) {
    return { error: "Solugenix Case # is required for Internet/POS/Connectivity issues.", status: 400 };
  }

  // Work Order follow-up — required when the closure type is something a
  // work order would normally get filed for (Plumbing, Vandalism, Equipment
  // Failure, Other). If one was filed, the submitter looks it up and links
  // it so the report and the WO ticket stay connected.
  const needsWo = closureTypes.some((t) => WO_TRIGGER.has(t));
  let workOrderFiled = null;
  let workOrderTicketId = null;
  let workOrderNumber = null;
  if (needsWo) {
    if (typeof body?.work_order_filed !== "boolean") {
      return { error: "Please answer whether a Work Order has been put in.", status: 400 };
    }
    workOrderFiled = body.work_order_filed;
    if (workOrderFiled) {
      const ticketId = sanitize(body?.work_order_ticket_id, 64);
      if (!ticketId) return { error: "Look up and select the Work Order.", status: 400 };
      const { data: ticket } = await supa.from("tickets").select("id, wo_number").eq("id", ticketId).maybeSingle();
      if (!ticket) return { error: "That work order couldn't be found.", status: 404 };
      workOrderTicketId = ticket.id;
      workOrderNumber = ticket.wo_number;
    }
  }

  const rvp = needsEscalationInput(body) ? await resolveRegionalVp(supa, store.district_id) : null;

  const fields = {
    disruption_date: disruptionDate,
    store_id: store.id,
    store_number: String(store.number),
    district_manager_id: dm?.id ?? null,
    district_manager_name: dm ? displayName(dm) : null,
    hours_disrupted: body?.hours_disrupted === "" || body?.hours_disrupted == null ? null : num(body.hours_disrupted),
    store_closed: storeClosed,
    reopen_date: storeClosed && /^\d{4}-\d{2}-\d{2}$/.test(body?.reopen_date || "") ? body.reopen_date : null,
    order_ahead_disabled: orderAheadDisabled,
    closure_types: closureTypes,
    closure_other_detail: sanitize(body?.closure_other_detail, 2000) || null,
    employee_injured: body?.employee_injured === true,
    store_damaged: body?.store_damaged === true,
    customer_injured: body?.customer_injured === true,
    issue_types: issueTypes,
    solugenix_case_number: solugenixCase || null,
    work_order_filed: workOrderFiled,
    work_order_ticket_id: workOrderTicketId,
    work_order_number: workOrderNumber,
    estimated_loss_sales: num(body?.estimated_loss_sales),
    description,
  };
  return { store, dm, rvp, fields };
}
function needsEscalationInput(body) {
  return body?.employee_injured === true || body?.customer_injured === true || body?.store_damaged === true;
}

// Fixed ops distribution list, CC'd on every escalation alongside the RVP.
// Comma-separated; optional.
const ESCALATION_CC = (process.env.BIZ_DISRUPTION_ESCALATION_EMAILS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function createDisruption(supa, user, body) {
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't submit a disruption report.", status: 403 };

  const v = await validateAndResolve(supa, user, body);
  if (v.error) return v;
  const { store, dm, rvp, fields } = v;

  const files = Array.isArray(body?.attachments) ? body.attachments.slice(0, MAX_FILES) : [];
  const uploaded = [];
  for (const f of files) {
    try {
      const r = await uploadFile(supa, f, store.id);
      if (r) uploaded.push(r);
    } catch (e) {
      return { error: `Attachment upload failed: ${e.message}`, status: 500 };
    }
  }

  const row = {
    ...fields,
    attachments: uploaded,
    escalated_to_rvp_name: rvp ? displayName(rvp) : null,
    submitted_by: user.id,
    submitted_by_name: displayName(user),
  };

  const { data, error } = await supa.from("business_disruptions").insert(row).select("*").single();
  if (error) return { error: error.message, status: 500 };

  if (dm?.email) {
    await sendEmailViaResend({
      to: dm.email,
      subject: `Business Disruption — Store #${store.number} — ${fields.disruption_date}`,
      text: notifyEmailBody(data, store),
    });
  }
  if (needsEscalation(data)) {
    const escalationTo = [rvp?.email, ...ESCALATION_CC].filter(Boolean);
    if (escalationTo.length) {
      await sendEmailViaResend({
        to: escalationTo,
        subject: `🚨 Business Disruption (escalated) — Store #${store.number} — ${fields.disruption_date}`,
        text: escalationEmailBody(data, store),
      });
    }
  }
  if (user.email) {
    await sendEmailViaResend({
      to: user.email,
      subject: `Your report was submitted — Store #${store.number} — ${fields.disruption_date}`,
      text: confirmationEmailBody(data, store),
    });
  }

  return { ok: true, id: data.id };
}

// GM (own report) or a DO+ reviewer whose scope covers the report's current
// store may edit. Re-validates every field the same way create does, but
// never touches attachments (kept immutable after submit) or re-sends any
// email — an edit is a correction, not a new incident.
async function updateDisruption(supa, user, body) {
  const id = sanitize(body?.id, 64);
  const { data: existing } = await supa.from("business_disruptions").select("id, store_id, submitted_by").eq("id", id).maybeSingle();
  if (!existing) return { error: "Report not found.", status: 404 };

  const role = String(user.role || "").toLowerCase();
  let canEdit = existing.submitted_by === user.id;
  if (!canEdit && REVIEW_ROLES.has(role)) {
    const scope = await storesForUser(supa, user);
    canEdit = scope.all || scope.ids.has(existing.store_id);
  }
  if (!canEdit) return { error: "You can't edit this report.", status: 403 };

  const v = await validateAndResolve(supa, user, body);
  if (v.error) return v;

  const { error } = await supa.from("business_disruptions").update({
    ...v.fields,
    escalated_to_rvp_name: v.rvp ? displayName(v.rvp) : null,
    updated_by_name: displayName(user),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function setStatus(supa, user, body) {
  if (!REVIEW_ROLES.has(String(user.role))) return { error: "Your role can't update a report's status.", status: 403 };
  const id = sanitize(body?.id, 64);
  const status = sanitize(body?.status, 20);
  if (!["open", "reviewed", "closed"].includes(status)) return { error: "Invalid status.", status: 400 };
  const { data: row } = await supa.from("business_disruptions").select("id, store_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Report not found.", status: 404 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(row.store_id)) return { error: "That store is outside your scope.", status: 403 };
  const { error } = await supa.from("business_disruptions").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const user = await getSessionUser(event);
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listDisruptions(supa, user));
      if (action === "export") return unwrap(await exportDisruptions(supa, user, params));
      if (action === "stores") return respond(200, await listStores(supa, user));
      if (action === "wo-lookup") return respond(200, await lookupWorkOrders(supa, user, params.store_number, params.q));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "create") return unwrap(await createDisruption(supa, user, body));
    if (action === "update") return unwrap(await updateDisruption(supa, user, body));
    if (action === "set-status") return unwrap(await setStatus(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
