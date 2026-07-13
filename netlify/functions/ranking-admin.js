// Ranking module — admin-only system settings (build phase).
//   ?action=overview      GET  config rows (all versions) + stores with labor pads
//   ?action=config-add    POST append a versioned ranking_config row
//   ?action=pad-set       POST set/clear a store's labor pad (ranking_store_seed)
//
// ranking_config is APPEND-ONLY (brief 2.5): changes are new rows with a later
// effective_from; runs stamp the slice they used, so history reproduces.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runRankingNow, latestRun } from "./_lib/ranking/run.js";
import { backfillLaborWindow } from "./_lib/kpiBackfill.js";
import { parseIxCsv } from "./_lib/ranking/ixParse.js";
import { importLegacyWeeks, trendsData } from "./_lib/ranking/legacy.js";
import { riskData } from "./_lib/ranking/risk.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("ranking-admin env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, email, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const isMissingTable = (error) => !!error && /ranking_config|ranking_store_seed/.test(String(error.message)) && /does not exist|relation/i.test(String(error.message));

async function overview(supa) {
  const [cfg, seeds, stores] = await Promise.all([
    supa.from("ranking_config").select("id, key, value, effective_from, note, created_at").order("key").order("effective_from", { ascending: false }),
    supa.from("ranking_store_seed").select("store_id, labor_pad, entity, updated_at"),
    supa.from("stores").select("id, number, name, soar_company_name, is_active").eq("is_active", true).order("number"),
  ]);
  if (cfg.error) {
    if (isMissingTable(cfg.error)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    return { error: cfg.error.message, status: 500 };
  }
  const padByStore = new Map((seeds.data || []).map((s) => [s.store_id, s]));
  const storeRows = (stores.data || []).map((s) => ({
    store_id: s.id,
    number: String(s.number),
    name: s.name,
    entity: s.soar_company_name ?? null, // legal entity comes from My Stores data (DEVIATIONS B3)
    labor_pad: padByStore.get(s.id)?.labor_pad ?? null,
  }));
  return { config: cfg.data || [], stores: storeRows };
}

async function configAdd(supa, user, body) {
  const key = String(body?.key || "").trim();
  const effectiveFrom = String(body?.effective_from || "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 500) || null;
  if (!key || !/^[a-z0-9_.-]+$/i.test(key)) return { error: "key is required (letters, digits, dot, dash, underscore).", status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return { error: "effective_from must be YYYY-MM-DD.", status: 400 };
  if (body?.value === undefined) return { error: "value (JSON) is required.", status: 400 };

  const { data, error } = await supa.from("ranking_config").insert({
    key, value: body.value, effective_from: effectiveFrom, note, created_by: user.id,
  }).select("id, key, value, effective_from, note, created_at").single();
  if (error) {
    if (/ranking_config_key_eff_uq|duplicate key/.test(error.message)) {
      return { error: `A row for '${key}' effective ${effectiveFrom} already exists — pick a different date (config is append-only).`, status: 409 };
    }
    if (isMissingTable(error)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { row: data };
}

async function padSet(supa, user, body) {
  const storeId = String(body?.store_id || "").trim();
  if (!storeId) return { error: "store_id is required.", status: 400 };
  const raw = body?.labor_pad;
  const pad = raw === null || raw === "" || raw === undefined ? null : Number(raw);
  if (pad !== null && (!isFinite(pad) || pad < 0 || pad > 1000000)) {
    return { error: "labor_pad must be a dollar amount (or blank to clear).", status: 400 };
  }
  const { data: store } = await supa.from("stores").select("id, number").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };

  const { error } = await supa.from("ranking_store_seed").upsert(
    { store_id: storeId, labor_pad: pad, updated_at: new Date().toISOString() },
    { onConflict: "store_id" },
  );
  if (error) {
    if (isMissingTable(error)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { ok: true, store_id: storeId, labor_pad: pad };
}

// Ingest an Inventory Expressway category export (CSV pasted/uploaded as
// text). Dedupes by content hash; store codes resolve at ingest (brief 6).
async function ingestIx(supa, user, body) {
  const content = String(body?.content || "");
  const filename = String(body?.filename || "ix.csv").slice(0, 200);
  const scope = body?.scope === "wtd" ? "wtd" : "ptd";
  if (!content.trim()) return { error: "Empty file.", status: 400 };
  if (content.length > 8_000_000) return { error: "File too large (8 MB max).", status: 400 };

  let parsed;
  try { parsed = parseIxCsv(content); }
  catch (e) { return { error: e.message, status: 400 }; }

  const sha = createHash("sha256").update(content).digest("hex");
  const codes = [...new Set(parsed.rows.filter((r) => r.level === "store" && r.store_code).map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "ix",
    storage_path: `inline:${filename}`,
    sha256: sha,
    week_ending: parsed.weekEnding,
    row_count: parsed.rows.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested (same content hash) — no double-count.", status: 409 };
    if (/ranking_source_files.*does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }

  const rows = parsed.rows.map((r) => ({
    file_id: file.id,
    source: "ix",
    store_id: r.level === "store" ? (idByNum.get(String(r.store_code)) ?? null) : null,
    store_code: r.store_code || r.leader || "rollup",
    payload: { ...r, scope },
  }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return {
    file_id: file.id,
    week_ending: parsed.weekEnding,
    scope,
    rows: rows.length,
    stores: codes.length,
    unresolved,
    flash: parsed.flashCount,
  };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "unauthorized" });
  if (String(user.role).toLowerCase() !== "admin") return respond(403, { error: "Admins only." });

  const params = event.queryStringParameters || {};
  const action = params.action || "overview";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "config-add") return unwrap(await configAdd(supa, user, body));
      if (action === "pad-set") return unwrap(await padSet(supa, user, body));
      if (action === "run-now") return unwrap(await runRankingNow(supa, user));
      if (action === "backfill") return unwrap(await backfillLaborWindow(supa, { days: Number(body?.days) || 35 }));
      if (action === "ingest-ix") return unwrap(await ingestIx(supa, user, body));
      if (action === "import-legacy") return unwrap(await importLegacyWeeks(supa));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "overview") return unwrap(await overview(supa));
    if (action === "run-latest") return unwrap(await latestRun(supa, params));
    if (action === "trends") return unwrap(await trendsData(supa, params));
    if (action === "risk") return unwrap(await riskData(supa));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `ranking-admin error: ${e?.message || String(e)}` });
  }
};
