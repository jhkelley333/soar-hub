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
const ORG_WIDE = new Set(["admin", "vp", "coo"]);

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

const PAGE = 1000;
const IN_CHUNK = 200;

// PostgREST caps a response at 1,000 rows and a long .in() list overflows the
// URL, so page every read and split .in() lists into chunks. `make` must
// return a fresh, deterministically ordered query each call.
export async function fetchAll(make, inCol, inValues) {
  const chunks = [];
  if (inCol) {
    const uniq = [...new Set(inValues)];
    for (let i = 0; i < uniq.length; i += IN_CHUNK) chunks.push(uniq.slice(i, i + IN_CHUNK));
  } else {
    chunks.push(null);
  }
  const rows = [];
  for (const chunk of chunks) {
    for (let from = 0; ; from += PAGE) {
      const q = chunk ? make().in(inCol, chunk) : make();
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return { data: null, error };
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return { data: rows, error: null };
}

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: { user } = {} } = await supa.auth.getUser(header.slice(7).trim());
  if (!user) return null;
  const { data: p } = await supa
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!p || !p.is_active) return null;
  const role = String(p.role || "").toLowerCase();
  if (!ALLOWED_ROLES.has(role)) return null;
  return { id: p.id, role };
}

// Build { store_number → { store_name, district, area, region } }
async function buildOrgMap(supa, storeNumbers) {
  if (!storeNumbers.length) return {};
  const { data: stores } = await fetchAll(
    () => supa
      .from("stores")
      .select("number, name, districts ( name, areas ( name, regions ( name ) ) )")
      .eq("is_active", true)
      .order("number"),
    "number",
    storeNumbers,
  );
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

// Store numbers the caller may see; null = org-wide. Same user_visible_stores()
// RPC the rest of the app scopes with, so an unmapped user sees nothing.
async function visibleStoreNumbers(supa, user) {
  if (ORG_WIDE.has(user.role)) return null;
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return new Set();
  const { data } = await fetchAll(
    () => supa.from("stores").select("number").order("number"),
    "id",
    ids,
  );
  return new Set((data ?? []).map((s) => String(s.number)));
}

// Caller's scope narrowed by the explicit region/area/district filters.
// Returns a storeNumbers array, or null for no filter (all stores). Filters
// only ever narrow: they are intersected with what the caller may see.
export async function scopedStoreNumbers(supa, user, params) {
  const visible = await visibleStoreNumbers(supa, user);

  const regionFilter   = params.get("region")   || null;
  const areaFilter     = params.get("area")     || null;
  const districtFilter = params.get("district") || null;

  if (!regionFilter && !areaFilter && !districtFilter) {
    return visible ? Array.from(visible) : null;
  }

  const { data } = await fetchAll(() => {
    let q = supa
      .from("stores")
      .select("number, districts!inner ( name, areas!inner ( name, regions!inner ( name ) ) )")
      .eq("is_active", true)
      .order("number");
    if (districtFilter) q = q.eq("districts.name", districtFilter);
    if (areaFilter)     q = q.eq("districts.areas.name", areaFilter);
    if (regionFilter)   q = q.eq("districts.areas.regions.name", regionFilter);
    return q;
  });
  const filtered = (data || []).map((s) => String(s.number));
  return visible ? filtered.filter((n) => visible.has(n)) : filtered;
}

// ── action=summary ────────────────────────────────────────────────────────────
async function getSummary(supa, user, params) {
  const storeNums = await scopedStoreNumbers(supa, user, params);

  if (storeNums !== null && !storeNums.length) {
    return { ok: true, stores: [], summary: null, top_findings: [], as_of: null };
  }
  const inArgs = storeNums !== null ? ["store_number", storeNums] : [];

  const { data: rows, error } = await fetchAll(
    () => supa
      .from("ecosure_assessments")
      .select("store_number, assessment_date, visit_type, visit_score, visit_rating, total_findings, imminent_risk, critical_findings, major_findings, minor_findings, report_url, pulled_at")
      .order("assessment_date", { ascending: false })
      .order("id"),
    ...inArgs,
  );
  if (error) return { error: error.message, status: 500 };

  // Keep latest per store
  const latest = new Map();
  for (const r of rows) {
    const cur = latest.get(r.store_number);
    if (!cur || r.assessment_date > cur.assessment_date) latest.set(r.store_number, r);
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
  const { data: findings, error: fErr } = await fetchAll(
    () => supa
      .from("ecosure_findings")
      .select("question_number, standard_description")
      .order("id"),
    ...inArgs,
  );
  if (fErr) return { error: fErr.message, status: 500 };

  const qCounts = new Map();
  const qDesc   = new Map();
  for (const f of findings) {
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

  const visible = await visibleStoreNumbers(supa, user);
  if (visible !== null && !visible.has(storeNumber)) {
    return { error: "forbidden", status: 403 };
  }

  const [{ data: assessments, error: aErr }, { data: findings, error: fErr }, orgMap] = await Promise.all([
    fetchAll(() => supa
      .from("ecosure_assessments")
      .select("*")
      .eq("store_number", storeNumber)
      .order("assessment_date", { ascending: false })
      .order("id")),
    fetchAll(() => supa
      .from("ecosure_findings")
      .select("assessment_date, question_number, standard_description, primary_response, primary_comment, pdc_response, pdc_comment")
      .eq("store_number", storeNumber)
      .order("assessment_date", { ascending: false })
      .order("question_number")
      .order("id")),
    buildOrgMap(supa, [storeNumber]),
  ]);
  if (aErr || fErr) return { error: (aErr || fErr).message, status: 500 };

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

  if (storeNums !== null && !storeNums.length) return { ok: true, overdue: [], as_of: null };

  // Latest assessment per store
  const { data, error } = await fetchAll(
    () => supa
      .from("ecosure_assessments")
      .select("store_number, assessment_date")
      .order("assessment_date", { ascending: false })
      .order("id"),
    ...(storeNums !== null ? ["store_number", storeNums] : []),
  );
  if (error) return { error: error.message, status: 500 };

  const latest = new Map();
  for (const r of data) {
    const cur = latest.get(r.store_number);
    if (!cur || r.assessment_date > cur) latest.set(r.store_number, r.assessment_date);
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
