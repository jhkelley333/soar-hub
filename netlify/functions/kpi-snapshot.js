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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

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

// Classify a businessDateData row by its org level. The feed rolls up with
// child names set to "Total" above the level the row represents, so the most
// specific non-"Total" name wins.
function levelOf(r) {
  if (r.storeName && r.storeName !== "Total") return "store";
  if (r.districtName && r.districtName !== "Total") return "district";
  if (r.regionName && r.regionName !== "Total") return "region";
  if (r.regionParentName && r.regionParentName !== "Total") return "regionParent";
  return "total";
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

    if (!KPI_URL || !KPI_TOKEN) {
      return respond(503, { error: "KPI feed isn't configured (set SKUNKWORKS_KPI_URL + SKUNKWORKS_KPI_TOKEN in Netlify)." });
    }

    // Build the request URL robustly: strip any token already on SKUNKWORKS_KPI_URL
    // (so a full URL pasted into the env var doesn't double the token), then set ours.
    let url;
    try {
      const u = new URL(KPI_URL);
      u.searchParams.delete("token");
      u.searchParams.set("token", KPI_TOKEN);
      url = u.toString();
    } catch {
      return respond(500, { error: `SKUNKWORKS_KPI_URL is not a valid URL: "${String(KPI_URL).slice(0, 80)}"` });
    }

    // Time-box the upstream fetch so a hung feed returns a clean error here
    // instead of being killed by the Lambda timeout (which surfaces as a bare 502).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let payload;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) {
        return respond(502, { error: `KPI feed responded ${res.status}`, detail: text.slice(0, 300) });
      }
      try { payload = JSON.parse(text); }
      catch { return respond(502, { error: "KPI feed returned non-JSON", detail: text.slice(0, 300) }); }
    } catch (e) {
      const msg = e?.name === "AbortError" ? "timed out after 8s" : (e?.message || String(e));
      return respond(502, { error: `Couldn't reach the KPI feed: ${msg}` });
    } finally {
      clearTimeout(timer);
    }

    const rows = Array.isArray(payload?.rawData?.businessDateData)
      ? payload.rawData.businessDateData
      : [];
    // Tag each row with its level and keep all KPI fields intact (pass-through).
    const tagged = rows.map((r) => ({ level: levelOf(r), ...r }));
    const total = tagged.find((r) => r.level === "total") ?? null;

    return respond(200, {
      ok: true,
      fetchedAt: new Date().toISOString(),
      counts: {
        total: tagged.length,
        stores: tagged.filter((r) => r.level === "store").length,
        districts: tagged.filter((r) => r.level === "district").length,
        regions: tagged.filter((r) => r.level === "region").length,
      },
      total,
      rows: tagged,
    });
  } catch (e) {
    // Last-resort guard so the function never returns a bare 502 — the dashboard
    // surfaces this message in its empty state.
    return respond(500, { error: `kpi-snapshot error: ${e?.message || String(e)}` });
  }
};
