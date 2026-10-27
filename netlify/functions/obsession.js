// netlify/functions/obsession.js
//
// Backend for the Obsession Metric page. All authenticated users can read;
// only admins can write.
//
// Actions (query param ?action=):
//   GET  config       — active obsession config + company progress values
//   GET  leaderboard  — per-store PTD averages for the active metric, ranked
//   POST save         — admin: deactivate existing, insert new config, compute baseline

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Admin-only for writes.
const WRITE_ROLES = new Set(["admin"]);

// Curated metrics available for the obsession. Key must match the field name
// inside kpi_snapshots payload businessDateData rows.
export const METRIC_CATALOG = [
  { key: "onTimePercentage",   label: "On-Time %",      direction: "higher", format: "pct"     },
  { key: "laborPercentage",    label: "Labor %",         direction: "lower",  format: "pct"     },
  { key: "netSales",           label: "Net Sales",       direction: "higher", format: "dollars" },
  { key: "voidPercentage",     label: "Void %",          direction: "lower",  format: "pct"     },
  { key: "dailyScore",         label: "Count Score",     direction: "higher", format: "score"   },
  { key: "discountPercentage", label: "Discount %",      direction: "lower",  format: "pct"     },
  { key: "averageTicketAmount",label: "Average Ticket",  direction: "higher", format: "dollars" },
  { key: "splh",               label: "SPLH",            direction: "higher", format: "dollars" },
];

function db() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("obsession env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = db();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, role, is_active, primary_store_id")
    .eq("id", data.user.id)
    .single();
  if (!profile?.is_active) return null;
  return profile;
}

function respond(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Extract a numeric metric value from a kpi_snapshots businessDateData row.
function extractMetric(row, key) {
  const v = row[key];
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Query kpi_snapshots and extract per-store PTD averages for a given metric
// over a date range. Returns { storeRows: [{storeNumber, storeName, avg}], companyAvg }.
async function queryMetricByDate(supa, metricKey, startDate, endDate) {
  // Pull raw snapshots for the date range. We need the full payload to
  // extract the businessDateData array per snapshot.
  const { data: snaps, error } = await supa
    .from("kpi_snapshots")
    .select("business_date, payload")
    .gte("business_date", startDate)
    .lte("business_date", endDate)
    .order("business_date", { ascending: true });

  if (error) throw new Error(error.message);
  if (!snaps?.length) return { storeRows: [], companyAvg: null };

  const storeAccum = new Map(); // storeNumber → { name, total, count }
  let companyTotal = 0, companyCount = 0;

  for (const snap of snaps) {
    const rows = snap.payload?.businessDateData ?? [];
    for (const r of rows) {
      const name = r.storeName ?? "";
      if (name === "Total") {
        const v = extractMetric(r, metricKey);
        if (v !== null) { companyTotal += v; companyCount++; }
        continue;
      }
      // Store rows: storeName format is "<number> <name>"
      const match = name.match(/^(\d+)\s+(.+)$/);
      const storeNum = match ? match[1] : name;
      const storeName = match ? match[2] : name;
      const v = extractMetric(r, metricKey);
      if (v !== null) {
        if (!storeAccum.has(storeNum)) storeAccum.set(storeNum, { name: storeName, total: 0, count: 0 });
        const a = storeAccum.get(storeNum);
        a.total += v;
        a.count++;
      }
    }
  }

  const storeRows = Array.from(storeAccum.entries()).map(([num, a]) => ({
    storeNumber: num,
    storeName: a.name,
    avg: a.count ? a.total / a.count : null,
  }));

  return {
    storeRows,
    companyAvg: companyCount ? companyTotal / companyCount : null,
  };
}

// Compute the 12-week baseline: average metric value from 84 days before startDate.
async function computeBaseline(supa, metricKey, startDate) {
  const end = new Date(startDate);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 83); // 12 weeks = 84 days
  const { companyAvg } = await queryMetricByDate(
    supa,
    metricKey,
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10)
  );
  return companyAvg;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleConfig(supa) {
  const { data: cfg, error } = await supa
    .from("obsession_config")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return respond(500, { error: error.message });
  if (!cfg) return respond(200, { config: null });

  // Current PTD company value (start_date → today or end_date, whichever is earlier)
  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = today < cfg.end_date ? today : cfg.end_date;
  const { companyAvg: currentValue } = await queryMetricByDate(
    supa, cfg.metric_key, cfg.start_date, periodEnd
  );

  return respond(200, { config: cfg, currentValue });
}

async function handleLeaderboard(supa) {
  const { data: cfg, error: cfgErr } = await supa
    .from("obsession_config")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cfgErr) return respond(500, { error: cfgErr.message });
  if (!cfg) return respond(200, { rows: [] });

  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = today < cfg.end_date ? today : cfg.end_date;
  const { storeRows } = await queryMetricByDate(
    supa, cfg.metric_key, cfg.start_date, periodEnd
  );

  // Sort: higher = descending, lower = ascending (best first)
  const sorted = storeRows
    .filter((r) => r.avg !== null)
    .sort((a, b) =>
      cfg.metric_direction === "higher" ? (b.avg - a.avg) : (a.avg - b.avg)
    );

  return respond(200, { rows: sorted, config: cfg });
}

async function handleSave(supa, user, body) {
  if (!WRITE_ROLES.has(user.role)) return respond(403, { error: "Admin only." });

  const { metricKey, targetValue, startDate, endDate, headline } = body ?? {};
  if (!metricKey || targetValue == null || !startDate || !endDate) {
    return respond(400, { error: "metricKey, targetValue, startDate, endDate required." });
  }
  const catalog = METRIC_CATALOG.find((m) => m.key === metricKey);
  if (!catalog) return respond(400, { error: "Unknown metric key." });

  if (new Date(endDate) <= new Date(startDate)) {
    return respond(400, { error: "end_date must be after start_date." });
  }

  // Compute 12-week baseline before startDate
  let baselineValue = null;
  try {
    baselineValue = await computeBaseline(supa, metricKey, startDate);
  } catch (_) {
    // baseline is best-effort
  }

  // Deactivate any existing active obsession
  await supa.from("obsession_config").update({ is_active: false }).eq("is_active", true);

  const { data: inserted, error: insertErr } = await supa
    .from("obsession_config")
    .insert({
      metric_key:       metricKey,
      metric_label:     catalog.label,
      metric_direction: catalog.direction,
      metric_format:    catalog.format,
      target_value:     parseFloat(targetValue),
      baseline_value:   baselineValue,
      start_date:       startDate,
      end_date:         endDate,
      headline:         headline || null,
      is_active:        true,
      created_by_id:    user.id,
      updated_by_id:    user.id,
    })
    .select("*")
    .single();

  if (insertErr) return respond(500, { error: insertErr.message });
  return respond(200, { config: inserted });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const user = await getUser(event);
  if (!user) return respond(401, { error: "Unauthorized." });

  const action = event.queryStringParameters?.action;
  const supa = db();

  if (event.httpMethod === "GET") {
    if (action === "config")      return handleConfig(supa);
    if (action === "leaderboard") return handleLeaderboard(supa);
    return respond(400, { error: "Unknown action." });
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
    if (action === "save") return handleSave(supa, user, body);
    return respond(400, { error: "Unknown action." });
  }

  return respond(405, { error: "Method not allowed." });
};
