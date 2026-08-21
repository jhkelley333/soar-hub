// Ranking module — admin-only system settings (build phase).
//   ?action=overview      GET  config rows (all versions) + stores with labor pads
//   ?action=config-add    POST append a versioned ranking_config row
//   ?action=pad-set       POST set/clear a store's labor pad (ranking_store_seed)
//
// ranking_config is APPEND-ONLY (brief 2.5): changes are new rows with a later
// effective_from; runs stamp the slice they used, so history reproduces.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runRankingNow, latestRun, listRuns, fullRun, moversData, commsBoard, sevenUpSales, periodMovers, topPerformers, eveningGrowth } from "./_lib/ranking/run.js";
import { bottomPerformers } from "./_lib/ranking/bottom.js";
import { callerStoreNumbers } from "./_lib/ranking/scope.js";
import { backfillLaborWindow } from "./_lib/kpiBackfill.js";
import { parseIxCsv } from "./_lib/ranking/ixParse.js";
import { importLegacyWeeks, trendsData, unifiedWeeks, legacyWeekStores } from "./_lib/ranking/legacy.js";
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

// Current value of a versioned config key (newest effective_from <= today).
function currentConfig(rows, key) {
  const today = new Date().toISOString().slice(0, 10);
  let best = null;
  for (const r of rows || []) {
    if (r.key !== key || r.effective_from > today) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best?.value ?? null;
}

async function overview(supa) {
  const [cfg, seeds, stores] = await Promise.all([
    supa.from("ranking_config").select("id, key, value, effective_from, note, created_at").order("key").order("effective_from", { ascending: false }),
    supa.from("ranking_store_seed").select("store_id, labor_pad, entity, updated_at"),
    supa.from("stores").select("id, number, name, soar_company_name, is_active").eq("is_active", true).or("brand.eq.sonic,brand.is.null").order("number"),
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
  const fcTarget = Number(currentConfig(cfg.data, "fc_target_efficiency")?.efficiency);
  return {
    config: cfg.data || [],
    stores: storeRows,
    fc_target_efficiency: isFinite(fcTarget) && fcTarget > 0 ? fcTarget : 0.96,
  };
}

// Set the food-cost miss target efficiency — appends a versioned config row
// effective today (past runs keep the target they used).
async function setFcTarget(supa, user, body) {
  const eff = Number(body?.efficiency);
  if (!isFinite(eff) || eff < 0.5 || eff > 1.5) {
    return { error: "Enter a target efficiency between 50% and 150% (e.g. 0.96).", status: 400 };
  }
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supa.from("ranking_config").upsert(
    { key: "fc_target_efficiency", value: { efficiency: Math.round(eff * 10000) / 10000 }, effective_from: today, note: "Set via System Settings", created_by: user.id },
    { onConflict: "key,effective_from" },
  );
  if (error) return { error: error.message, status: 500 };
  return { ok: true, efficiency: eff };
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
// Override for a re-upload: drop any prior ingest of this exact file (same
// source + content hash) — its rows first, then the file — so a forced
// re-ingest replaces it instead of being blocked as a duplicate. The run always
// uses the latest file per source, so this cleanly redoes a bad/mistaken upload.
async function clearPriorFile(supa, source, sha256) {
  const sha = String(sha256 || "").toLowerCase();
  if (!sha) return;
  const { data: prior } = await supa.from("ranking_source_files")
    .select("id").eq("source", source).eq("sha256", sha);
  const ids = (prior || []).map((p) => p.id);
  if (!ids.length) return;
  await supa.from("ranking_src_rows").delete().in("file_id", ids);
  await supa.from("ranking_source_files").delete().in("id", ids);
}

// Scoped sources (ix, vog, ott) legitimately reuse the SAME file for both PTD
// and WTD — most obviously in week 1 of a period, when period-to-date IS
// week-to-date, so the two exports are byte-identical. The file dedupe is on
// (source, sha256), so identical PTD/WTD content would collide and the second
// scope would be silently dropped. Fold the scope into the dedupe hash so the
// two scopes are distinct files, while re-uploading the same scope still dedupes.
function scopedSha(sha, scope) {
  return createHash("sha256").update(`${String(sha || "").toLowerCase()}|${scope}`).digest("hex");
}

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
  const dsha = scopedSha(sha, scope);
  const codes = [...new Set(parsed.rows.filter((r) => r.level === "store" && r.store_code).map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  if (body?.force) await clearPriorFile(supa, "ix", dsha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "ix",
    storage_path: `inline:${filename}`,
    sha256: dsha,
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

// Ingest TotZone training status. The xlsx is parsed CLIENT-side (SheetJS,
// "Station Completion Percenatge" sheet); the browser sends normalized store
// rows + a sha256 of the raw file bytes for dedupe.
async function ingestTotzone(supa, user, body) {
  const filename = String(body?.filename || "totzone.xlsx").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(String(body?.as_of || "")) ? String(body.as_of).slice(0, 10) : null;
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, ""),
      store_name: String(r?.store_name ?? "").trim().slice(0, 120) || null,
      do_name: String(r?.do_name ?? "").trim().slice(0, 120) || null,
      sdo_name: String(r?.sdo_name ?? "").trim().slice(0, 120) || null,
      crew_pct: Number.isFinite(Number(r?.crew_pct)) ? Number(r.crew_pct) : null,
      manager_pct: Number.isFinite(Number(r?.manager_pct)) ? Number(r.manager_pct) : null,
      total_training_pct: Number.isFinite(Number(r?.total_training_pct)) ? Number(r.total_training_pct) : null,
      tr_vs_tz: Number.isFinite(Number(r?.tr_vs_tz)) ? Number(r.tr_vs_tz) : null, // TR vs TZ Variance
      as_of: asOf,
    }))
    .filter((r) => r.store_code && r.total_training_pct != null && r.total_training_pct >= 0 && r.total_training_pct <= 1.5);
  if (!clean.length) return { error: "No usable store rows (need store # + total completion %).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  if (body?.force) await clearPriorFile(supa, "totzone", sha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "totzone",
    storage_path: `inline:${filename}`,
    sha256: sha.toLowerCase(),
    week_ending: asOf,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/ranking_source_files/.test(fe.message) && /does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }
  const rows = clean.map((r) => ({
    file_id: file.id,
    source: "totzone",
    store_id: idByNum.get(r.store_code) ?? null,
    store_code: r.store_code,
    payload: r,
  }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, as_of: asOf, rows: rows.length, stores: codes.length, unresolved };
}

// Ingest EcoSure (Ecolab TrueView "List of Assessments"). Parsed client-side;
// one src row PER ASSESSMENT (a store can have several YTD — the run
// averages them). sha256 of the raw file bytes dedupes.
async function ingestEcosure(supa, user, body) {
  const filename = String(body?.filename || "ecosure.xlsx").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(String(body?.as_of || "")) ? String(body.as_of).slice(0, 10) : null;
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, ""),
      store_name: String(r?.store_name ?? "").trim().slice(0, 120) || null,
      assessment_type: String(r?.assessment_type ?? "").trim().slice(0, 80) || null,
      date: /^\d{4}-\d{2}-\d{2}/.test(String(r?.date || "")) ? String(r.date).slice(0, 10) : null,
      score: Number.isFinite(Number(r?.score)) ? Number(r.score) : null,
      rating: String(r?.rating ?? "").trim().slice(0, 60) || null,
      as_of: asOf,
    }))
    .filter((r) => r.store_code && r.score != null && r.score >= 0 && r.score <= 100);
  if (!clean.length) return { error: "No usable assessment rows (need store # + score).", status: 400 };
  if (clean.length > 3000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  if (body?.force) await clearPriorFile(supa, "ecosure", sha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "ecosure",
    storage_path: `inline:${filename}`,
    sha256: sha.toLowerCase(),
    week_ending: asOf,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/ranking_source_files/.test(fe.message) && /does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }
  const rows = clean.map((r) => ({
    file_id: file.id,
    source: "ecosure",
    store_id: idByNum.get(r.store_code) ?? null,
    store_code: r.store_code,
    payload: r,
  }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, as_of: asOf, rows: rows.length, stores: codes.length, unresolved };
}

// Ingest BSC Training (the LTO training completion %, column G of the BSC
// sheet). One row per store; sha256 dedupe. Mirrors ingestTotzone.
async function ingestBsc(supa, user, body) {
  const filename = String(body?.filename || "bsc.xlsx").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(String(body?.as_of || "")) ? String(body.as_of).slice(0, 10) : null;
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, ""),
      store_name: String(r?.store_name ?? "").trim().slice(0, 120) || null,
      do_name: String(r?.do_name ?? "").trim().slice(0, 120) || null,
      sdo_name: String(r?.sdo_name ?? "").trim().slice(0, 120) || null,
      bsc_pct: Number.isFinite(Number(r?.bsc_pct)) ? Number(r.bsc_pct) : null,
      as_of: asOf,
    }))
    .filter((r) => r.store_code && r.bsc_pct != null && r.bsc_pct >= 0 && r.bsc_pct <= 1.5);
  if (!clean.length) return { error: "No usable store rows (need store # + LTO training %).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  if (body?.force) await clearPriorFile(supa, "bsc", sha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "bsc",
    storage_path: `inline:${filename}`,
    sha256: sha.toLowerCase(),
    week_ending: asOf,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/ranking_source_files/.test(fe.message) && /does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }
  const bscRows = clean.map((r) => ({
    file_id: file.id,
    source: "bsc",
    store_id: idByNum.get(r.store_code) ?? null,
    store_code: r.store_code,
    payload: r,
  }));
  for (let i = 0; i < bscRows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(bscRows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, as_of: asOf, rows: bscRows.length, stores: codes.length, unresolved };
}

// Ingest Mystery Shops (KnowledgeForce "DataDump"). One src row PER SHOP,
// each keeping its visit date + score — the RUN filters to shops that fell
// within the ranked fiscal period and averages per store (Heath: "only use
// those that fell within the period"). sha256 dedupe.
async function ingestShops(supa, user, body) {
  const filename = String(body?.filename || "shops.csv").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, "").replace(/^0+/, ""),
      store_name: String(r?.store_name ?? "").trim().slice(0, 120) || null,
      visit_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.visit_date || "")) ? String(r.visit_date) : null,
      score: Number.isFinite(Number(r?.score)) ? Number(r.score) : null,
    }))
    .filter((r) => r.store_code && r.visit_date && r.score != null && r.score >= 0 && r.score <= 1.5);
  if (!clean.length) return { error: "No usable shop rows (need store #, visit date, score).", status: 400 };
  if (clean.length > 4000) return { error: "Too many rows.", status: 400 };

  // Latest visit date drives the file's "as of" for the source board.
  const asOf = clean.map((r) => r.visit_date).sort().pop() ?? null;
  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  if (body?.force) await clearPriorFile(supa, "shops", sha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "shops",
    storage_path: `inline:${filename}`,
    sha256: sha.toLowerCase(),
    week_ending: asOf,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/ranking_source_files/.test(fe.message) && /does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }
  const rows = clean.map((r) => ({
    file_id: file.id,
    source: "shops",
    store_id: idByNum.get(r.store_code) ?? null,
    store_code: r.store_code,
    payload: r,
  }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, as_of: asOf, rows: rows.length, stores: codes.length, unresolved };
}

// Ingest VOG (Qualtrics dashboard export). One row per store; the run's VOG
// input is L2R (likely-to-return top-box), responses = Count. Scoped wtd/ptd
// (the "MTD" export = our PTD). sha256 dedupe.
async function ingestVog(supa, user, body) {
  const filename = String(body?.filename || "vog.csv").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const scope = body?.scope === "wtd" ? "wtd" : "ptd";
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, ""),
      l2r: Number.isFinite(Number(r?.l2r)) ? Number(r.l2r) : null,
      count: Number.isFinite(Number(r?.count)) ? Math.round(Number(r.count)) : null,
      osat: Number.isFinite(Number(r?.osat)) ? Number(r.osat) : null,
      scope,
    }))
    .filter((r) => r.store_code && r.l2r != null && r.l2r >= 0 && r.l2r <= 1.5);
  if (!clean.length) return { error: "No usable VOG rows (need StoreID + L2R).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  const dsha = scopedSha(sha, scope);
  if (body?.force) await clearPriorFile(supa, "vog", dsha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "vog",
    storage_path: `inline:${filename}`,
    sha256: dsha,
    week_ending: null,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/ranking_source_files/.test(fe.message) && /does not exist|relation/i.test(fe.message)) {
      return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    }
    return { error: fe.message, status: 500 };
  }
  const rows = clean.map((r) => ({
    file_id: file.id,
    source: "vog",
    store_id: idByNum.get(r.store_code) ?? null,
    store_code: r.store_code,
    payload: r,
  }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, scope, rows: rows.length, stores: codes.length, unresolved };
}

// Ingest On-Time Tickets / SOS / Late Sends (the "OTT" export). One row per
// store, uploaded WTD and PTD. Carries % Late Sends over 8 Min (the metric the
// ranker surfaces) plus % On Time Tickets, Avg SOS, and the late-send count.
// Mirrors ingestVog (scope-aware, store-keyed). sha256 dedupe.
async function ingestOtt(supa, user, body) {
  const filename = String(body?.filename || "ott.xlsx").slice(0, 200);
  const sha = String(body?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(sha)) return { error: "sha256 of the file is required.", status: 400 };
  const scope = body?.scope === "wtd" ? "wtd" : "ptd";
  const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      level: "store",
      store_code: String(r?.store_code ?? "").replace(/\D/g, "").replace(/^0+/, ""),
      on_time_pct: numOrNull(r?.on_time_pct),
      avg_sos: String(r?.avg_sos ?? "").trim().slice(0, 12) || null,
      late_sends_pct: numOrNull(r?.late_sends_pct),
      late_sends_count: Number.isFinite(Number(r?.late_sends_count)) ? Math.round(Number(r.late_sends_count)) : null,
      scope,
    }))
    .filter((r) => r.store_code && r.late_sends_pct != null && r.late_sends_pct >= 0 && r.late_sends_pct <= 1.5);
  if (!clean.length) return { error: "No usable rows (need store # + % Late Sends over 8 Min).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

  const dsha = scopedSha(sha, scope);
  if (body?.force) await clearPriorFile(supa, "ott", dsha);
  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "ott",
    storage_path: `inline:${filename}`,
    sha256: dsha,
    week_ending: null,
    row_count: clean.length,
    status: "parsed",
    uploaded_by: user.id,
  }).select("id").single();
  if (fe) {
    if (/duplicate|unique/i.test(fe.message)) return { error: "This exact file was already ingested — no double-count.", status: 409 };
    if (/violates check|source_check/i.test(fe.message)) return { error: "Run migration 0260 first (adds the 'ott' source).", status: 500 };
    return { error: fe.message, status: 500 };
  }
  const rows = clean.map((r) => ({ file_id: file.id, source: "ott", store_id: idByNum.get(r.store_code) ?? null, store_code: r.store_code, payload: r }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_src_rows").insert(rows.slice(i, i + 300));
    if (error) return { error: `File saved but rows failed: ${error.message}`, status: 500 };
  }
  const unresolved = codes.filter((c) => !idByNum.get(c));
  return { file_id: file.id, scope, rows: rows.length, stores: codes.length, unresolved };
}

// Ingest the official "SOAR PTD RANKING" sheet (store tier) for one fiscal
// period. These are the period-ending numbers the recognition slides quote; we
// archive them so 7 UP + Movers & Shakers can show the sheet's exact ranks and
// % vs LY instead of the live-recomputed values. Full replace per period: the
// PK is (period, store_number), so re-uploading a corrected sheet just rewrites
// that period cleanly (no double-count, drops stores no longer present).
async function ingestPtdRanking(supa, user, body) {
  const period = parseInt(body?.period, 10);
  if (!(period >= 1 && period <= 13)) return { error: "A fiscal period (1-13) is required.", status: 400 };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  const clean = raw
    .map((r) => ({
      period,
      store_number: String(r?.store_code ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, ""),
      soar_rank: Number.isFinite(Number(r?.soar_rank)) ? Math.round(Number(r.soar_rank)) : null,
      location: String(r?.location ?? "").trim() || null,
      gm: String(r?.gm ?? "").trim() || null,
      total_points: num(r?.total_points),
      ptd_sales: num(r?.ptd_sales),
      ly_sales: num(r?.ly_sales),
      pct_vs_ly: num(r?.pct_vs_ly),
      imported_by: user.id,
    }))
    .filter((r) => r.store_number);
  if (!clean.length) return { error: "No usable store rows (need a DI # and SOAR Rank).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  // De-dupe by store within the upload (keep the first occurrence).
  const byStore = new Map();
  for (const r of clean) if (!byStore.has(r.store_number)) byStore.set(r.store_number, r);
  const rows = [...byStore.values()];

  const del = await supa.from("ranking_official_periods").delete().eq("period", period);
  if (del.error) {
    if (/ranking_official_periods/.test(del.error.message) && /does not exist|relation/i.test(del.error.message)) {
      return { error: "Run migration 0263 first (ranking_official_periods is missing).", status: 500 };
    }
    return { error: del.error.message, status: 500 };
  }
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supa.from("ranking_official_periods").insert(rows.slice(i, i + 300));
    if (error) return { error: `Insert failed: ${error.message}`, status: 500 };
  }

  // Leader tiers (DO / SDO / RVP) - optional; powers the Movers & Shakers DO
  // tab. match_key strips the "-DO"/"-SDO"/"-RVP" suffix so the sheet joins the
  // new ranker's computed leader rows. Same clean full-replace per period.
  const leaderKey = (v) => String(v ?? "").replace(/-(?:sdo|rvp|do)\s*$/i, "").trim().replace(/\s+/g, " ").toLowerCase();
  const rawLeaders = Array.isArray(body?.leaders) ? body.leaders : [];
  let leaders = 0;
  if (rawLeaders.length) {
    const cleanLeaders = rawLeaders
      .map((r) => {
        const tier = String(r?.tier ?? "").toLowerCase();
        const entity_name = String(r?.entity_name ?? "").trim();
        return {
          period,
          tier: ["do", "sdo", "rvp"].includes(tier) ? tier : null,
          entity_name,
          match_key: leaderKey(entity_name),
          sdo_name: String(r?.sdo_name ?? "").trim() || null,
          store_count: Number.isFinite(Number(r?.store_count)) ? Math.round(Number(r.store_count)) : null,
          rank: Number.isFinite(Number(r?.rank)) ? Math.round(Number(r.rank)) : null,
          total_points: num(r?.total_points),
          ptd_sales: num(r?.ptd_sales),
          ly_sales: num(r?.ly_sales),
          imported_by: user.id,
        };
      })
      .filter((r) => r.tier && r.entity_name);
    // De-dupe within (tier, entity_name).
    const seen = new Map();
    for (const r of cleanLeaders) { const k = `${r.tier}|${r.entity_name}`; if (!seen.has(k)) seen.set(k, r); }
    const lrows = [...seen.values()];

    const ldel = await supa.from("ranking_official_leaders").delete().eq("period", period);
    if (ldel.error) {
      if (/ranking_official_leaders/.test(ldel.error.message) && /does not exist|relation/i.test(ldel.error.message)) {
        return { error: "Store ranks saved, but run migration 0264 for the DO/SDO/RVP tiers (ranking_official_leaders is missing).", status: 500 };
      }
      return { error: ldel.error.message, status: 500 };
    }
    for (let i = 0; i < lrows.length; i += 300) {
      const { error } = await supa.from("ranking_official_leaders").insert(lrows.slice(i, i + 300));
      if (error) return { error: `Store ranks saved, but leader insert failed: ${error.message}`, status: 500 };
    }
    leaders = lrows.length;
  }

  return { period, stores: rows.length, leaders };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "unauthorized" });
  // Ranking READS are open to every active user, scoped to what they manage
  // (like the rest of the Hub — see scope.js). Build ACTIONS (run, uploads,
  // config) and System Settings (overview) stay admin-only.
  const role = String(user.role).toLowerCase();

  const params = event.queryStringParameters || {};
  const action = params.action || "overview";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    if (event.httpMethod === "POST") {
      if (role !== "admin") return respond(403, { error: "Only admins can run the ranking or change its data." });
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "config-add") return unwrap(await configAdd(supa, user, body));
      if (action === "pad-set") return unwrap(await padSet(supa, user, body));
      if (action === "fc-target-set") return unwrap(await setFcTarget(supa, user, body));
      if (action === "run-now") return unwrap(await runRankingNow(supa, user, { weekEnding: body?.week_ending }));
      if (action === "backfill") return unwrap(await backfillLaborWindow(supa, { days: Number(body?.days) || 35 }));
      if (action === "ingest-ix") return unwrap(await ingestIx(supa, user, body));
      if (action === "ingest-totzone") return unwrap(await ingestTotzone(supa, user, body));
      if (action === "ingest-ecosure") return unwrap(await ingestEcosure(supa, user, body));
      if (action === "ingest-bsc") return unwrap(await ingestBsc(supa, user, body));
      if (action === "ingest-shops") return unwrap(await ingestShops(supa, user, body));
      if (action === "ingest-vog") return unwrap(await ingestVog(supa, user, body));
      if (action === "ingest-ott") return unwrap(await ingestOtt(supa, user, body));
      if (action === "ingest-ptd-ranking") return unwrap(await ingestPtdRanking(supa, user, body));
      if (action === "import-legacy") return unwrap(await importLegacyWeeks(supa));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    // System Settings payload (all stores + config) — admin only.
    if (action === "overview") {
      if (role !== "admin") return respond(403, { error: "System settings are admin-only." });
      return unwrap(await overview(supa));
    }
    // Scope every board/analytics read to what the caller manages (null = the
    // org-wide roles payroll/admin/vp/coo, who see the whole company).
    const storeNums = await callerStoreNumbers(supa, user);
    if (action === "run-latest") return unwrap(await latestRun(supa, params, storeNums));
    if (action === "sevenup") return unwrap(await sevenUpSales(supa, params, storeNums));
    if (action === "period-movers") return unwrap(await periodMovers(supa, params, storeNums));
    if (action === "top-performers") return unwrap(await topPerformers(supa, params, storeNums));
    if (action === "bottom-performers") {
      if (!["sdo", "rvp", "vp", "coo", "admin"].includes(role)) return respond(403, { error: "Bottom Performers is for SDO and above." });
      return unwrap(await bottomPerformers(supa, params, storeNums));
    }
    if (action === "evening-growth") return unwrap(await eveningGrowth(supa, params, storeNums));
    if (action === "runs") return unwrap(await listRuns(supa));
    if (action === "weeks") return unwrap(await unifiedWeeks(supa));         // hub + legacy timeline
    if (action === "legacy-week") return unwrap(await legacyWeekStores(supa, params, storeNums)); // one sheet-era week (store tier)
    if (action === "run-full") return unwrap(await fullRun(supa, params, storeNums));
    if (action === "comms-board") return unwrap(await commsBoard(supa, params, storeNums));
    if (action === "trends") return unwrap(await trendsData(supa, { ...params, storeNums }));
    if (action === "risk") return unwrap(await riskData(supa, storeNums));
    // Week-over-week movers — VP-only for now (admin included for build/support).
    if (action === "movers") {
      if (role !== "vp" && role !== "admin") return respond(403, { error: "The Movers view is VP-only for now." });
      return unwrap(await moversData(supa, { ...params, storeNums }));
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `ranking-admin error: ${e?.message || String(e)}` });
  }
};
