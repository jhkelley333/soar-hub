// Ranking module — admin-only system settings (build phase).
//   ?action=overview      GET  config rows (all versions) + stores with labor pads
//   ?action=config-add    POST append a versioned ranking_config row
//   ?action=pad-set       POST set/clear a store's labor pad (ranking_store_seed)
//
// ranking_config is APPEND-ONLY (brief 2.5): changes are new rows with a later
// effective_from; runs stamp the slice they used, so history reproduces.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runRankingNow, latestRun, listRuns, fullRun } from "./_lib/ranking/run.js";
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
      as_of: asOf,
    }))
    .filter((r) => r.store_code && r.total_training_pct != null && r.total_training_pct >= 0 && r.total_training_pct <= 1.5);
  if (!clean.length) return { error: "No usable store rows (need store # + total completion %).", status: 400 };
  if (clean.length > 2000) return { error: "Too many rows.", status: 400 };

  const codes = [...new Set(clean.map((r) => r.store_code))];
  const { data: sts } = await supa.from("stores").select("id, number").in("number", codes);
  const idByNum = new Map((sts || []).map((s) => [String(s.number), s.id]));

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

  const { data: file, error: fe } = await supa.from("ranking_source_files").insert({
    source: "vog",
    storage_path: `inline:${filename}`,
    sha256: sha.toLowerCase(),
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

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(supa, event);
  if (!user) return respond(401, { error: "unauthorized" });
  // VP / COO can READ the ranking (board, drill-down, trends, risk) during the
  // parallel run; the build ACTIONS (run, uploads, config) stay admin-only.
  const role = String(user.role).toLowerCase();
  const canRead = role === "admin" || role === "vp" || role === "coo";
  if (!canRead) return respond(403, { error: "Ranking is limited to VP, COO, and admins during the build." });

  const params = event.queryStringParameters || {};
  const action = params.action || "overview";
  const unwrap = (out) => (out?.error ? respond(out.status || 500, { error: out.error }) : respond(200, { ok: true, ...out }));

  try {
    if (event.httpMethod === "POST") {
      if (role !== "admin") return respond(403, { error: "Only admins can run the ranking or change its data during the build." });
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "config-add") return unwrap(await configAdd(supa, user, body));
      if (action === "pad-set") return unwrap(await padSet(supa, user, body));
      if (action === "fc-target-set") return unwrap(await setFcTarget(supa, user, body));
      if (action === "run-now") return unwrap(await runRankingNow(supa, user));
      if (action === "backfill") return unwrap(await backfillLaborWindow(supa, { days: Number(body?.days) || 35 }));
      if (action === "ingest-ix") return unwrap(await ingestIx(supa, user, body));
      if (action === "ingest-totzone") return unwrap(await ingestTotzone(supa, user, body));
      if (action === "ingest-ecosure") return unwrap(await ingestEcosure(supa, user, body));
      if (action === "ingest-bsc") return unwrap(await ingestBsc(supa, user, body));
      if (action === "ingest-shops") return unwrap(await ingestShops(supa, user, body));
      if (action === "ingest-vog") return unwrap(await ingestVog(supa, user, body));
      if (action === "import-legacy") return unwrap(await importLegacyWeeks(supa));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "overview") return unwrap(await overview(supa));
    if (action === "run-latest") return unwrap(await latestRun(supa, params));
    if (action === "runs") return unwrap(await listRuns(supa));
    if (action === "run-full") return unwrap(await fullRun(supa, params));
    if (action === "trends") return unwrap(await trendsData(supa, params));
    if (action === "risk") return unwrap(await riskData(supa));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: `ranking-admin error: ${e?.message || String(e)}` });
  }
};
