// ecosure — Food Safety (EcoSure TrueView) module.
//
// Tables read (service-role key — RLS on, no policies):
//   ecosure_assessments        — latest assessment per store+date+visit_type
//   ecosure_findings           — Standard Details findings per assessment
//   stores                     — name + org tree join
//
// Actions:
//   GET ?action=summary[&region=X][&area=X][&district=X]
//       → store list with latest assessment, summary cards, top findings
//   GET ?action=store&storeNumber=XXXX
//       → all assessments + findings for one store
//   GET ?action=overdue[&days=180][&region=X][&area=X][&district=X]
//       → stores with no audit in N days (default 180)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ROLES = new Set(["admin", "vp", "coo", "rvp", "sdo", "do", "gm", "fbc"]);

function svc() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(code, payload) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: { user } = {} } = await supa.auth.getUser(header.slice(7).trim());
  if (!user) return null;
  const { data: p } = await supa
    .from("profiles")
    .select("id, role, is_active, store_number, district, area, region")
    .eq("id", user.id)
    .maybeSingle();
  if (!p || !p.is_active) return null;
  const role = String(p.role || "").toLowerCase();
  if (!ALLOWED_ROLES.has(role)) return null;
  return { id: p.id, role, store_number: p.store_number, district: p.district, area: p.area, region: p.region };
}

// Build { store_number → { store_name, district, area, region } }
async function buildOrgMap(supa, storeNumbers) {
  if (!storeNumbers.length) return {};
  const { data: stores } = await supa
    .from("stores")
    .select("number, name, districts ( name, areas ( name, regions ( name ) ) )")
    .in("number", storeNumbers)
    .eq("is_active", true);
  const map = {};
  for (const s of stores || []) {
    const dist   = s.districts;
    const area   = dist?.areas;
    const region = area?.regions;
    map[s.number] = {
      store_name: s.name ?? null,
      district:   dist?.name ?? null,
      area:       area?.name ?? null,
      region:     region?.name ?? null,
    };
  }
  return map;
}

// Scope filtering: returns a storeNumbers array, or null for no filter (all stores).
async function scopedStoreNumbers(supa, user, params) {
  const role = user.role;

  // Admin / VP / COO see everything — but still apply any explicit filters
  const isWide = ["admin", "vp", "coo"].includes(role);

  const regionFilter   = params.get("region")   || null;
  const areaFilter     = params.get("area")      || null;
  const districtFilter = params.get("district")  || null;

  // Build stores query
  let q = supa
    .from("stores")
    .select("number, name, districts!inner ( name, areas!inner ( name, regions!inner ( name ) ) )")
    .eq("is_active", true);

  if (districtFilter) {
    q = q.eq("districts.name", districtFilter);
  } else if (areaFilter) {
    q = q.eq("districts.areas.name", areaFilter);
  } else if (regionFilter) {
    q = q.eq("districts.areas.regions.name", regionFilter);
  } else if (!isWide) {
    // Scope non-wide roles to their org slice
    if (role === "gm") {
      return user.store_number ? [user.store_number] : [];
    }
    if (["do", "sdo"].includes(role) && user.district) {
      q = q.eq("districts.name", user.district);
    } else if (role === "rvp" && user.region) {
      q = q.eq("districts.areas.regions.name", user.region);
    } else {
      return null; // FBC or unmapped — show all
    }
  }

  const { data } = await q;
  return (data || []).map((s) => s.number);
}

// ── action=summary ────────────────────────────────────────────────────────────
async function getSummary(supa, user, params) {
  const storeNums = await scopedStoreNumbers(supa, user, params);

  // Latest assessment per store (most recent date)
  let q = supa
    .from("ecosure_assessments")
    .select("store_number, assessment_date, visit_type, visit_score, visit_rating, total_findings, imminent_risk, critical_findings, major_findings, minor_findings, report_url, pulled_at");

  if (storeNums !== null) {
    if (!storeNums.length) return { ok: true, stores: [], summary: null, top_findings: [], as_of: null };
    q = q.in("store_number", storeNums);
  }

  const { data: rows, error } = await q.order("assessment_date", { ascending: false });
  if (error) return { error: error.message, status: 500 };

  // Keep latest per store
  const latest = new Map();
  for (const r of rows || []) {
    if (!latest.has(r.store_number)) latest.set(r.store_number, r);
  }
  const latestRows = Array.from(latest.values());

  // Org enrichment
  const nums   = latestRows.map((r) => r.store_number);
  const orgMap = await buildOrgMap(supa, nums);

  const stores = latestRows.map((r) => {
    const today = new Date();
    const auditDate = new Date(r.assessment_date);
    const daysSince = Math.floor((today - auditDate) / 86400000);
    return {
      ...r,
      store_name: orgMap[r.store_number]?.store_name ?? null,
      district:   orgMap[r.store_number]?.district   ?? null,
      area:       orgMap[r.store_number]?.area        ?? null,
      region:     orgMap[r.store_number]?.region      ?? null,
      days_since_audit: daysSince,
    };
  });

  // Summary cards
  const rated = stores.filter((s) => s.visit_score != null);
  const avgScore = rated.length
    ? Math.round((rated.reduce((a, s) => a + Number(s.visit_score), 0) / rated.length) * 10) / 10
    : null;
  const riskCounts = { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 };
  for (const s of stores) if (s.visit_rating) riskCounts[s.visit_rating] = (riskCounts[s.visit_rating] || 0) + 1;
  const overdueCount = stores.filter((s) => s.days_since_audit > 180).length;

  // Top findings (across the period in scope)
  let fq = supa
    .from("ecosure_findings")
    .select("question_number, standard_description");

  if (storeNums !== null && storeNums.length) fq = fq.in("store_number", storeNums);

  const { data: findings } = await fq;
  const qCounts = new Map();
  const qDesc   = new Map();
  for (const f of findings || []) {
    const k = f.question_number;
    qCounts.set(k, (qCounts.get(k) || 0) + 1);
    if (!qDesc.has(k)) qDesc.set(k, f.standard_description);
  }
  const top_findings = Array.from(qCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([question_number, count]) => ({
      question_number,
      standard_description: qDesc.get(question_number) ?? null,
      count,
    }));

  const as_of = stores.length
    ? stores.reduce((a, b) => (a.pulled_at > b.pulled_at ? a : b)).pulled_at
    : null;

  return {
    ok: true,
    summary: { avg_score: avgScore, risk_counts: riskCounts, overdue_count: overdueCount, total_stores: stores.length },
    stores,
    top_findings,
    as_of,
  };
}

// ── action=store ──────────────────────────────────────────────────────────────
async function getStore(supa, user, params) {
  const storeNumber = params.get("storeNumber");
  if (!storeNumber) return { error: "storeNumber required", status: 400 };

  // Access check: non-wide roles must own the store
  const storeNums = await scopedStoreNumbers(supa, user, params);
  if (storeNums !== null && !storeNums.includes(storeNumber)) {
    return { error: "forbidden", status: 403 };
  }

  const [{ data: assessments }, { data: findings }, orgMap] = await Promise.all([
    supa
      .from("ecosure_assessments")
      .select("*")
      .eq("store_number", storeNumber)
      .order("assessment_date", { ascending: false }),
    supa
      .from("ecosure_findings")
      .select("assessment_date, question_number, standard_description, primary_response, primary_comment, pdc_response, pdc_comment")
      .eq("store_number", storeNumber)
      .order("assessment_date", { ascending: false })
      .order("question_number"),
    buildOrgMap(supa, [storeNumber]),
  ]);

  // Group findings by assessment_date
  const findingsByDate = {};
  for (const f of findings || []) {
    const k = f.assessment_date;
    if (!findingsByDate[k]) findingsByDate[k] = [];
    findingsByDate[k].push(f);
  }

  const enrichedAssessments = (assessments || []).map((a) => ({
    ...a,
    findings: findingsByDate[a.assessment_date] || [],
  }));

  return {
    ok: true,
    store_number: storeNumber,
    store_name:   orgMap[storeNumber]?.store_name ?? null,
    district:     orgMap[storeNumber]?.district   ?? null,
    area:         orgMap[storeNumber]?.area        ?? null,
    region:       orgMap[storeNumber]?.region      ?? null,
    assessments:  enrichedAssessments,
  };
}

// ── action=overdue ────────────────────────────────────────────────────────────
async function getOverdue(supa, user, params) {
  const days = parseInt(params.get("days") || "180", 10);
  const storeNums = await scopedStoreNumbers(supa, user, params);

  // Latest assessment per store
  let q = supa
    .from("ecosure_assessments")
    .select("store_number, assessment_date")
    .order("assessment_date", { ascending: false });

  if (storeNums !== null) {
    if (!storeNums.length) return { ok: true, overdue: [], as_of: null };
    q = q.in("store_number", storeNums);
  }

  const { data, error } = await q;
  if (error) return { error: error.message, status: 500 };

  const latest = new Map();
  for (const r of data || []) {
    if (!latest.has(r.store_number)) latest.set(r.store_number, r.assessment_date);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const overdueEntries = Array.from(latest.entries()).filter(
    ([, d]) => new Date(d) < cutoff,
  );

  const nums   = overdueEntries.map(([n]) => n);
  const orgMap = await buildOrgMap(supa, nums);

  const overdue = overdueEntries
    .map(([store_number, last_audit_date]) => {
      const daysSince = Math.floor((Date.now() - new Date(last_audit_date)) / 86400000);
      return {
        store_number,
        last_audit_date,
        days_since_audit: daysSince,
        store_name: orgMap[store_number]?.store_name ?? null,
        district:   orgMap[store_number]?.district   ?? null,
        area:       orgMap[store_number]?.area        ?? null,
        region:     orgMap[store_number]?.region      ?? null,
      };
    })
    .sort((a, b) => b.days_since_audit - a.days_since_audit);

  return { ok: true, overdue, threshold_days: days, as_of: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed" });

  const supa   = svc();
  const user   = await sessionUser(supa, event);
  if (!user) return respond(401, { error: "Unauthorized" });

  const params = new URLSearchParams(event.queryStringParameters || {});
  const action = params.get("action") || "summary";

  let result;
  if (action === "summary") {
    result = await getSummary(supa, user, params);
  } else if (action === "store") {
    result = await getStore(supa, user, params);
  } else if (action === "overdue") {
    result = await getOverdue(supa, user, params);
  } else {
    return respond(400, { error: `Unknown action: ${action}` });
  }

  if (result.error) return respond(result.status || 500, { error: result.error });
  return respond(200, result);
};
