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
// Role tiers for approver escalation (training: DO within bank, RVP over bank).
const ROLE_RANK = { gm: 1, do: 2, sdo: 3, rvp: 4, vp: 5, coo: 6, admin: 7 };
const rankOf = (role) => ROLE_RANK[String(role || "").toLowerCase()] ?? 0;
// Finished states — can't be corrected or withdrawn.
const TERMINAL_STATUSES = new Set(["Completed", "Closed", "Withdrawn"]);

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

// (The DO weekly-sheet + closeout-form steps were retired — training now
// flows from TotZone, so approval is the final step.)

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
  const nowIso = new Date().toISOString();
  // Who covers this scope: primary holders (user_scopes) plus acting coverers
  // (additional_scopes, non-expired). Primary counts only if their role
  // matches the tier; acting coverers count regardless of primary role (an
  // RVP covering an area is a valid acting SDO escalation target).
  const [{ data: primaryScoped }, { data: actingScoped }] = await Promise.all([
    supa.from("user_scopes").select("user_id").eq("scope_type", scopeType).eq("scope_id", scopeId),
    supa.from("additional_scopes").select("user_id, expires_at").eq("scope_type", scopeType).eq("scope_id", scopeId),
  ]);
  const activeActing = (actingScoped ?? []).filter((r) => !r.expires_at || r.expires_at > nowIso);
  const ids = Array.from(
    new Set([
      ...(primaryScoped ?? []).map((s) => s.user_id),
      ...activeActing.map((s) => s.user_id),
    ])
  );
  if (!ids.length) return [];
  const { data: profiles } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role")
    .in("id", ids)
    .eq("is_active", true);
  const primaryIds = new Set((primaryScoped ?? []).map((s) => s.user_id));
  const actingIds = new Set(activeActing.map((s) => s.user_id));
  const out = [];
  for (const p of profiles ?? []) {
    const primaryMatch = primaryIds.has(p.id) && p.role === role;
    if (primaryMatch || actingIds.has(p.id)) {
      out.push({ id: p.id, email: p.email, full_name: p.full_name, preferred_name: p.preferred_name });
    }
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
    if (endMin === startMin) {
      return { error: `${day}: end time can't be the same as the start time.`, status: 400 };
    }
    // Wrap past midnight when end is earlier than start (e.g. 22:00 → 02:00 is
    // a four-hour overnight shift, not invalid). Caps at 24h since anything
    // longer would lap the start, which is implausible for training.
    let span = endMin - startMin;
    if (span < 0) span += 24 * 60;
    if (span > 16 * 60) {
      return { error: `${day}: that's over 16 hours — double-check the times.`, status: 400 };
    }
    const hours = round2(span / 60);
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

  const lastDayDate = sanitizeDateInput(body?.last_day_date);
  if (!lastDayDate) {
    return { error: "Last Training Day date is required.", status: 400 };
  }

  return {
    fields: {
      employee_name: employeeName,
      hourly_wage: wage,
      training_type: trainingType,
      training_other: trainingOther,
      start_date: sanitizeDateInput(body?.start_date),
      last_day_date: lastDayDate,
      requested_amount: requestedAmount,
      training_days: trainingDays,
      send_copy: body?.send_copy === true || body?.send_copy === "true",
    },
    meta: { employeeName, trainingType, trainingOther, wage, requestedAmount, trainingDays, lastDayDate },
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

// Training credit approval: DO approves within the store's bank; RVP approves
// when the request is over bank. Approval is the FINAL step — it lands
// "Completed" and the labor credit applies (loadTrainingCreditDates keys off
// approved_at). A submitter who already clears the required tier auto-approves
// their own request (they outrank every approver below them).
function trainingWorkflowFields(user, overBank) {
  const neededRank = overBank ? ROLE_RANK.rvp : ROLE_RANK.do;
  if (rankOf(user.role) >= neededRank) {
    const now = new Date().toISOString();
    return {
      status: "Completed",
      approved_at: now,
      approved_by_id: user.id,
      approved_by_email: user.email,
      decision_note: "Auto — submitter clears the approval tier",
    };
  }
  return { status: "Submitted" };
}

// ----------------------------------------------------------------------------
// Training credit bank — every store gets a yearly budget (default 2000.00)
// that requests draw down. A request counts against the year of its start
// date (falling back to submission date) unless it is Rejected/Withdrawn.
// training_credit_adjustments is the manual ledger: positive amount = use
// recorded by hand (historical backfill), negative = credit given back.
// ----------------------------------------------------------------------------
const DEFAULT_TRAINING_BUDGET = 2000;
const CREDIT_DEAD_STATUSES = new Set(["Rejected", "Withdrawn"]);
const creditYearOf = (r) =>
  parseInt(String(r.start_date || r.created_at || "").slice(0, 4), 10) || new Date().getFullYear();

// Aggregate usage for a set of store numbers in one year.
// → Map(store_number → { budget, used_requests, used_adjustments })
async function creditUsage(supa, numbers, year) {
  const usage = new Map();
  const get = (n) => {
    if (!usage.has(n)) usage.set(n, { budget: DEFAULT_TRAINING_BUDGET, used_requests: 0, used_adjustments: 0 });
    return usage.get(n);
  };
  const { data: reqs } = await supa
    .from("training_credit_requests")
    .select("store_number, requested_amount, status, start_date, created_at")
    .in("store_number", numbers)
    .limit(10000);
  for (const r of reqs ?? []) {
    if (CREDIT_DEAD_STATUSES.has(r.status)) continue;
    if (creditYearOf(r) !== year) continue;
    get(String(r.store_number)).used_requests += Number(r.requested_amount) || 0;
  }
  // Best-effort before migration 0229 — the bank tables may not exist yet.
  const { data: adjs } = await supa
    .from("training_credit_adjustments")
    .select("store_number, amount")
    .in("store_number", numbers).eq("year", year).limit(5000);
  for (const a of adjs ?? []) get(String(a.store_number)).used_adjustments += Number(a.amount) || 0;
  const { data: buds } = await supa
    .from("training_credit_budgets")
    .select("store_number, budget")
    .in("store_number", numbers).eq("year", year);
  for (const b of buds ?? []) get(String(b.store_number)).budget = Number(b.budget) || DEFAULT_TRAINING_BUDGET;
  return usage;
}

async function creditBalanceFor(supa, storeNumber, year) {
  const usage = await creditUsage(supa, [String(storeNumber)], year);
  const u = usage.get(String(storeNumber)) ?? { budget: DEFAULT_TRAINING_BUDGET, used_requests: 0, used_adjustments: 0 };
  const used = round2(u.used_requests + u.used_adjustments);
  return { year, budget: round2(u.budget), used, remaining: round2(u.budget - used) };
}

// Stores the caller's register covers (admin/org-wide read: every store).
async function creditStoresFor(supa, user) {
  if (user.role === "admin" || ORG_WIDE_READ.has(user.role)) {
    const { data } = await supa.from("stores").select("number, name").eq("is_active", true).order("number");
    return (data ?? []).map((s) => ({ number: String(s.number), name: s.name ?? null }));
  }
  const rows = await resolveVisibleStoreRows(supa, user.id);
  return rows.map((s) => ({ number: String(s.number), name: s.name ?? null }));
}

async function creditRegister(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const year = parseInt(params?.year, 10) || new Date().getFullYear();
  const stores = await creditStoresFor(supa, user);
  const canAdjust = CREDIT_ADJUST_ROLES.has(user.role);
  if (!stores.length) return { year, default_budget: DEFAULT_TRAINING_BUDGET, can_adjust: canAdjust, can_budget: user.role === "admin", rows: [] };
  const usage = await creditUsage(supa, stores.map((s) => s.number), year);
  return {
    year,
    default_budget: DEFAULT_TRAINING_BUDGET,
    can_adjust: canAdjust,
    can_budget: user.role === "admin",
    rows: stores.map((s) => {
      const u = usage.get(s.number) ?? { budget: DEFAULT_TRAINING_BUDGET, used_requests: 0, used_adjustments: 0 };
      const used = round2(u.used_requests + u.used_adjustments);
      return {
        store_number: s.number,
        store_name: s.name,
        budget: round2(u.budget),
        used_requests: round2(u.used_requests),
        used_adjustments: round2(u.used_adjustments),
        used,
        remaining: round2(u.budget - used),
      };
    }),
  };
}

async function creditBalance(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = sanitizeText(params?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;
  const year = parseInt(params?.year, 10) || new Date().getFullYear();
  return creditBalanceFor(supa, storeNumber, year);
}

async function creditLedger(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = sanitizeText(params?.store_number, 20);
  if (!storeNumber) return { error: "Store is required.", status: 400 };
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;
  const year = parseInt(params?.year, 10) || new Date().getFullYear();
  const { data: reqs } = await supa
    .from("training_credit_requests")
    .select("id, employee_name, training_type, requested_amount, status, start_date, created_at")
    .eq("store_number", storeNumber)
    .order("created_at", { ascending: false }).limit(500);
  const requests = (reqs ?? [])
    .filter((r) => !CREDIT_DEAD_STATUSES.has(r.status) && creditYearOf(r) === year);
  const { data: adjs } = await supa
    .from("training_credit_adjustments")
    .select("id, amount, note, created_at")
    .eq("store_number", storeNumber).eq("year", year)
    .order("created_at", { ascending: false }).limit(200);
  return { year, requests, adjustments: adjs ?? [] };
}

// DO and above record adjustments for stores in their own scope — each
// market's leaders enter their own historical spend. Admin reaches every
// store; budget overrides stay admin-only.
const CREDIT_ADJUST_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
// ── PTO report — per-employee quarterly usage vs the allowance ───────────────
// One row per (employee, store, position) for the year: Q1..Q4 usage (GM in
// days, hourly in hours; dated vacation_days land in their own quarter,
// legacy day-count rows land in the start date's quarter), the total, and
// the quarterly allowance for coloring.
async function ptoReport(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const year = parseInt(params?.year, 10) || new Date().getFullYear();
  let numbers = null;
  if (!ORG_WIDE_READ.has(user.role)) {
    numbers = await resolveVisibleStoreNumbers(supa, user.id);
    if (!numbers.length) return { year, gm_quota_days: PTO_QUOTA_GM_DAYS, hourly_quota_hours: PTO_QUOTA_HOURLY_HOURS, rows: [] };
  }
  let q = supa.from("pto_requests").select("*")
    .gte("pto_start_date", `${year}-01-01`).lte("pto_start_date", `${year}-12-31`)
    .limit(5000);
  if (numbers) q = q.in("store_number", numbers);
  const { data } = await q;

  const byKey = new Map();
  for (const r of data || []) {
    if (PTO_DEAD_STATUSES.has(r.status)) continue;
    const isGm = r.position === "GM";
    const key = `${String(r.employee_name || "").toLowerCase()}|${r.store_number}|${r.position}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        employee_name: r.employee_name, store_number: String(r.store_number), position: r.position,
        unit: isGm ? "days" : "hours", quarters: [0, 0, 0, 0], total: 0, pending: 0, over_quota_requests: 0,
      });
    }
    const row = byKey.get(key);
    const dated = Array.isArray(r.vacation_days) ? r.vacation_days.filter((d) => d && d.date) : [];
    if (dated.length) {
      for (const d of dated) {
        if (+String(d.date).slice(0, 4) !== year) continue;
        const qi = Math.floor((+String(d.date).slice(5, 7) - 1) / 3);
        row.quarters[qi] += isGm ? 1 : num(d.hours);
      }
    } else {
      const qi = Math.floor((+String(r.pto_start_date).slice(5, 7) - 1) / 3);
      row.quarters[qi] += isGm ? num(r.days_used) : num(r.vacation_hours);
    }
    row.total = round2(row.quarters.reduce((a, b) => a + b, 0));
    if (!r.approved_at) row.pending += 1;
    if (r.over_quota) row.over_quota_requests += 1;
  }
  const rows = [...byKey.values()].map((r) => ({
    ...r,
    quarters: r.quarters.map(round2),
    quota: r.unit === "days" ? PTO_QUOTA_GM_DAYS : PTO_QUOTA_HOURLY_HOURS,
  })).sort((a, b) => b.total - a.total);
  return { year, gm_quota_days: PTO_QUOTA_GM_DAYS, hourly_quota_hours: PTO_QUOTA_HOURLY_HOURS, rows };
}

// GM PTO daily labor credit rate (ea_settings) — read for display, admin set.
async function gmPtoRateGet(supa, user) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  try {
    const { data } = await supa.from("ea_settings")
      .select("value").eq("key", "gm_pto_daily_credit").maybeSingle();
    const amt = Number(data?.value?.amount);
    return { amount: isFinite(amt) && amt > 0 ? round2(amt) : 176 };
  } catch { return { amount: 176 }; }
}

async function gmPtoRateSet(supa, user, body) {
  if (user.role !== "admin") return { error: "Admins only.", status: 403 };
  const amount = round2(num(body?.amount));
  if (amount <= 0 || amount > 10000) return { error: "Enter a daily amount above $0.", status: 400 };
  const { error } = await supa.from("ea_settings").upsert(
    { key: "gm_pto_daily_credit", value: { amount }, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, amount };
}

async function creditAdjust(supa, user, body) {
  if (!CREDIT_ADJUST_ROLES.has(user.role)) return { error: "DO and above can record adjustments.", status: 403 };
  const storeNumber = sanitizeText(body?.store_number, 20);
  const year = parseInt(body?.year, 10);
  const amount = round2(num(body?.amount));
  const note = sanitizeText(body?.note, 300) || null;
  if (!storeNumber || !year) return { error: "Store and year are required.", status: 400 };
  if (!amount || Math.abs(amount) > 100000) return { error: "Enter a non-zero amount.", status: 400 };
  if (user.role !== "admin") {
    const scopeErr = await assertStoreInScope(supa, user, storeNumber);
    if (scopeErr) return scopeErr;
  }
  const { error } = await supa
    .from("training_credit_adjustments")
    .insert({ store_number: storeNumber, year, amount, note, created_by: user.id });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, balance: await creditBalanceFor(supa, storeNumber, year) };
}

async function creditBudgetSet(supa, user, body) {
  if (user.role !== "admin") return { error: "Admins only.", status: 403 };
  const storeNumber = sanitizeText(body?.store_number, 20);
  const year = parseInt(body?.year, 10);
  const budget = round2(num(body?.budget));
  if (!storeNumber || !year) return { error: "Store and year are required.", status: 400 };
  if (budget < 0 || budget > 1000000) return { error: "Enter a budget of $0 or more.", status: 400 };
  const { error } = await supa
    .from("training_credit_budgets")
    .upsert({ store_number: storeNumber, year, budget, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "store_number,year" });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, balance: await creditBalanceFor(supa, storeNumber, year) };
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

  // The bank no longer blocks a request that overdraws the store's yearly
  // credit — it escalates approval from the DO to the RVP instead.
  const year = creditYearOf({ start_date: built.fields.start_date });
  const bal = await creditBalanceFor(supa, storeNumber, year);
  const overBank = built.meta.requestedAmount > bal.remaining + 0.005;

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    ...built.fields,
    over_bank: overBank,
    ...trainingWorkflowFields(user, overBank),
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
    text: trainingEmailText(user, storeNumber, built.fields, built.meta, link, "submitted")
      + (overBank ? `\n\n⚠ Over the store's training bank ($${bal.remaining.toFixed(2)} left of $${bal.budget.toFixed(2)}) — this needs RVP approval.` : ""),
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

  // Two edit paths share this endpoint:
  //   • the submitter (a GM) fixing a request that was sent back ("Changes
  //     Requested"), and
  //   • a DO and above directly CORRECTING an in-flight request (e.g. a wrong
  //     store #). A correction resets the request to "Submitted" below, so it
  //     re-runs the approval chain — chosen behavior for material edits.
  const isApprover = APPROVER_ROLES.has(user.role);
  const isOwner = existing.submitter_id === user.id;
  if (!isOwner && !isApprover) {
    return { error: "Only the submitter, or a DO and above, can edit this request.", status: 403 };
  }
  if (TERMINAL_STATUSES.has(existing.status)) {
    return { error: `A ${existing.status} request can't be edited.`, status: 409 };
  }
  if (!isApprover && existing.status !== "Changes Requested") {
    return { error: "Only a request sent back for changes can be resubmitted.", status: 409 };
  }
  // A DO+ correcting must also have scope over the request's current store,
  // not just the (possibly new) store they're moving it to.
  const curScopeErr = await assertStoreInScope(supa, user, existing.store_number);
  if (curScopeErr) return curScopeErr;
  const isCorrection = isApprover && existing.status !== "Changes Requested";

  const storeNumber = sanitizeText(body?.store_number, 20) || existing.store_number;
  const scopeErr = await assertStoreInScope(supa, user, storeNumber);
  if (scopeErr) return scopeErr;

  const built = buildTrainingFields(body);
  if (built.error) return built;

  // Bank check — the request's own current amount goes back into the pool
  // before testing the new total (same store + year only).
  const newYear = creditYearOf({ start_date: built.fields.start_date });
  const bal = await creditBalanceFor(supa, storeNumber, newYear);
  const giveBack = String(existing.store_number) === String(storeNumber) && creditYearOf(existing) === newYear
    ? Number(existing.requested_amount) || 0 : 0;
  // Over bank re-routes to RVP approval (no longer blocked); recompute the flag.
  const overBank = built.meta.requestedAmount > bal.remaining + giveBack + 0.005;

  const { error } = await supa
    .from("training_credit_requests")
    .update({
      store_number: storeNumber,
      ...built.fields,
      over_bank: overBank,
      rejection_reason: null,
      approved_at: null,
      approved_by_id: null,
      approved_by_email: null,
      decision_note: null,
      ...trainingWorkflowFields(user, overBank),
    })
    .eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: "training_credit",
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: isCorrection ? "correct" : "resubmit",
    detail: {
      store_number: storeNumber,
      employee_name: built.meta.employeeName,
      from_status: existing.status,
      ...(existing.store_number !== storeNumber ? { prev_store_number: existing.store_number } : {}),
    },
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
    // GMs pick the exact days they'll be out (gm_days) — those dates drive
    // the labor credit (each approved day credits the store's chart, like
    // training credit). Legacy start/end + count still accepted from old
    // clients.
    const rawGmDays = Array.isArray(body?.gm_days) ? body.gm_days : [];
    const gmDays = [...new Set(rawGmDays.map((d) => sanitizeDateInput(d)).filter(Boolean))].sort();
    if (gmDays.length) {
      if (gmDays.length > 31) {
        return { error: "That's more than 31 PTO days — double-check the dates.", status: 400 };
      }
      return {
        fields: {
          employee_name: employeeName,
          position,
          send_copy: sendCopy,
          pto_start_date: gmDays[0],
          pto_end_date: gmDays[gmDays.length - 1],
          days_used: gmDays.length,
          vacation_days: gmDays.map((date) => ({ date })),
          hourly_wage: null,
          vacation_hours: null,
          hours_worked: null,
          amount: null,
        },
        meta: {
          employeeName,
          position,
          auditDetail: { position, days_used: gmDays.length, days: gmDays },
          summary:
            `Employee: ${employeeName} (${position})\n` +
            `Days out (${gmDays.length}): ${gmDays.join(", ")}\n` +
            `Once fully approved, each day credits the store's labor chart.\n\n`,
        },
      };
    }

    const startDate = sanitizeDateInput(body?.pto_start_date);
    if (!startDate) return { error: "Add the days you'll be out.", status: 400 };
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

// PTO approval tiers: DO, then SDO/RVP. A submitter clears every tier they
// outrank-or-equal (they can't approve their own, so anything left at their
// tier would dead-end):
//   GM       → Submitted        (DO approves, then SDO/RVP)
//   DO       → DO Approved      (skips DO tier; SDO/RVP approves)
//   SDO/RVP+ → SDO/RVP Approved (skips both tiers; a DO files the PAF next)
function ptoWorkflowFields(user) {
  const now = new Date().toISOString();
  const isApprover = user.role === "sdo" || user.role === "rvp" || user.role === "admin";
  if (isApprover) {
    return {
      status: "SDO/RVP Approved",
      do_approved_at: now,
      do_approved_by_id: user.id,
      do_note: "Auto — submitter is SDO/RVP or above",
      approved_at: now,
      approved_by_id: user.id,
      approved_by_email: user.email,
      decision_note: "Auto — submitter is SDO/RVP or above",
    };
  }
  if (user.role !== "gm") {
    return {
      status: "DO Approved",
      do_approved_at: now,
      do_approved_by_id: user.id,
      do_note: "Auto — submitter is DO or above",
    };
  }
  return { status: "Submitted", do_approved_at: null, do_approved_by_id: null, do_note: null };
}

// Vacation allowance: one week per calendar quarter through the normal flow
// (GM: 5 days, hourly: 40 hours). A request that pushes the employee over is
// stamped over_quota and its final approval is restricted to RVP/admin.
const PTO_QUOTA_GM_DAYS = 5;
const PTO_QUOTA_HOURLY_HOURS = 40;
const PTO_DEAD_STATUSES = new Set(["Rejected", "Withdrawn", "Changes Requested"]);

function quarterRange(dateIso) {
  const y = +String(dateIso).slice(0, 4);
  const m = +String(dateIso).slice(5, 7);
  const q = Math.floor((m - 1) / 3);
  const endMonth = q * 3 + 3;
  return {
    start: `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`,
    end: `${y}-${String(endMonth).padStart(2, "0")}-${endMonth === 6 || endMonth === 9 ? 30 : 31}`,
    label: `Q${q + 1} ${y}`,
  };
}

// Does this request push the employee over the quarterly allowance?
// Prior use = the employee's other live requests whose start date falls in
// the same quarter as this request's first day out.
async function ptoOverQuota(supa, fields, excludeId = null) {
  const isGm = fields.position === "GM";
  const first = ((fields.vacation_days ?? []).map((d) => d.date).filter(Boolean).sort()[0]) || fields.pto_start_date;
  if (!first) return { over: false };
  const q = quarterRange(first);
  const { data } = await supa
    .from("pto_requests")
    .select("id, position, days_used, vacation_hours, status")
    .ilike("employee_name", fields.employee_name)
    .eq("position", fields.position)
    .gte("pto_start_date", q.start)
    .lte("pto_start_date", q.end)
    .limit(200);
  let prior = 0;
  for (const r of data || []) {
    if (r.id === excludeId || PTO_DEAD_STATUSES.has(r.status)) continue;
    prior += isGm ? num(r.days_used) : num(r.vacation_hours);
  }
  const requested = isGm ? num(fields.days_used) : num(fields.vacation_hours);
  const quota = isGm ? PTO_QUOTA_GM_DAYS : PTO_QUOTA_HOURLY_HOURS;
  return {
    over: prior + requested > quota + 0.001,
    prior: round2(prior),
    requested: round2(requested),
    quota,
    unit: isGm ? "days" : "hours",
    label: q.label,
  };
}

// Vacation lead time: the first day out must be at least this many days from
// today. Admins bypass (corrections / backfill).
const PTO_ADVANCE_DAYS = 30;
function ptoAdvanceError(fields) {
  const dates = (fields.vacation_days ?? []).map((d) => d.date).filter(Boolean).sort();
  const first = dates[0] || fields.pto_start_date;
  if (!first) return null;
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const lead = Math.floor((Date.parse(first) - Date.parse(todayIso)) / 86400000);
  if (lead >= PTO_ADVANCE_DAYS) return null;
  const when = lead < 0 ? "in the past" : lead === 0 ? "today" : `only ${lead} day${lead === 1 ? "" : "s"} away`;
  return {
    error: `Vacation must be submitted at least ${PTO_ADVANCE_DAYS} days in advance — the first day out (${first}) is ${when}.`,
    status: 422,
  };
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
  if (user.role !== "admin") {
    const advErr = ptoAdvanceError(built.fields);
    if (advErr) return advErr;
  }
  const quota = await ptoOverQuota(supa, built.fields);

  const insertRow = {
    submitter_id: user.id,
    submitter_email: user.email,
    submitter_name: user.full_name ?? null,
    store_number: storeNumber,
    ...built.fields,
    over_quota: quota.over,
    ...ptoWorkflowFields(user),
  };

  let { data: created, error } = await supa
    .from("pto_requests")
    .insert(insertRow)
    .select("id")
    .single();
  if (error && /over_quota/.test(error.message)) {
    // Pre-0231: the column doesn't exist yet — submit without the flag.
    delete insertRow.over_quota;
    ({ data: created, error } = await supa.from("pto_requests").insert(insertRow).select("id").single());
  }
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
  const quotaNote = quota.over
    ? `OVER ALLOWANCE: ${built.meta.employeeName} already has ${quota.prior} ${quota.unit} of PTO in ${quota.label}; this request adds ${quota.requested} (allowance: ${quota.quota} ${quota.unit}/quarter). Final approval must come from the RVP.\n\n`
    : "";
  await notifyLeadership(supa, {
    storeNumber,
    sendCopy: built.fields.send_copy,
    submitterEmail: user.email,
    subject: `PTO Request — ${built.meta.employeeName} (Store ${storeNumber})${quota.over ? " — OVER ALLOWANCE" : ""}`,
    text:
      `A PTO request was submitted by ${displayName(user)}.\n\n` +
      `Store: ${storeNumber}\n${built.meta.summary}${quotaNote}Review it here: ${link}`,
  });

  return { ok: true, id: created.id, status: insertRow.status, over_quota: quota.over };
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
  const quota = await ptoOverQuota(supa, built.fields, id);

  const patch = {
    store_number: storeNumber,
    ...built.fields,
    over_quota: quota.over,
    ...ptoWorkflowFields(user),
    approved_at: null,
    approved_by_id: null,
    approved_by_email: null,
    decision_note: null,
    rejection_reason: null,
  };
  let { error } = await supa.from("pto_requests").update(patch).eq("id", id);
  if (error && /over_quota/.test(error.message)) {
    delete patch.over_quota;
    ({ error } = await supa.from("pto_requests").update(patch).eq("id", id));
  }
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

// The action a given role can take on a request at its current status, or
// null. Covers approvals ("decide") and the post-approval confirmations.
//   training: Submitted→decide (DO within bank / RVP over bank) → Completed
//   pto:      Submitted→decide(DO) "DO Approved"→decide(SDO/RVP) "SDO/RVP Approved"→paf-submitted(DO) "PAF Submitted"→close(DO)
function actionableStep(type, status, role, isOwner = false, overBank = false) {
  const isApprover = role === "sdo" || role === "rvp" || role === "admin";
  const isDo = role === "do" || role === "admin";
  // The post-approval operational steps (PAF filing / closeout) are normally a
  // DO's job. But a senior submitter (SDO/RVP/admin) must also be able to run
  // them on their OWN request — they outrank every approver, so there's no one
  // below to hand the request down to.
  const canOps = isDo || (isOwner && isApprover);
  if (type === "training") {
    // Approval is the only step now — DO within bank, RVP over bank.
    if (status === "Submitted") {
      return rankOf(role) >= (overBank ? ROLE_RANK.rvp : ROLE_RANK.do) ? "decide" : null;
    }
    return null;
  }
  // pto. The DO step is a DO's job for others, but a senior owner clears it on
  // their own request too (so an SDO/RVP can self-serve from the first step).
  if (status === "Submitted") return isDo || (isOwner && isApprover) ? "decide" : null;
  if (status === "DO Approved") return isApprover ? "decide" : null;
  if (status === "SDO/RVP Approved") return canOps ? "paf-submitted" : null;
  if (status === "PAF Submitted") return canOps ? "close" : null;
  return null;
}

// queue — everything awaiting the caller's action: approvals plus the
// post-approval confirmations (entered / closed-out / PAF submitted). Each
// row is stamped with `action_needed` so the UI shows the right button. Only
// the approval ("decide") step excludes the caller's own submissions.
async function listQueue(supa, user) {
  if (!APPROVER_ROLES.has(user.role)) {
    return { user: { id: user.id, role: user.role }, trainingCredits: [], ptoRequests: [] };
  }
  const numbers = user.role === "admin" ? null : await resolveVisibleStoreNumbers(supa, user.id);

  async function fetchActionable(type, statuses) {
    let q = supa.from(REQUEST_TABLE[type]).select("*").in("status", statuses).limit(500);
    if (numbers !== null) {
      if (!numbers.length) return [];
      q = q.in("store_number", numbers);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => ({
        ...r,
        action_needed: actionableStep(type, r.status, user.role, r.submitter_id === user.id, r.over_bank),
      }))
      .filter((r) => {
        if (!r.action_needed) return false;
        if (r.action_needed === "decide" && r.submitter_id === user.id) return false;
        return true;
      });
  }

  try {
    const [training, pto] = await Promise.all([
      fetchActionable("training", ["Submitted"]),
      fetchActionable("pto", ["Submitted", "DO Approved", "SDO/RVP Approved", "PAF Submitted"]),
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

  // A senior submitter (SDO/RVP/admin) may clear their own request — they
  // outrank every approver, so the usual "can't approve your own" guard would
  // strand it. Anyone below the required tier is still rejected by the step
  // check below (e.g. a GM or DO can't self-approve a tier above them).
  const isOwner = existing.submitter_id === user.id;
  if (actionableStep(type, existing.status, user.role, isOwner, existing.over_bank) !== "decide") {
    return {
      error: `This request is ${existing.status} and isn't yours to approve.`,
      status: 409,
    };
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

  // approve — training approval is the final step: it lands Completed and the
  // labor credit applies. The store's SDO is notified (FYI, not an approver).
  if (type === "training") {
    const err = await transition(
      {
        status: "Completed",
        approved_at: nowIso,
        approved_by_id: user.id,
        approved_by_email: user.email,
        closed_out_at: nowIso,
        closed_out_by_id: user.id,
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
      detail: { note: note || null, over_bank: !!existing.over_bank },
    });
    const { sdos } = await resolveStoreLeadership(supa, existing.store_number);
    await sendEmailViaResend({
      to: [existing.submitter_email, ...sdos.map((p) => p.email)].filter(Boolean),
      subject: `Training credit approved — ${employeeName} (Store ${existing.store_number})`,
      text:
        `${displayName(user)} approved the training credit for ${employeeName}. ` +
        `It's complete and the store's labor credit is applied.\n\nView it here: ${link}`,
    });
    return { ok: true, status: "Completed" };
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

  // pto final step (status === "DO Approved"). Over-allowance requests
  // (more than one week this quarter) need the RVP specifically.
  if (existing.over_quota && user.role !== "rvp" && user.role !== "admin") {
    return {
      error: "This request is over the one-week-per-quarter allowance — final approval must come from the RVP.",
      status: 403,
    };
  }
  const err = await transition(
    {
      status: "SDO/RVP Approved",
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
  return { ok: true, status: "SDO/RVP Approved" };
}

// confirm — the post-approval steps (no approve/reject): SDO/RVP mark a
// training "On Weekly Sheet"; the DO marks it "Completed" after the last day;
// the DO confirms the vacation PAF was submitted.
async function confirm(supa, user, body) {
  const type = sanitizeText(body?.type, 20);
  const table = REQUEST_TABLE[type];
  if (!table) return { error: "Unknown request type.", status: 400 };
  const id = sanitizeText(body?.id, 64);
  if (!id) return { error: "Request id is required.", status: 400 };
  const step = sanitizeText(body?.step, 20);

  const { data: existing, error: fetchErr } = await supa
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Request not found.", status: 404 };

  const expected = actionableStep(type, existing.status, user.role, existing.submitter_id === user.id);
  if (expected !== step || step === "decide" || !step) {
    return { error: "That step isn't available to you right now.", status: 409 };
  }
  const scopeErr = await assertStoreInScope(supa, user, existing.store_number);
  if (scopeErr) return scopeErr;

  const employeeName = existing.employee_name ?? "employee";
  const link = `${appBaseUrl()}/employee-actions`;
  const nowIso = new Date().toISOString();

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

  // (training "entered" / "closed-out" steps retired — approval is final now)

  if (step === "paf-submitted") {
    const err = await transition(
      { status: "PAF Submitted", paf_submitted_at: nowIso, paf_submitted_by_id: user.id },
      existing.status
    );
    if (err) return err;
    await logAudit(supa, {
      request_type: AUDIT_TYPE.pto,
      request_id: id,
      actor_id: user.id,
      actor_email: user.email,
      action: "paf-submitted",
      detail: {},
    });
    await sendEmailViaResend({
      to: existing.submitter_email,
      subject: `Vacation PAF submitted — ${employeeName} (Store ${existing.store_number})`,
      text: `${displayName(user)} confirmed the PAF was submitted for ${employeeName}'s vacation.\n\n${link}`,
    });
    return { ok: true, status: "PAF Submitted" };
  }

  if (step === "close") {
    const err = await transition(
      { status: "Closed", closed_at: nowIso, closed_by_id: user.id },
      existing.status
    );
    if (err) return err;
    await logAudit(supa, {
      request_type: AUDIT_TYPE.pto,
      request_id: id,
      actor_id: user.id,
      actor_email: user.email,
      action: "closed",
      detail: {},
    });
    await sendEmailViaResend({
      to: existing.submitter_email,
      subject: `PTO closed out — ${employeeName} (Store ${existing.store_number})`,
      text: `${displayName(user)} closed out ${employeeName}'s PTO request.\n\n${link}`,
    });
    return { ok: true, status: "Closed" };
  }

  return { error: "Unknown step.", status: 400 };
}

// ----------------------------------------------------------------------------
// delete (admin only)
// ----------------------------------------------------------------------------
// Withdraw a request that's no longer needed (e.g. the employee quit). Unlike
// reject (a decision sent back to the submitter) or delete (admin-only hard
// delete), this records a 'Withdrawn' status that stays for reporting and
// drops out of the active queue. DO and above, in scope, on a non-terminal
// request. Reason is optional.
async function withdrawRequest(supa, user, body) {
  if (!APPROVER_ROLES.has(user.role)) {
    return { error: "Only a DO and above can withdraw a request.", status: 403 };
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

  const { data: existing, error: fetchErr } = await supa
    .from(table).select("*").eq("id", id).maybeSingle();
  if (fetchErr) return { error: fetchErr.message, status: 500 };
  if (!existing) return { error: "Request not found.", status: 404 };
  const scopeErr = await assertStoreInScope(supa, user, existing.store_number);
  if (scopeErr) return scopeErr;
  if (TERMINAL_STATUSES.has(existing.status)) {
    return { error: `A ${existing.status} request can't be withdrawn.`, status: 409 };
  }

  const reason = sanitizeText(body?.reason, 500) || null;
  const { error } = await supa
    .from(table).update({ status: "Withdrawn", withdrawn_reason: reason }).eq("id", id);
  if (error) return { error: error.message, status: 500 };

  await logAudit(supa, {
    request_type: type === "training" ? "training_credit" : "pto",
    request_id: id,
    actor_id: user.id,
    actor_email: user.email,
    action: "withdraw",
    detail: { reason, from_status: existing.status },
  });

  return { ok: true, status: "Withdrawn" };
}

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
// decide-bulk — approve several requests at once. Reuses decide() per item so
// each goes through the same step/scope checks, transition guard, audit, and
// notification. Approve only; rejections need a per-request reason.
async function decideBulk(supa, user, body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
  if (!items.length) return { error: "No requests selected.", status: 400 };
  let approved = 0, failed = 0;
  const results = [];
  for (const it of items) {
    const type = sanitizeText(it?.type, 20);
    const id = sanitizeText(it?.id, 64);
    if (!type || !id) { results.push({ id: id || null, ok: false, error: "Missing type or id." }); failed++; continue; }
    const r = await decide(supa, user, { type, id, action: "approve" });
    if (r && typeof r === "object" && "error" in r) { results.push({ id, ok: false, error: r.error }); failed++; }
    else { results.push({ id, ok: true }); approved++; }
  }
  return { ok: true, approved, failed, results };
}

// Run one post-approval confirm step (e.g. "entered" = mark on weekly sheet)
// across many requests in a single call. Reuses confirm() per item, so every
// per-request gate (actionableStep + store scope) and side effect (audit +
// email) is identical to acting on them one at a time — this just saves the
// approver from opening each drawer. Lets an RVP mark a whole week's worth of
// training credits across multiple stores onto the weekly sheet at once.
async function confirmBulk(supa, user, body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
  const step = sanitizeText(body?.step, 20);
  if (!items.length) return { error: "No requests selected.", status: 400 };
  if (!step) return { error: "Missing step.", status: 400 };
  let done = 0, failed = 0;
  const results = [];
  for (const it of items) {
    const type = sanitizeText(it?.type, 20);
    const id = sanitizeText(it?.id, 64);
    if (!type || !id) { results.push({ id: id || null, ok: false, error: "Missing type or id." }); failed++; continue; }
    const r = await confirm(supa, user, { type, id, step });
    if (r && typeof r === "object" && "error" in r) { results.push({ id, ok: false, error: r.error }); failed++; }
    else { results.push({ id, ok: true }); done++; }
  }
  return { ok: true, done, failed, results };
}

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
      if (action === "credit-register") return unwrap(await creditRegister(supa, user, params));
      if (action === "credit-balance") return unwrap(await creditBalance(supa, user, params));
      if (action === "credit-ledger") return unwrap(await creditLedger(supa, user, params));
      if (action === "gm-pto-rate") return unwrap(await gmPtoRateGet(supa, user));
      if (action === "pto-report") return unwrap(await ptoReport(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "credit-adjust") return unwrap(await creditAdjust(supa, user, body));
      if (action === "credit-budget") return unwrap(await creditBudgetSet(supa, user, body));
      if (action === "gm-pto-rate-set") return unwrap(await gmPtoRateSet(supa, user, body));
      if (action === "submit-training") return unwrap(await submitTraining(supa, user, body));
      if (action === "submit-pto") return unwrap(await submitPto(supa, user, body));
      if (action === "update-training") return unwrap(await updateTraining(supa, user, body));
      if (action === "update-pto") return unwrap(await updatePto(supa, user, body));
      if (action === "decide") return unwrap(await decide(supa, user, body));
      if (action === "decide-bulk") return unwrap(await decideBulk(supa, user, body));
      if (action === "confirm") return unwrap(await confirm(supa, user, body));
      if (action === "confirm-bulk") return unwrap(await confirmBulk(supa, user, body));
      if (action === "withdraw") return unwrap(await withdrawRequest(supa, user, body));
      if (action === "delete") return unwrap(await deleteRequest(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
