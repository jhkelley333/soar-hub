// rap-data — Customer RAP Data (Beta) module. Admin-only, feature-flag gated.
//
// Tables read (service-role key — RLS on, no policies):
//   rap_guest_outcomes        — scores (mtd/rolling3/month_final) per store/period
//   rap_guest_outcomes_history — historical scores for time-series chart
//   rap_reviews               — individual reviews from all channels
//   stores                    — name + org tree join
//   districts / areas / regions — org hierarchy
//
// Actions:
//   GET ?action=scores[&scope=mtd|rolling3|month_final]
//   GET ?action=store&storeNumber=XXXX
//   GET ?action=reviews[&store=XXXX][&channel=X][&from=YYYY-MM-DD][&to=YYYY-MM-DD][&q=text][&page=N]

import { createClient } from "@supabase/supabase-js";
import { getFlag } from "./_lib/flags.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = 25;

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
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase() } : null;
}

// Deduplicate scores rows: keep latest pulled_at per store_number.
function dedup(rows) {
  const map = new Map();
  for (const r of rows) {
    const existing = map.get(r.store_number);
    if (!existing || r.pulled_at > existing.pulled_at) {
      map.set(r.store_number, r);
    }
  }
  return Array.from(map.values());
}

// Build org-tree lookup: store_number → { store_name, district, area, region }
async function buildOrgMap(supa, storeNumbers) {
  if (!storeNumbers.length) return {};
  const { data: stores } = await supa
    .from("stores")
    .select(`
      number, name,
      districts ( name, areas ( name, regions ( name ) ) )
    `)
    .in("number", storeNumbers)
    .eq("is_active", true);

  const map = {};
  for (const s of stores || []) {
    const dist = s.districts;
    const area = dist?.areas;
    const region = area?.regions;
    map[s.number] = {
      store_name: s.name ?? null,
      district: dist?.name ?? null,
      area: area?.name ?? null,
      region: region?.name ?? null,
    };
  }
  return map;
}

async function getScores(supa, scope) {
  const validScope = ["mtd", "rolling3", "month_final"].includes(scope) ? scope : "mtd";
  const { data, error } = await supa
    .from("rap_guest_outcomes")
    .select("store_number, period_start, period_end, scope, ltr, osat, doordash, google, grubhub, ubereats, other, avg_stars, pulled_at")
    .eq("scope", validScope)
    .order("pulled_at", { ascending: false });

  if (error) return { error: error.message, status: 500 };

  const deduped = dedup(data || []);
  const storeNumbers = deduped.map((r) => r.store_number);
  const orgMap = await buildOrgMap(supa, storeNumbers);

  const rows = deduped.map((r) => ({
    ...r,
    store_name: orgMap[r.store_number]?.store_name ?? null,
    district: orgMap[r.store_number]?.district ?? null,
    area: orgMap[r.store_number]?.area ?? null,
    region: orgMap[r.store_number]?.region ?? null,
  }));

  const as_of = rows.length ? rows.reduce((a, b) => (a.pulled_at > b.pulled_at ? a : b)).pulled_at : null;
  return { ok: true, scope: validScope, rows, as_of };
}

async function getStore(supa, storeNumber) {
  if (!storeNumber) return { error: "storeNumber required", status: 400 };

  const [histResult, reviewResult, storeResult] = await Promise.all([
    supa
      .from("rap_guest_outcomes_history")
      .select("period_start, ltr, osat")
      .eq("store_number", storeNumber)
      .eq("scope", "month_final")
      .order("period_start", { ascending: true })
      .limit(24),
    supa
      .from("rap_reviews")
      .select("id, store_number, channel, review_date, review_text, first_seen_at")
      .eq("store_number", storeNumber)
      .order("review_date", { ascending: false })
      .limit(PAGE_SIZE),
    supa
      .from("stores")
      .select("name")
      .eq("number", storeNumber)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const history = (histResult.data || []).map((r) => ({
    period_start: r.period_start,
    ltr: r.ltr,
    osat: r.osat,
  }));

  const reviews = (reviewResult.data || []).map((r) => ({
    ...r,
    store_name: storeResult.data?.name ?? null,
    pii_possible: r.channel?.toLowerCase() === "qualtrics",
  }));

  return {
    ok: true,
    store_number: storeNumber,
    store_name: storeResult.data?.name ?? null,
    history,
    reviews,
  };
}

async function getReviews(supa, params) {
  const page = Math.max(0, parseInt(params.page, 10) || 0);
  const offset = page * PAGE_SIZE;

  let query = supa
    .from("rap_reviews")
    .select("id, store_number, channel, review_date, review_text, first_seen_at")
    .order("review_date", { ascending: false })
    .range(offset, offset + PAGE_SIZE); // fetch +1 to detect hasMore

  if (params.store) query = query.eq("store_number", params.store);
  if (params.channel) query = query.eq("channel", params.channel);
  if (params.from) query = query.gte("review_date", params.from);
  if (params.to) query = query.lte("review_date", params.to);
  if (params.q) query = query.ilike("review_text", `%${params.q}%`);

  const { data, error } = await query;
  if (error) return { error: error.message, status: 500 };

  const hasMore = (data || []).length > PAGE_SIZE;
  const slice = (data || []).slice(0, PAGE_SIZE);

  // Enrich with store names.
  const storeNumbers = [...new Set(slice.map((r) => r.store_number))];
  const orgMap = await buildOrgMap(supa, storeNumbers);

  const reviews = slice.map((r) => ({
    ...r,
    store_name: orgMap[r.store_number]?.store_name ?? null,
    pii_possible: r.channel?.toLowerCase() === "qualtrics",
  }));

  return { ok: true, reviews, hasMore, page };
}

export const handler = async (event) => {
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed" });

  const supa = svc();
  const user = await sessionUser(supa, event);
  if (!user) return respond(401, { error: "Unauthorized" });
  if (user.role !== "admin") return respond(403, { error: "Forbidden" });

  const flagOn = await getFlag(supa, "rap_data_beta", { userId: user.id });
  if (!flagOn) return respond(403, { error: "rap_data_beta flag not enabled" });

  const params = event.queryStringParameters || {};
  const action = params.action || "scores";

  try {
    let result;
    if (action === "scores") {
      result = await getScores(supa, params.scope || "mtd");
    } else if (action === "store") {
      result = await getStore(supa, params.storeNumber);
    } else if (action === "reviews") {
      result = await getReviews(supa, params);
    } else {
      return respond(400, { error: `Unknown action: ${action}` });
    }

    if (result.error) return respond(result.status || 500, { error: result.error });
    return respond(200, result);
  } catch (err) {
    console.error("rap-data error:", err);
    return respond(500, { error: "Internal server error" });
  }
};
