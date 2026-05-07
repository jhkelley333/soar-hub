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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOKEN_EXPIRY_HOURS = 72;

// Roles that can submit. RVP/VP/COO included so they can submit bonuses
// for direct reports; their bonus PAFs skip SDO and go straight to
// Payroll.
const SUBMIT_ROLES = new Set(["do", "gm", "sdo", "rvp", "vp", "coo", "admin"]);
// Roles that can read PAFs at all
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
// Roles that can process (reject / needs-approval / mark-processed)
const PROCESS_ROLES = new Set(["payroll", "admin"]);
// Org-wide read (sees everything)
const ORG_WIDE_READ = new Set(["payroll", "admin", "vp", "coo"]);
// Roles whose own bonus submissions skip SDO and go straight to Payroll.
const BONUS_BYPASS_ROLES = new Set(["rvp", "vp", "coo", "admin"]);

// Allowed status values (mirrors form_config.lists.statuses).
const STATUSES = new Set([
  "Pending",
  "Pending SDO Approval",
  "Approved",
  "Rejected",
  "Needs Approval",
  "Needs Info",
  "Processed",
]);

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
  return (
    num(p.reg_hours) * r +
    num(p.ot_hours) * r * 1.5 +
    num(p.cc_tips) +
    num(p.declared_tips) +
    (hourly ? num(p.pto_hours) * r : 0) +
    (hourly ? num(p.illness_hours) * r : 0) +
    bonusAmt
  );
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

  const { data: candidates } = await supa
    .from("profiles")
    .select("id")
    .eq("role", targetRole)
    .eq("is_active", true);
  const candidateIds = (candidates ?? []).map((p) => p.id);
  if (!candidateIds.length) return null;

  const { data: scoped } = await supa
    .from("user_scopes")
    .select("user_id")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .in("user_id", candidateIds)
    .limit(1);
  return scoped?.[0]?.user_id ?? null;
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

  // Mask SSN for non-payroll/admin viewers.
  const showSSN = user.role === "payroll" || user.role === "admin";
  const rows = (data ?? []).map((r) => ({
    ...r,
    last4_ssn: showSSN ? r.last4_ssn : "****",
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
// submit — DO/GM/SDO/admin only; drive_in must be in their reach
// ----------------------------------------------------------------------------
async function submitPaf(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "Only DO/GM/SDO/Admin can submit a PAF.", status: 403 };
  }

  const driveIn = sanitizeText(body?.drive_in, 20);
  if (!driveIn) return { error: "drive_in is required.", status: 400 };

  // Scope check: caller must have access to this store. Admin bypass.
  if (user.role !== "admin") {
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
  if (!category) return { error: "category is required.", status: 400 };

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
    drive_in: driveIn,
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

    pto_hours: num(body?.pto_hours),
    illness_hours: num(body?.illness_hours),

    // Cross Store Work routing
    original_store: sanitizeText(body?.original_store, 20) || null,
    temp_new_store: sanitizeText(body?.temp_new_store, 20) || null,
    store_chrged_ot: sanitizeText(body?.store_chrged_ot, 20) || null,

    // Transfer
    current_store: sanitizeText(body?.current_store, 20) || null,
    new_store: sanitizeText(body?.new_store, 20) || null,
    current_position: sanitizeText(body?.current_position, 100) || null,
    new_position: sanitizeText(body?.new_position, 100) || null,

    // Demotion (current/new pay rate also used by Transfer)
    current_role: sanitizeText(body?.current_role, 100) || null,
    new_role: sanitizeText(body?.new_role, 100) || null,
    current_pay_rate: body?.current_pay_rate === "" || body?.current_pay_rate == null ? null : num(body?.current_pay_rate),
    new_pay_rate: body?.new_pay_rate === "" || body?.new_pay_rate == null ? null : num(body?.new_pay_rate),
    location_change: locationChange,
    new_location: sanitizeText(body?.new_location, 50) || null,

    // Termination — final_check_hrs + term_demotion intentionally not collected
    last_day_worked: sanitizeDateInput(body?.last_day_worked),
    termed_in_tr: sanitizeText(body?.termed_in_tr, 10) || null,

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

    status: "Pending",
  };

  // Bonus routing — non-bypass submitters land in "Pending SDO Approval"
  // with sdo_approver_id set; bypass roles + non-bonus categories go
  // straight to "Pending" (Payroll queue).
  const isBonus = category === "Bonus";
  if (isBonus && !BONUS_BYPASS_ROLES.has(user.role)) {
    let approverId = await resolveBonusApprover(supa, driveIn, user.role);
    if (!approverId) approverId = await resolveAdminFallback(supa);
    insertRow.status = "Pending SDO Approval";
    insertRow.sdo_approver_id = approverId; // may still be null; SDO widget filters by id-match
  }

  insertRow.estimated_cost = calcPafCost(insertRow);

  const { data: created, error } = await supa
    .from("paf_submissions")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: created.id,
    actor_id: user.id,
    actor_email: user.email,
    action: "submit",
    detail: {
      drive_in: driveIn,
      employee_name: employeeName,
      category,
      routed_to_sdo: insertRow.status === "Pending SDO Approval",
      sdo_approver_id: insertRow.sdo_approver_id ?? null,
    },
  });

  return { ok: true, id: created.id, status: insertRow.status };
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
    .select("id, status, employee_name, drive_in")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.status === "Processed") {
    return { error: "PAF is already Processed; cannot reject.", status: 400 };
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

  // Approval link the external user gets in their email. Email send
  // happens in PR B-2; for now we just return the link in the response
  // so the UI can show it and Payroll can copy/paste manually.
  const base =
    (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") || "";
  const approvalLink = `${base}/paf/accept?token=${token}`;

  await logAudit(supa, {
    paf_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "needs-approval",
    detail: { approval_email: approvalEmail, expires_at: expiresAt.toISOString() },
  });

  return { ok: true, approval_link: approvalLink, expires_at: expiresAt.toISOString() };
}

// ----------------------------------------------------------------------------
// token-approve — public; valid token + not expired -> Approved
// ----------------------------------------------------------------------------
async function tokenApprove(supa, body) {
  const token = sanitizeText(body?.token, 200);
  const clickerEmail = sanitizeText(body?.email, 200).toLowerCase() || null;
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

  const { error } = await supa
    .from("paf_submissions")
    .update({
      status: "Approved",
      approved_at: new Date().toISOString(),
      approved_by_email: clickerEmail || existing.approving_email,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", existing.id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    paf_id: existing.id,
    actor_id: null,
    actor_email: clickerEmail || existing.approving_email,
    action: "token-approved",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
    },
  });

  return {
    ok: true,
    employee_name: existing.employee_name,
    drive_in: existing.drive_in,
  };
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
    .eq("status", "Pending SDO Approval")
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (!isAdmin) q = q.eq("sdo_approver_id", user.id);
  const { data, error } = await q.limit(200);
  if (error) return { error: error.message, status: 500 };
  return { pafs: data ?? [] };
}

// ----------------------------------------------------------------------------
// sdo-approve — caller (the assigned SDO/RVP, or admin) approves a bonus
// PAF. Flips status to Pending so it moves into the Payroll queue.
// ----------------------------------------------------------------------------
async function sdoApprovePaf(supa, user, body) {
  const id = body?.id;
  const note = sanitizeText(body?.note, 2000) || null;
  if (!id) return { error: "id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("paf_submissions")
    .select("id, status, sdo_approver_id, employee_name, drive_in, bonus_type")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.status !== "Pending SDO Approval") {
    return { error: `PAF is not awaiting SDO approval (status: ${existing.status}).`, status: 400 };
  }
  if (user.role !== "admin" && existing.sdo_approver_id !== user.id) {
    return { error: "You are not the assigned approver for this PAF.", status: 403 };
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
    action: "sdo-approved",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
      bonus_type: existing.bonus_type,
      note,
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
    .select("id, status, sdo_approver_id, employee_name, drive_in, bonus_type")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.status !== "Pending SDO Approval") {
    return { error: `PAF is not awaiting SDO approval (status: ${existing.status}).`, status: 400 };
  }
  if (user.role !== "admin" && existing.sdo_approver_id !== user.id) {
    return { error: "You are not the assigned approver for this PAF.", status: 403 };
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
    action: "sdo-rejected",
    detail: {
      employee_name: existing.employee_name,
      drive_in: existing.drive_in,
      bonus_type: existing.bonus_type,
      reason,
    },
  });
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
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (existing.status === "Rejected") {
    return { error: "Cannot process a rejected PAF.", status: 400 };
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
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Audit log (best-effort — failures don't break the user-facing action).
// ----------------------------------------------------------------------------
async function logAudit(supa, entry) {
  try {
    await supa.from("paf_audit_log").insert(entry);
  } catch (e) {
    console.warn("[paf] audit log insert failed", e);
  }
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------
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
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "submit") return unwrap(await submitPaf(supa, user, body));
      if (action === "reject") return unwrap(await rejectPaf(supa, user, body));
      if (action === "needs-approval") return unwrap(await needsApprovalPaf(supa, user, body));
      if (action === "mark-processed") return unwrap(await markProcessed(supa, user, body));
      if (action === "sdo-approve") return unwrap(await sdoApprovePaf(supa, user, body));
      if (action === "sdo-reject") return unwrap(await sdoRejectPaf(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
