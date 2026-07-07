// Team Pipeline (Talent Planning) — backend.
//
// Service-role gatekeeper. Every read/write is scoped to the caller's stores.
// Team members are the store roster (Carhop → GM); most are not app accounts.
// Talent-planning data (flight risk, succession, reqs) is DO-and-above.

import { createClient } from "@supabase/supabase-js";
import { getFlag } from "./_lib/flags.js";
import {
  getSheetsClient, getAvailableWeeks, batchGetWeeks,
  findRowByStore, getMetricRaw, parseNum,
} from "./_lib/ranker-sheets.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORG_WIDE = new Set(["vp", "coo", "admin"]);
// Talent-data audience. GMs are in for their own store (granted for onboarding
// role cleanup); storesForUser still scopes them to their store via user_scopes.
const VIEW_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
// SOAR auth role → ladder role key
const ROLE_MAP = {
  gm: "gm", first_assistant_manager: "fam", associate_manager: "assoc",
  crew_leader: "lead", shift_manager: "shift", crew_member: "crew", carhop: "carhop",
};
// Inverse: ladder key → SOAR auth role (for inviting a roster member).
const LADDER_TO_AUTH = {
  gm: "gm", fam: "first_assistant_manager", assoc: "associate_manager",
  shift: "shift_manager", lead: "crew_leader", crew: "crew_member", carhop: "carhop",
};
// Invite eligibility: Crew Leader and up get an app login.
const INVITE_ROLES = new Set(["lead", "shift", "assoc", "fam", "gm"]);
const ROLE_KEYS = new Set(["carhop", "crew", "lead", "shift", "assoc", "fam", "gm"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("team-pipeline env vars not configured");
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

// PostgREST caps a single response at ~1000 rows. Page through with range()
// so big reads (a 5k-member roster, every member in scope) come back whole —
// otherwise dedupe + roll-up counts silently miss everything past row 1000.
async function fetchAll(makeQuery) {
  const PAGE = 1000;
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out = out.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
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
    .from("profiles").select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Stores the caller can see (org-wide roles see all; others by user_scopes).
async function storesForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE.has(role)) {
    const { data } = await supa.from("stores").select("id").eq("is_active", true).limit(5000);
    return { all: true, ids: new Set((data || []).map((s) => s.id)) };
  }
  const { data: scopes } = await supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, ids: new Set() };
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
  return { all: false, ids: storeIds };
}

const emptyRisk = () => ({ immediate: 0, medium: 0, low: 0, na: 0 });

// Tag each roster member with whether it's linked to an *active* app profile.
// Seed-from-profiles links a profile_id; the bulk ATS import doesn't — so this
// is what the "Account / No account" badge keys off.
async function annotateAccounts(supa, members) {
  const ids = [...new Set((members || []).map((m) => m.profile_id).filter(Boolean))];
  if (!ids.length) return (members || []).map((m) => ({ ...m, has_account: false }));
  const { data } = await supa.from("profiles").select("id, is_active").in("id", ids);
  const active = new Set((data || []).filter((p) => p.is_active !== false).map((p) => p.id));
  return (members || []).map((m) => ({ ...m, has_account: !!(m.profile_id && active.has(m.profile_id)) }));
}
const roleEditOn = (supa, user) => getFlag(supa, "team_pipeline_role_edit", { userId: user.id });

// Admin-tunable staffing model. target (excl GM) = ceil(weekly_sales / divisor).
async function tpSettings(supa) {
  const { data } = await supa.from("tp_settings").select("sales_per_member").eq("id", "global").maybeSingle();
  return { sales_per_member: data?.sales_per_member || 1200 };
}

// Latest-week weekly sales per store number, read live from the Ranker sheet.
// Returns Map<numberStr, sales>. Best-effort: if the sheet is unavailable
// (e.g. dev without Google creds) the targets simply fall back to null.
async function salesForStoreNumbers(storeNumbers) {
  const out = new Map();
  const nums = [...new Set((storeNumbers || []).map((n) => String(n)).filter(Boolean))];
  if (!nums.length) return out;
  try {
    const sheets = await getSheetsClient();
    const weeks = await getAvailableWeeks(sheets);
    if (!weeks.length) return out;
    const wk = String(weeks[weeks.length - 1]);
    const data = (await batchGetWeeks(sheets, [wk])).get(wk);
    if (!data) return out;
    for (const num of nums) {
      const row = findRowByStore(data.rows, num);
      const s = row ? parseNum(getMetricRaw(row, data.idx, "weeklySales")) : null;
      if (s !== null) out.set(num, s);
    }
  } catch { /* sheet unavailable — leave targets null */ }
  return out;
}
const targetFromSales = (sales, divisor) => (sales != null && divisor > 0 ? Math.ceil(sales / divisor) : null);

// Per-store talent aggregates, keyed by store id. The client overlays these
// onto its (already RLS-scoped) org tree, so we don't re-ship the org here.
async function rollup(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  if (ids && ids.length === 0) {
    return { stores: {}, can_write: VIEW_ROLES.has(String(user.role)), role_edit: await roleEditOn(supa, user), sales_per_member: (await tpSettings(supa)).sales_per_member };
  }

  // Terminated members are out of the pipeline — excluded from every aggregate.
  const members = await fetchAll(() => {
    let mq = supa.from("tp_team_members").select("store_id, role, flight_risk").neq("status", "terminated");
    if (ids) mq = mq.in("store_id", ids);
    return mq;
  });

  const reqs = await fetchAll(() => {
    let rq = supa.from("tp_requisitions").select("store_id, status");
    if (ids) rq = rq.in("store_id", ids);
    return rq;
  });

  const stores = {};
  const slot = (id) => (stores[id] ||= { risk: emptyRisk(), roster: 0, non_gm: 0, open_reqs: 0, gm_risk: null, sales: null, target: null });
  // Pre-create a slot for every scoped store so even an empty store shows its
  // sales-driven target.
  const idList = ids || Array.from(scope.ids);
  for (const id of idList) slot(id);
  for (const m of members || []) {
    const s = slot(m.store_id);
    s.roster++;
    if (m.role !== "gm") s.non_gm++;
    s.risk[m.flight_risk] = (s.risk[m.flight_risk] || 0) + 1;
    if (m.role === "gm") s.gm_risk = m.flight_risk;
  }
  for (const r of reqs || []) if (r.status !== "filled") slot(r.store_id).open_reqs++;

  // Overlay each store's sales-driven target (excl GM).
  const settings = await tpSettings(supa);
  const { data: srows } = idList.length ? await supa.from("stores").select("id, number").in("id", idList) : { data: [] };
  const numById = new Map((srows || []).map((s) => [s.id, String(s.number)]));
  const salesMap = await salesForStoreNumbers([...numById.values()]);
  for (const [id, s] of Object.entries(stores)) {
    const sales = salesMap.get(numById.get(id)) ?? null;
    s.sales = sales;
    s.target = targetFromSales(sales, settings.sales_per_member);
  }

  return { stores, can_write: VIEW_ROLES.has(String(user.role)), role_edit: await roleEditOn(supa, user), sales_per_member: settings.sales_per_member };
}

// ── Succession & Risk roll-up ─────────────────────────────────────────────────
// A leadership view (DO→COO): the named at-risk people in the caller's scope,
// and GM-seat backfill EXPOSURE — at-risk or open GM seats with no identified
// successor — plus the plan to close each gap, assembled from data already in
// the pipeline (risk, backfill, open reqs, corrective actions). Read-only.
async function succession(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  const empty = { at_risk: [], gm_seats: [], summary: emptySuccessionSummary() };
  if (ids && ids.length === 0) return empty;

  const [members, reqs, cas, succRows, storeRows] = await Promise.all([
    fetchAll(() => {
      let q = supa.from("tp_team_members")
        .select("id, store_id, full_name, role, flight_risk, risk_reasons, aspiration, perf, potential, backfill, hire_date")
        .neq("status", "terminated");
      if (ids) q = q.in("store_id", ids);
      return q;
    }),
    fetchAll(() => {
      let q = supa.from("tp_requisitions").select("store_id, role, status").neq("status", "filled");
      if (ids) q = q.in("store_id", ids);
      return q;
    }),
    fetchAll(() => {
      let q = supa.from("tp_corrective_actions").select("team_member_id, level, status").neq("status", "closed");
      if (ids) q = q.in("store_id", ids);
      return q;
    }),
    fetchAll(() => {
      let q = supa.from("tp_successors").select("id, incumbent_member_id, store_id, successor_member_id, successor_name, readiness, rank");
      if (ids) q = q.in("store_id", ids);
      return q;
    }),
    (async () => {
      let q = supa.from("stores").select("id, number, name, district_id").eq("is_active", true);
      if (ids) q = q.in("id", ids);
      const { data } = await q;
      return data || [];
    })(),
  ]);

  const storeById = new Map(storeRows.map((s) => [s.id, s]));
  const memberById = new Map((members || []).map((m) => [m.id, m]));
  const capByMember = new Map();
  for (const c of cas || []) {
    // Keep the most serious open level per member (pip > final > written > verbal).
    const rank = { verbal: 1, written: 2, final: 3, pip: 4 };
    const cur = capByMember.get(c.team_member_id);
    if (!cur || (rank[c.level] || 0) > (rank[cur] || 0)) capByMember.set(c.team_member_id, c.level);
  }
  const openGmReqByStore = new Map();
  for (const r of reqs || []) if (r.role === "gm") openGmReqByStore.set(r.store_id, r.status);

  const now = Date.now();
  const tenureDays = (d) => (d ? Math.max(0, Math.round((now - new Date(d).getTime()) / 86_400_000)) : null);
  const AT_RISK = new Set(["medium", "immediate"]);
  const RISK_RANK = { na: 0, low: 1, medium: 2, immediate: 3 };
  // Ladder order carhop→gm; higher index = more senior, so gm sorts first.
  const roleRank = { carhop: 0, crew: 1, lead: 2, shift: 3, assoc: 4, fam: 5, gm: 6 };
  // Readiness sort order — ready now first.
  const READY_RANK = { now: 0, "6mo": 1, "12mo": 2 };

  // Ranked bench per incumbent (usually a GM). Resolve each successor's live
  // name from the roster when it's an internal member, else the typed name.
  const benchByIncumbent = new Map();
  for (const s of (succRows || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
    const m = s.successor_member_id ? memberById.get(s.successor_member_id) : null;
    const entry = {
      id: s.id,
      successor_member_id: s.successor_member_id,
      name: m?.full_name || s.successor_name || "Unnamed successor",
      role: m?.role ?? null,
      readiness: s.readiness,
    };
    const arr = benchByIncumbent.get(s.incumbent_member_id);
    if (arr) arr.push(entry); else benchByIncumbent.set(s.incumbent_member_id, [entry]);
  }
  // Best (soonest) readiness on a bench, or null when empty.
  const bestReadiness = (bench) => {
    if (!bench || !bench.length) return null;
    return bench.map((b) => b.readiness).sort((a, b) => (READY_RANK[a] ?? 9) - (READY_RANK[b] ?? 9))[0];
  };

  // Named at-risk list (everyone flagged medium/immediate), worst-first.
  const at_risk = (members || [])
    .filter((m) => AT_RISK.has(m.flight_risk))
    .map((m) => {
      const st = storeById.get(m.store_id);
      return {
        member_id: m.id,
        name: m.full_name,
        store_id: m.store_id,
        store_number: st?.number ?? null,
        store_name: st?.name ?? null,
        district_id: st?.district_id ?? null,
        role: m.role,
        risk: m.flight_risk,
        reasons: m.risk_reasons || [],
        aspiration: m.aspiration,
        perf: m.perf,
        potential: m.potential,
        tenure_days: tenureDays(m.hire_date),
        cap_level: capByMember.get(m.id) || null,
        backfill: m.backfill || null,
      };
    })
    .sort((a, b) =>
      (RISK_RANK[b.risk] - RISK_RANK[a.risk]) ||
      ((roleRank[b.role] ?? 0) - (roleRank[a.role] ?? 0)) ||
      String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }),
    );

  // GM-seat exposure — one row per store: is the GM seat at-risk / open, and
  // does it have a backfill? Exposed = at-risk/open AND no backfill identified.
  const gmByStore = new Map();
  for (const m of members || []) if (m.role === "gm") gmByStore.set(m.store_id, m);

  const gm_seats = storeRows.map((st) => {
    const gm = gmByStore.get(st.id) || null;
    const openReq = openGmReqByStore.get(st.id) || null;
    let seat_status = "ok";
    if (!gm) seat_status = "open";
    else if (AT_RISK.has(gm.flight_risk)) seat_status = "at_risk";

    const bench = gm ? (benchByIncumbent.get(gm.id) || []) : [];
    const legacy = gm?.backfill || null; // pre-bench free-text successor
    const readiness = bestReadiness(bench); // soonest bench readiness, null if none
    // Coverage: a ranked bench (or legacy backfill) means covered; only a
    // ready-now successor means truly ready. Legacy text = developing (unknown).
    const hasBench = bench.length > 0 || !!legacy;
    const readyNow = readiness === "now";
    let coverage;
    if (seat_status === "ok") coverage = "ok";
    else if (readyNow) coverage = "ready";
    else if (hasBench) coverage = "developing";
    else coverage = "exposed";

    let plan;
    if (seat_status === "ok") plan = null;
    else if (readyNow) plan = { type: "ready", detail: `${bench.find((b) => b.readiness === "now").name} — ready now` };
    else if (bench.length) plan = { type: "develop", detail: `${bench[0].name} · ${bench[0].readiness === "6mo" ? "6 mo" : "12 mo"}` };
    else if (legacy) plan = { type: "develop", detail: legacy };
    else if (openReq) plan = { type: "req", detail: openReq };
    else plan = { type: "none", detail: seat_status === "open" ? "Open seat — no successor identified" : "No successor identified" };

    return {
      store_id: st.id,
      store_number: st.number,
      store_name: st.name,
      district_id: st.district_id,
      gm_name: gm?.full_name ?? null,
      gm_id: gm?.id ?? null,
      gm_risk: gm ? gm.flight_risk : null,
      seat_status,
      covered: coverage === "ready" || coverage === "developing",
      coverage,
      readiness,
      bench,
      backfill: legacy,
      req_status: openReq,
      plan,
    };
  });

  const uncovered = gm_seats.filter((s) => s.seat_status !== "ok");
  const summary = {
    at_risk_immediate: at_risk.filter((m) => m.risk === "immediate").length,
    at_risk_medium: at_risk.filter((m) => m.risk === "medium").length,
    at_risk_total: at_risk.length,
    gm_total: gm_seats.length,
    gm_at_risk: gm_seats.filter((s) => s.seat_status === "at_risk").length,
    gm_open: gm_seats.filter((s) => s.seat_status === "open").length,
    gm_ready: uncovered.filter((s) => s.coverage === "ready").length,
    gm_developing: uncovered.filter((s) => s.coverage === "developing").length,
    gm_covered: uncovered.filter((s) => s.covered).length,
    gm_exposed: uncovered.filter((s) => s.coverage === "exposed").length,
  };

  return { at_risk, gm_seats, summary };
}

function emptySuccessionSummary() {
  return { at_risk_immediate: 0, at_risk_medium: 0, at_risk_total: 0, gm_total: 0, gm_at_risk: 0, gm_open: 0, gm_ready: 0, gm_developing: 0, gm_covered: 0, gm_exposed: 0 };
}

async function storeRoster(supa, user, storeId) {
  if (!storeId) return { error: "Missing store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const all = await fetchAll(() => supa.from("tp_team_members").select("*").eq("store_id", storeId).order("created_at", { ascending: true }));
  const { data: reqs } = await supa.from("tp_requisitions").select("*").eq("store_id", storeId).neq("status", "filled").order("created_at", { ascending: false });
  const annotated = await annotateAccounts(supa, all);
  const settings = await tpSettings(supa);
  const { data: srow } = await supa.from("stores").select("number").eq("id", storeId).maybeSingle();
  const sales = srow ? (await salesForStoreNumbers([srow.number])).get(String(srow.number)) ?? null : null;
  return {
    // Terminated members drop out of the active pipeline but stay accessible
    // in their own list (rehire / history).
    roster: annotated.filter((m) => m.status !== "terminated"),
    terminated: annotated.filter((m) => m.status === "terminated"),
    reqs: reqs || [],
    can_write: VIEW_ROLES.has(String(user.role)),
    role_edit: await roleEditOn(supa, user),
    weekly_sales: sales,
    sales_per_member: settings.sales_per_member,
    target: targetFromSales(sales, settings.sales_per_member), // total team members (excl GM)
  };
}

// Every GM (role=gm) in the caller's scope — the GM bench. The client keys
// these by store_id against its org tree to render the district bench.
async function gms(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  if (ids && ids.length === 0) return { gms: [] };
  let q = supa.from("tp_team_members").select("*").eq("role", "gm").neq("status", "terminated");
  if (ids) q = q.in("store_id", ids);
  const { data } = await q;
  return { gms: await annotateAccounts(supa, data) };
}

// Admin-only: bootstrap the roster from existing SOAR profiles that have a
// home store + a store-floor/GM role. Idempotent (skips already-linked
// profiles). A stop-gap so the views have real data before the ATS import.
async function seedFromProfiles(supa, user) {
  if (String(user.role) !== "admin") return { error: "Admin only.", status: 403 };
  const { data: profs } = await supa
    .from("profiles").select("id, full_name, preferred_name, email, role, primary_store_id")
    .not("primary_store_id", "is", null);
  let created = 0;
  for (const p of profs || []) {
    const rk = ROLE_MAP[String(p.role)];
    if (!rk) continue;
    const { data: exists } = await supa.from("tp_team_members").select("id").eq("profile_id", p.id).maybeSingle();
    if (exists) continue;
    const { error } = await supa.from("tp_team_members").insert({
      store_id: p.primary_store_id, profile_id: p.id, role: rk,
      full_name: p.preferred_name || p.full_name || p.email || "Team member", email: p.email,
    });
    if (!error) created++;
  }
  return { ok: true, created };
}

// Commit a staffing plan: apply promotions (role changes) and open one
// requisition per queued hire. Scoped to the caller's store.
function reqRef() { return "REQ-" + Math.floor(1000 + Math.random() * 9000); }
async function commitPlan(supa, user, body) {
  const storeId = body?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const name = user.preferred_name || user.full_name || user.email || "Someone";

  let promoted = 0, reqsOpened = 0;
  const promotions = Array.isArray(body?.promotions) ? body.promotions : [];
  for (const p of promotions) {
    if (!p?.member_id || !p?.to_role || !ROLE_KEYS.has(String(p.to_role))) continue;
    const { error } = await supa.from("tp_team_members")
      .update({ role: String(p.to_role) }).eq("id", p.member_id).eq("store_id", storeId);
    if (!error) promoted++;
  }
  const hires = body?.hires && typeof body.hires === "object" ? body.hires : {};
  for (const [role, count] of Object.entries(hires)) {
    if (!ROLE_KEYS.has(role)) continue;
    const n = Math.max(0, Math.min(20, parseInt(count, 10) || 0));
    for (let i = 0; i < n; i++) {
      const { error } = await supa.from("tp_requisitions").insert({
        store_id: storeId, role, ref: reqRef(), reason: "Staffing gap vs. sales tier",
        status: "sourcing", opened_by: name, opened_by_id: user.id,
      });
      if (!error) reqsOpened++;
    }
  }
  return { ok: true, promoted, reqs_opened: reqsOpened };
}

// Resolve a roster member and confirm it falls inside the caller's scope.
async function memberInScope(supa, scope, memberId) {
  const { data: m } = await supa.from("tp_team_members").select("id, store_id").eq("id", memberId).maybeSingle();
  if (!m) return null;
  if (!scope.all && !scope.ids.has(m.store_id)) return null;
  return m;
}
function clampRating(v) {
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : Math.max(1, Math.min(5, n));
}
const RISK_VALS = new Set(["na", "low", "medium", "immediate"]);
const ASPIRATION_VALS = new Set(["current", "next", "looking"]);
const STATUS_VALS = new Set(["active", "loa", "terminated"]);

// Patch a roster member's talent overlay (risk, aspiration, ratings, backfill,
// status). Only known fields with valid values are written.
async function updateMember(supa, user, body) {
  const id = body?.member_id;
  if (!id) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, id))) return { error: "That team member is outside your scope.", status: 403 };
  const p = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const patch = {};
  if ("role" in p) {
    if (!ROLE_KEYS.has(p.role)) return { error: "Unknown role.", status: 400 };
    if (!(await roleEditOn(supa, user))) return { error: "Role editing is turned off in settings.", status: 403 };
    patch.role = p.role;
  }
  if ("flight_risk" in p && RISK_VALS.has(p.flight_risk)) patch.flight_risk = p.flight_risk;
  if ("aspiration" in p && ASPIRATION_VALS.has(p.aspiration)) patch.aspiration = p.aspiration;
  if ("status" in p && STATUS_VALS.has(p.status)) patch.status = p.status;
  if ("perf" in p) patch.perf = clampRating(p.perf);
  if ("potential" in p) patch.potential = clampRating(p.potential);
  if ("backfill" in p) patch.backfill = p.backfill == null ? null : String(p.backfill).slice(0, 300);
  if ("risk_reasons" in p && Array.isArray(p.risk_reasons)) {
    patch.risk_reasons = p.risk_reasons.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 12);
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_team_members").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, member: data };
}

async function listNotes(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, memberId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data } = await supa.from("tp_notes").select("*").eq("team_member_id", memberId).order("created_at", { ascending: false });
  return { notes: data || [] };
}

// Append a note to the member's thread; also mirror it onto comment/comment_by
// so the GM bench "latest comment" column stays current.
async function addNote(supa, user, body) {
  const id = body?.member_id;
  const text = String(body?.body || "").trim();
  if (!id) return { error: "Missing team member.", status: 400 };
  if (!text) return { error: "A note needs some text.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, id))) return { error: "That team member is outside your scope.", status: 403 };
  const author = user.preferred_name || user.full_name || user.email || "Someone";
  const clipped = text.slice(0, 2000);
  const { data, error } = await supa.from("tp_notes")
    .insert({ team_member_id: id, body: clipped, author, author_id: user.id }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  await supa.from("tp_team_members").update({ comment: clipped, comment_by: author }).eq("id", id);
  return { ok: true, note: data };
}

const REQ_STATUS = new Set(["sourcing", "interviewing", "offer", "filled"]);
async function updateReq(supa, user, body) {
  const id = body?.req_id;
  if (!id) return { error: "Missing requisition.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: r } = await supa.from("tp_requisitions").select("id, store_id").eq("id", id).maybeSingle();
  if (!r || (!scope.all && !scope.ids.has(r.store_id))) return { error: "That requisition is outside your scope.", status: 403 };
  const patch = {};
  if ("status" in (body || {}) && REQ_STATUS.has(body.status)) {
    patch.status = body.status;
    patch.filled_at = body.status === "filled" ? new Date().toISOString() : null;
  }
  if ("candidates" in (body || {})) {
    const n = parseInt(body.candidates, 10);
    if (!Number.isNaN(n)) patch.candidates = Math.max(0, Math.min(99, n));
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_requisitions").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, req: data };
}

// Corrective-action documents (progressive discipline) on a roster member.
const CA_LEVELS = new Set(["verbal", "written", "final", "pip"]);
const CA_STATUS = new Set(["active", "acknowledged", "closed"]);

async function listCorrectiveActions(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, memberId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data } = await supa.from("tp_corrective_actions").select("*").eq("team_member_id", memberId).order("created_at", { ascending: false });
  return { actions: data || [] };
}

async function addCorrectiveAction(supa, user, body) {
  const id = body?.member_id;
  const level = String(body?.level || "");
  const summary = String(body?.summary || "").trim();
  if (!id) return { error: "Missing team member.", status: 400 };
  if (!CA_LEVELS.has(level)) return { error: "Pick a corrective-action level.", status: 400 };
  if (!summary) return { error: "Describe the incident.", status: 400 };
  const scope = await storesForUser(supa, user);
  const m = await memberInScope(supa, scope, id);
  if (!m) return { error: "That team member is outside your scope.", status: 403 };
  const clip = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
  const row = {
    team_member_id: id, store_id: m.store_id, level,
    category: clip(body?.category, 40),
    incident_date: body?.incident_date || null,
    summary: summary.slice(0, 4000),
    expectations: clip(body?.expectations, 4000),
    consequence: clip(body?.consequence, 4000),
    issued_by: user.preferred_name || user.full_name || user.email || "Someone",
    issued_by_id: user.id,
  };
  const { data, error } = await supa.from("tp_corrective_actions").insert(row).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, action: data };
}

async function setCorrectiveActionStatus(supa, user, body) {
  const id = body?.action_id;
  const status = String(body?.status || "");
  if (!id || !CA_STATUS.has(status)) return { error: "Missing or invalid status.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: ca } = await supa.from("tp_corrective_actions").select("id, store_id").eq("id", id).maybeSingle();
  if (!ca || (!scope.all && !scope.ids.has(ca.store_id))) return { error: "That document is outside your scope.", status: 403 };
  const patch = { status };
  if (status === "acknowledged") {
    patch.acknowledged_at = new Date().toISOString();
    patch.acknowledged_by = user.preferred_name || user.full_name || user.email || "Someone";
  }
  const { data, error } = await supa.from("tp_corrective_actions").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, action: data };
}

// ── Succession bench (ranked successors + readiness) ──────────────────────────
// Each roster member (usually a GM) can carry a ranked bench of successors,
// each an internal roster member or a free-text name, tagged ready-now / 6mo /
// 12mo. This replaces the single free-text backfill so the roll-up can tell
// "covered but not ready" from "ready now".
const READINESS_VALS = new Set(["now", "6mo", "12mo"]);

// Attach the resolved display name to each bench row: an internal successor's
// current full_name (kept live), else the typed successor_name.
async function resolveSuccessorNames(supa, rows) {
  const memberIds = [...new Set(rows.map((r) => r.successor_member_id).filter(Boolean))];
  const nameById = new Map();
  if (memberIds.length) {
    const { data } = await supa.from("tp_team_members").select("id, full_name, role, store_id").in("id", memberIds);
    for (const m of data || []) nameById.set(m.id, m);
  }
  return rows.map((r) => {
    const m = r.successor_member_id ? nameById.get(r.successor_member_id) : null;
    return {
      id: r.id,
      incumbent_member_id: r.incumbent_member_id,
      store_id: r.store_id,
      successor_member_id: r.successor_member_id,
      successor_name: r.successor_name,
      name: m?.full_name || r.successor_name || "Unnamed successor",
      successor_role: m?.role ?? null,
      successor_store_id: m?.store_id ?? null,
      readiness: r.readiness,
      rank: r.rank,
      note: r.note,
    };
  });
}

async function listSuccessors(supa, user, incumbentId) {
  if (!incumbentId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, incumbentId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data } = await supa.from("tp_successors").select("*").eq("incumbent_member_id", incumbentId)
    .order("rank", { ascending: true }).order("created_at", { ascending: true });
  return { successors: await resolveSuccessorNames(supa, data || []) };
}

async function addSuccessor(supa, user, body) {
  const incumbentId = body?.member_id;
  if (!incumbentId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  const inc = await memberInScope(supa, scope, incumbentId);
  if (!inc) return { error: "That team member is outside your scope.", status: 403 };
  const readiness = READINESS_VALS.has(body?.readiness) ? body.readiness : "6mo";
  const successorMemberId = body?.successor_member_id || null;
  const successorName = body?.successor_name == null ? null : String(body.successor_name).trim().slice(0, 200) || null;
  if (!successorMemberId && !successorName) return { error: "Pick a successor or type a name.", status: 400 };
  // An internal successor must itself be inside the caller's scope.
  if (successorMemberId && !(await memberInScope(supa, scope, successorMemberId))) {
    return { error: "That successor is outside your scope.", status: 403 };
  }
  // Next rank = end of the current bench.
  const { data: existing } = await supa.from("tp_successors").select("rank").eq("incumbent_member_id", incumbentId);
  const nextRank = (existing || []).reduce((mx, r) => Math.max(mx, (r.rank ?? 0) + 1), 0);
  const row = {
    store_id: inc.store_id, incumbent_member_id: incumbentId,
    successor_member_id: successorMemberId, successor_name: successorMemberId ? null : successorName,
    readiness, rank: nextRank,
    note: body?.note == null || body.note === "" ? null : String(body.note).slice(0, 500),
    created_by: user.id,
  };
  const { data, error } = await supa.from("tp_successors").insert(row).select("*").single();
  if (error) return { error: error.message, status: 500 };
  const [resolved] = await resolveSuccessorNames(supa, [data]);
  return { ok: true, successor: resolved };
}

async function updateSuccessor(supa, user, body) {
  const id = body?.successor_id;
  if (!id) return { error: "Missing successor.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: s } = await supa.from("tp_successors").select("id, store_id").eq("id", id).maybeSingle();
  if (!s || (!scope.all && !scope.ids.has(s.store_id))) return { error: "That successor is outside your scope.", status: 403 };
  const p = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const patch = { updated_at: new Date().toISOString() };
  if ("readiness" in p && READINESS_VALS.has(p.readiness)) patch.readiness = p.readiness;
  if ("rank" in p) { const n = parseInt(p.rank, 10); if (!Number.isNaN(n)) patch.rank = Math.max(0, Math.min(99, n)); }
  if ("note" in p) patch.note = p.note == null || p.note === "" ? null : String(p.note).slice(0, 500);
  if ("successor_name" in p) patch.successor_name = p.successor_name == null ? null : String(p.successor_name).trim().slice(0, 200) || null;
  if (Object.keys(patch).length === 1) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_successors").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  const [resolved] = await resolveSuccessorNames(supa, [data]);
  return { ok: true, successor: resolved };
}

async function removeSuccessor(supa, user, body) {
  const id = body?.successor_id;
  if (!id) return { error: "Missing successor.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: s } = await supa.from("tp_successors").select("id, store_id").eq("id", id).maybeSingle();
  if (!s || (!scope.all && !scope.ids.has(s.store_id))) return { error: "That successor is outside your scope.", status: 403 };
  const { error } = await supa.from("tp_successors").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// ── Quarterly calibration snapshots ───────────────────────────────────────────
// A company-wide snapshot freezes every roster member's talent overlay for a
// period ('2026-Q3'), so the 9-box can show quarter-over-quarter movement and a
// locked period is the calibration record. Taken + locked by org-wide roles
// (VP+); everyone in scope compares against them.
const isOrgWide = (user) => ORG_WIDE.has(String(user.role || "").toLowerCase());
const PERIOD_RE = /^\d{4}-Q[1-4]$/;

async function listSnapshots(supa, user) {
  const { data } = await supa.from("tp_snapshots")
    .select("period, status, member_count, created_at, locked_at")
    .order("created_at", { ascending: false });
  return { snapshots: data || [], can_manage: isOrgWide(user) };
}

async function takeSnapshot(supa, user, body) {
  if (!isOrgWide(user)) return { error: "Company calibration snapshots are for VP and above.", status: 403 };
  const period = String(body?.period || "").trim();
  if (!PERIOD_RE.test(period)) return { error: "Period must look like 2026-Q3.", status: 400 };
  const { data: existing } = await supa.from("tp_snapshots").select("id, status").eq("period", period).maybeSingle();
  if (existing?.status === "locked") return { error: `${period} is locked. Take a new period instead.`, status: 409 };
  let snapId = existing?.id;
  if (snapId) {
    await supa.from("tp_snapshot_rows").delete().eq("snapshot_id", snapId);
  } else {
    const { data, error } = await supa.from("tp_snapshots").insert({ period, created_by: user.id }).select("id").single();
    if (error) return { error: error.message, status: 500 };
    snapId = data.id;
  }
  // Freeze every non-terminated member's talent overlay, company-wide.
  const members = await fetchAll(() => supa.from("tp_team_members")
    .select("id, store_id, role, perf, potential, flight_risk, aspiration").neq("status", "terminated"));
  const rows = (members || []).map((m) => ({
    snapshot_id: snapId, member_id: m.id, store_id: m.store_id, role: m.role,
    perf: m.perf, potential: m.potential, flight_risk: m.flight_risk, aspiration: m.aspiration,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa.from("tp_snapshot_rows").insert(rows.slice(i, i + 500));
    if (error) return { error: error.message, status: 500 };
  }
  await supa.from("tp_snapshots").update({ member_count: rows.length }).eq("id", snapId);
  return { ok: true, period, member_count: rows.length, replaced: !!existing };
}

async function lockSnapshot(supa, user, body) {
  if (!isOrgWide(user)) return { error: "Locking a calibration is for VP and above.", status: 403 };
  const period = String(body?.period || "").trim();
  const { data: snap } = await supa.from("tp_snapshots").select("id, status").eq("period", period).maybeSingle();
  if (!snap) return { error: "No snapshot for that period.", status: 404 };
  if (snap.status === "locked") return { ok: true, period, status: "locked" };
  const { error } = await supa.from("tp_snapshots")
    .update({ status: "locked", locked_at: new Date().toISOString(), locked_by: user.id }).eq("id", snap.id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true, period, status: "locked" };
}

// Frozen rows for a period, scoped to the caller (optional store filter). The
// 9-box overlays these to draw each member's movement since the snapshot.
async function snapshotRows(supa, user, params) {
  const period = String(params?.period || "").trim();
  if (!period) return { error: "Missing period.", status: 400 };
  const { data: snap } = await supa.from("tp_snapshots").select("id").eq("period", period).maybeSingle();
  if (!snap) return { error: "No snapshot for that period.", status: 404 };
  const scope = await storesForUser(supa, user);
  const storeId = params?.store_id || null;
  if (storeId && !scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const scopeIds = scope.all ? null : Array.from(scope.ids);
  if (!storeId && scopeIds && scopeIds.length === 0) return { period, rows: [] };
  const rows = await fetchAll(() => {
    let q = supa.from("tp_snapshot_rows")
      .select("member_id, store_id, role, perf, potential, flight_risk, aspiration").eq("snapshot_id", snap.id);
    if (storeId) q = q.eq("store_id", storeId);
    else if (scopeIds) q = q.in("store_id", scopeIds);
    return q;
  });
  return { period, rows: rows || [] };
}

// ── Partner Development Plans (PDP) ────────────────────────────────────────────
// A career development map per roster member: a header (future/target role +
// date) plus ranked development items (focus area → goal → actions → date →
// progress). Editable by anyone who can write in the member's scope.
const DEV_ITEM_STATUS = new Set(["open", "in_progress", "done"]);

// Return the member's active plan, lazily creating one when `create` is set.
async function getActivePlan(supa, member, userId, create) {
  const { data: existing } = await supa.from("tp_dev_plans")
    .select("*").eq("member_id", member.id).eq("status", "active").maybeSingle();
  if (existing || !create) return existing || null;
  const { data, error } = await supa.from("tp_dev_plans")
    .insert({ member_id: member.id, store_id: member.store_id, created_by: userId }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

async function getDevPlan(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  const m = await memberInScope(supa, scope, memberId);
  if (!m) return { error: "That team member is outside your scope.", status: 403 };
  const plan = await getActivePlan(supa, m, user.id, false);
  if (!plan) return { plan: null, items: [] };
  const { data: items } = await supa.from("tp_dev_items").select("*").eq("plan_id", plan.id)
    .order("rank", { ascending: true }).order("created_at", { ascending: true });
  return { plan, items: items || [] };
}

const clipText = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));

async function saveDevPlan(supa, user, body) {
  const memberId = body?.member_id;
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  const m = await memberInScope(supa, scope, memberId);
  if (!m) return { error: "That team member is outside your scope.", status: 403 };
  const plan = await getActivePlan(supa, m, user.id, true);
  const patch = { updated_at: new Date().toISOString() };
  if ("target_role" in (body || {})) patch.target_role = clipText(body.target_role, 120);
  if ("target_date" in (body || {})) patch.target_date = body.target_date || null;
  const { data, error } = await supa.from("tp_dev_plans").update(patch).eq("id", plan.id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, plan: data };
}

async function addDevItem(supa, user, body) {
  const memberId = body?.member_id;
  const focus = String(body?.focus_area || "").trim();
  if (!memberId) return { error: "Missing team member.", status: 400 };
  if (!focus) return { error: "Name a behavior or skill to develop.", status: 400 };
  const scope = await storesForUser(supa, user);
  const m = await memberInScope(supa, scope, memberId);
  if (!m) return { error: "That team member is outside your scope.", status: 403 };
  const plan = await getActivePlan(supa, m, user.id, true);
  const { data: existing } = await supa.from("tp_dev_items").select("rank").eq("plan_id", plan.id);
  const nextRank = (existing || []).reduce((mx, r) => Math.max(mx, (r.rank ?? 0) + 1), 0);
  const row = {
    plan_id: plan.id, store_id: m.store_id, focus_area: focus.slice(0, 200),
    goal: clipText(body?.goal, 1000), actions: clipText(body?.actions, 1000),
    target_date: body?.target_date || null, progress: clipText(body?.progress, 2000),
    rank: nextRank, created_by: user.id,
  };
  const { data, error } = await supa.from("tp_dev_items").insert(row).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, item: data };
}

async function updateDevItem(supa, user, body) {
  const id = body?.item_id;
  if (!id) return { error: "Missing item.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: it } = await supa.from("tp_dev_items").select("id, store_id").eq("id", id).maybeSingle();
  if (!it || (!scope.all && !scope.ids.has(it.store_id))) return { error: "That item is outside your scope.", status: 403 };
  const p = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const patch = { updated_at: new Date().toISOString() };
  if ("focus_area" in p) { const f = String(p.focus_area || "").trim(); if (f) patch.focus_area = f.slice(0, 200); }
  if ("goal" in p) patch.goal = clipText(p.goal, 1000);
  if ("actions" in p) patch.actions = clipText(p.actions, 1000);
  if ("progress" in p) patch.progress = clipText(p.progress, 2000);
  if ("target_date" in p) patch.target_date = p.target_date || null;
  if ("status" in p && DEV_ITEM_STATUS.has(p.status)) patch.status = p.status;
  if ("rank" in p) { const n = parseInt(p.rank, 10); if (!Number.isNaN(n)) patch.rank = Math.max(0, Math.min(99, n)); }
  if (Object.keys(patch).length === 1) return { error: "Nothing to update.", status: 400 };
  const { data, error } = await supa.from("tp_dev_items").update(patch).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, item: data };
}

async function removeDevItem(supa, user, body) {
  const id = body?.item_id;
  if (!id) return { error: "Missing item.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: it } = await supa.from("tp_dev_items").select("id, store_id").eq("id", id).maybeSingle();
  if (!it || (!scope.all && !scope.ids.has(it.store_id))) return { error: "That item is outside your scope.", status: 403 };
  const { error } = await supa.from("tp_dev_items").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// ── Signal-assisted risk ──────────────────────────────────────────────────────
// Surface data-driven risk cues from data already in the pipeline (corrective
// actions, aspiration, tenure, ratings, development-plan coverage) so leaders
// flag with evidence instead of guessing — and so we can review people the
// data flags that a leader hasn't. Pure function; no I/O.
const RISK_ORDER = { na: 0, low: 1, medium: 2, immediate: 3 };
const CA_ORDER = { verbal: 1, written: 2, final: 3, pip: 4 };
const riskFromRank = (rank) => Object.keys(RISK_ORDER).find((k) => RISK_ORDER[k] === rank) || "na";

// m: { role, perf, potential, aspiration, flight_risk, hire_date }
// capLevels: open corrective-action levels for the member; hasPlan: active PDP.
function computeSignals(m, capLevels, hasPlan) {
  const signals = [];
  const add = (key, severity, label, detail, implies) => signals.push({ key, severity, label, detail, implies });
  const now = Date.now();
  const tenureDays = m.hire_date ? Math.max(0, Math.round((now - new Date(m.hire_date).getTime()) / 86_400_000)) : null;

  const levels = capLevels || [];
  const worstCa = levels.reduce((mx, l) => Math.max(mx, CA_ORDER[l] || 0), 0);
  if (worstCa >= 3) add("discipline", "elevated", `Active ${worstCa === 4 ? "PIP" : "final warning"}`, "Unresolved corrective action on file", "immediate");
  else if (levels.length >= 2) add("discipline", "elevated", "Multiple active write-ups", `${levels.length} open corrective actions`, "medium");
  else if (levels.length === 1) add("discipline", "watch", "Active corrective action", "1 open write-up", "low");

  if (m.aspiration === "looking") add("looking", "elevated", "Signaled they're looking", "Aspiration set to Looking", "immediate");

  if (tenureDays != null && tenureDays < 90) add("newhire", "watch", "New hire (<90 days)", "Onboarding ramp — higher early-attrition risk", "low");
  else if (tenureDays != null && tenureDays > 1095 && m.aspiration === "current") add("tenure", "watch", "3+ years, aiming to stay", "Long tenure with no stated next step — check engagement", "low");

  const star = (m.perf ?? 0) >= 4 && (m.potential ?? 0) >= 4;
  if (star && !hasPlan) add("star_noplan", "elevated", "Top talent, no development plan", "High performer + potential with no PDP — retention risk", "medium");

  if (m.perf != null && m.perf <= 2) add("lowperf", "watch", "Low performance rating", `Performance ${m.perf}/5`, "medium");

  const suggestedRank = signals.reduce((mx, s) => Math.max(mx, RISK_ORDER[s.implies] || 0), 0);
  const suggested = riskFromRank(suggestedRank);
  const gap = suggestedRank > (RISK_ORDER[m.flight_risk] || 0);
  return { signals, suggested, gap };
}

// Open corrective-action levels per member id, for a set of member ids.
async function openCaLevelsByMember(supa, memberIds) {
  const out = new Map();
  if (!memberIds.length) return out;
  const rows = await fetchAll(() => supa.from("tp_corrective_actions")
    .select("team_member_id, level").neq("status", "closed").in("team_member_id", memberIds));
  for (const r of rows || []) {
    const arr = out.get(r.team_member_id);
    if (arr) arr.push(r.level); else out.set(r.team_member_id, [r.level]);
  }
  return out;
}

async function memberSignals(supa, user, memberId) {
  if (!memberId) return { error: "Missing team member.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!(await memberInScope(supa, scope, memberId))) return { error: "That team member is outside your scope.", status: 403 };
  const { data: m } = await supa.from("tp_team_members")
    .select("role, perf, potential, aspiration, flight_risk, hire_date").eq("id", memberId).single();
  const capMap = await openCaLevelsByMember(supa, [memberId]);
  const { data: plan } = await supa.from("tp_dev_plans").select("id").eq("member_id", memberId).eq("status", "active").maybeSingle();
  return computeSignals(m, capMap.get(memberId) || [], !!plan);
}

// Scope-wide review queue: everyone with at least one signal, gaps (data flags
// higher than the manual risk) first. The leadership "who should I look at?".
async function riskReview(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  const empty = { rows: [], summary: { total: 0, gaps: 0 } };
  if (ids && ids.length === 0) return empty;

  const members = await fetchAll(() => {
    let q = supa.from("tp_team_members")
      .select("id, store_id, full_name, role, perf, potential, aspiration, flight_risk, hire_date").neq("status", "terminated");
    if (ids) q = q.in("store_id", ids);
    return q;
  });
  const memberIds = (members || []).map((m) => m.id);
  const [capMap, planRows, storeRows] = await Promise.all([
    openCaLevelsByMember(supa, memberIds),
    fetchAll(() => {
      let q = supa.from("tp_dev_plans").select("member_id").eq("status", "active");
      if (ids) q = q.in("store_id", ids);
      return q;
    }),
    (async () => {
      let q = supa.from("stores").select("id, number, name, district_id").eq("is_active", true);
      if (ids) q = q.in("id", ids);
      const { data } = await q;
      return data || [];
    })(),
  ]);
  const planned = new Set((planRows || []).map((p) => p.member_id));
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  const rows = [];
  for (const m of members || []) {
    const { signals, suggested, gap } = computeSignals(m, capMap.get(m.id) || [], planned.has(m.id));
    if (!signals.length) continue;
    const st = storeById.get(m.store_id);
    const top = signals.slice().sort((a, b) => (RISK_ORDER[b.implies] || 0) - (RISK_ORDER[a.implies] || 0))[0];
    rows.push({
      member_id: m.id, name: m.full_name, store_id: m.store_id,
      store_number: st?.number ?? null, store_name: st?.name ?? null, district_id: st?.district_id ?? null,
      role: m.role, flight_risk: m.flight_risk, suggested, gap,
      top_signal: top, signal_count: signals.length,
      // Enough of the member overlay for the drawer to open from the row.
      perf: m.perf, potential: m.potential, aspiration: m.aspiration, hire_date: m.hire_date,
    });
  }
  rows.sort((a, b) =>
    (Number(b.gap) - Number(a.gap)) ||
    ((RISK_ORDER[b.suggested] || 0) - (RISK_ORDER[a.suggested] || 0)) ||
    (b.signal_count - a.signal_count) ||
    String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }));
  return { rows, summary: { total: rows.length, gaps: rows.filter((r) => r.gap).length } };
}

// ── ATS roster bulk import ────────────────────────────────────────────────────
// Replaces the seed-from-profiles stop-gap. Rows carry an employee + store
// number + role; we map the ATS role title onto a ladder key, resolve the
// store within the caller's scope, dedupe on external_id (else store+name),
// and upsert. The talent overlay (flight risk, ratings, notes) is never
// touched — only the HR fields the ATS owns.
const ATS_ROLE_MAP = {
  "gm": "gm", "general manager": "gm",
  "fam": "fam", "first assistant manager": "fam", "1st assistant manager": "fam", "first assistant": "fam",
  "am": "assoc", "associate manager": "assoc", "assoc manager": "assoc", "asst manager": "assoc",
  "sm": "shift", "shift manager": "shift", "shift lead": "shift", "shift leader": "shift",
  "cl": "lead", "crew leader": "lead", "lead": "lead", "team lead": "lead",
  "cm": "crew", "crew member": "crew", "crew": "crew", "team member": "crew",
  "ch": "carhop", "carhop": "carhop", "car hop": "carhop", "skating carhop": "carhop",
};
function normalizeRole(raw) {
  const k = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (ROLE_KEYS.has(k)) return k;
  return ATS_ROLE_MAP[k] || null;
}

// Build the lookup context once per request: in-scope store-number → id, plus
// existing roster members for dedupe (by external_id and by store+name).
async function importContext(supa, user) {
  const scope = await storesForUser(supa, user);
  const ids = scope.all ? null : Array.from(scope.ids);
  let sq = supa.from("stores").select("id, number").eq("is_active", true);
  if (ids) {
    if (ids.length === 0) return { byNumber: new Map(), existingExt: new Map(), existingName: new Map() };
    sq = sq.in("id", ids);
  }
  const { data: stores } = await sq;
  const byNumber = new Map((stores || []).map((s) => [String(s.number), s.id]));
  const storeIds = (stores || []).map((s) => s.id);
  const existingExt = new Map();
  const existingName = new Map();
  if (storeIds.length) {
    const mem = await fetchAll(() => supa.from("tp_team_members").select("id, external_id, full_name, store_id").in("store_id", storeIds));
    for (const m of mem) {
      if (m.external_id) existingExt.set(String(m.external_id), m.id);
      existingName.set(`${m.store_id}|${(m.full_name || "").trim().toLowerCase()}`, m.id);
    }
  }
  return { byNumber, existingExt, existingName };
}

function annotateImportRow(idx, raw, ctx) {
  const errors = [], warnings = [];
  const full_name = String(raw?.full_name || "").trim();
  const store_number = String(raw?.store_number || "").trim();
  const roleRaw = String(raw?.role || "").trim();
  const external_id = String(raw?.external_id || "").trim() || null;
  const email = String(raw?.email || "").trim() || null;
  const phone = String(raw?.phone || "").trim() || null;

  if (!full_name) errors.push("Missing full_name");
  if (!store_number) errors.push("Missing store_number");
  const store_id = store_number ? (ctx.byNumber.get(store_number) || null) : null;
  if (store_number && !store_id) errors.push(`Store #${store_number} not found or out of scope`);
  const role = normalizeRole(roleRaw);
  if (!roleRaw) errors.push("Missing role");
  else if (!role) errors.push(`Unrecognized role "${roleRaw}"`);

  let status = String(raw?.status || "").trim().toLowerCase();
  if (status && !STATUS_VALS.has(status)) { warnings.push(`Unknown status "${status}" → active`); status = "active"; }
  if (!status) status = "active";

  let hire_date = String(raw?.hire_date || "").trim() || null;
  if (hire_date && !/^\d{4}-\d{2}-\d{2}$/.test(hire_date)) { warnings.push("hire_date not YYYY-MM-DD → skipped"); hire_date = null; }

  let existingId = null;
  const nameKey = store_id ? `${store_id}|${full_name.toLowerCase()}` : null;
  if (external_id && ctx.existingExt.has(external_id)) existingId = ctx.existingExt.get(external_id);
  else if (nameKey && ctx.existingName.has(nameKey)) existingId = ctx.existingName.get(nameKey);

  const action = errors.length ? "error" : existingId ? "update" : "create";
  return { row: idx + 1, full_name, store_number, role, status, hire_date, email, phone, external_id, store_id, existing_id: existingId, action, errors, warnings };
}

function importRows(body) { return Array.isArray(body?.rows) ? body.rows.slice(0, 5000) : []; }

// Run async work over a list with bounded concurrency so a few thousand rows
// don't take a few thousand sequential round-trips (which would time the
// function out). Preserves input order in the result array.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function previewImport(supa, user, body) {
  const rows = importRows(body);
  if (!rows.length) return { error: "No rows to preview.", status: 400 };
  const ctx = await importContext(supa, user);
  const annotated = rows.map((r, i) => annotateImportRow(i, r, ctx));
  const summary = { create: 0, update: 0, error: 0 };
  for (const a of annotated) summary[a.action]++;
  return { rows: annotated, summary };
}

const importFields = (a) => ({
  store_id: a.store_id, full_name: a.full_name, role: a.role,
  email: a.email, phone: a.phone, status: a.status, hire_date: a.hire_date, external_id: a.external_id,
});

async function importRoster(supa, user, body) {
  const rows = importRows(body);
  if (!rows.length) return { error: "No rows to import.", status: 400 };
  // mode: all (default) | new (creates only) | update (matches only)
  const mode = ["all", "new", "update"].includes(body?.mode) ? body.mode : "all";
  const ctx = await importContext(supa, user);
  const annotated = rows.map((r, i) => annotateImportRow(i, r, ctx));

  // Process each row with bounded concurrency rather than one-at-a-time, so
  // a 2k-row import finishes in seconds instead of timing out.
  const results = await mapLimit(annotated, 24, async (a) => {
    if (a.action === "error") return { row: a.row, status: "error", full_name: a.full_name, message: a.errors.join("; ") };
    if ((mode === "new" && a.action === "update") || (mode === "update" && a.action === "create")) {
      return { row: a.row, status: "skipped", full_name: a.full_name, message: `${mode} only` };
    }
    if (a.existing_id) {
      const { error } = await supa.from("tp_team_members").update(importFields(a)).eq("id", a.existing_id);
      return error
        ? { row: a.row, status: "error", full_name: a.full_name, message: error.message }
        : { row: a.row, status: "updated", full_name: a.full_name };
    }
    const { error } = await supa.from("tp_team_members").insert(importFields(a));
    return error
      ? { row: a.row, status: "error", full_name: a.full_name, message: error.message }
      : { row: a.row, status: "created", full_name: a.full_name };
  });

  const summary = { created: 0, updated: 0, skipped: 0, errors: 0 };
  for (const r of results) {
    if (r.status === "created") summary.created++;
    else if (r.status === "updated") summary.updated++;
    else if (r.status === "skipped") summary.skipped++;
    else summary.errors++;
  }
  return { ok: true, results, summary };
}

// Merge two roster records for the same person (seed vs. bulk dup). Reassign
// notes + corrective actions to the keeper, fill its blanks from the loser,
// then delete the loser. Children move BEFORE the delete (FK cascades); the
// blank-fill runs AFTER (so a unique external_id never collides mid-merge).
async function mergeMembers(supa, user, body) {
  const keepId = body?.keep_id, dropId = body?.drop_id;
  if (!keepId || !dropId || keepId === dropId) return { error: "Pick two different records to merge.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: keep } = await supa.from("tp_team_members").select("*").eq("id", keepId).maybeSingle();
  const { data: drop } = await supa.from("tp_team_members").select("*").eq("id", dropId).maybeSingle();
  if (!keep || !drop) return { error: "One of those records no longer exists.", status: 404 };
  for (const m of [keep, drop]) if (!scope.all && !scope.ids.has(m.store_id)) return { error: "Those records are outside your scope.", status: 403 };
  if (keep.store_id !== drop.store_id) return { error: "Those records are at different stores.", status: 400 };

  const fill = {};
  for (const f of ["profile_id", "external_id", "email", "phone", "hire_date", "backfill", "comment", "comment_by", "perf", "potential"]) {
    if ((keep[f] == null || keep[f] === "") && drop[f] != null && drop[f] !== "") fill[f] = drop[f];
  }
  if (keep.flight_risk === "na" && drop.flight_risk && drop.flight_risk !== "na") fill.flight_risk = drop.flight_risk;
  if (keep.aspiration === "current" && drop.aspiration && drop.aspiration !== "current") fill.aspiration = drop.aspiration;
  const reasons = [...new Set([...(keep.risk_reasons || []), ...(drop.risk_reasons || [])])];
  if (reasons.length) fill.risk_reasons = reasons;

  await supa.from("tp_notes").update({ team_member_id: keepId }).eq("team_member_id", dropId);
  await supa.from("tp_corrective_actions").update({ team_member_id: keepId }).eq("team_member_id", dropId);
  const { error: delErr } = await supa.from("tp_team_members").delete().eq("id", dropId);
  if (delErr) return { error: delErr.message, status: 500 };
  if (Object.keys(fill).length) {
    const { error } = await supa.from("tp_team_members").update(fill).eq("id", keepId);
    if (error) return { error: error.message, status: 500 };
  }
  return { ok: true, kept: keepId };
}

// Invite a roster member (Crew Leader and up) to create their app account.
// Creates the auth user, leans on the profiles trigger, sets role/scope from
// the member's ladder tier + store, and links profile_id back to the roster.
async function inviteMember(supa, user, body) {
  const id = body?.member_id;
  const email = String(body?.email || "").trim().toLowerCase();
  if (!id) return { error: "Missing team member.", status: 400 };
  if (!email || !email.includes("@")) return { error: "A valid email is required.", status: 400 };
  const scope = await storesForUser(supa, user);
  const { data: m } = await supa.from("tp_team_members").select("*").eq("id", id).maybeSingle();
  if (!m || (!scope.all && !scope.ids.has(m.store_id))) return { error: "That team member is outside your scope.", status: 403 };
  if (m.profile_id) return { error: "This person already has an account.", status: 409 };
  if (!INVITE_ROLES.has(m.role)) return { error: "Invites are for Crew Leader and up.", status: 400 };
  const authRole = LADDER_TO_AUTH[m.role];

  const redirect = (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") + "/accept-invite";
  const { data: inv, error: invErr } = await supa.auth.admin.inviteUserByEmail(email, {
    data: m.full_name ? { full_name: m.full_name } : undefined,
    redirectTo: redirect || undefined,
  });
  if (invErr) {
    if (/already|registered/i.test(invErr.message || "")) return { error: "A user with that email already exists.", status: 409 };
    return { error: `Invite failed: ${invErr.message}`, status: 500 };
  }
  const newId = inv?.user?.id;
  if (!newId) return { error: "Invite returned no user id.", status: 500 };

  const { error: pErr } = await supa.from("profiles")
    .update({ full_name: m.full_name, phone: m.phone, role: authRole, is_active: true, primary_store_id: m.store_id })
    .eq("id", newId);
  if (pErr) { await supa.auth.admin.deleteUser(newId).catch(() => {}); return { error: `Profile setup failed: ${pErr.message}`, status: 500 }; }
  const { error: sErr } = await supa.from("user_scopes").insert({ user_id: newId, scope_type: "store", scope_id: m.store_id });
  if (sErr) { await supa.auth.admin.deleteUser(newId).catch(() => {}); return { error: `Scope assignment failed: ${sErr.message}`, status: 500 }; }
  await supa.from("tp_team_members").update({ profile_id: newId, email }).eq("id", id);
  return { ok: true, profile_id: newId, email };
}

async function getSettings(supa, user) {
  const s = await tpSettings(supa);
  return { ...s, can_edit: String(user.role) === "admin" };
}
async function updateSettings(supa, user, body) {
  if (String(user.role) !== "admin") return { error: "Only admins can change the staffing model.", status: 403 };
  const n = parseInt(body?.sales_per_member, 10);
  if (Number.isNaN(n) || n < 1) return { error: "Enter a positive dollar amount.", status: 400 };
  const sales_per_member = Math.min(1000000, n);
  const { error } = await supa.from("tp_settings")
    .update({ sales_per_member, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", "global");
  if (error) return { error: error.message, status: 500 };
  return { ok: true, sales_per_member };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!VIEW_ROLES.has(String(user.role))) return respond(403, { error: "Talent Planning is for DO and above." });

  const params = event.queryStringParameters || {};
  const action = params.action || "rollup";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "rollup") return unwrap(await rollup(supa, user));
      if (action === "succession") return unwrap(await succession(supa, user));
      if (action === "gms") return unwrap(await gms(supa, user));
      if (action === "store-roster") return unwrap(await storeRoster(supa, user, params.store_id));
      if (action === "notes") return unwrap(await listNotes(supa, user, params.member_id));
      if (action === "corrective-actions") return unwrap(await listCorrectiveActions(supa, user, params.member_id));
      if (action === "successors") return unwrap(await listSuccessors(supa, user, params.member_id));
      if (action === "snapshots") return unwrap(await listSnapshots(supa, user));
      if (action === "snapshot-rows") return unwrap(await snapshotRows(supa, user, params));
      if (action === "dev-plan") return unwrap(await getDevPlan(supa, user, params.member_id));
      if (action === "member-signals") return unwrap(await memberSignals(supa, user, params.member_id));
      if (action === "risk-review") return unwrap(await riskReview(supa, user));
      if (action === "settings") return unwrap(await getSettings(supa, user));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "seed-from-profiles") return unwrap(await seedFromProfiles(supa, user));
    if (action === "commit-plan") return unwrap(await commitPlan(supa, user, body));
    if (action === "update-member") return unwrap(await updateMember(supa, user, body));
    if (action === "add-note") return unwrap(await addNote(supa, user, body));
    if (action === "update-req") return unwrap(await updateReq(supa, user, body));
    if (action === "add-corrective-action") return unwrap(await addCorrectiveAction(supa, user, body));
    if (action === "corrective-action-status") return unwrap(await setCorrectiveActionStatus(supa, user, body));
    if (action === "add-successor") return unwrap(await addSuccessor(supa, user, body));
    if (action === "update-successor") return unwrap(await updateSuccessor(supa, user, body));
    if (action === "remove-successor") return unwrap(await removeSuccessor(supa, user, body));
    if (action === "take-snapshot") return unwrap(await takeSnapshot(supa, user, body));
    if (action === "lock-snapshot") return unwrap(await lockSnapshot(supa, user, body));
    if (action === "save-dev-plan") return unwrap(await saveDevPlan(supa, user, body));
    if (action === "add-dev-item") return unwrap(await addDevItem(supa, user, body));
    if (action === "update-dev-item") return unwrap(await updateDevItem(supa, user, body));
    if (action === "remove-dev-item") return unwrap(await removeDevItem(supa, user, body));
    if (action === "import-preview") return unwrap(await previewImport(supa, user, body));
    if (action === "import-roster") return unwrap(await importRoster(supa, user, body));
    if (action === "merge-members") return unwrap(await mergeMembers(supa, user, body));
    if (action === "invite-member") return unwrap(await inviteMember(supa, user, body));
    if (action === "update-settings") return unwrap(await updateSettings(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
