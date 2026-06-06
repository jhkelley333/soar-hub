// netlify/functions/cash-management.js
//
// Cash Management backend — the night-close → next-day deposit cycle.
// Auth bridge + store-scoping mirror facilities-v2.js / paf.js: validate the
// Supabase JWT with the service-role key, look up the caller's profile, and
// gate every action on role + visible-store scope. Money is in integer cents.
//
// Actions:
//   GET  ?action=overview&store_id=  -> store context, tonight's closeout,
//                                       pending deposit, open alerts, history
//   GET  ?action=config              -> denomination ladder + tolerance
//   GET  ?action=alerts              -> discrepancy alerts in scope + counts
//   GET  ?action=dsr&store_id=       -> DSR ledger (carried-in/out) + summary
//   GET  ?action=slip-url&deposit_id=-> signed URL for a slip photo
//   POST ?action=submit-closeout     -> create/replace tonight's closeout
//   POST ?action=verify-deposit      -> validate a pending deposit
//   POST ?action=alert-decide        -> acknowledge / resolve an alert (DO+)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOLERANCE_CENTS = 500; // $5 escalation tolerance

// Denomination ladder (cents) used by the night-close cash counter.
const DENOMS = [
  { id: "b100", label: "$100", cents: 10000, type: "bill" },
  { id: "b50", label: "$50", cents: 5000, type: "bill" },
  { id: "b20", label: "$20", cents: 2000, type: "bill" },
  { id: "b10", label: "$10", cents: 1000, type: "bill" },
  { id: "b5", label: "$5", cents: 500, type: "bill" },
  { id: "b1", label: "$1", cents: 100, type: "bill" },
  { id: "q", label: "25¢", cents: 25, type: "coin" },
  { id: "d", label: "10¢", cents: 10, type: "coin" },
  { id: "n", label: "5¢", cents: 5, type: "coin" },
  { id: "p", label: "1¢", cents: 1, type: "coin" },
];

// Store-leaders + above may run closeouts / deposit validation.
const CLOSEOUT_ROLES = new Set([
  "gm", "shift_manager", "first_assistant_manager", "associate_manager",
  "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin",
]);
// DO/SDO and above may acknowledge / resolve discrepancy alerts.
const ACT_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("cash-management env vars not configured");
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
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active, primary_store_id")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

// ---- money + misc helpers ----
const centsToNum = (c) => Number(c || 0);
function fmtMoney(cents) {
  return (centsToNum(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function coCode(businessDate) {
  // CO-MMDD from an ISO date, matching the design's short closeout codes.
  const d = String(businessDate || "");
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `CO-${m[1]}${m[2]}` : "CO-----";
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- store scoping (mirrors facilities-v2 getStoresForUser, returns rows) ----
// Org-wide readers see every store. Accounting is added so they can review
// deposits + slips across the company (read-only — they're not in
// CLOSEOUT_ROLES or ACT_ROLES, so they can't close/validate/resolve).
const ORG_WIDE_READ = new Set(["admin", "coo", "vp", "accounting"]);

async function getSettings(supa) {
  const { data } = await supa
    .from("cash_settings")
    .select("closeout_tolerance_cents, deposit_tolerance_cents")
    .eq("id", "global")
    .maybeSingle();
  return {
    closeout: data?.closeout_tolerance_cents ?? TOLERANCE_CENTS,
    deposit: data?.deposit_tolerance_cents ?? TOLERANCE_CENTS,
  };
}

// Append an action-history row (best-effort — never fails the user action).
async function logCash(supa, entry) {
  try {
    const { error } = await supa.from("cash_audit_log").insert(entry);
    if (error) console.warn("[cash] audit insert failed", error.message);
  } catch (e) {
    console.warn("[cash] audit insert threw", e?.message || e);
  }
}

async function storeRowsForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE_READ.has(role)) {
    const { data } = await supa
      .from("stores")
      .select("id, number, name, district_id")
      .eq("is_active", true)
      .order("number")
      .limit(1000);
    return { all: true, rows: data || [] };
  }
  const { data: scopes } = await supa
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, rows: [] };

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
  if (storeIds.size === 0) return { all: false, rows: [] };
  const { data: rows } = await supa
    .from("stores")
    .select("id, number, name, district_id")
    .in("id", Array.from(storeIds))
    .eq("is_active", true)
    .order("number");
  return { all: false, rows: rows || [] };
}

// Resolve the active store the caller is operating on (store_id param or default).
async function resolveActiveStore(supa, profile, storeIdParam) {
  const access = await storeRowsForUser(supa, profile);
  const rows = access.rows;
  if (!rows.length) return { stores: [], active: null };
  let active =
    (storeIdParam && rows.find((r) => r.id === storeIdParam)) ||
    (profile.primary_store_id && rows.find((r) => r.id === profile.primary_store_id)) ||
    rows[0];
  return { stores: rows, active };
}

// The store's assigned DO (district scope) + SDO (area scope) — for escalation
// notification + display. Mirrors PAF's resolveBonusApprover lookups.
async function resolveStoreLeaders(supa, storeId) {
  const out = { do: null, sdo: null };
  const { data: store } = await supa
    .from("stores").select("id, district_id").eq("id", storeId).maybeSingle();
  if (!store?.district_id) return out;

  out.do = await firstScopedProfile(supa, "do", "district", store.district_id);

  const { data: district } = await supa
    .from("districts").select("id, area_id").eq("id", store.district_id).maybeSingle();
  if (district?.area_id) {
    out.sdo = await firstScopedProfile(supa, "sdo", "area", district.area_id);
  }
  return out;
}
async function firstScopedProfile(supa, role, scopeType, scopeId) {
  const { data: cands } = await supa
    .from("profiles").select("id, full_name, preferred_name, email")
    .eq("role", role).eq("is_active", true);
  const ids = (cands || []).map((c) => c.id);
  if (!ids.length) return null;
  const { data: scoped } = await supa
    .from("user_scopes").select("user_id")
    .eq("scope_type", scopeType).eq("scope_id", scopeId).in("user_id", ids).limit(1);
  const uid = scoped?.[0]?.user_id;
  if (!uid) return null;
  const p = (cands || []).find((c) => c.id === uid);
  return p ? { id: p.id, name: p.preferred_name || p.full_name || p.email, email: p.email } : null;
}

// ---- Resend email (best-effort, mirrors paf.js) ----
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.CASH_FROM_NAME || process.env.RESEND_FROM_NAME || "Cash Management";
function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}
async function sendEmail(to, subject, text) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!RESEND_API_KEY || !recipients.length) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`, to: recipients, subject, text }),
    });
  } catch (e) {
    console.warn("[cash-management] email send failed", e?.message || e);
  }
}
async function escalate(supa, { store, variancecents, type, reason, managerName, source, closeoutId }) {
  const leaders = await resolveStoreLeaders(supa, store.id);
  const notified = [];
  if (leaders.do) notified.push("District Operator");
  if (leaders.sdo) notified.push("Sr. District Officer");
  const severity = Math.abs(variancecents) > 1000 ? "high" : "medium";

  await supa.from("cash_alerts").insert({
    store_id: store.id, store_number: String(store.number), closeout_id: closeoutId ?? null,
    source, variance_cents: variancecents, type, severity, reason: reason || null,
    manager_name: managerName || null, status: "open",
    notified: notified.length ? notified : ["District Operator", "Sr. District Officer"],
  });

  const emails = [leaders.do?.email, leaders.sdo?.email].filter(Boolean);
  const sourceLabel = source === "deposit" ? "deposit validation" : source === "carryover" ? "carried-over balance" : "night closeout";
  const subject = `[Cash MGT] ${type === "short" ? "Cash short" : "Cash over"} at Store ${store.number} — ${fmtMoney(variancecents)}`;
  const body =
    `A ${sourceLabel} at Store ${store.number}` +
    `${store.name ? ` (${store.name})` : ""} breached the cash variance tolerance.\n\n` +
    `Variance: ${fmtMoney(variancecents)} (${type})\n` +
    `Submitted by: ${managerName || "—"}\n` +
    `Reason: ${reason || "—"}\n\n` +
    `Review it in the hub: ${appBaseUrl()}/admin/cash-management`;
  await sendEmail(emails, subject, body);
}

// ---- closeout row -> display shape for tables ----
function closeoutCard(co) {
  return {
    id: coCode(co.business_date),
    closeout_id: co.id,
    business_date: co.business_date,
    cash_due_cents: co.cash_due_cents,
    deposit_cents: co.deposit_cents,
    variance_cents: co.variance_cents,
    status: co.status,
    flagged: co.flagged,
  };
}

// ============================================================================
// overview
// ============================================================================
async function overview(supa, user, params) {
  const { stores, active } = await resolveActiveStore(supa, user, params.store_id);
  if (!active) {
    return { stores: [], active_store_id: null, store: null, toleranceCents: TOLERANCE_CENTS, history: [], open_alerts: 0 };
  }
  const today = todayISO();

  const [{ data: todayCo }, { data: pendingDep }, { data: history }, { count: openAlerts }, leaders] =
    await Promise.all([
      supa.from("cash_closeouts").select("*").eq("store_id", active.id).eq("business_date", today).maybeSingle(),
      supa.from("cash_deposits").select("*").eq("store_id", active.id).eq("status", "pending")
        .order("for_date", { ascending: false }).limit(1).maybeSingle(),
      supa.from("cash_closeouts").select("*").eq("store_id", active.id)
        .order("business_date", { ascending: false }).limit(6),
      supa.from("cash_alerts").select("id", { count: "exact", head: true })
        .eq("store_id", active.id).eq("status", "open"),
      resolveStoreLeaders(supa, active.id),
    ]);
  const settings = await getSettings(supa);

  return {
    stores: stores.map((s) => ({ id: s.id, number: String(s.number), name: s.name })),
    active_store_id: active.id,
    store: { id: active.id, number: String(active.number), name: active.name },
    business_date: today,
    toleranceCents: settings.closeout,
    closeoutToleranceCents: settings.closeout,
    depositToleranceCents: settings.deposit,
    can_act_alerts: ACT_ROLES.has(String(user.role)),
    leaders: { do_name: leaders.do?.name || null, sdo_name: leaders.sdo?.name || null },
    closeout: todayCo ? closeoutCard(todayCo) : null,
    pending_deposit: pendingDep
      ? {
          id: pendingDep.id, code: `DEP-${coCode(pendingDep.for_date).slice(3)}`, for_date: pendingDep.for_date,
          expected_cents: pendingDep.expected_cents, status: pendingDep.status,
        }
      : null,
    open_alerts: openAlerts || 0,
    history: (history || []).map(closeoutCard),
  };
}

// ============================================================================
// submit-closeout
// ============================================================================
async function submitCloseout(supa, user, body) {
  if (!CLOSEOUT_ROLES.has(String(user.role))) {
    return { error: "Your role can't run a closeout.", status: 403 };
  }
  const { active } = await resolveActiveStore(supa, user, body?.store_id);
  if (!active) return { error: "No store in your scope.", status: 403 };

  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.business_date || "") ? body.business_date : todayISO();
  const cashDue = Math.round(Number(body?.cash_due_cents));
  const deposit = Math.round(Number(body?.deposit_cents));
  const counted = Math.round(Number(body?.counted_cents));
  if (!Number.isFinite(cashDue) || !Number.isFinite(deposit) || !Number.isFinite(counted)) {
    return { error: "cash_due, deposit and counted amounts are required.", status: 400 };
  }
  const settings = await getSettings(supa);
  const variance = deposit - cashDue;
  const flagged = Math.abs(variance) > settings.closeout;
  const reason = String(body?.reason || "").trim();
  if (flagged && reason.length < 8) {
    return { error: "A reason (min 8 chars) is required to escalate.", status: 400 };
  }

  const managerName = user.preferred_name || user.full_name || user.email;

  const row = {
    store_id: active.id, store_number: String(active.number), business_date: businessDate,
    cash_due_cents: cashDue, counted_cents: counted, deposit_cents: deposit,
    denominations: body?.denominations || {}, variance_cents: variance, carried_over_cents: 0,
    flagged, reason: flagged ? reason : null, status: flagged ? "flagged" : "awaiting-deposit",
    submitted_by: user.id, submitted_by_name: managerName, submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: co, error } = await supa
    .from("cash_closeouts").upsert(row, { onConflict: "store_id,business_date" }).select("*").single();
  if (error) return { error: error.message, status: 500 };

  // (Re)create the pending next-day deposit for this closeout.
  await supa.from("cash_deposits").upsert(
    {
      closeout_id: co.id, store_id: active.id, store_number: String(active.number),
      for_date: businessDate, expected_cents: deposit, dsr_carried_over_cents: 0,
      status: "pending", updated_at: new Date().toISOString(),
    },
    { onConflict: "closeout_id" }
  );

  if (flagged) {
    await escalate(supa, {
      store: active, variancecents: variance, type: variance < 0 ? "short" : "over",
      reason, managerName, source: "closeout", closeoutId: co.id,
    });
  }
  await logCash(supa, {
    scope: "closeout", action: "submit", store_id: active.id, closeout_id: co.id,
    detail: {
      business_date: businessDate, cash_due_cents: cashDue, deposit_cents: deposit,
      counted_cents: counted, variance_cents: variance, flagged, acknowledged: body?.acknowledged === true,
    },
    actor_id: user.id, actor_name: managerName,
  });
  return { ok: true, id: co.id, flagged, status: co.status };
}

// ============================================================================
// deposit (get the pending deposit for validation)
// ============================================================================
async function getDeposit(supa, user, params) {
  const { active } = await resolveActiveStore(supa, user, params.store_id);
  if (!active) return { error: "No store in your scope.", status: 403 };
  const { data: dep } = await supa
    .from("cash_deposits").select("*").eq("store_id", active.id).eq("status", "pending")
    .order("for_date", { ascending: false }).limit(1).maybeSingle();
  if (!dep) return { deposit: null };
  const { data: co } = await supa
    .from("cash_closeouts").select("submitted_by_name").eq("id", dep.closeout_id).maybeSingle();
  const settings = await getSettings(supa);
  return {
    deposit: {
      id: dep.id, code: `DEP-${coCode(dep.for_date).slice(3)}`, for_date: dep.for_date,
      closed_by: co?.submitted_by_name || "—", expected_cents: dep.expected_cents,
      dsr_carried_over_cents: dep.dsr_carried_over_cents, status: dep.status,
    },
    toleranceCents: settings.deposit,
  };
}

// ============================================================================
// verify-deposit
// ============================================================================
async function verifyDeposit(supa, user, body) {
  if (!CLOSEOUT_ROLES.has(String(user.role))) {
    return { error: "Your role can't validate deposits.", status: 403 };
  }
  const depId = body?.deposit_id;
  if (!depId) return { error: "deposit_id is required.", status: 400 };
  const { data: dep } = await supa.from("cash_deposits").select("*").eq("id", depId).maybeSingle();
  if (!dep) return { error: "Deposit not found.", status: 404 };
  if (dep.status === "verified") return { error: "This deposit is already validated.", status: 400 };

  // Scope check.
  const access = await storeRowsForUser(supa, user);
  if (!access.all && !access.rows.some((r) => r.id === dep.store_id)) {
    return { error: "That deposit isn't in your scope.", status: 403 };
  }

  const bank = Math.round(Number(body?.bank_credited_cents));
  if (!Number.isFinite(bank)) return { error: "Bank-credited amount is required.", status: 400 };
  const slipPath = String(body?.slip_path || "").trim();
  if (!slipPath) return { error: "A stamped deposit-slip photo is required.", status: 400 };

  const settings = await getSettings(supa);
  const variance = bank - dep.expected_cents;
  const flagged = Math.abs(variance) > settings.deposit;
  const reason = String(body?.reason || "").trim();
  if (flagged && reason.length < 8) return { error: "A mismatch reason (min 8 chars) is required.", status: 400 };

  // Carried-over open checks (Micros DSR): a COUNT + DOLLAR value the validator
  // enters from the prior-day DSR. A nonzero carry must be recorded + addressed.
  const carriedCents = Math.round(Number(body?.carried_over_cents)) || 0;
  const carriedCount = parseInt(String(body?.carried_over_count ?? "0"), 10) || 0;
  const hasCarry = carriedCount > 0 || carriedCents !== 0;
  const carriedAck = body?.carried_ack === true || body?.carried_ack === "true";
  const carriedNote = String(body?.carried_note || "").trim() || null;
  if (hasCarry && !carriedAck) {
    return { error: "Record and address the carried-over open checks before verifying.", status: 400 };
  }
  const nowIso = new Date().toISOString();

  const { error } = await supa.from("cash_deposits").update({
    bank_credited_cents: bank, variance_cents: variance, flagged, reason: flagged ? reason : null,
    slip_path: slipPath,
    dsr_carried_over_cents: carriedCents, carried_over_count: carriedCount, carried_fwd_cents: carriedCents,
    carried_ack: hasCarry, carried_note: hasCarry ? carriedNote : null,
    carried_ack_by: hasCarry ? user.id : null, carried_ack_at: hasCarry ? nowIso : null,
    status: flagged ? "flagged" : "verified",
    verified_by: user.id, verified_at: nowIso, updated_at: nowIso,
  }).eq("id", depId);
  if (error) return { error: error.message, status: 500 };

  // Mark the closeout verified when the deposit clears within tolerance.
  await supa.from("cash_closeouts").update({
    status: flagged ? "flagged" : "verified", updated_at: nowIso,
  }).eq("id", dep.closeout_id);

  const mgr = user.preferred_name || user.full_name || user.email;
  let storeRow = null;
  if (flagged || hasCarry) {
    const { data } = await supa.from("stores").select("id, number, name").eq("id", dep.store_id).maybeSingle();
    storeRow = data || { id: dep.store_id, number: dep.store_number, name: null };
  }
  // Bank-credit mismatch over tolerance → DO/SDO alert.
  if (flagged) {
    await escalate(supa, {
      store: storeRow, variancecents: variance, type: variance < 0 ? "short" : "over",
      reason, managerName: mgr, source: "deposit", closeoutId: dep.closeout_id,
    });
  }
  // Carried-over open checks → DO/SDO alert (shrinkage exposure), even though
  // the validator acknowledged it here.
  if (hasCarry) {
    await escalate(supa, {
      store: storeRow, variancecents: carriedCents, type: carriedCents < 0 ? "short" : "over",
      reason: `Carried-over: ${carriedCount} open check(s), ${fmtMoney(carriedCents)} — recorded at deposit validation by ${mgr}.${carriedNote ? ` Note: ${carriedNote}` : ""}`,
      managerName: mgr, source: "carryover", closeoutId: dep.closeout_id,
    });
  }
  await logCash(supa, {
    scope: "deposit", action: "verify-deposit", store_id: dep.store_id, closeout_id: dep.closeout_id, deposit_id: dep.id,
    detail: {
      bank_credited_cents: bank, variance_cents: variance, flagged,
      carried_over_count: carriedCount, carried_over_cents: carriedCents,
    },
    actor_id: user.id, actor_name: mgr,
  });
  return { ok: true, flagged, carried_acknowledged: hasCarry, carried_fwd_cents: carriedCents };
}

// ============================================================================
// slip-url — short-lived signed URL for a deposit-slip photo
// ============================================================================
async function slipUrl(supa, user, params) {
  const depId = params.deposit_id;
  if (!depId) return { error: "deposit_id is required.", status: 400 };
  const { data: dep } = await supa.from("cash_deposits").select("store_id, slip_path").eq("id", depId).maybeSingle();
  if (!dep?.slip_path) return { error: "No slip on file.", status: 404 };
  const access = await storeRowsForUser(supa, user);
  if (!access.all && !access.rows.some((r) => r.id === dep.store_id)) {
    return { error: "Not in your scope.", status: 403 };
  }
  const { data: signed, error } = await supa.storage.from("cash-deposit-slips").createSignedUrl(dep.slip_path, 120);
  if (error || !signed?.signedUrl) return { error: "Could not open slip.", status: 500 };
  return { url: signed.signedUrl };
}

// ============================================================================
// alerts (list + summary)
// ============================================================================
async function listAlerts(supa, user, params) {
  const access = await storeRowsForUser(supa, user);
  let q = supa.from("cash_alerts").select("*").order("created_at", { ascending: false }).limit(100);
  if (!access.all) {
    const ids = access.rows.map((r) => r.id);
    if (!ids.length) return { alerts: [], counts: { open: 0, acknowledged: 0, resolved: 0 }, can_act: ACT_ROLES.has(String(user.role)) };
    q = q.in("store_id", ids);
  }
  if (params.store_id) q = q.eq("store_id", params.store_id);
  const { data, error } = await q;
  if (error) return { error: error.message, status: 500 };
  const rows = data || [];
  return {
    can_act: ACT_ROLES.has(String(user.role)),
    counts: {
      open: rows.filter((a) => a.status === "open").length,
      acknowledged: rows.filter((a) => a.status === "acknowledged").length,
      resolved: rows.filter((a) => a.status === "resolved").length,
    },
    alerts: rows.map((a) => ({
      id: a.id, closeout_code: coCode(a.created_at?.slice(0, 10)), store_number: a.store_number,
      variance_cents: a.variance_cents, type: a.type, severity: a.severity, reason: a.reason,
      manager_name: a.manager_name, status: a.status, acked_by_name: a.acked_by_name,
      notified: a.notified || [], created_at: a.created_at,
    })),
  };
}

// ============================================================================
// alert-decide (acknowledge / resolve)
// ============================================================================
async function decideAlert(supa, user, body) {
  if (!ACT_ROLES.has(String(user.role))) {
    return { error: "Only a DO/SDO and above can act on alerts.", status: 403 };
  }
  const id = body?.id;
  const decision = body?.decision; // 'acknowledged' | 'resolved'
  if (!id || !["acknowledged", "resolved"].includes(decision)) {
    return { error: "id and a valid decision are required.", status: 400 };
  }
  const { data: alert } = await supa.from("cash_alerts").select("store_id, status, closeout_id, acked_at").eq("id", id).maybeSingle();
  if (!alert) return { error: "Alert not found.", status: 404 };
  const access = await storeRowsForUser(supa, user);
  if (!access.all && !access.rows.some((r) => r.id === alert.store_id)) {
    return { error: "That alert isn't in your scope.", status: 403 };
  }
  const name = user.preferred_name || user.full_name || user.email;
  const patch = { status: decision, acked_by: user.id, acked_by_name: name, updated_at: new Date().toISOString() };
  if (decision === "acknowledged" && !alert.acked_at) patch.acked_at = new Date().toISOString();
  if (decision === "resolved") patch.resolved_at = new Date().toISOString();
  const { error } = await supa.from("cash_alerts").update(patch).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  await logCash(supa, {
    scope: "alert", action: decision === "resolved" ? "alert-resolve" : "alert-ack",
    store_id: alert.store_id, closeout_id: alert.closeout_id ?? null, alert_id: id,
    detail: null, actor_id: user.id, actor_name: name,
  });
  return { ok: true };
}

// ============================================================================
// dsr — ledger with running carried-over balance + summary
// ============================================================================
async function dsr(supa, user, params) {
  const { active } = await resolveActiveStore(supa, user, params.store_id);
  if (!active) return { error: "No store in your scope.", status: 403 };
  const { data: rows } = await supa
    .from("cash_closeouts").select("*").eq("store_id", active.id)
    .order("business_date", { ascending: true }).limit(30);

  // closeout_id -> deposit (verified? + id + slip + entered open-check carryover).
  const ids = (rows || []).map((r) => r.id);
  const depByCloseout = {};
  if (ids.length) {
    const { data: deps } = await supa
      .from("cash_deposits")
      .select("closeout_id, id, status, slip_path, carried_over_count, dsr_carried_over_cents")
      .in("closeout_id", ids);
    for (const d of deps || []) depByCloseout[d.closeout_id] = d;
  }
  const settings = await getSettings(supa);

  // newest first for display (rows are ascending by date)
  const ledger = (rows || [])
    .map((h) => {
      const d = depByCloseout[h.id];
      return {
        id: coCode(h.business_date), closeout_id: h.id, deposit_id: d?.id || null, has_slip: !!d?.slip_path,
        business_date: h.business_date, cash_due_cents: h.cash_due_cents, deposit_cents: h.deposit_cents,
        variance_cents: h.variance_cents,
        carried_over_count: d?.carried_over_count || 0, carried_over_cents: d?.dsr_carried_over_cents || 0,
        deposit_verified: d?.status === "verified", status: h.status,
      };
    })
    .reverse();

  const flaggedCount = (rows || []).filter((h) => Math.abs(h.variance_cents) > settings.closeout).length;
  const totalDeposited = (rows || []).reduce((s, h) => s + (h.deposit_cents || 0), 0);
  const depList = Object.values(depByCloseout);
  const openCheckCount = depList.reduce((s, d) => s + (d.carried_over_count || 0), 0);
  const openCheckCents = depList.reduce((s, d) => s + (d.dsr_carried_over_cents || 0), 0);

  return {
    store: { id: active.id, number: String(active.number), name: active.name },
    toleranceCents: settings.closeout,
    open_check_count: openCheckCount,
    open_check_cents: openCheckCents,
    total_deposited_cents: totalDeposited,
    flagged_days: flaggedCount,
    clean_days: (rows || []).length - flaggedCount,
    days: (rows || []).length,
    ledger,
  };
}

// ============================================================================
// settings — read both tolerances; update is admin-only
// ============================================================================
async function getSettingsAction(supa, user) {
  const s = await getSettings(supa);
  return {
    closeoutToleranceCents: s.closeout,
    depositToleranceCents: s.deposit,
    can_edit: String(user.role) === "admin",
  };
}
async function updateSettings(supa, user, body) {
  if (String(user.role) !== "admin") return { error: "Only an admin can change tolerances.", status: 403 };
  const co = Math.round(Number(body?.closeout_tolerance_cents));
  const dep = Math.round(Number(body?.deposit_tolerance_cents));
  if (!Number.isFinite(co) || co < 0 || !Number.isFinite(dep) || dep < 0) {
    return { error: "Both tolerances must be valid non-negative amounts.", status: 400 };
  }
  const { error } = await supa.from("cash_settings").upsert(
    { id: "global", closeout_tolerance_cents: co, deposit_tolerance_cents: dep, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, closeoutToleranceCents: co, depositToleranceCents: dep };
}

// ============================================================================
// detail — full closeout + deposit for the review drawer (accounting / DO+)
// ============================================================================
async function detail(supa, user, params) {
  const closeoutId = params.closeout_id;
  if (!closeoutId) return { error: "closeout_id is required.", status: 400 };
  const { data: co } = await supa.from("cash_closeouts").select("*").eq("id", closeoutId).maybeSingle();
  if (!co) return { error: "Closeout not found.", status: 404 };
  const access = await storeRowsForUser(supa, user);
  if (!access.all && !access.rows.some((r) => r.id === co.store_id)) {
    return { error: "Not in your scope.", status: 403 };
  }
  const { data: dep } = await supa.from("cash_deposits").select("*").eq("closeout_id", closeoutId).maybeSingle();
  return {
    closeout: {
      id: co.id, code: coCode(co.business_date), business_date: co.business_date, store_number: co.store_number,
      cash_due_cents: co.cash_due_cents, counted_cents: co.counted_cents, deposit_cents: co.deposit_cents,
      variance_cents: co.variance_cents, denominations: co.denominations || {}, flagged: co.flagged,
      reason: co.reason, status: co.status, submitted_by_name: co.submitted_by_name, submitted_at: co.submitted_at,
    },
    deposit: dep
      ? {
          id: dep.id, code: `DEP-${coCode(dep.for_date).slice(3)}`, for_date: dep.for_date,
          expected_cents: dep.expected_cents, bank_credited_cents: dep.bank_credited_cents,
          dsr_carried_over_cents: dep.dsr_carried_over_cents, carried_over_count: dep.carried_over_count,
          carried_fwd_cents: dep.carried_fwd_cents,
          variance_cents: dep.variance_cents, flagged: dep.flagged, reason: dep.reason,
          carried_ack: dep.carried_ack, carried_note: dep.carried_note, has_slip: !!dep.slip_path,
          status: dep.status, verified_at: dep.verified_at,
        }
      : null,
    history: ((await supa
      .from("cash_audit_log")
      .select("id, scope, action, detail, actor_name, created_at")
      .eq("closeout_id", closeoutId)
      .order("created_at", { ascending: true })
      .limit(50)).data ?? []),
    can_edit: String(user.role) === "admin",
  };
}

// ============================================================================
// edit-closeout — admin fix for a closeout (e.g. wrong business date)
// ============================================================================
async function editCloseout(supa, user, body) {
  if (String(user.role) !== "admin") {
    return { error: "Only an admin can edit a closeout.", status: 403 };
  }
  const id = body?.closeout_id;
  if (!id) return { error: "closeout_id is required.", status: 400 };
  const { data: co } = await supa.from("cash_closeouts").select("*").eq("id", id).maybeSingle();
  if (!co) return { error: "Closeout not found.", status: 404 };

  const settings = await getSettings(supa);
  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.business_date || "") ? body.business_date : co.business_date;
  const cashDue = body?.cash_due_cents != null ? Math.round(Number(body.cash_due_cents)) : co.cash_due_cents;
  const deposit = body?.deposit_cents != null ? Math.round(Number(body.deposit_cents)) : co.deposit_cents;
  const counted = body?.counted_cents != null ? Math.round(Number(body.counted_cents)) : co.counted_cents;
  if (![cashDue, deposit, counted].every(Number.isFinite)) {
    return { error: "Amounts must be valid numbers.", status: 400 };
  }
  const reason = body?.reason != null ? String(body.reason).trim() : co.reason;

  // Moving to another date can collide with that day's closeout (unique store+date).
  if (businessDate !== co.business_date) {
    const { data: clash } = await supa
      .from("cash_closeouts").select("id")
      .eq("store_id", co.store_id).eq("business_date", businessDate).neq("id", id).maybeSingle();
    if (clash) return { error: `A closeout already exists for ${businessDate} at this store.`, status: 409 };
  }

  const variance = deposit - cashDue;
  const flagged = Math.abs(variance) > settings.closeout;
  const nowIso = new Date().toISOString();

  const { error } = await supa.from("cash_closeouts").update({
    business_date: businessDate, cash_due_cents: cashDue, deposit_cents: deposit, counted_cents: counted,
    variance_cents: variance, flagged, reason, updated_at: nowIso,
  }).eq("id", id);
  if (error) return { error: error.message, status: 500 };

  // Keep the linked deposit consistent with the corrected closeout.
  await supa.from("cash_deposits").update({
    expected_cents: deposit, for_date: businessDate, updated_at: nowIso,
  }).eq("closeout_id", id);

  await logCash(supa, {
    scope: "closeout", action: "edit", store_id: co.store_id, closeout_id: id,
    detail: {
      before: { business_date: co.business_date, cash_due_cents: co.cash_due_cents, deposit_cents: co.deposit_cents, counted_cents: co.counted_cents },
      after: { business_date: businessDate, cash_due_cents: cashDue, deposit_cents: deposit, counted_cents: counted },
    },
    actor_id: user.id, actor_name: user.preferred_name || user.full_name || user.email,
  });
  return { ok: true };
}

// ============================================================================
// badges — scope-wide counts for the dashboard Cash quick-link card
// ============================================================================
async function badges(supa, user) {
  const access = await storeRowsForUser(supa, user);
  let depQ = supa.from("cash_deposits").select("id", { count: "exact", head: true }).eq("status", "pending");
  let altQ = supa.from("cash_alerts").select("id", { count: "exact", head: true }).eq("status", "open");
  if (!access.all) {
    const ids = access.rows.map((r) => r.id);
    if (!ids.length) return { pending_deposits: 0, open_alerts: 0 };
    depQ = depQ.in("store_id", ids);
    altQ = altQ.in("store_id", ids);
  }
  const [{ count: dep }, { count: alt }] = await Promise.all([depQ, altQ]);
  return { pending_deposits: dep || 0, open_alerts: alt || 0 };
}

// ============================================================================
// handler
// ============================================================================
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "overview";
  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "overview") return unwrap(await overview(supa, user, params));
      if (action === "config") {
        const s = await getSettings(supa);
        return respond(200, {
          denominations: DENOMS,
          toleranceCents: s.closeout,
          closeoutToleranceCents: s.closeout,
          depositToleranceCents: s.deposit,
        });
      }
      if (action === "deposit") return unwrap(await getDeposit(supa, user, params));
      if (action === "alerts") return unwrap(await listAlerts(supa, user, params));
      if (action === "dsr") return unwrap(await dsr(supa, user, params));
      if (action === "slip-url") return unwrap(await slipUrl(supa, user, params));
      if (action === "badges") return unwrap(await badges(supa, user));
      if (action === "settings") return unwrap(await getSettingsAction(supa, user));
      if (action === "detail") return unwrap(await detail(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "submit-closeout") return unwrap(await submitCloseout(supa, user, body));
      if (action === "verify-deposit") return unwrap(await verifyDeposit(supa, user, body));
      if (action === "alert-decide") return unwrap(await decideAlert(supa, user, body));
      if (action === "update-settings") return unwrap(await updateSettings(supa, user, body));
      if (action === "edit-closeout") return unwrap(await editCloseout(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
