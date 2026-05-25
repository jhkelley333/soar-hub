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

const VALID_TRAINING_DAYS = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

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
  const out = { dos: [], rvps: [] };
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
async function submitTraining(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "You don't have permission to submit a training credit request.", status: 403 };
  }

  const storeNumber = sanitizeText(body?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const employeeName = sanitizeText(body?.employee_name, 200);
  if (!employeeName) return { error: "Employee Full Name is required.", status: 400 };

  const trainingType = sanitizeText(body?.training_type, 120);
  if (!trainingType) return { error: "Training type is required.", status: 400 };

  const wage = num(body?.hourly_wage);

  // First three training days: each entry carries its own start/end time.
  // Hours and amount are recomputed server-side ((end - start) hours x wage)
  // so the stored per-day amounts + total are authoritative regardless of
  // what the client sent.
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
  const requestedAmount = round2(
    trainingDays.reduce((sum, e) => sum + e.amount, 0)
  );

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    employee_name: employeeName,
    hourly_wage: wage,
    training_type: trainingType,
    training_other: sanitizeText(body?.training_other, 500) || null,
    start_date: sanitizeDateInput(body?.start_date),
    requested_amount: requestedAmount,
    training_days: trainingDays,
    send_copy: body?.send_copy === true || body?.send_copy === "true",
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
    detail: { store_number: storeNumber, employee_name: employeeName, training_type: trainingType },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: insertRow.send_copy,
    submitterEmail: user.email,
    subject: `Training Credit Request — ${employeeName} (Store ${storeNumber})`,
    text:
      `A Training Credit Request was submitted by ${displayName(user)}.\n\n` +
      `Store: ${storeNumber}\n` +
      `Employee: ${employeeName}\n` +
      `Training: ${trainingType}${insertRow.training_other ? ` (${insertRow.training_other})` : ""}\n` +
      `Hourly wage: $${wage.toFixed(2)}\n` +
      `Start date: ${insertRow.start_date ?? "—"}\n\n` +
      `Training days:\n` +
      trainingDays
        .map(
          (e) =>
            `  • ${e.day}: ${e.start_time}–${e.end_time} (${e.hours} hrs) = $${e.amount.toFixed(2)}`
        )
        .join("\n") +
      `\n\nRequested credit (total): $${requestedAmount.toFixed(2)}\n\n` +
      `Review it here: ${link}`,
  });

  return { ok: true, id: created.id, status: insertRow.status };
}

// ----------------------------------------------------------------------------
// submit-pto
// ----------------------------------------------------------------------------
async function submitPto(supa, user, body) {
  if (!SUBMIT_ROLES.has(user.role)) {
    return { error: "You don't have permission to submit a PTO request.", status: 403 };
  }

  const storeNumber = sanitizeText(body?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const gmName = sanitizeText(body?.gm_name, 200);
  if (!gmName) return { error: "GM Name is required.", status: 400 };

  const startDate = sanitizeDateInput(body?.pto_start_date);
  if (!startDate) return { error: "PTO Start Date is required (YYYY-MM-DD).", status: 400 };
  const endDate = sanitizeDateInput(body?.pto_end_date);
  if (!endDate) return { error: "PTO End Date is required (YYYY-MM-DD).", status: 400 };
  if (endDate < startDate) {
    return { error: "PTO End Date cannot be before the Start Date.", status: 400 };
  }

  const daysUsed = num(body?.days_used);
  if (daysUsed <= 0) return { error: "How Many Days PTO Used is required.", status: 400 };

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    gm_name: gmName,
    pto_start_date: startDate,
    pto_end_date: endDate,
    days_used: daysUsed,
    send_copy: body?.send_copy === true || body?.send_copy === "true",
    status: "Submitted",
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
    detail: { store_number: storeNumber, gm_name: gmName, days_used: daysUsed },
  });

  const link = `${appBaseUrl()}/employee-actions`;
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: insertRow.send_copy,
    submitterEmail: user.email,
    subject: `PTO Request — ${gmName} (Store ${storeNumber})`,
    text:
      `A PTO request was submitted by ${displayName(user)}.\n\n` +
      `Store: ${storeNumber}\n` +
      `GM: ${gmName}\n` +
      `Dates: ${startDate} → ${endDate}\n` +
      `Days used: ${daysUsed}\n\n` +
      `Review it here: ${link}`,
  });

  return { ok: true, id: created.id, status: insertRow.status };
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
      if (action === "my-stores") return unwrap(await listMyStores(supa, user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "submit-training") return unwrap(await submitTraining(supa, user, body));
      if (action === "submit-pto") return unwrap(await submitPto(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
