// SOAR KPI snapshot — server-side proxy for the Expressway "skunkworks" KPI
// feed. The browser can't call that API directly (token must stay secret, and
// CORS/egress would block it), so this function fetches it with the service
// token from env, verifies the caller's Supabase JWT, and returns a normalized
// snapshot.
//
// Env (set in Netlify, then redeploy):
//   SKUNKWORKS_KPI_URL    base snapshot URL (no token) — kept in env, never in
//                         code, so Netlify's secret scanner stays happy
//   SKUNKWORKS_KPI_TOKEN  the shared access token

import { createClient } from "@supabase/supabase-js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("kpi-snapshot env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
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
    .select("id, email, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Classify a businessDateData row by its (feed) org level.
function levelOf(r) {
  if (r.storeName && r.storeName !== "Total") return "store";
  if (r.districtName && r.districtName !== "Total") return "district";
  if (r.regionName && r.regionName !== "Total") return "region";
  if (r.regionParentName && r.regionParentName !== "Total") return "regionParent";
  return "total";
}

// The feed's storeName is "<store#> <name>" (e.g. "3574 Helton Dr"); the leading
// digits are our store number — our join key into the SOAR org hierarchy.
function storeNumberOf(r) {
  const m = String(r.storeName || "").match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

// Resolve store numbers → our org (store/district/area/region names) by walking
// stores → districts → areas → regions. Returns a Map keyed by store number.
async function resolveOrg(supa, numbers) {
  const map = new Map();
  if (!numbers.length) return map;
  const { data: stores } = await supa.from("stores").select("id, number, name, district_id").in("number", numbers);
  const storeIds = [...new Set((stores || []).map((s) => s.id).filter(Boolean))];
  const districtIds = [...new Set((stores || []).map((s) => s.district_id).filter(Boolean))];
  const { data: districts } = districtIds.length
    ? await supa.from("districts").select("id, name, area_id").in("id", districtIds) : { data: [] };
  const areaIds = [...new Set((districts || []).map((d) => d.area_id).filter(Boolean))];
  const { data: areas } = areaIds.length
    ? await supa.from("areas").select("id, name, region_id").in("id", areaIds) : { data: [] };
  const regionIds = [...new Set((areas || []).map((a) => a.region_id).filter(Boolean))];
  const { data: regions } = regionIds.length
    ? await supa.from("regions").select("id, name").in("id", regionIds) : { data: [] };

  // Leaders. GM is a profile whose primary_store_id is the store; DO/SDO/RVP
  // come from user_scopes rows on the district/area/region node, matched to the
  // expected role for that level. Mirrors org.js leadership resolution.
  const nameOf = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);
  const nodeIds = [...storeIds, ...districtIds, ...areaIds, ...regionIds];
  const { data: scopeRows } = nodeIds.length
    ? await supa.from("user_scopes").select("user_id, scope_type, scope_id").in("scope_id", nodeIds) : { data: [] };
  const scopeUserIds = [...new Set((scopeRows || []).map((s) => s.user_id))];
  const { data: scopeProfiles } = scopeUserIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email, role").in("id", scopeUserIds).eq("is_active", true) : { data: [] };
  const { data: gmProfiles } = storeIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email, primary_store_id").eq("role", "gm").eq("is_active", true).in("primary_store_id", storeIds) : { data: [] };
  const profById = new Map((scopeProfiles || []).map((p) => [p.id, p]));
  const expectedRole = { district: "do", area: "sdo", region: "rvp", store: "gm" };
  const leaderByNode = new Map(); // scope_id → leader name
  for (const s of scopeRows || []) {
    const p = profById.get(s.user_id);
    if (p && String(p.role || "").toLowerCase() === expectedRole[s.scope_type] && !leaderByNode.has(s.scope_id)) {
      leaderByNode.set(s.scope_id, nameOf(p));
    }
  }
  const gmByStore = new Map();
  for (const p of gmProfiles || []) if (p.primary_store_id) gmByStore.set(p.primary_store_id, nameOf(p));

  const dMap = new Map((districts || []).map((d) => [d.id, d]));
  const aMap = new Map((areas || []).map((a) => [a.id, a]));
  const rMap = new Map((regions || []).map((r) => [r.id, r]));
  for (const s of stores || []) {
    const d = dMap.get(s.district_id) || null;
    const a = d ? aMap.get(d.area_id) || null : null;
    const r = a ? rMap.get(a.region_id) || null : null;
    map.set(String(s.number), {
      number: String(s.number),
      store: s.name || `#${s.number}`,
      gmName: gmByStore.get(s.id) || leaderByNode.get(s.id) || null,
      district: d?.name ?? null,
      doName: d ? leaderByNode.get(d.id) || null : null,
      area: a?.name ?? null,
      sdoName: a ? leaderByNode.get(a.id) || null : null,
      region: r?.name ?? null,
      rvpName: r ? leaderByNode.get(r.id) || null : null,
    });
  }
  return map;
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const div = (a, b) => (b ? a / b : null);

// Aggregate a set of store-level feed rows into one summary, recomputing
// rates/averages from their numerators & denominators (never averaging %s).
function aggregate(name, rows) {
  const s = (k) => rows.reduce((acc, r) => acc + num(r[k]), 0);
  const netSales = s("netSales");
  const tickets = s("tickets");
  const prevNet = s("previousYearNetSales");
  const prevTickets = s("previousYearTickets");
  const laborHours = s("laborHours");
  const laborNum = s("laborPercentageNumerator") || s("laborCost");
  const laborDen = s("laborPercentageDenominator") || netSales;
  return {
    name,
    storeCount: rows.length,
    netSales,
    grossSales: s("grossSales"),
    subTotal: s("subTotal"),
    tickets,
    averageTicketAmount: div(netSales, tickets),
    yoYNetSalesPercentage: div(netSales - prevNet, prevNet),
    yoYTrafficPercentage: div(tickets - prevTickets, prevTickets),
    laborCost: s("laborCost"),
    laborHours,
    laborPercentage: div(laborNum, laborDen),
    splh: div(netSales, laborHours),
    onTimePercentage: div(s("onTimePercentageNumerator"), s("onTimePercentageDenominator")),
    orderAheadPercentage: div(s("orderAheadNetSales"), s("orderAheadNetSalesDenominator")),
    deliveryPercentage: div(s("deliveryNetSales"), s("deliveryNetSalesDenominator")),
    discountPercentage: div(s("discountPercentageDiscountsTotal"), s("discountPercentageSales")),
    discountTotal: s("discountTotal"),
    voidTotal: s("voidTotal"),
  };
}

// Tag + org-scope + roll up one period's feed rows into { total, scope, levels }.
function buildPeriod(dataRows, orgMap) {
  const tagged = (Array.isArray(dataRows) ? dataRows : []).map((r) => ({ level: levelOf(r), ...r }));
  const total = tagged.find((r) => r.level === "total") ?? null;
  const storeRows = tagged.filter((r) => r.level === "store");

  let matched = 0;
  const unmatched = [];
  const inScope = [];
  for (const r of storeRows) {
    const number = storeNumberOf(r);
    const org = number ? orgMap.get(number) : null;
    if (org) { matched++; inScope.push({ ...r, soar: org }); }
    else { unmatched.push(number || r.storeName || "—"); }
  }

  const groupBy = (keyFn, leaderKey) => {
    const m = new Map();
    for (const r of inScope) {
      const k = keyFn(r) || "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()]
      .map(([name, rs]) => ({
        ...aggregate(name, rs),
        leader: rs[0]?.soar?.[leaderKey] ?? null,
        // Parent identifiers (single-valued within a group) for drill-down.
        region: rs[0]?.soar?.region ?? null,
        area: rs[0]?.soar?.area ?? null,
        district: rs[0]?.soar?.district ?? null,
      }))
      .sort((a, b) => num(b.netSales) - num(a.netSales));
  };

  const levels = {
    region: groupBy((r) => r.soar.region, "rvpName"),
    area: groupBy((r) => r.soar.area, "sdoName"),
    district: groupBy((r) => r.soar.district, "doName"),
    store: inScope
      .map((r) => {
        // Keep the store number in the label (don't double it if our store
        // name already starts with it): e.g. "3574 Helton Dr".
        const nm = String(r.soar.store).trim();
        const label = nm.startsWith(r.soar.number) ? nm : `${r.soar.number} ${nm}`;
        return {
          ...aggregate(label, [r]),
          number: r.soar.number,
          leader: r.soar.gmName,
          district: r.soar.district,
          area: r.soar.area,
          region: r.soar.region,
        };
      })
      .sort((a, b) => num(b.netSales) - num(a.netSales)),
  };

  return {
    total,
    scope: { matched, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 10) },
    levels,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    let user;
    try { user = await getSessionUser(event); }
    catch (e) { return respond(500, { error: e.message || "auth failed" }); }
    if (!user) return respond(401, { error: "unauthorized" });
    // Admin-only: the KPI feed is company-wide financial data.
    if (String(user.role || "").toLowerCase() !== "admin") {
      return respond(403, { error: "Admins only." });
    }

    if (!kpiConfigured()) {
      return respond(503, { error: "KPI feed isn't configured (set SKUNKWORKS_KPI_URL + SKUNKWORKS_KPI_TOKEN in Netlify)." });
    }

    // Shared fetch (also used by labor-v2.js) — handles the URL/token build,
    // a 15s timeout (this proxy used to time-box at 8s, which is shorter than
    // the feed sometimes needs and was cutting it off on every retry rather
    // than just the genuinely slow ones), and distinguishes a login/redirect
    // page (config/access problem — retrying won't help) from a generic
    // non-JSON blip, both folded into the thrown error's message so the
    // dashboard's error card is actually diagnosable instead of a bare
    // "non-JSON" with no detail.
    let payload;
    try {
      payload = await fetchKpiFeed({ timeoutMs: 15000 });
    } catch (e) {
      return respond(502, { error: e.message || "Couldn't reach the KPI feed." });
    }

    const rd = (payload && payload.rawData) || {};
    const feedKeys = Object.keys(rd);
    // Pick the first present array for each period (the feed may name them a few
    // different ways; feedKeys is returned so the UI can self-report mismatches).
    const pick = (cands) => { for (const k of cands) if (Array.isArray(rd[k])) return rd[k]; return []; };
    const dayRows = pick(["businessDateData"]);
    const wtdRows = pick(["weekToDateData", "weekToDate", "wtdData", "businessWeekData", "weekData", "wtd"]);
    const ptdRows = pick(["periodToDateData", "periodToDate", "ptdData", "businessPeriodData", "periodData", "ptd"]);

    // Resolve our org once over the union of store numbers across all periods.
    const supa = admin();
    const storeNumbers = [...new Set(
      [...dayRows, ...wtdRows, ...ptdRows]
        .filter((r) => levelOf(r) === "store")
        .map(storeNumberOf)
        .filter(Boolean),
    )];
    const orgMap = await resolveOrg(supa, storeNumbers);

    return respond(200, {
      ok: true,
      fetchedAt: new Date().toISOString(),
      feedKeys,
      periods: {
        day: buildPeriod(dayRows, orgMap),
        wtd: buildPeriod(wtdRows, orgMap),
        ptd: buildPeriod(ptdRows, orgMap),
      },
    });
  } catch (e) {
    // Last-resort guard so the function never returns a bare 502 — the dashboard
    // surfaces this message in its empty state.
    return respond(500, { error: `kpi-snapshot error: ${e?.message || String(e)}` });
  }
};
