// schedule-status — per-store ExpressWay schedule workflow status.
// Reads ew_schedule_status (populated by scrapekit on Heath's MacBook).
// Actions:
//   ?action=weeks         — available week_start values (latest first)
//   ?action=summary&week= — all rows for a week, org-decorated

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SONIC_ONLY = "brand.eq.sonic,brand.is.null";
const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("schedule-status env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const roleOf = (u) => String(u?.role || "").toLowerCase();

const READ_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const IN_CHUNK = 200;
const PAGE = 1000;

async function selectAllIn(supa, table, cols, col, ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return [];
  const out = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supa.from(table).select(cols).in(col, chunk).range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = data || [];
      out.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
}

async function visibleStoreNumbers(supa, user) {
  if (ORG_WIDE.has(roleOf(user)) || roleOf(user) === "admin") {
    const { data } = await supa.from("stores").select("number").eq("is_active", true).or(SONIC_ONLY);
    return (data ?? []).map((r) => String(r.number));
  }
  const { data: visibleIds } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visibleIds ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa.from("stores").select("number").in("id", ids).eq("is_active", true).or(SONIC_ONLY);
  return (data ?? []).map((r) => String(r.number));
}

async function resolveOrg(supa, numbers) {
  if (!numbers.length) return new Map();
  const stores = await selectAllIn(supa, "stores", "id, number, name, district_id", "number", numbers);
  const districtIds = [...new Set(stores.map((s) => s.district_id).filter(Boolean))];
  const districts = await selectAllIn(supa, "districts", "id, name, area_id", "id", districtIds);
  const areaIds = [...new Set(districts.map((d) => d.area_id).filter(Boolean))];
  const areas = await selectAllIn(supa, "areas", "id, name, region_id", "id", areaIds);
  const regionIds = [...new Set(areas.map((a) => a.region_id).filter(Boolean))];
  const regions = await selectAllIn(supa, "regions", "id, name", "id", regionIds);

  const districtMap = new Map(districts.map((d) => [d.id, d]));
  const areaMap = new Map(areas.map((a) => [a.id, a]));
  const regionMap = new Map(regions.map((r) => [r.id, r]));

  // user_scopes is polymorphic: scope_type + scope_id (no district_id column).
  // Fetch district-scoped rows, then look up each user's profile.
  const doByDistrict = new Map();
  if (districtIds.length) {
    for (let i = 0; i < districtIds.length; i += IN_CHUNK) {
      const chunk = districtIds.slice(i, i + IN_CHUNK);
      const { data: scopeRows } = await supa
        .from("user_scopes")
        .select("user_id, scope_id")
        .eq("scope_type", "district")
        .in("scope_id", chunk);
      const userIds = [...new Set((scopeRows ?? []).map((r) => r.user_id).filter(Boolean))];
      if (!userIds.length) continue;
      const { data: profileRows } = await supa
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));
      for (const sr of scopeRows ?? []) {
        if (!doByDistrict.has(sr.scope_id)) {
          const p = profileById.get(sr.user_id);
          if (p) doByDistrict.set(sr.scope_id, p.full_name || p.email);
        }
      }
    }
  }

  const org = new Map();
  for (const s of stores) {
    const district = districtMap.get(s.district_id);
    const area = district ? areaMap.get(district.area_id) : null;
    const region = area ? regionMap.get(area.region_id) : null;
    org.set(String(s.number), {
      store_name: s.name,
      district: district?.name ?? null,
      do_name: doByDistrict.get(s.district_id) ?? null,
      area: area?.name ?? null,
      region: region?.name ?? null,
    });
  }
  return org;
}

async function getWeeks(supa, numbers) {
  if (!numbers.length) return [];
  const { data } = await supa
    .from("ew_schedule_status")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(10000); // date strings only; dedup below collapses to distinct weeks
  const unique = [...new Set((data ?? []).map((r) => r.week_start))].sort((a, b) => (a > b ? -1 : 1));
  return unique;
}

async function getSummary(supa, numbers, week) {
  if (!numbers.length || !week) return [];
  const rows = [];
  for (let i = 0; i < numbers.length; i += IN_CHUNK) {
    const chunk = numbers.slice(i, i + IN_CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supa
        .from("ew_schedule_status")
        .select("store_number, week_start, status, status_step, status_label, forecast, adjusted_forecast, projected_splh, scheduled_labor_pct, target_labor_pct, budget_usage, rvp, sdo, do_name, pulled_at")
        .in("store_number", chunk)
        .eq("week_start", week)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
      from += PAGE;
    }
  }
  return rows;
}

export const handler = async (event) => {
  try {
    const supa = admin();
    const user = await getSessionUser(supa, event);
    if (!user) return respond(401, { error: "Unauthorized" });
    if (!READ_ROLES.has(roleOf(user))) return respond(403, { error: "Forbidden — DO level and above only." });

    const params = event.queryStringParameters || {};
    const action = params.action || "weeks";

    const numbers = await visibleStoreNumbers(supa, user);

    if (action === "weeks") {
      const weeks = await getWeeks(supa, numbers);
      return respond(200, { ok: true, weeks });
    }

    if (action === "summary") {
      const week = params.week;
      if (!week) return respond(400, { error: "week param required" });
      const [rows, orgMap] = await Promise.all([
        getSummary(supa, numbers, week),
        resolveOrg(supa, numbers),
      ]);

      const decorated = rows.map((r) => {
        const o = orgMap.get(r.store_number) ?? {};
        return {
          ...r,
          store_name: o.store_name ?? null,
          district: o.district ?? null,
          do_name_org: o.do_name ?? r.do_name ?? null,
          area: o.area ?? null,
          region: o.region ?? r.rvp ?? null,
        };
      });

      // Counts by step (1–5)
      const stepCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 };
      for (const r of decorated) {
        const s = r.status_step;
        if (s >= 1 && s <= 5) stepCounts[s]++;
        else stepCounts.unknown++;
      }

      return respond(200, { ok: true, week, rows: decorated, stepCounts, total: decorated.length });
    }

    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `schedule-status error: ${e?.message || String(e)}` });
  }
};
