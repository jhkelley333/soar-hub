// rvp-period-commitments — Phase 6. Each RVP records free-text commitments per
// fiscal period, with an editable target and status. Every edit to a tracked
// field is captured in an immutable history table by a DB trigger (see
// migration 0302); this function only sets updated_by so the trigger can
// attribute the change. Distinct from the metric-target rvp_commitments
// scoreboard (labor-v2.js / migration 0258).
//
// Scope:
//   rvp            → own commitments only (rvp_user_id = self)
//   vp/coo/admin   → all commitments; may create on behalf of any RVP
//   everyone else  → 403
//
// Commitments are permanent (correct by editing, which is audited). No delete
// action is exposed; the history table's immutability trigger enforces it.

import { createClient } from "@supabase/supabase-js";
import { fiscalForDate, periodWeekEnds, priorWeekEnds } from "./_lib/fiscal.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const LEADER_ROLES = ["vp", "coo", "admin"]; // can see/manage every RVP's commitments
const MANAGE_ROLES = ["rvp", ...LEADER_ROLES]; // can reach this tool at all
const STATUSES = ["active", "met", "missed"];

// Ranker metric keys stored as fractions in ranking_rows.metrics (the Comms
// Board renders them ×100 as a percentage). Every OTHER metric key is a raw
// value (count, days, dollars, per-10K, points). Scaling these ×100 makes the
// auto-pulled baseline read the same number an RVP sees on the Ranker.
const PCT_KEYS = new Set([
  "pctVsLy", "varianceToChart", "ticketsVsLyPct", "voidsPct", "cogsEff",
  "totalTrainingPct", "bscTrainingPct", "onTimePct", "eveningPct", "vog",
]);
const round2 = (n) => Math.round(n * 100) / 100;
const scaleMetric = (key, raw) => {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return round2(PCT_KEYS.has(key) ? v * 100 : v);
};

// The RVP-tier ranking rows are keyed by the leader's display name
// (resolveOrg nameOf = preferred_name || full_name || email). Recompute it from
// a profile so a commitment's rvp_user_id maps to its ranking_rows entity_key.
const rvpEntityName = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);

// For a fiscal period + a set of RVP entity names, read the pre-aggregated
// rvp-tier ranking rows and return, per name, the 4-week pre-period baseline
// (avg of the weekly values) and the per-week series across the period. Weeks
// with no complete run yet are present with value null (pending). Reads scope
// 'wtd' — each week's isolated number, exactly what the Comms Board shows.
async function metricSeriesByName(supa, metricKey, period, names) {
  const nameList = [...names].filter(Boolean);
  const baseWeekEnds = priorWeekEnds(period, 4);
  const trackWeekEnds = periodWeekEnds(period);
  const allWeekEnds = [...new Set([...baseWeekEnds, ...trackWeekEnds])];
  const out = new Map();
  for (const n of nameList) out.set(n, { baseline: null, weeks: trackWeekEnds.map((we) => weekStub(we)) });
  if (!metricKey || !allWeekEnds.length || !nameList.length) return out;

  const { data: runs } = await supa.from("ranking_runs")
    .select("id, week_ending, started_at").eq("status", "complete")
    .in("week_ending", allWeekEnds).order("started_at", { ascending: false });
  const runByWeek = new Map(); // week_ending -> newest complete run id
  for (const r of runs || []) if (!runByWeek.has(r.week_ending)) runByWeek.set(r.week_ending, r.id);
  const runIds = [...runByWeek.values()];
  if (!runIds.length) return out;
  const weekByRun = new Map([...runByWeek.entries()].map(([w, id]) => [id, w]));

  const { data: rows } = await supa.from("ranking_rows")
    .select("run_id, entity_key, metrics").in("run_id", runIds)
    .eq("scope", "wtd").eq("tier", "rvp").in("entity_key", nameList);
  // name -> (week_ending -> scaled value)
  const byName = new Map();
  for (const r of rows || []) {
    const val = scaleMetric(metricKey, r.metrics?.[metricKey]);
    if (val == null) continue;
    const we = weekByRun.get(r.run_id);
    (byName.get(r.entity_key) || byName.set(r.entity_key, new Map()).get(r.entity_key)).set(we, val);
  }
  for (const name of nameList) {
    const wk = byName.get(name) || new Map();
    const baseVals = baseWeekEnds.map((we) => wk.get(we)).filter((v) => v != null);
    const baseline = baseVals.length ? round2(baseVals.reduce((a, b) => a + b, 0) / baseVals.length) : null;
    out.set(name, {
      baseline,
      weeks: trackWeekEnds.map((we) => weekStub(we, wk.has(we) ? wk.get(we) : null)),
    });
  }
  return out;
}

function weekStub(weekEnding, value = null) {
  const fi = fiscalForDate(weekEnding);
  return { week_ending: weekEnding, week_in_period: fi?.weekInPeriod ?? null, value };
}

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(statusCode, payload) { return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }; }

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, role, full_name, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const clean = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined; // undefined = invalid (caller rejects)
};

// Structured specific-actions. Returns a sanitized array, or undefined when the
// payload is not an array (caller rejects). Blank rows are dropped; at most 12
// actions are kept. Each action is {what, owner, cadence, impact}.
const cleanActions = (raw) => {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  for (const a of raw.slice(0, 12)) {
    if (!a || typeof a !== "object") continue;
    const what = clean(a.what, 300);
    const owner = clean(a.owner, 120);
    const cadence = clean(a.cadence, 120);
    let impact = null;
    if (a.impact != null && a.impact !== "") {
      const n = Number(a.impact);
      if (!Number.isFinite(n)) return undefined;
      impact = n;
    }
    if (!what && !owner && !cadence && impact == null) continue; // fully-blank row
    out.push({ what, owner, cadence, impact });
  }
  return out;
};

const SELECT_COLS =
  "id, rvp_user_id, fiscal_year, period, metric_key, metric_label, baseline_value, " +
  "commitment_text, target_value, target_unit, actions, status, created_at, created_by, updated_at, updated_by";

// Attach each commitment's edit history (newest first).
async function withHistory(supa, commitments) {
  const ids = commitments.map((c) => c.id);
  if (ids.length === 0) return commitments.map((c) => ({ ...c, history: [] }));
  const { data: hist } = await supa
    .from("rvp_period_commitment_history")
    .select("id, commitment_id, changed_at, changed_by, field, old_value, new_value")
    .in("commitment_id", ids)
    .order("changed_at", { ascending: false });
  // Resolve changed_by → name in one pass.
  const byIds = [...new Set((hist || []).map((h) => h.changed_by).filter(Boolean))];
  let names = {};
  if (byIds.length) {
    const { data: people } = await supa.from("profiles").select("id, full_name").in("id", byIds);
    names = Object.fromEntries((people || []).map((p) => [p.id, p.full_name]));
  }
  const grouped = {};
  for (const h of hist || []) {
    (grouped[h.commitment_id] ||= []).push({ ...h, changed_by_name: names[h.changed_by] || null });
  }
  return commitments.map((c) => ({ ...c, history: grouped[c.id] || [] }));
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "env not configured" });
  const supa = admin();

  let user;
  try { user = await sessionUser(supa, event); } catch (e) { return respond(500, { error: e?.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const role = String(user.role || "").toLowerCase();
  if (!MANAGE_ROLES.includes(role)) return respond(403, { error: "RVP or leadership only." });
  const isLeader = LEADER_ROLES.includes(role);

  const params = event.queryStringParameters || {};
  const action = params.action || "list";

  try {
    // ── list: commitments for a fiscal period, in the caller's scope ──────────
    if (event.httpMethod === "GET" && action === "list") {
      const fiscalYear = clean(params.fiscal_year, 16);
      const period = Number(params.period);
      if (!fiscalYear || !Number.isInteger(period) || period < 1 || period > 12) {
        return respond(400, { error: "fiscal_year and period (1–12) are required." });
      }
      let query = supa.from("rvp_period_commitments")
        .select(SELECT_COLS)
        .eq("fiscal_year", fiscalYear).eq("period", period)
        .order("created_at", { ascending: true });
      if (!isLeader) query = query.eq("rvp_user_id", user.id);
      const { data: rows, error } = await query;
      if (error) {
        if (/metric_key|metric_label|baseline_value|actions/.test(error.message)) return respond(500, { error: "Run migration 0313 first (metric/baseline/actions columns are missing)." });
        if (/rvp_period_commitments/.test(error.message)) return respond(500, { error: "Run migration 0302 first (rvp_period_commitments table is missing)." });
        return respond(500, { error: error.message });
      }

      // Resolve RVP profiles for the rows (display name + the ranking entity name).
      const rvpIds = [...new Set((rows || []).map((r) => r.rvp_user_id))];
      let profById = {};
      if (rvpIds.length) {
        const { data: people } = await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", rvpIds);
        profById = Object.fromEntries((people || []).map((p) => [p.id, p]));
      }
      const withHist = (await withHistory(supa, rows || []))
        .map((c) => ({ ...c, rvp_name: profById[c.rvp_user_id]?.full_name || null }));

      // Attach live 4-week baseline + per-week movement series for metric-anchored
      // commitments. Group by metric so each metric's ranking rows load once.
      const entityByCommit = new Map();
      const byMetric = new Map(); // metric_key -> Set(entity name)
      for (const c of withHist) {
        const entity = rvpEntityName(profById[c.rvp_user_id]);
        entityByCommit.set(c.id, entity);
        if (c.metric_key && entity) (byMetric.get(c.metric_key) || byMetric.set(c.metric_key, new Set()).get(c.metric_key)).add(entity);
      }
      const seriesByMetric = new Map();
      for (const [mk, nameset] of byMetric) seriesByMetric.set(mk, await metricSeriesByName(supa, mk, period, nameset));
      const commitments = withHist.map((c) => {
        const entity = entityByCommit.get(c.id);
        const s = c.metric_key && entity ? seriesByMetric.get(c.metric_key)?.get(entity) : null;
        return { ...c, series: s || null };
      });

      // Leadership gets the RVP roster to attribute new commitments; an RVP is
      // implicitly themselves.
      let rvps = [{ id: user.id, full_name: user.full_name }];
      if (isLeader) {
        const { data: allRvps } = await supa.from("profiles")
          .select("id, full_name").eq("role", "rvp").eq("is_active", true).order("full_name");
        rvps = allRvps || [];
      }
      return respond(200, { ok: true, commitments, rvps, scope: isLeader ? "all" : "own", self_id: user.id });
    }

    // ── metric-series: live 4-week baseline + per-week series for one metric ───
    // Powers the modal's baseline auto-fill when a metric is picked, for the
    // caller (or, for a leader, a named RVP).
    if (event.httpMethod === "GET" && action === "metric-series") {
      const metricKey = clean(params.metric_key, 64);
      const period = Number(params.period);
      if (!metricKey || !Number.isInteger(period) || period < 1 || period > 12) {
        return respond(400, { error: "metric_key and period (1–12) are required." });
      }
      let targetId = user.id;
      if (params.rvp_user_id && params.rvp_user_id !== user.id) {
        if (!isLeader) return respond(403, { error: "You can only pull your own metrics." });
        targetId = clean(params.rvp_user_id, 64);
      }
      const { data: prof } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("id", targetId).maybeSingle();
      if (!prof) return respond(400, { error: "rvp_user_id does not match a profile." });
      const entity = rvpEntityName(prof);
      const series = (await metricSeriesByName(supa, metricKey, period, new Set([entity]))).get(entity)
        || { baseline: null, weeks: [] };
      return respond(200, { ok: true, metric_key: metricKey, period, rvp_name: prof.full_name || null, ...series });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};

      // ── create ──────────────────────────────────────────────────────────────
      if (action === "create") {
        const fiscalYear = clean(body.fiscal_year, 16);
        const period = Number(body.period);
        const text = clean(body.commitment_text, 2000);
        if (!fiscalYear || !Number.isInteger(period) || period < 1 || period > 12) return respond(400, { error: "fiscal_year and period (1–12) are required." });
        if (!text) return respond(400, { error: "commitment_text is required." });

        // Whose commitment? RVPs are always themselves; leaders may name an RVP.
        let rvpUserId = user.id;
        if (isLeader && body.rvp_user_id) {
          rvpUserId = clean(body.rvp_user_id, 64);
          const { data: target } = await supa.from("profiles").select("id, role").eq("id", rvpUserId).maybeSingle();
          if (!target) return respond(400, { error: "rvp_user_id does not match a profile." });
        } else if (!isLeader && body.rvp_user_id && body.rvp_user_id !== user.id) {
          return respond(403, { error: "You can only record your own commitments." });
        }

        const tv = numOrNull(body.target_value);
        if (tv === undefined) return respond(400, { error: "target_value must be a number." });
        const baseline = numOrNull(body.baseline_value);
        if (baseline === undefined) return respond(400, { error: "baseline_value must be a number." });
        const actions = cleanActions(body.actions);
        if (actions === undefined) return respond(400, { error: "actions must be a list of {what, owner, cadence, impact}." });
        const status = clean(body.status, 16) || "active";
        if (!STATUSES.includes(status)) return respond(400, { error: `status must be one of ${STATUSES.join(", ")}.` });

        const { data, error } = await supa.from("rvp_period_commitments").insert({
          rvp_user_id: rvpUserId,
          fiscal_year: fiscalYear,
          period,
          metric_key: clean(body.metric_key, 64),
          metric_label: clean(body.metric_label, 120),
          baseline_value: baseline,
          commitment_text: text,
          target_value: tv,
          target_unit: clean(body.target_unit, 16),
          actions,
          status,
          created_by: user.id,
          updated_by: user.id,
        }).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, commitment: { ...data, history: [] } });
      }

      // ── update: edit tracked fields; DB trigger records the diff ─────────────
      if (action === "update") {
        const id = clean(body.id, 64);
        if (!id) return respond(400, { error: "id is required." });
        const { data: existing } = await supa.from("rvp_period_commitments").select("id, rvp_user_id").eq("id", id).maybeSingle();
        if (!existing) return respond(404, { error: "Commitment not found." });
        if (!isLeader && existing.rvp_user_id !== user.id) return respond(403, { error: "You can only edit your own commitments." });

        const patch = { updated_at: new Date().toISOString(), updated_by: user.id };
        if (body.commitment_text !== undefined) {
          const t = clean(body.commitment_text, 2000);
          if (!t) return respond(400, { error: "commitment_text can't be blank." });
          patch.commitment_text = t;
        }
        if (body.metric_key !== undefined) patch.metric_key = clean(body.metric_key, 64);
        if (body.metric_label !== undefined) patch.metric_label = clean(body.metric_label, 120);
        if (body.baseline_value !== undefined) {
          const bv = numOrNull(body.baseline_value);
          if (bv === undefined) return respond(400, { error: "baseline_value must be a number." });
          patch.baseline_value = bv;
        }
        if (body.target_value !== undefined) {
          const tv = numOrNull(body.target_value);
          if (tv === undefined) return respond(400, { error: "target_value must be a number." });
          patch.target_value = tv;
        }
        if (body.target_unit !== undefined) patch.target_unit = clean(body.target_unit, 16);
        if (body.actions !== undefined) {
          const actions = cleanActions(body.actions);
          if (actions === undefined) return respond(400, { error: "actions must be a list of {what, owner, cadence, impact}." });
          patch.actions = actions;
        }
        if (body.status !== undefined) {
          const status = clean(body.status, 16);
          if (!STATUSES.includes(status)) return respond(400, { error: `status must be one of ${STATUSES.join(", ")}.` });
          patch.status = status;
        }

        const { data, error } = await supa.from("rvp_period_commitments").update(patch).eq("id", id).select().single();
        if (error) return respond(500, { error: error.message });
        const [withHist] = await withHistory(supa, [data]);
        return respond(200, { ok: true, commitment: withHist });
      }

      return respond(400, { error: `unknown POST action: ${action}` });
    }

    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e?.message || "server error" });
  }
};
