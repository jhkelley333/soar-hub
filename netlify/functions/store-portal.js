// Store Command Center — backend for the public per-store page (/s/:token).
//
// The URL token is the credential, and it binds to the FIRST device that opens
// it (the store desktop): the browser generates a device_id once and sends it
// with every call; a mismatched device gets a clear 403 until an admin resets
// the binding. Data exposed is the store's own operational snapshot only.
//
// Admin actions (Bearer + role=admin) mint / revoke / reset tokens.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getSheetsClient, getAvailableWeeks, batchGetWeeks, findRowByStore, getMetricRaw,
} from "./_lib/ranker-sheets.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "SOAR Hub";

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("store-portal env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
const respond = (statusCode, payload) => ({
  statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

async function sendEmail({ to, subject, text }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!RESEND_API_KEY || !recipients.length) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`, to: recipients, subject, text }),
    });
    return { ok: res.ok };
  } catch { return { ok: false }; }
}

// ── Token + device gate ───────────────────────────────────────────────────────
// Resolves the token, enforces the device binding (first device claims an
// unclaimed token), and returns the store row.
async function gate(supa, body) {
  const token = String(body?.token || "").trim();
  const deviceId = String(body?.device_id || "").trim();
  if (!token || !deviceId) return { error: "Missing token or device.", status: 400 };
  const { data: t } = await supa.from("store_portal_tokens").select("*").eq("token", token).maybeSingle();
  if (!t || !t.is_active) return { error: "This link is no longer active. Ask your admin for a new one.", status: 404 };
  if (!t.device_id) {
    await supa.from("store_portal_tokens")
      .update({ device_id: deviceId, device_bound_at: new Date().toISOString(), last_used_at: new Date().toISOString() })
      .eq("id", t.id).is("device_id", null);
    // Re-read: if a concurrent first-open won the race, fall through to the check.
    const { data: t2 } = await supa.from("store_portal_tokens").select("*").eq("id", t.id).maybeSingle();
    if (t2?.device_id && t2.device_id !== deviceId) {
      return { error: "This link is registered to a different device. Ask your admin to reset it.", status: 403 };
    }
  } else if (t.device_id !== deviceId) {
    return { error: "This link is registered to a different device. Ask your admin to reset it.", status: 403 };
  } else {
    await supa.from("store_portal_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
  }
  const { data: store } = await supa.from("stores")
    .select("id, number, name, city, state").eq("id", t.store_id).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };
  return { tokenRow: t, store };
}

async function resolve(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  const { store } = g;
  return { ok: true, store: { number: store.number, name: store.name, city: store.city, state: store.state } };
}

// ── Snapshot — everything on the page in one call ─────────────────────────────
const pct = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 10);

async function laborAndSales(supa, storeNumber) {
  const { data: rows } = await supa.from("labor_v2_daily")
    .select("business_date, net_sales, labor_pct, target_labor_pct")
    .eq("store_number", String(storeNumber))
    .order("business_date", { ascending: false }).limit(10);
  const latest = rows?.[0];
  if (!latest) return { sales: null, labor: null };
  const wk = (rows || []).find((r) => {
    const d = new Date(`${latest.business_date}T00:00:00Z`) - new Date(`${r.business_date}T00:00:00Z`);
    return Math.round(d / 86_400_000) === 7;
  });
  const sales = {
    date: latest.business_date,
    net_sales: latest.net_sales == null ? null : Number(latest.net_sales),
    wow_pct: latest.net_sales != null && wk?.net_sales
      ? Math.round(((Number(latest.net_sales) - Number(wk.net_sales)) / Number(wk.net_sales)) * 1000) / 10
      : null,
  };
  const labor = {
    date: latest.business_date,
    labor_pct: pct(latest.labor_pct),
    target_pct: pct(latest.target_labor_pct),
  };
  return { sales, labor };
}

async function rankerRank(storeNumber) {
  try {
    const sheets = await getSheetsClient();
    const weeks = await getAvailableWeeks(sheets);
    if (!weeks.length) return null;
    const wk = String(weeks[weeks.length - 1]);
    const data = (await batchGetWeeks(sheets, [wk])).get(wk);
    if (!data) return null;
    const row = findRowByStore(data.rows, storeNumber);
    if (!row) return null;
    const rank = parseInt(getMetricRaw(row, data.idx, "storeRank"), 10);
    return Number.isNaN(rank) ? null : { rank, total: data.rows.length, week: wk };
  } catch { return null; }
}

async function openWorkOrders(supa, storeNumber) {
  const { data: rows } = await supa.from("tickets")
    .select("id, title, status, priority, date_submitted")
    .eq("store_number", String(storeNumber))
    .not("status", "in", "(completed,closed,cancelled)")
    .order("date_submitted", { ascending: false }).limit(25);
  const open = rows || [];
  return {
    open_count: open.length,
    latest: open.slice(0, 2).map((t) => ({ title: t.title, status: t.status, priority: t.priority })),
  };
}

async function storeNotes(supa, storeNumber) {
  const nowIso = new Date().toISOString();
  const { data } = await supa.from("store_messages")
    .select("id, title, body, is_pinned, created_at, expires_at, author_name")
    .contains("store_numbers", [String(storeNumber)])
    .eq("is_active", true)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8);
  return (data || [])
    .filter((m) => !m.expires_at || m.expires_at > nowIso)
    .slice(0, 5)
    .map((m) => ({ title: m.title, body: (m.body || "").slice(0, 240), pinned: m.is_pinned, author: m.author_name, created_at: m.created_at }));
}

// GM / DO / SDO / RVP for one store — compact version of org.js's resolution
// (primary scopes only; enough for a call sheet).
async function leadership(supa, store) {
  const out = [];
  const { data: gms } = await supa.from("profiles")
    .select("full_name, preferred_name, phone, email, role")
    .eq("primary_store_id", store.id).eq("is_active", true).eq("role", "gm").limit(1);
  if (gms?.[0]) out.push({ slot: "GM", ...pick(gms[0]) });

  const { data: srow } = await supa.from("stores").select("district_id").eq("id", store.id).maybeSingle();
  const districtId = srow?.district_id ?? null;
  let areaId = null, regionId = null;
  if (districtId) {
    const { data: d } = await supa.from("districts").select("area_id").eq("id", districtId).maybeSingle();
    areaId = d?.area_id ?? null;
  }
  if (areaId) {
    const { data: a } = await supa.from("areas").select("region_id").eq("id", areaId).maybeSingle();
    regionId = a?.region_id ?? null;
  }
  const slots = [
    { slot: "DO", role: "do", scope_type: "district", scope_id: districtId },
    { slot: "SDO", role: "sdo", scope_type: "area", scope_id: areaId },
    { slot: "RVP", role: "rvp", scope_type: "region", scope_id: regionId },
  ];
  for (const s of slots) {
    if (!s.scope_id) continue;
    const { data: scopes } = await supa.from("user_scopes")
      .select("user_id").eq("scope_type", s.scope_type).eq("scope_id", s.scope_id);
    const ids = (scopes || []).map((r) => r.user_id);
    if (!ids.length) continue;
    const { data: profs } = await supa.from("profiles")
      .select("id, full_name, preferred_name, phone, email, role")
      .in("id", ids).eq("is_active", true);
    const match = (profs || []).find((p) => p.role === s.role) || (profs || [])[0];
    if (match) out.push({ slot: s.slot, ...pick(match) });
  }
  return out;
}
const pick = (p) => ({ name: p.preferred_name || p.full_name || null, phone: p.phone || null, email: p.email || null });

async function assembleSnapshot(supa, store) {
  const [ls, rank, wo, notes, contacts] = await Promise.all([
    laborAndSales(supa, store.number),
    rankerRank(store.number),
    openWorkOrders(supa, store.number),
    storeNotes(supa, store.number),
    leadership(supa, store),
  ]);
  return {
    store: { number: store.number, name: store.name, city: store.city, state: store.state },
    sales: ls.sales, labor: ls.labor, rank, work_orders: wo, notes, contacts,
  };
}

async function snapshot(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  return assembleSnapshot(supa, g.store);
}

const REPORT_KINDS = new Set(["tardiness", "safety", "equipment", "issue"]);
async function report(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  const { store, tokenRow } = g;
  const kind = REPORT_KINDS.has(body?.kind) ? body.kind : "issue";
  const message = String(body?.message || "").trim();
  if (!message) return { error: "Describe what is going on.", status: 400 };
  const reporter = String(body?.reporter_name || "").trim().slice(0, 120) || null;

  const contacts = await leadership(supa, store);
  const to = contacts.filter((c) => (c.slot === "GM" || c.slot === "DO") && c.email).map((c) => c.email);
  const kindLabel = { tardiness: "Tardiness", safety: "SAFETY", equipment: "Equipment", issue: "Issue" }[kind];
  await sendEmail({
    to,
    subject: `[Store ${store.number}] ${kindLabel} report from the store floor`,
    text: [
      `Store #${store.number}${store.name ? ` - ${store.name}` : ""}`,
      `Type: ${kindLabel}`,
      reporter ? `Reported by: ${reporter}` : null,
      "",
      message.slice(0, 4000),
      "",
      "Sent from the Store Command Center screen.",
    ].filter((l) => l !== null).join("\n"),
  });
  const { error } = await supa.from("store_portal_reports").insert({
    store_id: store.id, token_id: tokenRow.id, kind, message: message.slice(0, 4000),
    reporter_name: reporter, emailed_to: to,
  });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, notified: to.length };
}

// ── Admin (Bearer + role=admin) ───────────────────────────────────────────────
async function getSessionUser(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: userRes, error } = await supa.auth.getUser(header.slice(7).trim());
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles")
    .select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false || String(profile.role) !== "admin") return null;
  return profile;
}

async function adminList(supa) {
  const { data: stores } = await supa.from("stores")
    .select("id, number, name, city, state").eq("is_active", true).order("number");
  const { data: tokens } = await supa.from("store_portal_tokens")
    .select("id, store_id, token, is_active, device_id, device_bound_at, last_used_at, created_at")
    .order("created_at", { ascending: false });
  const byStore = new Map();
  for (const t of tokens || []) {
    if (!t.is_active) continue;
    if (!byStore.has(t.store_id)) byStore.set(t.store_id, t);
  }
  return {
    stores: (stores || []).map((s) => {
      const t = byStore.get(s.id) || null;
      return {
        store_id: s.id, number: s.number, name: s.name, city: s.city, state: s.state,
        token: t ? { id: t.id, token: t.token, bound: !!t.device_id, last_used_at: t.last_used_at, created_at: t.created_at } : null,
      };
    }),
  };
}

async function adminMint(supa, user, body) {
  const storeId = body?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  // One active token per store: revoke any existing active ones first.
  await supa.from("store_portal_tokens").update({ is_active: false }).eq("store_id", storeId).eq("is_active", true);
  const token = crypto.randomBytes(18).toString("hex");
  const { data, error } = await supa.from("store_portal_tokens")
    .insert({ store_id: storeId, token, created_by: user.id }).select("id, token").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, token_id: data.id, token: data.token };
}

async function adminRevoke(supa, _user, body) {
  const id = body?.token_id;
  if (!id) return { error: "Missing token.", status: 400 };
  const { error } = await supa.from("store_portal_tokens").update({ is_active: false }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// Live admin view of a store's Command Center: the same snapshot the store
// screen renders (no token/device needed — Bearer admin instead), plus the
// recent floor reports so the admin sees what is coming in.
async function adminSnapshot(supa, params) {
  const storeId = params?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  const { data: store } = await supa.from("stores")
    .select("id, number, name, city, state").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };
  const [snap, reports] = await Promise.all([
    assembleSnapshot(supa, store),
    supa.from("store_portal_reports")
      .select("kind, message, reporter_name, created_at")
      .eq("store_id", storeId).order("created_at", { ascending: false }).limit(10)
      .then((r) => r.data || []),
  ]);
  return { ...snap, reports };
}

async function adminResetDevice(supa, _user, body) {
  const id = body?.token_id;
  if (!id) return { error: "Missing token.", status: 400 };
  const { error } = await supa.from("store_portal_tokens")
    .update({ device_id: null, device_bound_at: null }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const params = event.queryStringParameters || {};
  const action = params.action || "";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    // Public, token-gated actions.
    if (action === "resolve") return unwrap(await resolve(supa, body));
    if (action === "snapshot") return unwrap(await snapshot(supa, body));
    if (action === "report") return unwrap(await report(supa, body));
    // Admin actions.
    const user = await getSessionUser(event, supa);
    if (!user) return respond(401, { error: "unauthorized" });
    if (action === "admin-list") return unwrap(await adminList(supa));
    if (action === "admin-snapshot") return unwrap(await adminSnapshot(supa, params));
    if (action === "admin-mint") return unwrap(await adminMint(supa, user, body));
    if (action === "admin-revoke") return unwrap(await adminRevoke(supa, user, body));
    if (action === "admin-reset-device") return unwrap(await adminResetDevice(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
