// netlify/functions/pl.js
//
// Store P&L statements (migration 0209). Actions:
//   GET  ?action=periods                      -> distinct uploaded periods
//   GET  ?action=overview&period=YYYY-MM-DD   -> caller's visible stores with
//                                                headline metrics for a period
//   GET  ?action=statement&store=N&period=…   -> one store's full statement
//   POST ?action=upload                       -> admin-only batch upsert from
//                                                the client-parsed workbook
//
// Visibility mirrors the rest of the app: org-wide roles see everything,
// everyone else flows through user_visible_stores(). Service-role
// gatekeeper — RLS is on with no policies; this function scope-checks.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const ORG_WIDE = new Set(["admin", "vp", "coo", "payroll", "accounting"]);
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll", "accounting", "fbc"]);
const UPLOAD_ROLES = new Set(["admin"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("pl env vars not configured");
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

// Visible store rows (id + number + name) for the caller — org-wide roles
// get every active store; everyone else via the user_visible_stores RPC.
async function callerVisibleStores(supa, user) {
  if (ORG_WIDE.has(user.role) || user.role === "fbc") {
    const { data } = await supa
      .from("stores")
      .select("id, number, name")
      .eq("is_active", true);
    return data ?? [];
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa
    .from("stores")
    .select("id, number, name")
    .in("id", ids)
    .eq("is_active", true);
  return data ?? [];
}

async function listPeriods(supa) {
  const { data, error } = await supa
    .from("pl_statements")
    .select("period_end, period_label, is_final")
    .order("period_end", { ascending: false });
  if (error) return { error: error.message, status: 500 };
  const byEnd = new Map();
  for (const r of data ?? []) {
    const cur = byEnd.get(r.period_end) || {
      period_end: r.period_end,
      period_label: r.period_label,
      has_prelim: false,
      has_final: false,
    };
    if (r.period_label && !cur.period_label) cur.period_label = r.period_label;
    if (r.is_final) cur.has_final = true; else cur.has_prelim = true;
    byEnd.set(r.period_end, cur);
  }
  // is_final kept for back-compat (badge shows "Final" once a Final exists).
  const periods = Array.from(byEnd.values()).map((p) => ({ ...p, is_final: p.has_final }));
  return { periods };
}

async function overview(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const period = String(params.period || "").trim();
  if (!period) return { error: "period is required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  if (!stores.length) return { period, rows: [] };
  const numbers = stores.map((s) => String(s.number));
  const nameByNumber = new Map(stores.map((s) => [String(s.number), s.name]));

  const { data, error } = await supa
    .from("pl_statements")
    .select("store_number, period_label, is_final, total_sales, gross_profit, ci_amount, ci_pct, ebitda")
    .eq("period_end", period)
    .in("store_number", numbers)
    .order("store_number");
  if (error) return { error: error.message, status: 500 };

  // A store may now have both a Prelim and a Final row. Show the Final when it
  // exists (else Prelim), and flag whether both are present so the UI can offer
  // the side-by-side comparison.
  const byStore = new Map();
  for (const r of data ?? []) {
    const key = String(r.store_number);
    const cur = byStore.get(key) || { prelim: null, final: null };
    if (r.is_final) cur.final = r; else cur.prelim = r;
    byStore.set(key, cur);
  }
  const rows = [];
  for (const [num, { prelim, final }] of byStore) {
    const chosen = final || prelim;
    if (!chosen) continue;
    rows.push({
      ...chosen,
      store_name: nameByNumber.get(num) ?? null,
      stage: chosen.is_final ? "final" : "prelim",
      compare_available: !!(prelim && final),
    });
  }
  rows.sort((a, b) => String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }));
  return { period, rows };
}

async function statement(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data, error } = await supa
    .from("pl_statements")
    .select("*")
    .eq("store_number", storeNumber)
    .eq("period_end", period);
  if (error) return { error: error.message, status: 500 };
  const prelim = (data ?? []).find((r) => !r.is_final) || null;
  const final = (data ?? []).find((r) => r.is_final) || null;
  if (!prelim && !final) return { error: "No P&L uploaded for this store and period.", status: 404 };

  // Default to Final; ?stage=prelim forces the Prelim view.
  const wantPrelim = String(params.stage || "").toLowerCase() === "prelim";
  const chosen = (wantPrelim ? prelim : final) || final || prelim;
  return {
    statement: { ...chosen, store_name: store.name, stage: chosen.is_final ? "final" : "prelim" },
    available: { prelim: !!prelim, final: !!final },
  };
}

// Side-by-side Prelim vs Final for one store/period: both statements plus a
// line-by-line delta and headline movers, for the "what changed" report.
async function compare(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data, error } = await supa
    .from("pl_statements")
    .select("*")
    .eq("store_number", storeNumber)
    .eq("period_end", period);
  if (error) return { error: error.message, status: 500 };
  const prelim = (data ?? []).find((r) => !r.is_final) || null;
  const final = (data ?? []).find((r) => r.is_final) || null;
  if (!prelim || !final) {
    return { error: "Both a Preliminary and a Final P&L are required to compare.", status: 409 };
  }

  const delta = (a, b) => (a == null || b == null ? null : round2(b - a));
  const headlineKeys = ["total_sales", "gross_profit", "ci_amount", "ci_pct", "ebitda"];
  const headline = {};
  for (const k of headlineKeys) {
    headline[k] = { prelim: prelim[k] ?? null, final: final[k] ?? null, delta: delta(prelim[k], final[k]) };
  }

  // Line-by-line: match Prelim and Final rows by label (statements come from the
  // same workbook layout, so labels align). Preserve Final's order, then append
  // any Prelim-only lines that dropped out.
  const prelimByLabel = new Map((prelim.lines || []).map((l) => [l.label, l]));
  const finalLabels = new Set((final.lines || []).map((l) => l.label));
  const lines = [];
  for (const fl of final.lines || []) {
    const pl = prelimByLabel.get(fl.label) || null;
    const d = delta(pl?.amount, fl.amount);
    lines.push({
      label: fl.label,
      total: !!fl.total,
      prelim_amount: pl?.amount ?? null,
      final_amount: fl.amount ?? null,
      delta: d,
      prelim_pct: pl?.pct ?? null,
      final_pct: fl.pct ?? null,
      changed: d != null && Math.abs(d) >= 0.005,
    });
  }
  for (const pl of prelim.lines || []) {
    if (finalLabels.has(pl.label)) continue;
    lines.push({
      label: pl.label,
      total: !!pl.total,
      prelim_amount: pl.amount ?? null,
      final_amount: null,
      delta: delta(pl.amount, 0),
      prelim_pct: pl.pct ?? null,
      final_pct: null,
      changed: true,
    });
  }

  return {
    store_number: storeNumber,
    store_name: store.name,
    period_end: period,
    period_label: final.period_label || prelim.period_label || null,
    headline,
    lines,
    changed_count: lines.filter((l) => l.changed).length,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Batch upsert from the client-parsed workbook. Re-uploading the same
// period overwrites (Prelim -> Final), keyed on (store_number, period_end).
async function upload(supa, user, body) {
  if (!UPLOAD_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const periodEnd = String(body?.period_end || "").trim();
  const periodLabel = String(body?.period_label || "").trim() || null;
  const isFinal = !!body?.is_final;
  const statements = Array.isArray(body?.statements) ? body.statements : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return { error: "period_end (YYYY-MM-DD) required", status: 400 };
  if (!statements.length) return { error: "no statements to upload", status: 400 };
  if (statements.length > 600) return { error: "too many statements in one upload", status: 400 };

  const numbers = statements.map((s) => String(s.store_number || "").trim()).filter(Boolean);
  const { data: storeRows } = await supa.from("stores").select("id, number").in("number", numbers);
  const idByNumber = new Map((storeRows ?? []).map((s) => [String(s.number), s.id]));

  const now = new Date().toISOString();
  const name = user.preferred_name || user.full_name || user.email;
  const ready = [];
  const unmatched = [];
  for (const s of statements) {
    const num = String(s.store_number || "").trim();
    if (!num || !Array.isArray(s.lines) || !s.lines.length) continue;
    const storeId = idByNumber.get(num) ?? null;
    if (!storeId) unmatched.push(num);
    ready.push({
      store_number: num,
      store_id: storeId,
      period_end: periodEnd,
      period_label: periodLabel,
      is_final: isFinal,
      lines: s.lines.slice(0, 200),
      total_sales: numOrNull(s.total_sales),
      gross_profit: numOrNull(s.gross_profit),
      ci_amount: numOrNull(s.ci_amount),
      ci_pct: numOrNull(s.ci_pct),
      ebitda: numOrNull(s.ebitda),
      uploaded_by: user.id,
      uploaded_by_name: name,
      updated_at: now,
    });
  }
  if (!ready.length) return { error: "nothing parseable in the upload", status: 400 };

  // Keyed on the stage too (is_final), so a Final upload no longer clobbers the
  // Prelim — both are retained for side-by-side comparison. Re-uploading the
  // same stage overwrites just that stage.
  const { error } = await supa
    .from("pl_statements")
    .upsert(ready, { onConflict: "store_number,period_end,is_final" });
  if (error) return { error: error.message, status: 500 };

  return { ok: true, upserted: ready.length, unmatched };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
      if (action === "periods") return unwrap(await listPeriods(supa));
      if (action === "overview") return unwrap(await overview(supa, user, params));
      if (action === "statement") return unwrap(await statement(supa, user, params));
      if (action === "compare") return unwrap(await compare(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "upload") return unwrap(await upload(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    console.error("[pl]", action, e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
