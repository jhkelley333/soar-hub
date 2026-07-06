// netlify/functions/count.js
//
// Daily Count scores (migration 0211) — per-store inventory count scores
// (Daily / Completion / Accuracy) from the same KPI feed as Labor v2.
// Actions:
//   GET  ?action=overview[&date=YYYY-MM-DD]  -> caller's visible stores with
//                                               scores for the date (latest by
//                                               default), + WoW deltas
//   GET  ?action=trend&store=N               -> one store's daily history
//   POST ?action=refresh                     -> admin: pull the feed now and
//                                               upsert count_daily
//
// Visibility mirrors the app: org-wide roles see everything, everyone else
// via user_visible_stores(). Service-role gatekeeper: RLS on, no policies.

import { createClient } from "@supabase/supabase-js";
import { fetchKpiFeed, kpiConfigured } from "./_lib/kpiFeed.js";
import { feedBusinessDate, wallClockInTz } from "./_lib/kpiLabor.js";
import { extractCountRows } from "./_lib/kpiCount.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const TZ = "America/Chicago";

const ORG_WIDE = new Set(["admin", "vp", "coo", "payroll", "accounting"]);
const READ_ROLES = new Set([
  "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader",
  "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting", "fbc",
]);
const REFRESH_ROLES = new Set(["admin", "vp", "coo"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("count env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, primary_store_id, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

async function callerVisibleStores(supa, user) {
  if (ORG_WIDE.has(user.role) || user.role === "fbc") {
    const { data } = await supa.from("stores").select("id, number, name").eq("is_active", true);
    return data ?? [];
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa.from("stores").select("id, number, name").in("id", ids).eq("is_active", true);
  return data ?? [];
}

async function latestBusinessDate(supa) {
  const { data } = await supa
    .from("count_daily")
    .select("business_date")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.business_date ?? null;
}

function priorDateIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

async function overview(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const stores = await callerVisibleStores(supa, user);
  if (!stores.length) return { date: null, rows: [] };
  const numbers = stores.map((s) => String(s.number));
  const nameByNumber = new Map(stores.map((s) => [String(s.number), s.name]));

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || ""))
    ? params.date
    : await latestBusinessDate(supa);
  if (!date) return { date: null, rows: [] };
  const prior = priorDateIso(date);

  const [{ data: cur }, { data: prev }] = await Promise.all([
    supa.from("count_daily").select("*").eq("business_date", date).in("store_number", numbers),
    supa.from("count_daily").select("store_number, daily_score, completion_score, accuracy_score").eq("business_date", prior).in("store_number", numbers),
  ]);
  const prevBy = new Map((prev ?? []).map((r) => [String(r.store_number), r]));

  const rows = (cur ?? []).map((r) => {
    const p = prevBy.get(String(r.store_number));
    return {
      store_number: r.store_number,
      store_name: nameByNumber.get(String(r.store_number)) ?? null,
      daily_score: r.daily_score,
      completion_score: r.completion_score,
      accuracy_score: r.accuracy_score,
      total_intellicost_pct: r.total_intellicost_pct,
      wow_daily: p && r.daily_score != null && p.daily_score != null ? round4(r.daily_score - p.daily_score) : null,
      wow_completion: p && r.completion_score != null && p.completion_score != null ? round4(r.completion_score - p.completion_score) : null,
      wow_accuracy: p && r.accuracy_score != null && p.accuracy_score != null ? round4(r.accuracy_score - p.accuracy_score) : null,
    };
  });
  rows.sort((a, b) => (a.daily_score ?? 1) - (b.daily_score ?? 1)); // worst first

  return { date, rows };
}

async function trend(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  if (!storeNumber) return { error: "store is required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data } = await supa
    .from("count_daily")
    .select("business_date, daily_score, completion_score, accuracy_score, total_intellicost_pct")
    .eq("store_number", storeNumber)
    .order("business_date", { ascending: true })
    .limit(120);
  return { store_number: storeNumber, store_name: store.name, history: data ?? [] };
}

async function refresh(supa, user) {
  if (!REFRESH_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  if (!kpiConfigured()) return { error: "KPI feed isn't configured.", status: 500 };
  const payload = await fetchKpiFeed();
  const wc = wallClockInTz(new Date(), TZ);
  const businessDate = feedBusinessDate(payload, wc);
  const rows = extractCountRows(payload).map((r) => ({
    ...r, business_date: businessDate, captured_at: new Date().toISOString(),
  }));
  if (!rows.length) {
    return { ok: true, business_date: businessDate, upserted: 0, note: "The feed returned no count scores for this pull." };
  }
  const { error } = await supa.from("count_daily").upsert(rows, { onConflict: "store_number,business_date" });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, business_date: businessDate, upserted: rows.length };
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  const unwrap = (result) => {
    if (result && typeof result === "object" && "status" in result && "error" in result) {
      return respond(result.status, { error: result.error });
    }
    return respond(200, result);
  };

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "overview") return unwrap(await overview(supa, user, params));
      if (action === "trend") return unwrap(await trend(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      if (action === "refresh") return unwrap(await refresh(supa, user));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    console.error("[count]", action, e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
