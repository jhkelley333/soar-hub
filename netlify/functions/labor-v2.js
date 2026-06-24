// Labor v2 — admin-only labor + sales by store, rolled up onto our org, with
// per-day history. Reads labor_v2_daily (populated by kpi-capture and by the
// refresh action here). Mirrors the KPI dashboard's org roll-up + drill-down.

import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";
import { extractLaborRows, feedBusinessDate, wallClockInTz } from "./_lib/kpiLabor.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = "America/Chicago";

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("labor-v2 env vars not configured");
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
  const { data: profile } = await supa.from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const numv = (v) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const div = (a, b) => (b ? a / b : null);

// Aggregate labor rows into one summary (weighted from $ and hours; never
// averaging percentages).
function laborAgg(name, rows) {
  const s = (k) => rows.reduce((a, r) => a + numv(r[k]), 0);
  const netSales = s("net_sales");
  const laborCost = s("labor_cost");
  const laborHours = s("labor_hours");
  const scheduledHours = s("scheduled_labor_hours");
  const actualVsSched = s("actual_vs_scheduled_hours");
  const targetLaborDollars = rows.reduce((a, r) => a + numv(r.target_labor_pct) * numv(r.net_sales), 0);
  const laborPct = div(laborCost, netSales);
  const targetPct = div(targetLaborDollars, netSales);
  return {
    name,
    storeCount: rows.length,
    netSales,
    laborCost,
    laborHours,
    scheduledHours,
    actualVsSched,
    laborPct,
    targetPct,
    variancePts: laborPct != null && targetPct != null ? laborPct - targetPct : null,
    splh: div(netSales, laborHours),
  };
}

function buildLevels(inScope) {
  const groupBy = (keyFn, leaderKey) => {
    const m = new Map();
    for (const r of inScope) {
      const k = keyFn(r) || "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()]
      .map(([name, rs]) => ({
        ...laborAgg(name, rs),
        leader: rs[0]?.soar?.[leaderKey] ?? null,
        region: rs[0]?.soar?.region ?? null,
        area: rs[0]?.soar?.area ?? null,
        district: rs[0]?.soar?.district ?? null,
      }))
      .sort((a, b) => numv(b.netSales) - numv(a.netSales));
  };
  return {
    region: groupBy((r) => r.soar.region, "rvpName"),
    area: groupBy((r) => r.soar.area, "sdoName"),
    district: groupBy((r) => r.soar.district, "doName"),
    store: inScope
      .map((r) => {
        const nm = String(r.soar.store).trim();
        const label = nm.startsWith(r.soar.number) ? nm : `${r.soar.number} ${nm}`;
        return {
          ...laborAgg(label, [r]),
          number: r.soar.number,
          leader: r.soar.gmName,
          district: r.soar.district,
          area: r.soar.area,
          region: r.soar.region,
        };
      })
      .sort((a, b) => numv(b.netSales) - numv(a.netSales)),
  };
}

async function listDates(supa) {
  const { data } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(2000);
  const dates = [...new Set((data || []).map((r) => r.business_date))];
  return { dates };
}

// Pull the feed now and upsert into labor_v2_daily; returns the business date.
async function refreshNow(supa) {
  if (!kpiConfigured()) throw new Error("KPI feed isn't configured.");
  const payload = await fetchKpiFeed();
  const wc = wallClockInTz(new Date(), TZ);
  const businessDate = feedBusinessDate(payload, wc);
  const rows = extractLaborRows(payload).map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
  if (rows.length) await supa.from("labor_v2_daily").upsert(rows, { onConflict: "store_number,business_date" });
  return businessDate;
}

async function summary(supa, params) {
  let date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;

  // Refresh from the live feed when asked, or when there's no history yet.
  if (params.refresh === "1" || !date) {
    const { data: anyRow } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    if (params.refresh === "1" || !anyRow?.length) {
      try { const bd = await refreshNow(supa); if (!date) date = bd; }
      catch (e) { if (!anyRow?.length) return { error: e.message, status: 502 }; }
    }
    if (!date) date = anyRow?.[0]?.business_date ?? null;
  }
  if (!date) return { date: null, total: null, scope: { matched: 0, unmatched: 0 }, levels: { region: [], area: [], district: [], store: [] } };

  const { data: rows } = await supa.from("labor_v2_daily").select("*").eq("business_date", date);
  const numbers = [...new Set((rows || []).map((r) => String(r.store_number)).filter(Boolean))];
  const orgMap = await resolveOrg(supa, numbers);

  let matched = 0;
  const unmatched = [];
  const inScope = [];
  for (const r of rows || []) {
    const org = orgMap.get(String(r.store_number));
    if (org) { matched++; inScope.push({ ...r, soar: org }); }
    else unmatched.push(String(r.store_number));
  }

  const total = laborAgg("Company", inScope);
  return {
    date,
    total,
    scope: { matched, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 10) },
    levels: buildLevels(inScope),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); }
  catch (e) { return respond(500, { error: e.message }); }

  let user;
  try { user = await getSessionUser(supa, event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });
  if (String(user.role || "").toLowerCase() !== "admin") return respond(403, { error: "Admins only." });

  const params = event.queryStringParameters || {};
  const action = params.action || "summary";
  try {
    if (action === "dates") return respond(200, await listDates(supa));
    if (action === "summary") {
      const out = await summary(supa, params);
      if (out?.error) return respond(out.status || 500, { error: out.error });
      return respond(200, { ok: true, ...out });
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `labor-v2 error: ${e?.message || String(e)}` });
  }
};
