// netlify/functions/paf.js
//
// PR B-1 — PAF flow backend. Migrated from the App Script Code.gs.
//
// Auth bridge: same pattern as team-mgmt.js / org-mgmt.js. Validates
// the Supabase JWT with the service-role key, looks up the requesting
// profile, and gates each action on role.
//
// Actions:
//
//   GET ?action=list
//     -> { user, pafs[] } scoped to caller's visible stores. Submitters
//        see their own; managers (DO/SDO/RVP/VP/COO) see PAFs in their
//        scope; payroll/admin see everything.
//
//   GET ?action=config
//     -> latest paf_form config row (read by submit form to render).
//        Cached in-process for 60s.
//
//   POST ?action=submit
//     body: full PAF object
//     -> creates a new paf_submissions row with status=Pending.
//        Submitter must be DO/GM/SDO/Admin per the Code.gs rules,
//        and the drive_in must be in their visible store set.
//
//   POST ?action=reject (payroll/admin)
//     body: { id, reason }
//     -> sets status=Rejected with the given reason.
//
//   POST ?action=needs-approval (payroll/admin)
//     body: { id, approval_email, notes }
//     -> sets status="Needs Approval", generates a 72h action_token,
//        and (in PR B-2) emails the link to approval_email.
//
//   POST ?action=mark-processed (payroll/admin)
//     body: { id }
//     -> sets status=Processed + payroll_processed_at/by.
//
//   POST ?action=token-approve  (PUBLIC — no auth required)
//     body: { token, email_of_clicker (optional) }
//     -> validates token + expiry, sets status=Approved + approved_*
//        fields.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { sendSms, telnyxConfigured } from "./_lib/telnyx.js";
import { getFlag } from "./_lib/flags.js";
import { resolvePafWatchers } from "./_lib/pafWatchers.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOKEN_EXPIRY_HOURS = 72;

// Roles that can submit. GM is intentionally excluded — PAFs originate
// at DO level and above. RVP/VP/COO included so they can submit
// bonuses for direct reports; their bonus PAFs skip SDO and go
// straight to Payroll.
const SUBMIT_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);

// "Restricted" stores on PAF — listed here so the listMyStores fetch will
// always append them for the allowed roles even when they sit outside the
// caller's normal org scope (corporate / training / hold stores aren't in
// any operating district's hierarchy). The allowlist also doubles as a
// submit-side gate, but for 8100 we open it to every PAF-submitter role
// because employees coded there include above-store leadership that any
// DO might need to file a PAF against.
//
// Key  = store_number (string).
// Value = roles that can pick this store on a PAF + see it in the dropdown
//         even when they have no scope to it. Use a narrower set if a future
//         store should genuinely be restricted (e.g. SDO+).
const PAF_RESTRICTED_STORES = {
  "8100": new Set(["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]),
};
function canSeeRestrictedStore(role, storeNumber) {
  const allowed = PAF_RESTRICTED_STORES[String(storeNumber).trim()];
  if (!allowed) return true; // not restricted at all
  return allowed.has(role);
}
// Roles that can read PAFs at all (also no GM).
const READ_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
// Roles that can process (reject / needs-approval / mark-processed)
const PROCESS_ROLES = new Set(["payroll", "admin"]);
// Org-wide read (sees everything)
const ORG_WIDE_READ = new Set(["payroll", "admin", "vp", "coo"]);
// SDO and higher (plus back-office) — may waive the Drive-In # on a
// Demotion, where the demoted leader doesn't map to a single store.
const DRIVEIN_OVERRIDE_ROLES = new Set(["sdo", "rvp", "vp", "coo", "payroll", "admin"]);
// Roles whose own bonus submissions skip SDO and go straight to Payroll.
const BONUS_BYPASS_ROLES = new Set(["rvp", "vp", "coo", "admin"]);
// Roles that may edit + resubmit a REJECTED PAF on behalf of someone else
// (still scope-checked). The original submitter can always resubmit their own.
const ON_BEHALF_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

// Pay Adjustment (Salary) — SDO/RVP submit a salary change for a GM/DO/SDO;
// the VP approves it (reusing the SDO-approval machinery: same approver +
// decision columns, distinct "Pending VP Approval" status). VP and COO are
// copied on submission.
const PAY_ADJ_SALARY = "Pay Adjustment (Salary)";
const PAY_ADJ_SUBMIT_ROLES = new Set(["sdo", "rvp", "admin"]);
const PAY_ADJ_ROLES = new Set(["GM", "DO", "SDO"]);
const APPROVAL_PENDING_STATUSES = ["Pending SDO Approval", "Pending VP Approval"];

// Allowed status values (mirrors form_config.lists.statuses).
const STATUSES = new Set([
  "Pending",
  "Pending SDO Approval",
  "Pending VP Approval",
  "Approved",
  "Rejected",
  "Needs Approval",
  "Needs Info",
  "Processed",
]);

// Source statuses that are safe to flip to "Processed". Pending SDO
// Approval and Needs Approval are deliberately excluded — those still
// need their respective sign-off step. Rejected and Processed are
// terminal (already-handled) and excluded for idempotency.
const PROCESSABLE_STATUSES = new Set(["Pending", "Approved", "Needs Info"]);

// Source statuses from which a PAF can be rejected. Processed is
// terminal so we can't undo payroll; Rejected is a no-op (idempotency).
const REJECTABLE_STATUSES = new Set([
  "Pending",
  "Pending SDO Approval",
  "Pending VP Approval",
  "Approved",
  "Needs Approval",
  "Needs Info",
]);

// Statuses a PAF can be edited from: rejected (the original flow), or still
// awaiting a decision (pending). Once Approved/Processed it's locked.
const EDITABLE_STATUSES = new Set(["Rejected", "Pending", "Pending SDO Approval", "Pending VP Approval"]);

// Statuses from which the submitter may delete their OWN PAF (before anyone
// has actioned it). Admins can delete any non-archived PAF.
const SUBMITTER_DELETABLE_STATUSES = new Set(["Pending", "Pending SDO Approval", "Pending VP Approval"]);

// Light in-process cache for the form config so list/submit don't hit
// the DB every call. Same TTL as paf-config.js.
const CACHE_TTL_MS = 60 * 1000;
const _cache = new Map();
function cacheGet(k) {
  const hit = _cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(k);
    return null;
  }
  return hit.value;
}
function cacheSet(k, v) {
  _cache.set(k, { value: v, expiresAt: Date.now() + CACHE_TTL_MS });
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("paf env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
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

// ----------------------------------------------------------------------------
// Email delivery via Resend HTTP API. Best-effort: failures here never
// fail the user-facing action, only log a warning. Templates come from
// the active form_config row and are rendered with simple {{VAR}}
// substitution.
// ----------------------------------------------------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
// PAF-specific display name. Falls back to the shared
// RESEND_FROM_NAME if a global name is set instead, then to the
// "Payroll Adjustment Form" default so recipients see a clear
// brand for these emails regardless of env config.
const RESEND_FROM_NAME =
  process.env.PAF_FROM_NAME
  || process.env.RESEND_FROM_NAME
  || "Payroll Adjustment Form";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

function renderTemplate(template, vars) {
  const merged = { LINK: `${appBaseUrl()}/paf`, ...vars };
  function render(s) {
    return Object.keys(merged).reduce(
      (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(merged[k] ?? "")),
      String(s ?? "")
    );
  }
  return { subject: render(template.subject), body: render(template.body) };
}

async function sendEmailViaResend({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.warn("[paf] RESEND_API_KEY not set; skipping send", { to, subject });
    return { skipped: true };
  }
  // Guard against empty arrays / null — Resend 422s on missing `to`.
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) {
    console.warn("[paf] sendEmailViaResend called with no recipient", { subject });
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: recipients,
        subject,
        text,
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[paf] Resend send failed", res.status, detail);
      return { ok: false, status: res.status };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    console.warn("[paf] Resend send threw", e);
    return { ok: false, error: e?.message };
  }
}

// Built-in templates for keys that may not exist in older form_config
// versions (config entries with the same key override these).
const FALLBACK_TEMPLATES = {
  PAY_ADJ_VP_APPROVAL_REQUEST: {
    subject: "PAF needs your approval — {{EMPLOYEE}} ({{ROLE}} salary adjustment)",
    body:
      "A Pay Adjustment (Salary) PAF needs your approval.\n\n" +
      "Employee: {{EMPLOYEE}}\nRole: {{ROLE}}\nNew salary: {{NEW_SALARY}}\n" +
      "New salary start date: {{START_DATE}}\nSubmitted by: {{SUBMITTER}}\n\n" +
      "Review it in SOAR Hub under PAF.",
  },
  PAY_ADJ_VP_APPROVED: {
    subject: "Pay adjustment approved — {{EMPLOYEE}}",
    body:
      "{{APPROVER}} approved the salary pay adjustment for {{EMPLOYEE}} ({{ROLE}}).\n" +
      "It has moved to the Payroll queue.",
  },
  PAY_ADJ_VP_REJECTED: {
    subject: "Pay adjustment rejected — {{EMPLOYEE}}",
    body:
      "{{APPROVER}} rejected the salary pay adjustment for {{EMPLOYEE}} ({{ROLE}}).\n\n" +
      "Reason: {{REASON}}",
  },
};

// Convenience: pull the named template from the active config and send.
async function sendPafEmail(supa, { templateKey, to, vars }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) return { skipped: true };
  try {
    const cfg = await getActiveConfig(supa);
    if (cfg.error) return { skipped: true, error: cfg.error };
    const template = cfg.config_json?.emailTemplates?.[templateKey] || FALLBACK_TEMPLATES[templateKey];
    if (!template?.subject || !template?.body) {
      console.warn(`[paf] template "${templateKey}" missing in active config`);
      return { skipped: true };
    }
    const rendered = renderTemplate(template, vars || {});
    return await sendEmailViaResend({
      to: recipients,
      subject: rendered.subject,
      text: rendered.body,
    });
  } catch (e) {
    console.warn("[paf] sendPafEmail threw", e);
    return { ok: false, error: e?.message };
  }
}

// Returns the email addresses of every active payroll user. Used for
// notifications that go to "the payroll team" rather than a specific
// person (e.g. PAF_SUBMITTED, APPROVAL_CONFIRMED).
async function payrollEmails(supa) {
  const { data } = await supa
    .from("profiles")
    .select("email")
    .eq("role", "payroll")
    .eq("is_active", true);
  return (data ?? []).map((p) => p.email).filter(Boolean);
}

// Emails of every active profile holding one of the given roles (e.g.
// ["vp", "coo"] for the pay-adjustment copy list).
async function rolesEmails(supa, roles) {
  const { data } = await supa
    .from("profiles")
    .select("email")
    .in("role", roles)
    .eq("is_active", true);
  return (data ?? []).map((p) => p.email).filter(Boolean);
}

// Look up an email by profile id (for SDO approval emails to a specific
// approver). Returns { email, name } or null.
async function profileById(supa, id) {
  if (!id) return null;
  const { data } = await supa
    .from("profiles")
    .select("email, full_name, preferred_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    email: data.email,
    name: data.preferred_name || data.full_name || data.email,
  };
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Outcome emails go to the PAF owner, plus the leader who resubmitted it on
// their behalf (if any). De-duped case-insensitively.
function outcomeRecipients(submitterEmail, resubmittedByEmail) {
  const out = [];
  const seen = new Set();
  for (const e of [submitterEmail, resubmittedByEmail]) {
    if (!e) continue;
    const k = String(e).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Cost calculation — locked formula (App Script calcCost). Mirrored on the
// client for live preview but the server result is authoritative.
// ----------------------------------------------------------------------------
function num(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
// Cost calculation. Reg/OT hours always multiply by reg_pay_rate;
// PTO + Illness only count when pay_basis is hourly (salary employees
// don't accrue an hourly rate that maps to those hours). Bonus amount
// is whichever flavor of bonus this PAF carries.
function calcPafCost(p) {
  const r = num(p.reg_pay_rate);
  const hourly = String(p.pay_basis ?? "").toLowerCase() === "hourly";
  const bonusAmt =
    num(p.spot_bonus_amt) +
    num(p.training_bonus_amt) +
    num(p.referral_bonus_amt);
  const gross =
    num(p.reg_hours) * r +
    num(p.ot_hours) * r * 1.5 +
    num(p.cc_tips) +
    num(p.declared_tips) +
    (hourly ? num(p.pto_hours) * r : 0) +
    (hourly ? num(p.illness_hours) * r : 0) +
    bonusAmt;
  // Partial back pay nets out what was already received.
  const alreadyPaid =
    String(p.backpay_type ?? "").toLowerCase() === "partial"
      ? num(p.backpay_paid_reg) + num(p.backpay_paid_cc_tips) + num(p.backpay_paid_declared_tips)
      : 0;
  return Math.max(0, gross - alreadyPaid);
}

function normalizeSSN(v) {
  const c = String(v ?? "").replace(/\D/g, "");
  return c.length === 4 ? c : null;
}
function sanitizeText(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}
function sanitizeDateInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// ----------------------------------------------------------------------------
// Resolve the SDO/RVP who should approve a bonus PAF. Returns a profile
// id or null if none can be matched (caller's responsibility to fall
// back to admin or an "unassigned" status).
//
// Routing:
//   - non-SDO submitter -> SDO assigned to the store's area
//   - SDO submitter     -> RVP assigned to the store's region
//   - RVP+ submitter    -> not invoked (caller skips SDO entirely)
//
// "Assigned to" = a row in user_scopes with scope_type matching the
// org level and scope_id matching the store's area_id / region_id.
// ----------------------------------------------------------------------------
async function resolveBonusApprover(supa, driveIn, submitterRole) {
  const targetRole = submitterRole === "sdo" ? "rvp" : "sdo";
  const scopeType = submitterRole === "sdo" ? "region" : "area";

  const { data: storeRow } = await supa
    .from("stores")
    .select("id, district_id")
    .eq("number", driveIn)
    .maybeSingle();
  if (!storeRow?.district_id) return null;

  const { data: districtRow } = await supa
    .from("districts")
    .select("id, area_id")
    .eq("id", storeRow.district_id)
    .maybeSingle();
  if (!districtRow?.area_id) return null;

  let scopeId = districtRow.area_id;
  if (scopeType === "region") {
    const { data: areaRow } = await supa
      .from("areas")
      .select("id, region_id")
      .eq("id", districtRow.area_id)
      .maybeSingle();
    if (!areaRow?.region_id) return null;
    scopeId = areaRow.region_id;
  }

  // Primary: a real <targetRole> assigned to this scope via user_scopes.
  const { data: candidates } = await supa
    .from("profiles")
    .select("id")
    .eq("role", targetRole)
    .eq("is_active", true);
  const candidateIds = (candidates ?? []).map((p) => p.id);
  if (candidateIds.length) {
    const { data: scoped } = await supa
      .from("user_scopes")
      .select("user_id")
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .in("user_id", candidateIds)
      .limit(1);
    if (scoped?.[0]?.user_id) return scoped[0].user_id;
  }

  // Fallback: acting coverage — whoever covers this scope via additional_scopes
  // (non-expired), regardless of their primary role. An RVP covering an area as
  // acting SDO approves that area's bonus PAFs.
  const nowIso = new Date().toISOString();
  const { data: actingRows } = await supa
    .from("additional_scopes")
    .select("user_id, expires_at")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId);
  const actingIds = (actingRows ?? [])
    .filter((r) => !r.expires_at || r.expires_at > nowIso)
    .map((r) => r.user_id);
  if (actingIds.length) {
    const { data: active } = await supa
      .from("profiles")
      .select("id")
      .in("id", actingIds)
      .eq("is_active", true)
      .limit(1);
    if (active?.[0]?.id) return active[0].id;
  }
  return null;
}

async function resolveAdminFallback(supa) {
  const { data } = await supa
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ----------------------------------------------------------------------------
// Resolve caller's visible store rows (full records, not just numbers).
// Used by the my-stores action and (indirectly) by listMyStores below.
// ----------------------------------------------------------------------------
// Select + flatten stores with their district (DO "market") and area
// (SDO) names embedded, so the New Hire form can build the market/area
// pickers + auto-populated store lists from a single fetch.
const STORE_SELECT =
  "id, number, name, district_id, is_active, districts(name, area_id, areas(name))";

function flattenStore(s) {
  const d = s.districts || null;
  const a = d?.areas || null;
  return {
    id: s.id,
    number: s.number,
    name: s.name,
    district_id: s.district_id,
    district_name: d?.name ?? null,
    area_id: d?.area_id ?? null,
    area_name: a?.name ?? null,
    is_active: s.is_active,
  };
}

async function resolveVisibleStoreRows(supa, userId) {
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa
    .from("stores")
    .select(STORE_SELECT)
    .in("id", ids)
    .eq("is_active", true)
    .order("number");
  return (data ?? []).map(flattenStore);
}

// ----------------------------------------------------------------------------
// my-stores — list of stores the caller is allowed to submit PAFs for.
// Used by the form's drive_in dropdown.
// ----------------------------------------------------------------------------
async function listMyStores(supa, user) {
  // Admin sees everything to match the submit fallback in submitPaf.
  if (user.role === "admin") {
    const { data } = await supa
      .from("stores")
      .select(STORE_SELECT)
      .eq("is_active", true)
      .order("number");
    return { stores: (data ?? []).map(flattenStore) };
  }
  if (!SUBMIT_ROLES.has(user.role) && !READ_ROLES.has(user.role)) {
    return { stores: [] };
  }
  const rows = await resolveVisibleStoreRows(supa, user.id);
  // Strip out any PAF-restricted stores the caller can't pick.
  const visible = rows.filter((s) => canSeeRestrictedStore(user.role, s.number));

  // Restricted stores like 8100 (corporate/hold — where above-store leadership
  // is coded) sit OUTSIDE the normal org tree, so they wouldn't appear in any
  // RVP's or SDO's scope-based visible-stores list. Append them as a global
  // option for the roles allowed to see them, so an SDO/RVP/VP/COO/payroll
  // can still submit a PAF against the store their employee is coded to.
  const haveNumbers = new Set(visible.map((s) => String(s.number)));
  const needGlobalNumbers = Object.keys(PAF_RESTRICTED_STORES)
    .filter((n) => !haveNumbers.has(n))
    .filter((n) => canSeeRestrictedStore(user.role, n));
  if (needGlobalNumbers.length) {
    const { data: extras } = await supa
      .from("stores")
      .select(STORE_SELECT)
      .in("number", needGlobalNumbers)
      .eq("is_active", true);
    for (const row of extras || []) visible.push(flattenStore(row));
    visible.sort((a, b) => Number(a.number) - Number(b.number));
  }
  return { stores: visible };
}

// ----------------------------------------------------------------------------
// Resolve caller's visible store-numbers (the store table's `number` column).
// Reuses the existing user_visible_stores RPC + a stores lookup, exactly
// like work-orders.js does.
// ----------------------------------------------------------------------------
async function resolveVisibleStoreNumbers(supa, userId) {
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data: storeRows } = await supa
    .from("stores")
    .select("number")
    .in("id", ids);
  return (storeRows ?? []).map((s) => String(s.number)).filter(Boolean);
}

// ----------------------------------------------------------------------------
// offer-letter-url — short-lived signed URL for a New Hire offer letter.
// Gated by the same scope rule as the PAF list: org-wide readers + the
// submitter; everyone else must reach the PAF's store. Served here (service
// role) rather than via client storage RLS because the letter carries pay
// + PII and PAF visibility is role-scoped.
// ----------------------------------------------------------------------------
async function offerLetterUrl(supa, user, pafId) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  if (!pafId) return { error: "id is required", status: 400 };

  const { data: paf } = await supa
    .from("paf_submissions")
    .select("nh_offer_letter_path, drive_in, submitter_id")
    .eq("id", pafId)
    .maybeSingle();
  if (!paf?.nh_offer_letter_path) return { error: "no offer letter on file", status: 404 };

  if (!ORG_WIDE_READ.has(user.role) && paf.submitter_id !== user.id) {
    const numbers = await resolveVisibleStoreNumbers(supa, user.id);
    if (!paf.drive_in || !numbers.includes(String(paf.drive_in))) {
      return { error: "not authorized", status: 403 };
    }
  }

  const { data: signed, error } = await supa.storage
    .from("paf-offer-letters")
    .createSignedUrl(paf.nh_offer_letter_path, 60);
  if (error || !signed?.signedUrl) return { error: "could not open offer letter", status: 500 };
  return { url: signed.signedUrl };
}

// ----------------------------------------------------------------------------
// list — PAFs visible to the caller
// ----------------------------------------------------------------------------
async function listPafs(supa, user) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };

  let q = supa
    .from("paf_submissions")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (!ORG_WIDE_READ.has(user.role)) {
    // Submitter / scope filter:
    //   gm: their own primary_store + their submissions
    //   do/sdo/rvp: any PAF whose drive_in is in their visible-store set
    const numbers = await resolveVisibleStoreNumbers(supa, user.id);
    if (!numbers.length) {
      // No reach -> show only their own submissions
      q = q.eq("submitter_id", user.id);
    } else {
      q = q.in("drive_in", numbers);
    }
  }

  const { data, error } = await q.limit(500);
  if (error) return { error: error.message, status: 500 };

  // Build a drive_in -> store_name lookup so the UI can render store
  // names in the table + detail drawer without a separate request per
  // row. One indexed query covers every distinct drive_in we returned.
  const distinctDriveIns = Array.from(
    new Set((data ?? []).map((r) => r.drive_in).filter(Boolean))
  );
  const storeNameMap = new Map();
  if (distinctDriveIns.length) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("number, name")
      .in("number", distinctDriveIns);
    for (const s of storeRows ?? []) {
      storeNameMap.set(String(s.number), s.name);
    }
  }

  // SSN last-4 is returned to every reader that reaches here. This list is
  // already scope-filtered to PAFs the leader is allowed to see, and those
  // leaders have access to the same last-4 in other systems — so there's no
  // value in masking it for in-scope DO/SDO/RVP. (Previously payroll/admin
  // only.)
  const rows = (data ?? []).map((r) => ({
    ...r,
    store_name: storeNameMap.get(String(r.drive_in)) ?? null,
  }));

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      can_submit: SUBMIT_ROLES.has(user.role),
      can_process: PROCESS_ROLES.has(user.role),
    },
    pafs: rows,
  };
}

// ----------------------------------------------------------------------------
// config — latest paf_form config (cached). Used by the submit form
// ----------------------------------------------------------------------------
async function getActiveConfig(supa) {
  const cached = cacheGet("paf_form");
  if (cached) return cached;

  const { data, error } = await supa
    .from("form_config")
    .select("config_version, config_json")
    .eq("config_key", "paf_form")
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "paf_form config missing.", status: 404 };

  cacheSet("paf_form", data);
  return data;
}

// ----------------------------------------------------------------------------
// Shared field validation + row construction for submit AND resubmit.
// Returns { error, status } on failure, or { row, driveIn, effectiveDriveIn,
// employeeName, category } on success. The row carries a default
// status="Pending"; callers apply bonus routing + estimated_cost.
// ----------------------------------------------------------------------------
async function buildPafRowFromBody(supa, user, body) {
  const driveIn = sanitizeText(body?.drive_in, 20);
  const submitCategory = sanitizeText(body?.category, 100);
  const newLocation = sanitizeText(body?.new_location, 50) || null;

  // For a Demotion with a location change, default the store to the new
  // location when no Drive-In # was entered (e.g. demoting a DO into a GM
  // store). This keeps the PAF scoped + displayed to the destination store
  // instead of showing #null.
  let effectiveDriveIn = driveIn;
  if (!effectiveDriveIn && submitCategory === "Demotion" && newLocation) {
    effectiveDriveIn = newLocation;
  }

  // Drive-In # is normally required. It's waived for New Hire (Salary
  // Leader) — which uses a home store / market instead — and for a
  // Demotion when an SDO+ submitter marks it not applicable.
  const driveInWaived =
    submitCategory === "New Hire (Salary Leader)" ||
    submitCategory === PAY_ADJ_SALARY ||
    (submitCategory === "Demotion" &&
      DRIVEIN_OVERRIDE_ROLES.has(user.role) &&
      (body?.drivein_na === "yes" || body?.drivein_na === true));

  if (!effectiveDriveIn && !driveInWaived) {
    return { error: "drive_in is required.", status: 400 };
  }

  // Restricted-store gate: a few stores (e.g. Store 8100 — corporate / hold)
  // can only be picked on a PAF by SDO+. Catches DOs who'd otherwise type the
  // number even though the dropdown hid it. Skipped when waived.
  if (effectiveDriveIn && !driveInWaived && !canSeeRestrictedStore(user.role, effectiveDriveIn)) {
    return { error: `Store #${effectiveDriveIn} requires SDO or above to submit a PAF.`, status: 403 };
  }

  // Scope check: caller must have access to a Drive-In # they typed in.
  // Skipped when waived, when the store was derived from the new location
  // (a demotion's destination store may sit outside the submitter's scope),
  // OR when the store is on the PAF_RESTRICTED_STORES allowlist for this
  // role — those are intentionally global for allowed roles even when they
  // sit outside the org tree (e.g. Store 8100 corporate/hold).
  if (driveIn && user.role !== "admin" && !PAF_RESTRICTED_STORES[String(driveIn)]) {
    const numbers = await resolveVisibleStoreNumbers(supa, user.id);
    if (!numbers.includes(driveIn)) {
      return { error: `Store ${driveIn} is outside your scope.`, status: 403 };
    }
  }

  const ssn = normalizeSSN(body?.last4_ssn);
  if (!ssn) return { error: "last4_ssn must be 4 digits.", status: 400 };

  const payPeriodEnd = sanitizeDateInput(body?.pay_period_end);
  if (!payPeriodEnd) return { error: "pay_period_end is required (YYYY-MM-DD).", status: 400 };
  // App Script enforces Sunday — replicate.
  const d = new Date(payPeriodEnd + "T00:00:00Z");
  if (d.getUTCDay() !== 0) {
    return { error: "pay_period_end must be a Sunday.", status: 400 };
  }

  const employeeName = sanitizeText(body?.employee_name, 200);
  if (!employeeName) return { error: "employee_name is required.", status: 400 };

  const category = sanitizeText(body?.category, 100);

  // Pay Adjustment (Salary): SDO/RVP only, and its custom fields are
  // required (role of the person being adjusted, the new salary, and when
  // it starts). VP approval is routed later.
  let paRole = null, paNewSalary = null, paStartDate = null;
  if (category === PAY_ADJ_SALARY) {
    if (!PAY_ADJ_SUBMIT_ROLES.has(user.role)) {
      return { error: "Only SDO/RVP can submit a Pay Adjustment (Salary).", status: 403 };
    }
    paRole = sanitizeText(body?.pa_role, 20);
    if (!PAY_ADJ_ROLES.has(paRole)) {
      return { error: "pa_role must be GM, DO, or SDO.", status: 400 };
    }
    paNewSalary = num(body?.pa_new_salary);
    if (!(paNewSalary > 0)) return { error: "New salary is required.", status: 400 };
    paStartDate = sanitizeDateInput(body?.pa_start_date);
    if (!paStartDate) return { error: "New salary start date is required (YYYY-MM-DD).", status: 400 };
  }
  if (!category) return { error: "category is required.", status: 400 };

  // Cross Store Work: the clock question decides the flow. If the team
  // member clocked in at the other store, their hours already pay through
  // that store's payroll — no additional pay goes on this PAF; payroll just
  // needs to know which store the OT charges to.
  let crossClockedOther = null;
  if (category === "Cross Store Work") {
    const ans = String(body?.cross_clocked_other ?? "").toLowerCase();
    if (ans !== "yes" && ans !== "no") {
      return { error: 'Answer "Did the team member clock in at the other store?"', status: 400 };
    }
    crossClockedOther = ans === "yes";
    if (crossClockedOther && !sanitizeText(body?.store_chrged_ot, 20)) {
      return { error: '"Store Charged OT" is required when the team member clocked in at the other store.', status: 400 };
    }
  }

  const explanation = sanitizeText(body?.explanation, 5000);
  if (!explanation) return { error: "explanation is required.", status: 400 };

  // Pull the active config_version for provenance.
  const cfg = await getActiveConfig(supa);
  if (cfg.error) return cfg;

  const payBasisRaw = String(body?.pay_basis ?? "").toLowerCase();
  const payBasis = payBasisRaw === "hourly" || payBasisRaw === "salary" ? payBasisRaw : null;

  const locChangeRaw = String(body?.location_change ?? "").toLowerCase();
  const locationChange =
    locChangeRaw === "yes" || locChangeRaw === "true"
      ? true
      : locChangeRaw === "no" || locChangeRaw === "false"
        ? false
        : null;

  const trainingDaysRaw = body?.training_days;
  const trainingDays =
    trainingDaysRaw === "" || trainingDaysRaw == null
      ? null
      : Number.isFinite(parseInt(trainingDaysRaw, 10))
        ? Math.max(0, parseInt(trainingDaysRaw, 10))
        : null;

  const insertRow = {
    config_version: cfg.config_version,
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,

    pay_period_end: payPeriodEnd,
    drive_in: effectiveDriveIn || null,
    drivein_na: driveInWaived && !effectiveDriveIn,
    market_do: sanitizeText(body?.market_do, 200) || null,
    employee_name: employeeName,
    last4_ssn: ssn,
    category,
    explanation,
    pay_basis: payBasis,

    job_position: sanitizeText(body?.job_position, 100) || null,
    approving_mgr: sanitizeText(body?.approving_mgr, 200) || null,
    reg_pay_rate: num(body?.reg_pay_rate),
    reg_hours: num(body?.reg_hours),
    ot_hours: num(body?.ot_hours),

    cc_tips: num(body?.cc_tips),
    declared_tips: num(body?.declared_tips),

    // Back pay: full (default) or partial. Partial records what was already
    // received so the netted cost is the remaining owed.
    backpay_type: category === "Backpay" && String(body?.backpay_type).toLowerCase() === "partial" ? "partial" : "full",
    backpay_paid_reg: num(body?.backpay_paid_reg),
    backpay_paid_cc_tips: num(body?.backpay_paid_cc_tips),
    backpay_paid_declared_tips: num(body?.backpay_paid_declared_tips),

    pto_hours: num(body?.pto_hours),
    illness_hours: num(body?.illness_hours),

    // Cross Store Work routing
    original_store: sanitizeText(body?.original_store, 20) || null,
    temp_new_store: sanitizeText(body?.temp_new_store, 20) || null,
    store_chrged_ot: sanitizeText(body?.store_chrged_ot, 20) || null,
    cross_clocked_other: crossClockedOther,

    // Transfer
    current_store: sanitizeText(body?.current_store, 20) || null,
    new_store: sanitizeText(body?.new_store, 20) || null,
    current_position: sanitizeText(body?.current_position, 100) || null,
    new_position: sanitizeText(body?.new_position, 100) || null,

    // Demotion (current/new pay rate also used by Transfer). "current_role"
    // is a Postgres reserved keyword; column renamed to from_role.
    from_role: sanitizeText(body?.from_role, 100) || null,
    new_role: sanitizeText(body?.new_role, 100) || null,
    current_pay_rate: body?.current_pay_rate === "" || body?.current_pay_rate == null ? null : num(body?.current_pay_rate),
    new_pay_rate: body?.new_pay_rate === "" || body?.new_pay_rate == null ? null : num(body?.new_pay_rate),
    location_change: locationChange,
    new_location: sanitizeText(body?.new_location, 50) || null,
    demotion_effective_date: sanitizeDateInput(body?.demotion_effective_date),

    // Termination — final_check_hrs is collected again (was dropped in
    // 0019 and brought back in 0200_paf_final_check_hrs). term_demotion
    // stays retired; the column still exists for historical rows only.
    last_day_worked: sanitizeDateInput(body?.last_day_worked),
    termed_in_tr: sanitizeText(body?.termed_in_tr, 10) || null,
    final_check_hrs: num(body?.final_check_hrs),

    // New Hire (Salary Leader)
    nh_role: sanitizeText(body?.nh_role, 20) || null,
    nh_start_date: sanitizeDateInput(body?.nh_start_date),
    nh_hours_last_period: num(body?.nh_hours_last_period),
    nh_home_store: sanitizeText(body?.nh_home_store, 20) || null,
    nh_no_market: body?.nh_no_market === "yes" || body?.nh_no_market === true,
    nh_market: sanitizeText(body?.nh_market, 200) || null,
    nh_area: sanitizeText(body?.nh_area, 200) || null,
    nh_stores: sanitizeText(body?.nh_stores, 2000) || null,
    nh_offer_letter_path: sanitizeText(body?.nh_offer_letter_path, 500) || null,

    // Bonus (sub-fields branch on bonus_type)
    bonus_type: sanitizeText(body?.bonus_type, 100) || null,
    spot_bonus_amt: num(body?.spot_bonus_amt),
    spot_bonus_reason: sanitizeText(body?.spot_bonus_reason, 1000) || null,
    training_bonus_amt: body?.training_bonus_amt === "" || body?.training_bonus_amt == null ? null : num(body?.training_bonus_amt),
    trained_employee_name: sanitizeText(body?.trained_employee_name, 200) || null,
    trained_at_store: sanitizeText(body?.trained_at_store, 20) || null,
    training_days: trainingDays,
    referral_bonus_amt: body?.referral_bonus_amt === "" || body?.referral_bonus_amt == null ? null : num(body?.referral_bonus_amt),
    referral_tier: sanitizeText(body?.referral_tier, 100) || null,
    referred_employee_name: sanitizeText(body?.referred_employee_name, 200) || null,
    referral_start_date: sanitizeDateInput(body?.referral_start_date),

    // Pay Adjustment (Salary)
    pa_role: paRole,
    pa_new_salary: paNewSalary,
    pa_start_date: paStartDate,

    status: "Pending",
  };

  // Clocked at the other store: base pay runs through that store's clock, so
  // this PAF documents the OT PREMIUM to charge the other store. Charge OT
  // only: keep reg_pay_rate + ot_hours, zero reg_hours + tips. The PAF's cost
  // is then ot_hours × rate × 1.5 — the amount payroll charges the other store.
  // Zeros, not nulls: these columns are NOT NULL in paf_submissions.
  if (crossClockedOther === true) {
    insertRow.reg_hours = 0;
    insertRow.cc_tips = 0;
    insertRow.declared_tips = 0;
    const otCharge = num(insertRow.ot_hours) * num(insertRow.reg_pay_rate) * 1.5;
    const marker = "[CROSS STORE — CLOCKED AT OTHER STORE]";
    if (!insertRow.explanation.includes(marker)) {
      insertRow.explanation =
        `${insertRow.explanation}\n\n${marker} NOTIFY PAYROLL: charge $${otCharge.toFixed(2)} ` +
        `(${num(insertRow.ot_hours)} OT hr × $${num(insertRow.reg_pay_rate).toFixed(2)} × 1.5) to store #${insertRow.store_chrged_ot}. ` +
        "Base pay runs through the other store's clock; this PAF charges the OT premium only.";
    }
  }

  return { row: insertRow, driveIn, effectiveDriveIn, employeeName, category };
}

// Apply bonus SDO routing to a freshly-built row (mutates row.status +
// row.sdo_approver_id). Routing keys off the ORIGINAL submitter's role,
// not whoever is editing — so a DO's bonus still routes to the SDO even
// when an SDO resubmits it on the DO's behalf.
// ── Payroll cutoff — Wednesday 10:00 AM Central by default ────────────────────
// A PAF submitted after the current week's cutoff is flagged late and stamped
// into NEXT week's processing batch. paf_cutoffs holds per-week overrides
// (holiday weeks, planned in advance) keyed by the pay week's Sunday.
const CENTRAL_TZ = "America/Chicago";
const DAY_MS = 86400000;
function centralParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((x) => x.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { y: +get("year"), m: +get("month"), d: +get("day"), hour, minute: +get("minute") };
}
function isoFromYmd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addDaysIso(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
// Sunday ending the Mon–Sun week containing the given central date.
function weekSundayIso(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysIso(isoFromYmd(y, m, d), dow === 0 ? 0 : 7 - dow);
}
// UTC instant for a Central wall-clock time on a date (DST-safe).
function centralWallToUtc(dateIso, hour, minute) {
  const [y, m, d] = dateIso.split("-").map(Number);
  for (const off of [5, 6]) {
    const guess = new Date(Date.UTC(y, m - 1, d, hour + off, minute));
    const p = centralParts(guess);
    if (p.y === y && p.m === m && p.d === d && p.hour === hour && p.minute === minute) return guess;
  }
  return new Date(Date.UTC(y, m - 1, d, hour + 6, minute));
}
// The cutoff decision for a submission happening right now.
async function evaluatePafCutoff(supa) {
  const now = new Date();
  const p = centralParts(now);
  const thisSunday = weekSundayIso(p.y, p.m, p.d);
  let cutoff = null;
  let overridden = false;
  try {
    const { data } = await supa.from("paf_cutoffs")
      .select("cutoff_at").eq("week_sunday", thisSunday).maybeSingle();
    if (data?.cutoff_at) { cutoff = new Date(data.cutoff_at); overridden = true; }
  } catch { /* pre-0233: table missing */ }
  if (!cutoff) cutoff = centralWallToUtc(addDaysIso(thisSunday, -4), 10, 0);
  const late = now.getTime() > cutoff.getTime();
  return {
    late,
    process_week: late ? addDaysIso(thisSunday, 7) : thisSunday,
    cutoff_at: cutoff.toISOString(),
    week_sunday: thisSunday,
    overridden,
  };
}

async function applyBonusRouting(supa, submitterRole, row, driveIn, category) {
  if (category === PAY_ADJ_SALARY) {
    // Salary adjustments for GM/DO/SDO are approved by the VP. Reuses the
    // SDO-approval columns with a distinct status.
    let approverId = await resolveVpApprover(supa);
    if (!approverId) approverId = await resolveAdminFallback(supa);
    row.status = "Pending VP Approval";
    row.sdo_approver_id = approverId;
    return;
  }
  if (category === "Bonus" && !BONUS_BYPASS_ROLES.has(submitterRole)) {
    let approverId = await resolveBonusApprover(supa, driveIn, submitterRole);
    if (!approverId) approverId = await resolveAdminFallback(supa);
    row.status = "Pending SDO Approval";
    row.sdo_approver_id = approverId; // may still be null; SDO widget filters by id-match
  } else {
    row.status = "Pending";
    row.sdo_approver_id = null;
  }
}

// The VP who approves salary pay adjustments (first active VP; COO backup).
async function resolveVpApprover(supa) {
  for (const role of ["vp", "coo"]) {
    const { data } = await supa
      .from("profiles").select("id").eq("role", role).eq("is_active", true).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  return null;
}

// Best-effort routing-aware notification — shared by submit + resubmit.
// `submitterDisplay` is the PAF's OWNER (not the editor) so the "from"
// person in the email reads correctly on an on-behalf resubmit.
async function notifyPafRouted(supa, submitterDisplay, row, ctx) {
  // SDO/RVP/VP/COO who opted in (profiles.notify_paf_downline) to being
  // copied on PAF activity in their own downline — see _lib/pafWatchers.js.
  const watchers = await resolvePafWatchers(supa, ctx.driveIn);
  const watcherEmails = watchers.map((w) => w.email).filter(Boolean);

  if (row.status === "Pending VP Approval") {
    // Approval request to the VP, with the VP + COO copy list the policy
    // asks for.
    const approver = await profileById(supa, row.sdo_approver_id);
    const copyList = await rolesEmails(supa, ["vp", "coo"]);
    const to = [approver?.email, ...copyList, ...watcherEmails].filter(Boolean);
    await sendPafEmail(supa, {
      templateKey: "PAY_ADJ_VP_APPROVAL_REQUEST",
      to: [...new Set(to)],
      vars: {
        EMPLOYEE: ctx.employeeName,
        ROLE: row.pa_role ?? "",
        NEW_SALARY: fmtMoney(row.pa_new_salary),
        START_DATE: row.pa_start_date ?? "",
        SUBMITTER: submitterDisplay,
      },
    });
    return;
  }

  if (row.status === "Pending SDO Approval") {
    const approver = await profileById(supa, row.sdo_approver_id);
    const to = [approver?.email, ...watcherEmails].filter(Boolean);
    await sendPafEmail(supa, {
      templateKey: "BONUS_SDO_APPROVAL_REQUEST",
      to: [...new Set(to)],
      vars: {
        EMPLOYEE: ctx.employeeName,
        STORE: ctx.driveIn,
        BONUS_TYPE: row.bonus_type ?? "",
        AMOUNT: fmtMoney(row.estimated_cost),
        DO: submitterDisplay,
      },
    });
  } else {
    const recipients = await payrollEmails(supa);
    await sendPafEmail(supa, {
      templateKey: "PAF_SUBMITTED",
      to: [...new Set([...recipients, ...watcherEmails])],
      vars: {
        EMPLOYEE: ctx.employeeName,
        STORE: ctx.effectiveDriveIn || "N/A",
        DO: submitterDisplay,
        CATEGORY: ctx.category,
        AMOUNT: fmtMoney(row.estimated_cost),
      },
    });
  }
}

// ----------------------------------------------------------------------------
// submit — DO/GM/SDO/admin only; drive_in must be in their reach
// ----------------------------------------------------------------------------
async function submitPaf(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "Only DO/GM/SDO/Admin can submit a PAF.", status: 403 };
  }

  const built = await buildPafRowFromBody(supa, user, body);
  if (built.error) return built;
  const { row: insertRow, driveIn, effectiveDriveIn, employeeName, category } = built;

  await applyBonusRouting(supa, user.role, insertRow, driveIn, category);
  insertRow.estimated_cost = calcPafCost(insertRow);
  const cut = await evaluatePafCutoff(supa);
  insertRow.late_for_week = cut.late;
  insertRow.process_week = cut.process_week;

  let { data: created, error } = await supa
    .from("paf_submissions")
    .insert(insertRow)
    .select("id")
    .single();
  if (error && /late_for_week|process_week|cross_clocked_other/.test(error.message)) {
    // Pre-0233 / pre-0242: the newer columns don't exist yet.
    delete insertRow.late_for_week;
    delete insertRow.process_week;
    delete insertRow.cross_clocked_other;
    ({ data: created, error } = await supa.from("paf_submissions").insert(insertRow).select("id").single());
  }
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: created.id,
    actor_id: user.id,
    actor_email: user.email,
    action: "submit",
    detail: {
      drive_in: effectiveDriveIn || null,
      employee_name: employeeName,
      category,
      routed_to_sdo: insertRow.status === "Pending SDO Approval",
      sdo_approver_id: insertRow.sdo_approver_id ?? null,
    },
  });

  const submitterDisplay = user.preferred_name || user.full_name || user.email;
  await notifyPafRouted(supa, submitterDisplay, insertRow, {
    driveIn,
    effectiveDriveIn,
    employeeName,
    category,
  });

  return {
    ok: true, id: created.id, status: insertRow.status,
    late: cut.late, process_week: cut.process_week, cutoff_at: cut.cutoff_at,
  };
}

// ----------------------------------------------------------------------------
// resubmit — edit a Rejected PAF and send it back into the workflow. Reuses
// the same record (id + created_at + owner preserved) so the audit history
// stays intact. The original submitter can always resubmit their own; an
// SDO/RVP (or above) within scope can resubmit on the submitter's behalf,
// in which case we record who did the edit so later outcome emails CC them.
// Re-runs the same validation, cost, and bonus routing as a fresh submit
// (routing follows the ORIGINAL submitter's role) and clears prior
// decision/token state.
// ----------------------------------------------------------------------------
async function resubmitPaf(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role) && !ON_BEHALF_ROLES.has(user.role)) {
    return { error: "Your role can't resubmit a PAF.", status: 403 };
  }
  const id = body?.id;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, submitter_id, submitter_email, submitter_name, archived")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.archived) return { error: "This PAF was deleted.", status: 400 };
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return {
      error: `This PAF can no longer be edited (status: ${existing.status}). Only pending or rejected PAFs can be edited.`,
      status: 400,
    };
  }

  const onBehalf = existing.submitter_id !== user.id;
  if (onBehalf && !ON_BEHALF_ROLES.has(user.role)) {
    return {
      error: "Only the submitter, or an SDO/RVP and above, can resubmit this PAF.",
      status: 403,
    };
  }

  const built = await buildPafRowFromBody(supa, user, body);
  if (built.error) return built;
  const { row, driveIn, effectiveDriveIn, employeeName, category } = built;

  // Preserve the original owner — an on-behalf edit doesn't change who the
  // PAF belongs to. (buildPafRowFromBody stamps the caller as submitter.)
  row.submitter_id = existing.submitter_id;
  row.submitter_email = existing.submitter_email;
  row.submitter_name = existing.submitter_name;

  // Routing + the email "from" person follow the original submitter.
  let submitterRole = user.role;
  let submitterDisplay = user.preferred_name || user.full_name || user.email;
  if (onBehalf) {
    const { data: owner } = await supa
      .from("profiles")
      .select("role, full_name, preferred_name, email")
      .eq("id", existing.submitter_id)
      .maybeSingle();
    if (owner) {
      submitterRole = owner.role;
      submitterDisplay =
        owner.preferred_name || owner.full_name || owner.email || submitterDisplay;
    }
  }

  await applyBonusRouting(supa, submitterRole, row, driveIn, category);
  row.estimated_cost = calcPafCost(row);
  // The cutoff re-evaluates on resubmit: it is entering the batch NOW.
  const cut = await evaluatePafCutoff(supa);
  row.late_for_week = cut.late;
  row.process_week = cut.process_week;

  // Reset all prior-decision + token state so the PAF re-enters its
  // workflow cleanly. created_at / archived are left untouched (update,
  // not insert). resubmitted_by tracks an on-behalf editor for the CC, and
  // is cleared when the owner resubmits their own PAF.
  const updateRow = {
    ...row,
    rejection_reason: null,
    sdo_decided_at: null,
    sdo_decision: null,
    sdo_decision_note: null,
    action_token: null,
    token_expires_at: null,
    approving_email: null,
    approval_notes: null,
    approved_at: null,
    approved_by: null,
    approved_by_email: null,
    payroll_processed_at: null,
    payroll_processed_by: null,
    resubmitted_by_id: onBehalf ? user.id : null,
    resubmitted_by_email: onBehalf ? user.email : null,
  };

  // Guard against a concurrent decision: only update while still in the same
  // editable status it was when we fetched it.
  let { data: updated, error: updErr } = await supa
    .from("paf_submissions")
    .update(updateRow)
    .eq("id", id)
    .eq("status", existing.status)
    .select("id");
  if (updErr && /late_for_week|process_week|cross_clocked_other/.test(updErr.message)) {
    delete updateRow.late_for_week;
    delete updateRow.process_week;
    delete updateRow.cross_clocked_other;
    ({ data: updated, error: updErr } = await supa
      .from("paf_submissions").update(updateRow).eq("id", id).eq("status", existing.status).select("id"));
  }
  if (updErr) return { error: updErr.message, status: 500 };
  if (!updated || updated.length === 0) {
    return { error: "This PAF was just actioned and can no longer be edited.", status: 409 };
  }

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "resubmit",
    detail: {
      drive_in: effectiveDriveIn || null,
      employee_name: employeeName,
      category,
      routed_to_sdo: updateRow.status === "Pending SDO Approval",
      on_behalf: onBehalf,
    },
  });

  await notifyPafRouted(supa, submitterDisplay, updateRow, {
    driveIn,
    effectiveDriveIn,
    employeeName,
    category,
  });

  return {
    ok: true, id, status: updateRow.status,
    late: cut.late, process_week: cut.process_week, cutoff_at: cut.cutoff_at,
  };
}

// ----------------------------------------------------------------------------
// reject — payroll/admin
// ----------------------------------------------------------------------------
async function rejectPaf(supa, user, body) {
  if (!PROCESS_ROLES.has(user.role)) {
    return { error: "Only Payroll/Admin can reject a PAF.", status: 403 };
  }
  const id = body?.id;
  const reason = sanitizeText(body?.reason, 2000);
  if (!id) return { error: "id is required.", status: 400 };
  if (!reason) return { error: "reason is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, employee_name, drive_in, submitter_email, resubmitted_by_email")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (!REJECTABLE_STATUSES.has(existing.status)) {
    return {
      error: `Cannot reject a PAF in status "${existing.status}".`,
      status: 400,
    };
  }

  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Rejected",
      rejection_reason: reason,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "reject",
    detail: { reason },
  });

  await sendPafEmail(supa, {
    templateKey: "PAF_REJECTED",
    to: outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email),
    vars: {
      EMPLOYEE: existing.employee_name,
      STORE: existing.drive_in,
      REASON: reason,
    },
  });

  return { ok: true };
}

// ----------------------------------------------------------------------------
// needs-approval — payroll/admin issues a 72h token to an external approver
// ----------------------------------------------------------------------------
async function needsApprovalPaf(supa, user, body) {
  if (!PROCESS_ROLES.has(user.role)) {
    return { error: "Only Payroll/Admin can request approval.", status: 403 };
  }
  const id = body?.id;
  const approvalEmail = sanitizeText(body?.approval_email, 200).toLowerCase();
  const notes = sanitizeText(body?.notes, 2000) || null;
  if (!id) return { error: "id is required.", status: 400 };
  if (!approvalEmail.includes("@")) {
    return { error: "Valid approval_email required.", status: 400 };
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 3600 * 1000);

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.status === "Processed" || existing.status === "Rejected") {
    return { error: `Cannot request approval on a ${existing.status} PAF.`, status: 400 };
  }

  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Needs Approval",
      approving_email: approvalEmail,
      approval_notes: notes,
      action_token: token,
      token_expires_at: expiresAt.toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  // Approval link the external user gets in their email.
  const approvalLink = `${appBaseUrl()}/paf/accept?token=${token}`;

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "needs-approval",
    detail: { approval_email: approvalEmail, expires_at: expiresAt.toISOString() },
  });

  // Pull employee + store for the template.
  const { data: row } = await supa
    .from("paf_submissions")
    .select("employee_name, drive_in")
    .eq("id", id)
    .maybeSingle();

  await sendPafEmail(supa, {
    templateKey: "NEEDS_APPROVAL",
    to: approvalEmail,
    vars: {
      EMPLOYEE: row?.employee_name ?? "",
      STORE: row?.drive_in ?? "",
      NOTES: notes ?? "",
      LINK: approvalLink,
    },
  });

  return { ok: true, approval_link: approvalLink, expires_at: expiresAt.toISOString() };
}

// ----------------------------------------------------------------------------
// token-approve — public; valid token + not expired -> Approved
// ----------------------------------------------------------------------------
//
// SECURITY: the clicker is anonymous (this is a public endpoint reached
// via the email link), so we DO NOT trust any email submitted in the
// body. The only field that can name "the approver of record" is the
// approving_email that Payroll/Admin set when issuing the token. A
// forwarded link can therefore approve the PAF, but cannot impersonate
// a different identity in the audit log or notification email.
//
// Concurrency: two clicks of the same link race. We make the update
// conditional on (id, action_token) so only the first attempt that
// still sees the original token wins; the second sees zero rows
// updated and returns 409. Without this both updates would succeed,
// the audit log would record two token-approved rows, and the second
// approved_at would silently overwrite the first.
async function tokenApprove(supa, body) {
  const token = sanitizeText(body?.token, 200);
  if (!token) return { error: "token is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, token_expires_at, approving_email, employee_name, drive_in")
    .eq("action_token", token)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Invalid or already-used link.", status: 404 };
  if (existing.token_expires_at && new Date(existing.token_expires_at) < new Date()) {
    return { error: "Link has expired.", status: 410 };
  }
  if (existing.status !== "Needs Approval") {
    return { error: "PAF is no longer awaiting approval.", status: 400 };
  }

  const { data: updated, error } = await supa
    .from("paf_submissions")
    .update({
      status: "Approved",
      approved_at: new Date().toISOString(),
      approved_by_email: existing.approving_email,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", existing.id)
    .eq("action_token", token)
    .select("id");
  if (error) return { error: error.message, status: 500 };
  if (!updated || updated.length === 0) {
    return { error: "Already approved or expired.", status: 409 };
  }

  await logAudit(supa, {
    paf_id: existing.id,
    actor_id: null,
    actor_email: existing.approving_email,
    action: "token-approved",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
    },
  });

  // Notify Payroll that the external approver clicked through.
  const recipients = await payrollEmails(supa);
  await sendPafEmail(supa, {
    templateKey: "APPROVAL_CONFIRMED",
    to: recipients,
    vars: {
      EMPLOYEE: existing.employee_name,
      STORE: existing.drive_in,
    },
  });

  return {
    ok: true,
    employee_name: existing.employee_name,
    drive_in: existing.drive_in,
  };
}

// ----------------------------------------------------------------------------
// audit-log — recent state-change rows for one PAF. Visible to the
// submitter, anyone with org-wide read (payroll/admin/vp/coo), and any
// scoped manager whose visible-store set covers the PAF's drive_in.
// ----------------------------------------------------------------------------
async function listAuditLog(supa, user, query) {
  const id = query?.id;
  if (!id) return { error: "id is required.", status: 400 };
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };

  const { data: paf, error: pafErr } = await supa
    .from("paf_submissions")
    .select("id, submitter_id, drive_in")
    .eq("id", id)
    .maybeSingle();
  if (pafErr) return { error: pafErr.message, status: 500 };
  if (!paf) return { error: "PAF not found.", status: 404 };

  // Scope check (mirrors listPafs).
  if (!ORG_WIDE_READ.has(user.role) && paf.submitter_id !== user.id) {
    const numbers = await resolveVisibleStoreNumbers(supa, user.id);
    if (!numbers.includes(paf.drive_in)) {
      return { error: "out of scope", status: 403 };
    }
  }

  const { data, error } = await supa
    .from("paf_audit_log")
    .select("id, action, detail, actor_email, created_at")
    .eq("paf_id", id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return { error: error.message, status: 500 };
  return { entries: data ?? [] };
}

// ----------------------------------------------------------------------------
// list-sdo-queue — PAFs awaiting the caller's SDO/RVP approval. Admins see
// every Pending SDO Approval row regardless of approver assignment so they
// can unstick PAFs whose approver is missing.
// ----------------------------------------------------------------------------
async function listSdoQueue(supa, user) {
  const isAdmin = user.role === "admin";
  if (!isAdmin && !["sdo", "rvp", "vp", "coo"].includes(user.role)) {
    return { error: "not authorized", status: 403 };
  }
  let q = supa
    .from("paf_submissions")
    .select("*")
    .in("status", APPROVAL_PENDING_STATUSES)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (!isAdmin) q = q.eq("sdo_approver_id", user.id);
  const { data, error } = await q.limit(200);
  if (error) return { error: error.message, status: 500 };
  const rows = data ?? [];
  // Enrich with store_name for the dashboard widget. Same pattern as
  // listPafs — one indexed query keyed by drive_in.
  const distinctDriveIns = Array.from(
    new Set(rows.map((r) => r.drive_in).filter(Boolean))
  );
  const storeNameMap = new Map();
  if (distinctDriveIns.length) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("number, name")
      .in("number", distinctDriveIns);
    for (const s of storeRows ?? []) {
      storeNameMap.set(String(s.number), s.name);
    }
  }
  return {
    pafs: rows.map((r) => ({
      ...r,
      store_name: storeNameMap.get(String(r.drive_in)) ?? null,
    })),
  };
}

// ----------------------------------------------------------------------------
// sdo-approve — caller (the assigned SDO/RVP, or admin) approves a bonus
// PAF. Flips status to Pending so it moves into the Payroll queue.
// ----------------------------------------------------------------------------
// Who may approve/reject a pending PAF: the assigned approver, an admin, or a
// role senior to the approval tier whose scope covers the store — so an RVP
// can act on a bonus sitting in their SDO's queue (they only see PAFs in
// their reach, so seeing it already implies scope). VP flow escalates only to
// COO/admin; SDO/bonus flow escalates to RVP/VP/COO/admin.
async function canApprovePaf(supa, user, existing, isVpFlow) {
  if (user.role === "admin") return true;
  if (existing.sdo_approver_id && existing.sdo_approver_id === user.id) return true;
  const escalate = isVpFlow
    ? new Set(["vp", "coo"])
    : new Set(["rvp", "vp", "coo"]);
  if (!escalate.has(user.role)) return false;
  // Org-wide roles see everything; RVP must have the store in scope.
  if (ORG_WIDE_READ.has(user.role)) return true;
  if (!existing.drive_in) return false;
  const visible = await resolveVisibleStoreNumbers(supa, user.id);
  return visible.includes(String(existing.drive_in));
}

async function sdoApprovePaf(supa, user, body) {
  const id = body?.id;
  const note = sanitizeText(body?.note, 2000) || null;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, sdo_approver_id, employee_name, drive_in, bonus_type, category, pa_role, pa_new_salary, submitter_email, resubmitted_by_email")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (!APPROVAL_PENDING_STATUSES.includes(existing.status)) {
    return { error: `PAF is not awaiting approval (status: ${existing.status}).`, status: 400 };
  }
  const isVpFlow = existing.status === "Pending VP Approval";
  const okApprove = await canApprovePaf(supa, user, existing, isVpFlow);
  if (!okApprove) {
    return { error: "You are not authorized to approve this PAF.", status: 403 };
  }

  const now = new Date().toISOString();
  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Pending",
      sdo_decided_at: now,
      sdo_decision: "approved",
      sdo_decision_note: note,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: isVpFlow ? "vp-approved" : "sdo-approved",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
      bonus_type: existing.bonus_type,
      note,
    },
  });

  const approver = user.preferred_name || user.full_name || user.email;
  if (isVpFlow) {
    const copyList = await rolesEmails(supa, ["vp", "coo"]);
    await sendPafEmail(supa, {
      templateKey: "PAY_ADJ_VP_APPROVED",
      to: [...new Set([...outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email), ...copyList])],
      vars: {
        EMPLOYEE: existing.employee_name,
        ROLE: existing.pa_role ?? "",
        APPROVER: approver,
      },
    });
  } else {
    await sendPafEmail(supa, {
      templateKey: "BONUS_SDO_APPROVED",
      to: outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email),
      vars: {
        EMPLOYEE: existing.employee_name,
        STORE: existing.drive_in,
        APPROVER: approver,
      },
    });
  }
  // Also let Payroll know it has landed in their queue.
  const payroll = await payrollEmails(supa);
  await sendPafEmail(supa, {
    templateKey: "PAF_SUBMITTED",
    to: payroll,
    vars: {
      EMPLOYEE: existing.employee_name,
      STORE: existing.drive_in ?? "N/A",
      DO: approver,
      CATEGORY: isVpFlow ? PAY_ADJ_SALARY : "Bonus",
      AMOUNT: "—",
    },
  });
  return { ok: true };
}

// ----------------------------------------------------------------------------
// sdo-reject — terminal rejection by the assigned SDO/RVP (or admin).
// ----------------------------------------------------------------------------
async function sdoRejectPaf(supa, user, body) {
  const id = body?.id;
  const reason = sanitizeText(body?.reason, 2000);
  if (!id) return { error: "id is required.", status: 400 };
  if (!reason) return { error: "reason is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, sdo_approver_id, employee_name, drive_in, bonus_type, category, pa_role, submitter_email, resubmitted_by_email")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (!APPROVAL_PENDING_STATUSES.includes(existing.status)) {
    return { error: `PAF is not awaiting approval (status: ${existing.status}).`, status: 400 };
  }
  const isVpFlow = existing.status === "Pending VP Approval";
  const okApprove = await canApprovePaf(supa, user, existing, isVpFlow);
  if (!okApprove) {
    return { error: "You are not authorized to approve this PAF.", status: 403 };
  }

  const now = new Date().toISOString();
  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Rejected",
      rejection_reason: reason,
      sdo_decided_at: now,
      sdo_decision: "rejected",
      sdo_decision_note: reason,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: isVpFlow ? "vp-rejected" : "sdo-rejected",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
      bonus_type: existing.bonus_type,
      reason,
    },
  });

  const approver = user.preferred_name || user.full_name || user.email;
  if (isVpFlow) {
    const copyList = await rolesEmails(supa, ["vp", "coo"]);
    await sendPafEmail(supa, {
      templateKey: "PAY_ADJ_VP_REJECTED",
      to: [...new Set([...outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email), ...copyList])],
      vars: {
        EMPLOYEE: existing.employee_name,
        ROLE: existing.pa_role ?? "",
        APPROVER: approver,
        REASON: reason,
      },
    });
  } else {
    await sendPafEmail(supa, {
      templateKey: "BONUS_SDO_REJECTED",
      to: outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email),
      vars: {
        EMPLOYEE: existing.employee_name,
        STORE: existing.drive_in,
        APPROVER: approver,
        REASON: reason,
      },
    });
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Payroll cutoff management — payroll/admin plan holiday-week overrides in
// advance; cutoff-info is readable by anyone who can open the PAF form.
// ----------------------------------------------------------------------------
async function cutoffInfo(supa) {
  return evaluatePafCutoff(supa);
}

async function listCutoffs(supa, user) {
  if (!PROCESS_ROLES.has(user.role)) return { error: "Payroll/Admin only.", status: 403 };
  const p = centralParts(new Date());
  const thisSunday = weekSundayIso(p.y, p.m, p.d);
  const { data, error } = await supa
    .from("paf_cutoffs")
    .select("week_sunday, cutoff_at, note, created_at")
    .gte("week_sunday", thisSunday)
    .order("week_sunday", { ascending: true })
    .limit(60);
  if (error) return { error: error.message, status: 500 };
  return { default_rule: "Wednesday 10:00 AM Central", this_week_sunday: thisSunday, overrides: data ?? [] };
}

async function setCutoff(supa, user, body) {
  if (!PROCESS_ROLES.has(user.role)) return { error: "Payroll/Admin only.", status: 403 };
  const weekSunday = sanitizeDateInput(body?.week_sunday);
  if (!weekSunday) return { error: "week_sunday is required (YYYY-MM-DD).", status: 400 };
  if (new Date(`${weekSunday}T00:00:00Z`).getUTCDay() !== 0) {
    return { error: "week_sunday must be a Sunday.", status: 400 };
  }
  const dateIso = sanitizeDateInput(body?.cutoff_date);
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(body?.cutoff_time || ""));
  if (!dateIso || !time) return { error: "cutoff_date (YYYY-MM-DD) and cutoff_time (HH:MM, Central) are required.", status: 400 };
  // The cutoff must fall on or before its pay week's Sunday.
  if (dateIso > weekSunday) return { error: "The cutoff must be on or before that week's Sunday.", status: 400 };
  const cutoffAt = centralWallToUtc(dateIso, +time[1], +time[2]);
  const note = sanitizeText(body?.note, 200) || null;
  const { error } = await supa.from("paf_cutoffs").upsert(
    { week_sunday: weekSunday, cutoff_at: cutoffAt.toISOString(), note, created_by: user.id },
    { onConflict: "week_sunday" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, week_sunday: weekSunday, cutoff_at: cutoffAt.toISOString() };
}

async function deleteCutoff(supa, user, body) {
  if (!PROCESS_ROLES.has(user.role)) return { error: "Payroll/Admin only.", status: 403 };
  const weekSunday = sanitizeDateInput(body?.week_sunday);
  if (!weekSunday) return { error: "week_sunday is required.", status: 400 };
  const { error } = await supa.from("paf_cutoffs").delete().eq("week_sunday", weekSunday);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// mark-processed — payroll/admin
// ----------------------------------------------------------------------------
async function markProcessed(supa, user, body) {
  if (!PROCESS_ROLES.has(user.role)) {
    return { error: "Only Payroll/Admin can mark a PAF as processed.", status: 403 };
  }
  const id = body?.id;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, employee_name, drive_in, submitter_email, resubmitted_by_email, estimated_cost")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  // Explicit allowlist of source statuses. Pending / Approved / Needs
  // Info are the safe inputs to "Processed". Pending SDO Approval and
  // Needs Approval are NOT — flipping them straight to Processed
  // bypasses the SDO sign-off or external approver respectively.
  if (!PROCESSABLE_STATUSES.has(existing.status)) {
    return {
      error: `Cannot process a PAF in status "${existing.status}". Must be Pending, Approved, or Needs Info.`,
      status: 400,
    };
  }

  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Processed",
      payroll_processed_at: new Date().toISOString(),
      payroll_processed_by: user.id,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "mark-processed",
    detail: null,
  });

  await sendPafEmail(supa, {
    templateKey: "PAF_PROCESSED",
    to: outcomeRecipients(existing.submitter_email, existing.resubmitted_by_email),
    vars: {
      EMPLOYEE: existing.employee_name,
      STORE: existing.drive_in,
      AMOUNT: fmtMoney(existing.estimated_cost),
    },
  });

  return { ok: true };
}

// ----------------------------------------------------------------------------
// Audit log (best-effort — failures don't break the user-facing action).
// ----------------------------------------------------------------------------
//
// Note the error-handling shape: supabase-js returns PostgREST errors
// in the result object, it does NOT throw, so a try/catch around an
// insert will never see schema/RLS failures and would silently drop
// audit rows. Always destructure { error } and warn explicitly.
async function logAudit(supa, entry) {
  try {
    const { error } = await supa.from("paf_audit_log").insert(entry);
    if (error) console.warn("[paf] audit log insert failed", error);
  } catch (e) {
    console.warn("[paf] audit log insert threw", e);
  }
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// delete (soft) — admin only. Hides the PAF from every queue/list by setting
// archived = true (existing list queries already filter archived = false) and
// records who deleted it and why. The row is kept; the deletion shows up in the
// audit log as "Deleted by System Admin" with the reason. A reason is required.
// ----------------------------------------------------------------------------
async function deletePaf(supa, user, body) {
  const id = body?.id;
  const reason = sanitizeText(body?.reason, 2000);
  if (!id) return { error: "id is required.", status: 400 };
  if (!reason) return { error: "A reason is required to delete a PAF.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, archived, status, submitter_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.archived) return { error: "This PAF is already deleted.", status: 400 };

  // Admins can delete any PAF; the submitter can delete their OWN PAF only
  // while it's still pending (before anyone has approved/processed it).
  const isAdmin = user.role === "admin";
  const ownPending =
    existing.submitter_id === user.id && SUBMITTER_DELETABLE_STATUSES.has(existing.status);
  if (!isAdmin && !ownPending) {
    return {
      error: "You can only delete your own PAF while it's still pending. Ask an admin to remove an actioned one.",
      status: 403,
    };
  }

  const { error } = await supa
    .from("paf_submissions")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_reason: reason,
      archived_by_id: user.id,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "delete",
    detail: { reason },
  });

  return { ok: true };
}

// notify-approver — manual nudge to the assigned approver when a quick
// response is needed. Emails them (reliable) and, when Telnyx is set up,
// also texts a heads-up + a link to the PAF queue (not a magic link).
const TEXTABLE_STATUSES = new Set(["Pending", "Pending SDO Approval"]);
const PAF_NOTIFY_FLAG = "paf_text_approver";
async function textApprover(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) return { error: "Your role can't notify PAF approvers.", status: 403 };
  if (!(await getFlag(supa, PAF_NOTIFY_FLAG, { userId: user.id }))) {
    return { error: "Notifying the approver isn't turned on yet.", status: 403 };
  }
  const id = body?.id;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: paf, error } = await supa
    .from("paf_submissions")
    .select("id, status, employee_name, category, estimated_cost, sdo_approver_id, submitter_name, archived")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!paf || paf.archived) return { error: "PAF not found.", status: 404 };
  if (!TEXTABLE_STATUSES.has(paf.status)) {
    return { error: `This PAF is ${paf.status} — there's no pending approval to nudge.`, status: 409 };
  }
  if (!paf.sdo_approver_id) {
    return { error: "This PAF has no assigned approver to notify (it may be with Payroll).", status: 400 };
  }

  const { data: appr } = await supa
    .from("profiles").select("full_name, preferred_name, phone, email").eq("id", paf.sdo_approver_id).maybeSingle();
  if (!appr?.phone && !appr?.email) {
    return { error: "The assigned approver has no phone or email on file.", status: 400 };
  }

  const who = appr.preferred_name || appr.full_name || "the approver";
  const amount = paf.estimated_cost != null ? fmtMoney(paf.estimated_cost) : null;
  const detail = [paf.category, amount].filter(Boolean).join(", ");
  const link = `${appBaseUrl()}/paf`;
  const summary = `${paf.employee_name}${detail ? ` (${detail})` : ""}${paf.submitter_name ? ` from ${paf.submitter_name}` : ""}`;

  const channels = [];
  let lastError = null;

  // SMS — best-effort. Only when Telnyx is configured and we have a number;
  // a failure here never blocks the email below.
  if (telnyxConfigured() && appr.phone) {
    const smsText = `SOAR PAF needs your review: ${summary}. ${link}`;
    const sent = await sendSms(appr.phone, smsText);
    if (sent.ok) channels.push("text");
    else lastError = sent.error;
  }

  // Email — the reliable channel (and the only one while 10DLC is pending).
  if (appr.email) {
    const emailRes = await sendEmailViaResend({
      to: appr.email,
      subject: `PAF needs your review — ${paf.employee_name}`,
      text:
        `Hi ${who},\n\n` +
        `A Payroll Action Form needs your review:\n\n` +
        `  ${summary}\n\n` +
        `Please review and respond here:\n${link}\n\n` +
        `— SOAR PAF`,
    });
    if (emailRes.ok) channels.push("email");
    else if (!emailRes.skipped) lastError = "Couldn't send the email.";
  }

  if (channels.length === 0) {
    return { error: lastError || "Couldn't reach the approver (no channel succeeded).", status: 502 };
  }

  await logAudit(supa, {
    paf_id: id, actor_id: user.id, actor_email: user.email,
    action: "notify-approver", detail: { to: who, channels },
  });
  return { ok: true, to: who, channels };
}

function unwrap(result) {
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    "error" in result
  ) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    const supa = admin();

    // Public token-approve route — no auth required.
    if (action === "token-approve" && event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      return unwrap(await tokenApprove(supa, body));
    }

    // Everything else needs auth.
    let user;
    try {
      user = await getSessionUser(event);
    } catch (e) {
      return respond(500, { error: e.message || "auth failed" });
    }
    if (!user) return respond(401, { error: "unauthorized" });

    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listPafs(supa, user));
      if (action === "list-sdo-queue") return unwrap(await listSdoQueue(supa, user));
      if (action === "config") return unwrap(await getActiveConfig(supa));
      if (action === "audit-log") return unwrap(await listAuditLog(supa, user, params));
      if (action === "my-stores") return unwrap(await listMyStores(supa, user));
      if (action === "cutoff-info") return unwrap(await cutoffInfo(supa));
      if (action === "list-cutoffs") return unwrap(await listCutoffs(supa, user));
      if (action === "offer-letter-url")
        return unwrap(await offerLetterUrl(supa, user, params.id));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "submit") return unwrap(await submitPaf(supa, user, body));
      if (action === "resubmit") return unwrap(await resubmitPaf(supa, user, body));
      if (action === "reject") return unwrap(await rejectPaf(supa, user, body));
      if (action === "needs-approval") return unwrap(await needsApprovalPaf(supa, user, body));
      if (action === "mark-processed") return unwrap(await markProcessed(supa, user, body));
      if (action === "cutoff-set") return unwrap(await setCutoff(supa, user, body));
      if (action === "cutoff-delete") return unwrap(await deleteCutoff(supa, user, body));
      if (action === "sdo-approve") return unwrap(await sdoApprovePaf(supa, user, body));
      if (action === "sdo-reject") return unwrap(await sdoRejectPaf(supa, user, body));
      if (action === "delete") return unwrap(await deletePaf(supa, user, body));
      if (action === "text-approver") return unwrap(await textApprover(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
