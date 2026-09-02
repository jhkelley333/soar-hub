// google-reviews — Google Reviews module (Tier A, Google Places API). Pulls each
// store's overall Google rating + review count and its (≤5) newest reviews into
// google_reviews / google_review_snapshots, and serves a scoped summary: overall
// rating, worst locations, a recent-review feed, keyword tags, and a sample
// distribution. Reviews depth is capped by the Places API (5/place, no history);
// the snapshot table builds a rating trend over time. Business Profile API would
// add full history + replies later.
//
//   GET ?action=summary                    scoped overview
//   GET ?action=refresh[&limit=N]          pull the N stalest stores (admin/vp/coo)
//
// Roles mirror Hours of Operation (its place_id source). Service-role only.

import { createClient } from "@supabase/supabase-js";
import { fetchPlaceReviews, placesConfigured } from "./_lib/places.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VIEW_ROLES = new Set(["admin", "vp", "coo", "sdo", "rvp"]);
const ORG_WIDE = new Set(["admin", "vp", "coo"]);
const REFRESH_ROLES = ORG_WIDE;

function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function respond(code, payload) { return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }; }
async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: { user } = {} } = await supa.auth.getUser(header.slice(7).trim());
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase() } : null;
}
async function visibleIds(supa, user) {
  if (ORG_WIDE.has(user.role)) return null;
  const { data } = await supa.rpc("user_visible_stores", { uid: user.id });
  return new Set((data ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean));
}

// ── refresh: pull the N stalest stores from Google Places ──
async function refresh(supa, params) {
  if (!placesConfigured()) return { error: "Google Places isn't configured (GOOGLE_PLACES_API_KEY).", status: 503 };
  const limit = Math.min(40, Math.max(1, parseInt(params.limit, 10) || 15));
  const { data: stores } = await supa.from("stores").select("id, number, google_place_id").eq("is_active", true).not("google_place_id", "is", null);
  if (!stores?.length) return { refreshed: 0, note: "No stores have a Google place_id yet — reconcile them in Hours of Operation first." };
  const { data: snaps } = await supa.from("google_review_snapshots").select("store_id, captured_date");
  const last = new Map();
  for (const s of snaps || []) { const p = last.get(s.store_id); if (!p || s.captured_date > p) last.set(s.store_id, s.captured_date); }
  const ordered = stores.slice().sort((a, b) => ((last.get(a.id) || "") < (last.get(b.id) || "") ? -1 : 1)); // stalest first
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const start = Date.now();
  let refreshed = 0, reviewsSeen = 0, errors = 0;
  for (const st of ordered) {
    if (refreshed >= limit || Date.now() - start > 8500) break;
    const r = await fetchPlaceReviews(st.google_place_id);
    if (r.error) { errors++; refreshed++; continue; }
    await supa.from("google_review_snapshots").upsert(
      { store_id: st.id, captured_date: today, rating: r.rating, review_count: r.total, fetched_at: new Date().toISOString() },
      { onConflict: "store_id,captured_date" },
    );
    const rows = (r.reviews || []).filter((rv) => rv.time).map((rv) => ({
      store_id: st.id, author: rv.author, rating: rv.rating, body: rv.text,
      review_time: new Date(rv.time * 1000).toISOString(), relative_time: rv.relative_time, language: rv.language,
    }));
    if (rows.length) {
      const { error } = await supa.from("google_reviews").upsert(rows, { onConflict: "store_id,author,review_time", ignoreDuplicates: true });
      if (!error) reviewsSeen += rows.length;
    }
    refreshed++;
  }
  const pending = ordered.filter((s) => (last.get(s.id) || "") < today).length;
  return { refreshed, reviews_seen: reviewsSeen, errors, remaining: Math.max(0, pending - refreshed), total_with_place_id: stores.length };
}

// ── keyword tags over collected review bodies ──
const STOP = new Set("the and for that with this was were are you your our have has had they them their but not been will they've it's don't didn't cant can't get got very really just too also then than out who how why when what where which some any all can our are her his she him".split(/\s+/));
function keywordTags(rows) {
  const neg = new Map(), pos = new Map();
  for (const r of rows) {
    const bag = r.rating <= 2 ? neg : r.rating >= 4 ? pos : null;
    if (!bag) continue;
    const seen = new Set();
    for (const w of String(r.body || "").toLowerCase().match(/[a-z']{3,}/g) || []) {
      if (STOP.has(w) || seen.has(w)) continue;
      seen.add(w); bag.set(w, (bag.get(w) || 0) + 1);
    }
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count }));
  return { issues: top(neg), positive: top(pos) };
}

async function summary(supa, user) {
  const scope = await visibleIds(supa, user);
  const { data: stores } = await supa.from("stores").select("id, number, name, google_place_id").eq("is_active", true).or("brand.eq.sonic,brand.is.null");
  const inScope = (stores || []).filter((s) => s.google_place_id && (scope == null || scope.has(s.id)));
  const withPlaceId = inScope.length;
  const totalStores = (stores || []).filter((s) => scope == null || scope.has(s.id)).length;
  const ids = inScope.map((s) => s.id);
  if (!ids.length) {
    return { overall: null, worst: [], recent: [], keywords: { issues: [], positive: [] }, distribution: null, coverage: { rated: 0, with_place_id: 0, total: totalStores }, configured: placesConfigured() };
  }

  const { data: snaps } = await supa.from("google_review_snapshots").select("store_id, rating, review_count, captured_date").in("store_id", ids).order("captured_date", { ascending: false });
  const latest = new Map();
  for (const s of snaps || []) if (!latest.has(s.store_id)) latest.set(s.store_id, s);
  const nmeta = new Map(inScope.map((s) => [s.id, s]));
  const rated = ids.map((id) => ({ meta: nmeta.get(id), snap: latest.get(id) })).filter((x) => x.snap && x.snap.rating != null);

  const totCount = rated.reduce((a, x) => a + (x.snap.review_count || 0), 0);
  const wSum = rated.reduce((a, x) => a + x.snap.rating * (x.snap.review_count || 0), 0);
  const overall = rated.length ? {
    avg: totCount ? Math.round((wSum / totCount) * 10) / 10 : Math.round((rated.reduce((a, x) => a + x.snap.rating, 0) / rated.length) * 10) / 10,
    stores: rated.length, total_reviews: totCount,
  } : null;

  const worst = rated.slice().sort((a, b) => a.snap.rating - b.snap.rating).slice(0, 8)
    .map((x) => ({ number: x.meta.number, name: x.meta.name, rating: x.snap.rating, count: x.snap.review_count }));

  const nameById = new Map(inScope.map((s) => [s.id, `#${s.number} ${s.name}`]));
  const { data: recentRaw } = await supa.from("google_reviews").select("store_id, author, rating, body, review_time, relative_time").in("store_id", ids).order("review_time", { ascending: false }).limit(40);
  const recent = (recentRaw || []).map((r) => ({ store: nameById.get(r.store_id) || "", author: r.author, rating: r.rating, body: (r.body || "").slice(0, 700), review_time: r.review_time, relative_time: r.relative_time }));

  const { data: allRev } = await supa.from("google_reviews").select("rating, body").in("store_id", ids).limit(3000);
  const dist = [0, 0, 0, 0, 0, 0];
  for (const r of allRev || []) if (r.rating >= 1 && r.rating <= 5) dist[r.rating]++;

  // 60-day trend from collected reviews: per day, how many reviews came in and
  // their average rating. Rolling sample, so it fills out over time.
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: trendRows } = await supa.from("google_reviews").select("review_time, rating").in("store_id", ids).gte("review_time", since);
  const byDay = new Map();
  for (const r of trendRows || []) {
    if (!r.review_time) continue;
    const d = new Date(r.review_time).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const b = byDay.get(d) || { count: 0, sum: 0, rated: 0 };
    b.count++; if (r.rating != null) { b.sum += r.rating; b.rated++; }
    byDay.set(d, b);
  }
  const trend = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const b = byDay.get(d);
    trend.push({ date: d, count: b ? b.count : 0, avg: b && b.rated ? Math.round((b.sum / b.rated) * 100) / 100 : null });
  }

  return {
    overall, worst, recent, trend,
    keywords: keywordTags(allRev || []),
    distribution: { 1: dist[1], 2: dist[2], 3: dist[3], 4: dist[4], 5: dist[5], total: (allRev || []).length },
    coverage: { rated: rated.length, with_place_id: withPlaceId, total: totalStores },
    configured: placesConfigured(),
  };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }

  const params = event.queryStringParameters || {};
  const action = params.action || "summary";

  // Cron path: token-authenticated refresh with no user session (the weekly
  // Monday workflow). Only active when REVIEWS_CRON_TOKEN is set in Netlify.
  const cronToken = process.env.REVIEWS_CRON_TOKEN;
  if (action === "refresh" && cronToken && params.token && params.token === cronToken) {
    try {
      const r = await refresh(supa, params);
      return r.error ? respond(r.status || 500, { error: r.error }) : respond(200, r);
    } catch (e) {
      return respond(500, { error: e?.message || "Request failed" });
    }
  }

  const user = await sessionUser(supa, event);
  if (!user) return respond(401, { error: "Not signed in." });
  if (!VIEW_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

  try {
    if (action === "summary") return respond(200, await summary(supa, user));
    if (action === "refresh") {
      if (!REFRESH_ROLES.has(user.role)) return respond(403, { error: "Only admin/VP/COO can refresh." });
      const r = await refresh(supa, params);
      return r.error ? respond(r.status || 500, { error: r.error }) : respond(200, r);
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.log(`[google-reviews] ${action} failed: ${e?.message || e}`);
    return respond(500, { error: e?.message || "Request failed" });
  }
};
