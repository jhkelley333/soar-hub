// netlify/functions/employee-actions.js
//
// Employee Action module — V1 backend (Training Credit + PTO requests).
//
// Auth bridge + scope enforcement mirror paf.js: validate the Supabase
// JWT with the service-role key, look up the requesting profile, gate
// each action on role, and confirm the target store is in the caller's
// visible-store set via the user_visible_stores RPC.
//
// On submit we notify the store's DO + RVP by email (best-effort) and
// return ok so the client can show a confirmation toast. Approvals,
// tracking, and sign-offs are a later layer — there is deliberately no
// decide/approve action here yet.
//
// Actions:
//   GET  ?action=my-stores      -> { stores[] } the caller can submit for
//   GET  ?action=list           -> { trainingCredits[], ptoRequests[] } in scope
//   POST ?action=submit-training-> create a training_credit_requests row
//   POST ?action=submit-pto     -> create a pto_requests row

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// GM and up can file an Employee Action. (Unlike PAF, GM is included —
// these forms originate at the store: a GM requests a training credit
// for a team member or files their own vacation request.)
const SUBMIT_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]);
// Roles that see every request regardless of store scope.
const ORG_WIDE_READ = new Set(["payroll", "admin", "vp", "coo"]);
// Roles that can act on an approval step.
const APPROVER_ROLES = new Set(["do", "sdo", "rvp", "admin"]);

const VALID_TRAINING_DAYS = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

// PTO eligibility. GMs are tracked by days (no dollar amount); the hourly
// positions are tracked by hours with a dollar amount + the weekly cap.
const VALID_POSITIONS = new Set(["GM", "Associate Manager", "First Assistant"]);
const MAX_HOURS_PER_DAY = 8;
const WEEKLY_HOUR_CAP = 40;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("employee-actions env vars not configured");
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

// ----------------------------------------------------------------------------
// Email delivery via Resend HTTP API. Best-effort: a send failure never
// fails the user-facing submit, only logs a warning. Same env contract as
// paf.js (RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_FROM_NAME).
// ----------------------------------------------------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME =
  process.env.EMPLOYEE_ACTIONS_FROM_NAME ||
  process.env.RESEND_FROM_NAME ||
  "SOAR Employee Actions";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

async function sendEmailViaResend({ to, subject, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) {
    return { skipped: true };
  }
  if (!RESEND_API_KEY) {
    console.warn("[employee-actions] RESEND_API_KEY not set; skipping send", { subject });
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
      console.warn("[employee-actions] Resend send failed", res.status, detail);
      return { ok: false, status: res.status };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    console.warn("[employee-actions] Resend send threw", e);
    return { ok: false, error: e?.message };
  }
}

// ----------------------------------------------------------------------------
// Sanitizers
// ----------------------------------------------------------------------------
function sanitizeText(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}
function sanitizeDateInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}
function num(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
// "HH:MM" (24h) -> minutes since midnight, or null if malformed.
function parseTimeToMinutes(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "";
}

// ----------------------------------------------------------------------------
// Store scope helpers (mirror paf.js).
// ----------------------------------------------------------------------------
async function resolveVisibleStoreRows(supa, userId) {
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa
    .from("stores")
    .select("id, number, name, district_id, is_active")
    .in("id", ids)
    .eq("is_active", true)
    .order("number");
  return data ?? [];
}

async function resolveVisibleStoreNumbers(supa, userId) {
  const rows = await resolveVisibleStoreRows(supa, userId);
  return rows.map((s) => String(s.number)).filter(Boolean);
}

// Resolve the active profiles holding `role` whose user_scopes row matches
// the given org scope. Returns full profile rows (id, email, names).
async function scopedProfiles(supa, scopeType, scopeId, role) {
  if (!scopeId) return [];
  const { data: candidates } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name")
    .eq("role", role)
    .eq("is_active", true);
  const byId = new Map((candidates ?? []).map((p) => [p.id, p]));
  if (!byId.size) return [];
  const { data: scoped } = await supa
    .from("user_scopes")
    .select("user_id")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .in("user_id", Array.from(byId.keys()));
  const out = [];
  for (const s of scoped ?? []) {
    const p = byId.get(s.user_id);
    if (p) out.push(p);
  }
  return out;
}

// Given a store number, resolve the DO (district scope) and RVP (region
// scope) responsible for it. Same scope-walk org.js findManager() uses.
async function resolveStoreLeadership(supa, storeNumber) {
  const out = { dos: [], sdos: [], rvps: [] };
  const { data: store } = await supa
    .from("stores")
    .select("id, district_id")
    .eq("number", storeNumber)
    .maybeSingle();
  if (!store?.district_id) return out;

  out.dos = await scopedProfiles(supa, "district", store.district_id, "do");

  const { data: district } = await supa
    .from("districts")
    .select("id, area_id")
    .eq("id", store.district_id)
    .maybeSingle();
  if (!district?.area_id) return out;

  out.sdos = await scopedProfiles(supa, "area", district.area_id, "sdo");

  const { data: area } = await supa
    .from("areas")
    .select("id, region_id")
    .eq("id", district.area_id)
    .maybeSingle();
  if (area?.region_id) {
    out.rvps = await scopedProfiles(supa, "region", area.region_id, "rvp");
  }
  return out;
}

// ----------------------------------------------------------------------------
// my-stores — stores the caller can submit an Employee Action for.
// ----------------------------------------------------------------------------
async function listMyStores(supa, user) {
  if (user.role === "admin") {
    const { data } = await supa
      .from("stores")
      .select("id, number, name, district_id, is_active")
      .eq("is_active", true)
      .order("number");
    return { stores: data ?? [] };
  }
  if (!READ_ROLES.has(user.role)) return { stores: [] };
  const rows = await resolveVisibleStoreRows(supa, user.id);
  return { stores: rows };
}

// ----------------------------------------------------------------------------
// list — requests visible to the caller (own + in-scope; org-wide for
// payroll/admin/vp/coo). Read-only history for the Employee Actions page.
// ----------------------------------------------------------------------------
async function listRequests(supa, user) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };

  let numbers = null;
  if (!ORG_WIDE_READ.has(user.role)) {
    numbers = await resolveVisibleStoreNumbers(supa, user.id);
  }

  async function fetchType(table) {
    let q = supa
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (numbers !== null) {
      if (!numbers.length) {
        q = q.eq("submitter_id", user.id);
      } else {
        q = q.in("store_number", numbers);
      }
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  try {
    const [trainingCredits, ptoRequests] = await Promise.all([
      fetchType("training_credit_requests"),
      fetchType("pto_requests"),
    ]);

    // Stamp store names so the UI can render them without a per-row call.
    const distinct = Array.from(
      new Set(
        [...trainingCredits, ...ptoRequests]
          .map((r) => r.store_number)
          .filter(Boolean)
      )
    );
    const nameMap = new Map();
    if (distinct.length) {
      const { data: storeRows } = await supa
        .from("stores")
        .select("number, name")
        .in("number", distinct);
      for (const s of storeRows ?? []) nameMap.set(String(s.number), s.name);
    }
    const stamp = (r) => ({ ...r, store_name: nameMap.get(String(r.store_number)) ?? null });

    return {
      user: { id: user.id, role: user.role, can_submit: SUBMIT_ROLES.has(user.role) },
      trainingCredits: trainingCredits.map(stamp),
      ptoRequests: ptoRequests.map(stamp),
    };
  } catch (e) {
    return { error: e.message, status: 500 };
  }
}

// ----------------------------------------------------------------------------
// Shared submit plumbing: scope check + leadership notify + audit.
// ----------------------------------------------------------------------------
async function assertStoreInScope(supa, user, storeNumber) {
  if (user.role === "admin") return null;
  const numbers = await resolveVisibleStoreNumbers(supa, user.id);
  if (!numbers.includes(storeNumber)) {
    return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  }
  return null;
}

async function logAudit(supa, entry) {
  try {
    const { error } = await supa.from("employee_action_audit_log").insert(entry);
    if (error) console.warn("[employee-actions] audit insert failed", error);
  } catch (e) {
    console.warn("[employee-actions] audit insert threw", e);
  }
}

// Notify the store's DO + RVP (and the submitter if they asked for a copy).
async function notifyLeadership(supa, { storeNumber, sendCopy, submitterEmail, subject, text }) {
  const { dos, rvps } = await resolveStoreLeadership(supa, storeNumber);
  const recipients = new Set();
  for (const p of [...dos, ...rvps]) if (p.email) recipients.add(p.email);
  if (sendCopy && submitterEmail) recipients.add(submitterEmail);
  await sendEmailViaResend({ to: Array.from(recipients), subject, text });
  return { dos, rvps, notified: Array.from(recipients) };
}

// ----------------------------------------------------------------------------
// submit-training
// ----------------------------------------------------------------------------
// Validate + normalize the Training Credit form fields (no DB, no provenance).
// Returns { error, status } or { fields, meta }. Hours + per-day amount + the
// requested total are recomputed server-side so they're authoritative.
function buildTrainingFields(body) {
  const employeeName = sanitizeText(body?.employee_name, 200);
  if (!employeeName) return { error: "Employee Full Name is required.", status: 400 };

  const trainingType = sanitizeText(body?.training_type, 120);
  if (!trainingType) return { error: "Training type is required.", status: 400 };

  const wage = num(body?.hourly_wage);

  const rawDays = Array.isArray(body?.training_days) ? body.training_days : [];
  if (!rawDays.length) {
    return { error: "Add at least one training day with a start and end time.", status: 400 };
  }
  if (rawDays.length > 3) {
    return { error: "Enter at most three training days.", status: 400 };
  }
  const trainingDays = [];
  for (const d of rawDays) {
    const day = sanitizeText(d?.day, 12);
    if (!VALID_TRAINING_DAYS.has(day)) {
      return { error: "Each training day must be a valid day of the week.", status: 400 };
    }
    const startMin = parseTimeToMinutes(d?.start_time);
    const endMin = parseTimeToMinutes(d?.end_time);
    if (startMin == null || endMin == null) {
      return { error: `Enter a start and end time for ${day}.`, status: 400 };
    }
    if (endMin <= startMin) {
      return { error: `${day}: end time must be after the start time.`, status: 400 };
    }
    const hours = round2((endMin - startMin) / 60);
    trainingDays.push({
      day,
      start_time: sanitizeText(d.start_time, 5),
      end_time: sanitizeText(d.end_time, 5),
      hours,
      amount: round2(hours * wage),
    });
  }
  const requestedAmount = round2(trainingDays.reduce((sum, e) => sum + e.amount, 0));
  const trainingOther = sanitizeText(body?.training_other, 500) || null;

  return {
    fields: {
      employee_name: employeeName,
      hourly_wage: wage,
      training_type: trainingType,
      training_other: trainingOther,
      start_date: sanitizeDateInput(body?.start_date),
      requested_amount: requestedAmount,
      training_days: trainingDays,
      send_copy: body?.send_copy === true || body?.send_copy === "true",
    },
    meta: { employeeName, trainingType, trainingOther, wage, requestedAmount, trainingDays },
  };
}

function trainingEmailText(user, storeNumber, fields, meta, link, verb) {
  return (
    `A Training Credit Request was ${verb} by ${displayName(user)}.\n\n` +
    `Store: ${storeNumber}\n` +
    `Employee: ${meta.employeeName}\n` +
    `Training: ${meta.trainingType}${meta.trainingOther ? ` (${meta.trainingOther})` : ""}\n` +
    `Hourly wage: $${meta.wage.toFixed(2)}\n` +
    `Start date: ${fields.start_date ?? "—"}\n\n` +
    `Training days:\n` +
    meta.trainingDays
      .map(
        (e) =>
          `  • ${e.day}: ${e.start_time}–${e.end_time} (${e.hours} hrs) = $${e.amount.toFixed(2)}`
      )
      .join("\n") +
    `\n\nRequested credit (total): $${meta.requestedAmount.toFixed(2)}\n\n` +
    `Review it here: ${link}`
  );
}

async function submitTraining(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "You don't have permission to submit a training credit request.", status: 403 };
  }
  const storeNumber = sanitizeText(body?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const built = buildTrainingFields(body);
  if (built.error) return built;

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    ...built.fields,
    status: "Submitted",
  };

  const { data: created, error } = await supa
    .from("training_credit_requests")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: "training_credit",
    request_id: created.id,
    actor_id: user.id,
    actor_email: user.email,
    action: "submit",
    detail: { store_number: storeNumber, employee_name: built.meta.employeeName, training_type: built.meta.trainingType },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: insertRow.send_copy,
    submitterEmail: user.email,
    subject: `Training Credit Request — ${built.meta.employeeName} (Store ${storeNumber})`,
    text: trainingEmailText(user, storeNumber, built.fields, built.meta, link, "submitted"),
  });

  return { ok: true, id: created.id, status: insertRow.status };
}

// Resubmit a "Changes Requested" training credit after the submitter edits it.
async function updateTraining(supa, user, body) {
  const id = sanitizeText(body?.id, 64);
  if (!id) return { error: "Request id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("training_credit_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Request not found.", status: 404 };
  if (existing.submitter_id !== user.id && user.role !== "admin") {
    return { error: "You can only edit your own request.", status: 403 };
  }
  if (existing.status !== "Changes Requested") {
    return { error: "Only a request sent back for changes can be resubmitted.", status: 409 };
  }

  const storeNumber = sanitizeText(body?.store_number, 20) || existing.store_number;
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const built = buildTrainingFields(body);
  if (built.error) return built;

  const { error } = await supa
    .from("training_credit_requests")
    .update({
      store_number: storeNumber,
      ...built.fields,
      status: "Submitted",
      rejection_reason: null,
      approved_at: null,
      approved_by_id: null,
      approved_by_email: null,
      decision_note: null,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: "training_credit",
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "resubmit",
    detail: { store_number: storeNumber, employee_name: built.meta.employeeName },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: built.fields.send_copy,
    submitterEmail: user.email,
    subject: `Training Credit Resubmitted — ${built.meta.employeeName} (Store ${storeNumber})`,
    text: trainingEmailText(user, storeNumber, built.fields, built.meta, link, "resubmitted after changes"),
  });

  return { ok: true, id, status: "Submitted" };
}

// ----------------------------------------------------------------------------
// submit-pto
// ----------------------------------------------------------------------------
// Validate + normalize the PTO form fields (no DB, no provenance/workflow).
// GM = day-based (no dollar); hourly = hour-based (<= 8/day) with a dollar
// amount and the 40h weekly cap. Returns { error, status } or { fields, meta }.
function buildPtoFields(body) {
  const employeeName = sanitizeText(body?.employee_name, 200);
  if (!employeeName) return { error: "Employee Name is required.", status: 400 };

  const position = sanitizeText(body?.position, 60);
  if (!VALID_POSITIONS.has(position)) {
    return {
      error: "Select a valid position (GM, Associate Manager, or First Assistant).",
      status: 400,
    };
  }
  const sendCopy = body?.send_copy === true || body?.send_copy === "true";

  if (position === "GM") {
    const startDate = sanitizeDateInput(body?.pto_start_date);
    if (!startDate) return { error: "PTO Start Date is required (YYYY-MM-DD).", status: 400 };
    const endDate = sanitizeDateInput(body?.pto_end_date);
    if (!endDate) return { error: "PTO End Date is required (YYYY-MM-DD).", status: 400 };
    if (endDate < startDate) {
      return { error: "PTO End Date cannot be before the Start Date.", status: 400 };
    }
    const daysUsed = num(body?.days_used);
    if (daysUsed <= 0) return { error: "How Many Days PTO Used is required.", status: 400 };

    return {
      fields: {
        employee_name: employeeName,
        position,
        send_copy: sendCopy,
        pto_start_date: startDate,
        pto_end_date: endDate,
        days_used: daysUsed,
        vacation_days: [],
        hourly_wage: null,
        vacation_hours: null,
        hours_worked: null,
        amount: null,
      },
      meta: {
        employeeName,
        position,
        auditDetail: { position, days_used: daysUsed },
        summary:
          `Employee: ${employeeName} (${position})\n` +
          `Dates: ${startDate} → ${endDate}\n` +
          `Days used: ${daysUsed}\n\n`,
      },
    };
  }

  // Hourly positions.
  const wage = num(body?.hourly_wage);
  if (wage <= 0) return { error: "Hourly Wage is required.", status: 400 };

  const rawDays = Array.isArray(body?.vacation_days) ? body.vacation_days : [];
  if (!rawDays.length) return { error: "Add at least one vacation day with hours.", status: 400 };
  const vacationDays = [];
  for (const d of rawDays) {
    const date = sanitizeDateInput(d?.date);
    if (!date) return { error: "Each vacation day needs a valid date.", status: 400 };
    const hours = num(d?.hours);
    if (hours <= 0) return { error: `Enter hours for ${date}.`, status: 400 };
    if (hours > MAX_HOURS_PER_DAY) {
      return { error: `A vacation day can't exceed ${MAX_HOURS_PER_DAY} hours (${date}).`, status: 400 };
    }
    vacationDays.push({ date, hours: round2(hours), amount: round2(hours * wage) });
  }
  const vacationHours = round2(vacationDays.reduce((s, e) => s + e.hours, 0));
  const amount = round2(vacationDays.reduce((s, e) => s + e.amount, 0));
  const hoursWorked = num(body?.hours_worked);
  if (round2(vacationHours + hoursWorked) > WEEKLY_HOUR_CAP) {
    return {
      error: `Vacation (${vacationHours}h) + hours worked (${hoursWorked}h) exceeds the ${WEEKLY_HOUR_CAP}-hour weekly limit.`,
      status: 400,
    };
  }
  const dates = vacationDays.map((e) => e.date).sort();

  return {
    fields: {
      employee_name: employeeName,
      position,
      send_copy: sendCopy,
      pto_start_date: dates[0],
      pto_end_date: dates[dates.length - 1],
      days_used: null,
      hourly_wage: wage,
      vacation_days: vacationDays,
      vacation_hours: vacationHours,
      hours_worked: hoursWorked,
      amount,
    },
    meta: {
      employeeName,
      position,
      auditDetail: { position, vacation_hours: vacationHours, hours_worked: hoursWorked, amount },
      summary:
        `Employee: ${employeeName} (${position})\n` +
        `Hourly wage: $${wage.toFixed(2)}\n` +
        `Vacation days:\n` +
        vacationDays.map((e) => `  • ${e.date}: ${e.hours} hrs = $${e.amount.toFixed(2)}`).join("\n") +
        `\n\nTotal vacation: ${vacationHours} hrs = $${amount.toFixed(2)}\n` +
        `Hours worked this week: ${hoursWorked} hrs\n` +
        `Week total (vacation + worked): ${round2(vacationHours + hoursWorked)} / ${WEEKLY_HOUR_CAP} hrs\n\n`,
    },
  };
}

// A GM's PTO starts at the DO step; anyone DO-or-above submitting skips it
// (their own tier) and lands directly in the SDO/RVP queue.
function ptoWorkflowFields(user) {
  if (user.role !== "gm") {
    return {
      status: "DO Approved",
      do_approved_at: new Date().toISOString(),
      do_approved_by_id: user.id,
      do_note: "Auto — submitter is DO or above",
    };
  }
  return { status: "Submitted", do_approved_at: null, do_approved_by_id: null, do_note: null };
}

async function submitPto(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "You don't have permission to submit a PTO request.", status: 403 };
  }
  const storeNumber = sanitizeText(body?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const built = buildPtoFields(body);
  if (built.error) return built;

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    ...built.fields,
    ...ptoWorkflowFields(user),
  };

  const { data: created, error } = await supa
    .from("pto_requests")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: "pto",
    request_id: created.id,
    actor_id: user.id,
    actor_email: user.email,
    action: "submit",
    detail: { store_number: storeNumber, ...built.meta.auditDetail },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: built.fields.send_copy,
    submitterEmail: user.email,
    subject: `PTO Request — ${built.meta.employeeName} (Store ${storeNumber})`,
    text:
      `A PTO request was submitted by ${displayName(user)}.\n\n` +
      `Store: ${storeNumber}\n${built.meta.summary}Review it here: ${link}`,
  });

  return { ok: true, id: created.id, status: insertRow.status };
}

// Resubmit a "Changes Requested" PTO request after the submitter edits it.
async function updatePto(supa, user, body) {
  const id = sanitizeText(body?.id, 64);
  if (!id) return { error: "Request id is required.", status: 400 };

  const { data: existing, error: fetchErr } = await supa
    .from("pto_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Request not found.", status: 404 };
  if (existing.submitter_id !== user.id && user.role !== "admin") {
    return { error: "You can only edit your own request.", status: 403 };
  }
  if (existing.status !== "Changes Requested") {
    return { error: "Only a request sent back for changes can be resubmitted.", status: 409 };
  }

  const storeNumber = sanitizeText(body?.store_number, 20) || existing.store_number;
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const built = buildPtoFields(body);
  if (built.error) return built;

  const { error } = await supa
    .from("pto_requests")
    .update({
      store_number: storeNumber,
      ...built.fields,
      ...ptoWorkflowFields(user),
      approved_at: null,
      approved_by_id: null,
      approved_by_email: null,
      decision_note: null,
      rejection_reason: null,
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: "pto",
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "resubmit",
    detail: { store_number: storeNumber, ...built.meta.auditDetail },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: built.fields.send_copy,
    submitterEmail: user.email,
    subject: `PTO Resubmitted — ${built.meta.employeeName} (Store ${storeNumber})`,
    text:
      `A PTO request was resubmitted after changes by ${displayName(user)}.\n\n` +
      `Store: ${storeNumber}\n${built.meta.summary}Review it here: ${link}`,
  });

  return { ok: true, id, status: "Submitted" };
}

// ----------------------------------------------------------------------------
// Approval workflow
// ----------------------------------------------------------------------------
const REQUEST_TABLE = {
  training: "training_credit_requests",
  pto: "pto_requests",
};
const AUDIT_TYPE = {
  training: "training_credit",
  pto: "pto",
};

// Which roles may act on a request at its current status, or null if the
// status is terminal / not awaiting an approver.
function pendingActorRoles(type, status) {
  if (type === "training") {
    return status === "Submitted" ? new Set(["sdo", "rvp", "admin"]) : null;
  }
  // pto
  if (status === "Submitted") return new Set(["do", "admin"]);
  if (status === "DO Approved") return new Set(["sdo", "rvp", "admin"]);
  return null;
}

// queue — requests awaiting the caller's approval (own submissions excluded).
async function listQueue(supa, user) {
  if (!APPROVER_ROLES.has(user.role)) {
    return { user: { id: user.id, role: user.role }, trainingCredits: [], ptoRequests: [] };
  }
  const numbers = user.role === "admin" ? null : await resolveVisibleStoreNumbers(supa, user.id);

  async function fetchPending(type, statuses) {
    let q = supa.from(REQUEST_TABLE[type]).select("*").in("status", statuses).limit(500);
    if (numbers !== null) {
      if (!numbers.length) return [];
      q = q.in("store_number", numbers);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).filter((r) => {
      if (r.submitter_id === user.id) return false; // no self-approval
      const allowed = pendingActorRoles(type, r.status);
      return allowed != null && allowed.has(user.role);
    });
  }

  try {
    const [training, pto] = await Promise.all([
      fetchPending("training", ["Submitted"]),
      fetchPending("pto", ["Submitted", "DO Approved"]),
    ]);
    const distinct = Array.from(
      new Set([...training, ...pto].map((r) => r.store_number).filter(Boolean))
    );
    const nameMap = new Map();
    if (distinct.length) {
      const { data: storeRows } = await supa
        .from("stores")
        .select("number, name")
        .in("number", distinct);
      for (const s of storeRows ?? []) nameMap.set(String(s.number), s.name);
    }
    const stamp = (r) => ({ ...r, store_name: nameMap.get(String(r.store_number)) ?? null });
    return {
      user: { id: user.id, role: user.role },
      trainingCredits: training.map(stamp),
      ptoRequests: pto.map(stamp),
    };
  } catch (e) {
    return { error: e.message, status: 500 };
  }
}

// decide — approve or reject the current step. First action wins (conditional
// update on the existing status guards the two-approvers-at-once race).
async function decide(supa, user, body) {
  const type = sanitizeText(body?.type, 20);
  const table = REQUEST_TABLE[type];
  if (!table) return { error: "Unknown request type.", status: 400 };
  const id = sanitizeText(body?.id, 64);
  if (!id) return { error: "Request id is required.", status: 400 };
  const action = sanitizeText(body?.action, 12);
  if (action !== "approve" && action !== "reject") {
    return { error: "action must be 'approve' or 'reject'.", status: 400 };
  }
  const note = sanitizeText(body?.note, 2000);

  const { data: existing, error: fetchErr } = await supa
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Request not found.", status: 404 };

  if (existing.submitter_id === user.id) {
    return { error: "You can't approve your own request.", status: 403 };
  }
  const allowed = pendingActorRoles(type, existing.status);
  if (!allowed) {
    return { error: `This request is ${existing.status} and can't be actioned.`, status: 409 };
  }
  if (!allowed.has(user.role)) {
    return { error: "This step isn't yours to approve.", status: 403 };
  }
  const scopeErr = await assertStoreInScope(supa, user, existing.store_number);
  if (scopeErr) return scopeErr;

  const employeeName = existing.employee_name ?? existing.gm_name ?? "employee";
  const link = `${appBaseUrl()}/employee-actions`;
  const nowIso = new Date().toISOString();

  // Apply the transition with a status guard so a racing approver loses.
  async function transition(patch, fromStatus) {
    const { data, error } = await supa
      .from(table)
      .update(patch)
      .eq("id", id)
      .eq("status", fromStatus)
      .select("id")
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "This request was just updated by someone else.", status: 409 };
    return null;
  }

  if (action === "reject") {
    if (!note) return { error: "A reason is required to send it back.", status: 400 };
    const err = await transition(
      { status: "Changes Requested", rejection_reason: note },
      existing.status
    );
    if (err) return err;
    await logAudit(supa, {
      request_type: AUDIT_TYPE[type],
      request_id: id,
      actor_id: user.id,
      actor_email: user.email,
      action: "reject",
      detail: { from: existing.status, reason: note },
    });
    await sendEmailViaResend({
      to: existing.submitter_email,
      subject: `Changes requested — ${employeeName} (Store ${existing.store_number})`,
      text:
        `${displayName(user)} sent your request back for changes.\n\n` +
        `Reason: ${note}\n\n` +
        `Edit and resubmit here: ${link}`,
    });
    return { ok: true, status: "Changes Requested" };
  }

  // approve
  if (type === "training") {
    const err = await transition(
      {
        status: "Approved",
        approved_at: nowIso,
        approved_by_id: user.id,
        approved_by_email: user.email,
        decision_note: note || null,
      },
      existing.status
    );
    if (err) return err;
    await logAudit(supa, {
      request_type: AUDIT_TYPE.training,
      request_id: id,
      actor_id: user.id,
      actor_email: user.email,
      action: "approve",
      detail: { note: note || null },
    });
    await sendEmailViaResend({
      to: existing.submitter_email,
      subject: `Training credit approved — ${employeeName} (Store ${existing.store_number})`,
      text:
        `${displayName(user)} approved the training credit request.\n\n` +
        `View it here: ${link}`,
    });
    return { ok: true, status: "Approved" };
  }

  // pto
  if (existing.status === "Submitted") {
    // DO step → moves to the SDO/RVP queue.
    const err = await transition(
      {
        status: "DO Approved",
        do_approved_at: nowIso,
        do_approved_by_id: user.id,
        do_note: note || null,
      },
      existing.status
    );
    if (err) return err;
    await logAudit(supa, {
      request_type: AUDIT_TYPE.pto,
      request_id: id,
      actor_id: user.id,
      actor_email: user.email,
      action: "do-approve",
      detail: { note: note || null },
    });
    const { sdos, rvps } = await resolveStoreLeadership(supa, existing.store_number);
    const to = Array.from(
      new Set([...sdos, ...rvps].map((p) => p.email).filter(Boolean))
    );
    await sendEmailViaResend({
      to,
      subject: `PTO needs your approval — ${employeeName} (Store ${existing.store_number})`,
      text:
        `${displayName(user)} (DO) approved a PTO request. It now needs SDO/RVP approval.\n\n` +
        `Employee: ${employeeName}\nStore: ${existing.store_number}\n` +
        `Dates: ${existing.pto_start_date} → ${existing.pto_end_date}\n\n` +
        `Review it here: ${link}`,
    });
    return { ok: true, status: "DO Approved" };
  }

  // pto final step (status === "DO Approved")
  const err = await transition(
    {
      status: "Approved",
      approved_at: nowIso,
      approved_by_id: user.id,
      approved_by_email: user.email,
      decision_note: note || null,
    },
    existing.status
  );
  if (err) return err;
  await logAudit(supa, {
    request_type: AUDIT_TYPE.pto,
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "approve",
    detail: { note: note || null },
  });
  await sendEmailViaResend({
    to: existing.submitter_email,
    subject: `PTO approved — ${employeeName} (Store ${existing.store_number})`,
    text: `${displayName(user)} approved the PTO request.\n\nView it here: ${link}`,
  });
  return { ok: true, status: "Approved" };
}

// ----------------------------------------------------------------------------
// delete (admin only)
// ----------------------------------------------------------------------------
async function deleteRequest(supa, user, body) {
  if (user.role !== "admin") {
    return { error: "Only an admin can delete requests.", status: 403 };
  }
  const type = sanitizeText(body?.type, 20);
  const id = sanitizeText(body?.id, 64);
  if (!id) return { error: "Request id is required.", status: 400 };
  const table =
    type === "training"
      ? "training_credit_requests"
      : type === "pto"
        ? "pto_requests"
        : null;
  if (!table) return { error: "Unknown request type.", status: 400 };

  const { error } = await supa.from(table).delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: type,
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "delete",
    detail: {},
  });

  return { ok: true };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------
function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
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

    let user;
    try {
      user = await getSessionUser(event);
    } catch (e) {
      return respond(500, { error: e.message || "auth failed" });
    }
    if (!user) return respond(401, { error: "unauthorized" });

    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listRequests(supa, user));
      if (action === "queue") return unwrap(await listQueue(supa, user));
      if (action === "my-stores") return unwrap(await listMyStores(supa, user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "submit-training") return unwrap(await submitTraining(supa, user, body));
      if (action === "submit-pto") return unwrap(await submitPto(supa, user, body));
      if (action === "update-training") return unwrap(await updateTraining(supa, user, body));
      if (action === "update-pto") return unwrap(await updatePto(supa, user, body));
      if (action === "decide") return unwrap(await decide(supa, user, body));
      if (action === "delete") return unwrap(await deleteRequest(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
