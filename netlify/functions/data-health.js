// netlify/functions/data-health.js
// Data health dashboard — coverage analysis, stream summaries, missing stores.
// Gated to admin / payroll / accounting / rvp / vp / coo.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const READER_ROLES = new Set(["admin", "payroll", "accounting", "rvp", "vp", "coo"]);

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("data-health: env vars not set");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = adminClient();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", data.user.id)
    .single();
  if (!profile?.is_active) return null;
  return profile;
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ------------------------------------------------------------------
// overview — data stream summaries + 30-day coverage grid + pull log
// ------------------------------------------------------------------
async function overview(supa) {
  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 31);
  const thirtyAgoStr = thirtyAgo.toISOString().slice(0, 10);

  const [
    laborFirst, laborLast, laborCount,
    countFirst, countLast, countCount,
    snapFirst, snapLast, snapCount,
    storesResult,
    pullLogResult,
    coverageRaw,
  ] = await Promise.all([
    supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: true }).limit(1),
    supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1),
    supa.from("labor_v2_daily").select("*", { count: "exact", head: true }),
    supa.from("count_daily").select("business_date").order("business_date", { ascending: true }).limit(1),
    supa.from("count_daily").select("business_date").order("business_date", { ascending: false }).limit(1),
    supa.from("count_daily").select("*", { count: "exact", head: true }),
    supa.from("kpi_snapshots").select("central_date").order("central_date", { ascending: true }).limit(1),
    supa.from("kpi_snapshots").select("central_date").order("central_date", { ascending: false }).limit(1),
    supa.from("kpi_snapshots").select("*", { count: "estimated", head: true }),
    supa.from("stores").select("number", { count: "exact" }).eq("is_active", true).or("brand.eq.sonic,brand.is.null"),
    supa.from("kpi_pull_log").select("id,created_at,source,ok,business_date,store_rows,wtd_rows,kpi_snapshot,duration_ms,error").order("created_at", { ascending: false }).limit(50),
    supa.from("labor_v2_daily").select("business_date,store_number").gte("business_date", thirtyAgoStr),
  ]);

  // Build per-date store count from raw rows
  const byDate = new Map();
  for (const row of coverageRaw.data ?? []) {
    const d = row.business_date;
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d).add(String(row.store_number));
  }
  const coverage = Array.from(byDate.entries())
    .map(([date, stores]) => ({ date, store_count: stores.size }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalStores = storesResult.count ?? 0;

  const streams = [
    {
      name: "labor_v2_daily",
      label: "Labor & Sales",
      description: "Net sales, labor cost/%, hours, SPLH, on-time, voids, tickets — daily + WTD + PTD bands",
      first_date: laborFirst.data?.[0]?.business_date ?? null,
      last_date: laborLast.data?.[0]?.business_date ?? null,
      total_rows: laborCount.count ?? 0,
    },
    {
      name: "count_daily",
      label: "Count Scores",
      description: "IntelliCost daily score, completion, accuracy, count variance — one row per store per day",
      first_date: countFirst.data?.[0]?.business_date ?? null,
      last_date: countLast.data?.[0]?.business_date ?? null,
      total_rows: countCount.count ?? 0,
    },
    {
      name: "kpi_snapshots",
      label: "Raw Snapshots",
      description: "Full Expressway JSON payload — every capture hour, never pruned. Source of truth for backfills.",
      first_date: snapFirst.data?.[0]?.central_date ?? null,
      last_date: snapLast.data?.[0]?.central_date ?? null,
      total_rows: snapCount.count ?? 0,
    },
  ];

  return {
    streams,
    coverage,
    pull_log: pullLogResult.data ?? [],
    total_stores: totalStores,
  };
}

// ------------------------------------------------------------------
// coverage-detail — present vs missing stores for a specific date
// ------------------------------------------------------------------
async function coverageDetail(supa, date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date must be YYYY-MM-DD", status: 400 };
  }

  const [presentResult, storeResult] = await Promise.all([
    supa
      .from("labor_v2_daily")
      .select("store_number, net_sales, labor_pct, labor_cost, labor_hours, on_time_numerator, tickets")
      .eq("business_date", date),
    supa
      .from("stores")
      .select("number, name")
      .eq("is_active", true)
      .or("brand.eq.sonic,brand.is.null")
      .order("number"),
  ]);

  const presentNums = new Set((presentResult.data ?? []).map((r) => String(r.store_number)));
  const allStores = storeResult.data ?? [];

  const missing = allStores
    .filter((s) => !presentNums.has(String(s.number)))
    .map((s) => ({ number: s.number, name: s.name ?? null }));

  // Stores that have a row but key fields are null (incomplete pull)
  const incomplete = (presentResult.data ?? [])
    .filter((r) => r.net_sales == null || r.labor_pct == null || r.labor_cost == null)
    .map((r) => ({
      store_number: r.store_number,
      missing_fields: [
        r.net_sales == null && "net_sales",
        r.labor_pct == null && "labor_pct",
        r.labor_cost == null && "labor_cost",
        r.labor_hours == null && "labor_hours",
      ].filter(Boolean),
    }));

  // Also fetch kpi_pull_log rows for this business_date for context
  const { data: pulls } = await supa
    .from("kpi_pull_log")
    .select("created_at, source, ok, store_rows, error")
    .eq("business_date", date)
    .order("created_at", { ascending: false });

  return {
    date,
    present_count: presentNums.size,
    total_stores: allStores.length,
    missing,
    incomplete,
    pulls_for_date: pulls ?? [],
  };
}

// ------------------------------------------------------------------
// handler
// ------------------------------------------------------------------
export async function handler(event) {
  try {
    const supa = adminClient();
    const user = await getUser(event);
    if (!user) return respond(401, { error: "Unauthorized" });
    if (!READER_ROLES.has(user.role)) return respond(403, { error: "Finance or admin access required." });

    const params = event.queryStringParameters ?? {};
    const action = params.action ?? "overview";

    if (action === "overview") {
      const result = await overview(supa);
      return respond(200, result);
    }
    if (action === "coverage-detail") {
      const result = await coverageDetail(supa, params.date);
      if (result.error) return respond(result.status ?? 400, result);
      return respond(200, result);
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[data-health]", e);
    return respond(500, { error: e?.message ?? "Internal error" });
  }
}
