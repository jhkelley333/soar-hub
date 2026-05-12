// Shared utilities for the Ranker netlify functions. Auth, scope
// resolution, Google Sheets read + parse, and the metric/header logic
// from the legacy command-center.js function ported to ESM.
//
// Used by:
//   netlify/functions/ranker.js          (portfolio + store dashboard)
//   netlify/functions/ranker-summary.js  (AI summary generation)

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHEET_ID     = process.env.SOAR_METRICS_SHEET_ID;

// Roles whose visible-stores set is "every active store" — matches the
// ORG_WIDE convention in netlify/functions/org.js so behavior stays
// consistent across the app.
const ORG_WIDE = new Set(["payroll", "admin", "vp", "coo"]);

// Sheet layout — see legacy command-center.js notes. Header row at 5,
// data row 6+. Column letters: A=rank, B=storeNum, C=storeName,
// D=gmName, Q=laborPct (zero-indexed 16). Other metrics are resolved
// by header text alias because their column position varies.
export const HEADER_ROW = 5;
export const FIXED_COL = {
  storeRank: 1,
  storeNum:  2,
  storeName: 3,
  gmName:    4,
  laborPct:  16,
};

export const HEADER_ALIASES = {
  annualizedFinancialMiss: ["Annualized Financial Miss","Annualized Miss","Annualized $ Miss","Annualized Financial $ Miss"],
  weeklySales:    ["Weekly Sales","Week Sales","Sales - Week","Sales (Week)"],
  vsLastYear:     ["% vs Last Year","% vs LY","Vs LY %","Sales vs LY %","% to LY"],
  cogsEff:        ["COGS Efficiency %","COGS Eff %","COGS %","Food Cost %","FC %"],
  annualizedFcMiss: ["Annualized FC Miss","Annualized Food Miss","Annualized Food Cost Miss"],
  varToChart:     ["Variance to Chart","Var to Chart","Variance","Labor Variance","Variance $","Variance %"],
  bscTraining:    ["BSC Training%","BSC Training %","Training %","BSC %"],
  onTimeTickets:  ["On Time Tickets %","On-Time Tickets %","On Time %","OT %"],
  vogWeek:        ["VOG WEEK","VOG Week","VOG Wk","LTR Week"],
  vogCount:       ["VOG Count","VOG #","VOG","LTR Count"],
  complaints:     ["# of Complaints","Complaints","Complaint Count"],
  callsPer10k:    ["Calls /10k Tkts","Calls/10k","Calls per 10k","Calls per 10K Tickets"],
};

// All metric keys returned on a store row. Keep in sync with
// src/modules/ranker/types.ts (Metrics shape).
export const METRIC_KEYS = [
  "storeRank","storeNum","storeName","gmName",
  "annualizedFinancialMiss","weeklySales","vsLastYear","cogsEff",
  "annualizedFcMiss","laborPct","varToChart","bscTraining",
  "onTimeTickets","vogWeek","vogCount","complaints","callsPer10k",
];

// Metrics fetched as a trend series. Covers every sparkline the Store
// View KPI grid renders — including annualizedFcMiss, bscTraining, and
// onTimeTickets which the legacy function omitted.
export const TREND_METRICS = [
  "weeklySales","vsLastYear","cogsEff","annualizedFcMiss",
  "laborPct","varToChart","bscTraining","onTimeTickets",
  "vogWeek","vogCount","complaints","callsPer10k","storeRank",
];

// ── CORS / response helpers ────────────────────────────────────────────────
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export function corsOptions() {
  return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

// ── Supabase admin client ──────────────────────────────────────────────────
export function supabaseAdmin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Supabase env vars missing.");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Verify the Bearer token and return the caller's profile. Returns null
// if the token is missing, invalid, or the profile is inactive.
export async function getCallerProfile(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = supabaseAdmin();
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

// Returns a sorted list of store_number (text) strings the caller can
// see. ORG_WIDE roles get every active store; everyone else flows
// through user_visible_stores(). Sorted naturally so the UI's store
// pickers come back in expected numeric order.
export async function getCallerStoreNumbers(supa, profile) {
  if (ORG_WIDE.has(profile.role)) {
    const { data } = await supa
      .from("stores")
      .select("number")
      .eq("is_active", true);
    return (data ?? [])
      .map(s => String(s.number || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }
  // RPC returns rows shaped either as a bare string or { user_visible_stores: <uuid> }
  // depending on supabase-js version. Tolerate both.
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: profile.id });
  const ids = (visible ?? [])
    .map(v => typeof v === "string" ? v : v?.user_visible_stores ?? null)
    .filter(Boolean);
  if (!ids.length) return [];
  const { data: stores } = await supa
    .from("stores")
    .select("number")
    .in("id", ids)
    .eq("is_active", true);
  return (stores ?? [])
    .map(s => String(s.number || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

// ── Number / string helpers ────────────────────────────────────────────────
export function norm(s) {
  return String(s || "").trim().toLowerCase();
}

export function parseNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,%]/g, "").trim());
  return isFinite(n) ? n : null;
}

export function getStoreDigits(value) {
  return String(value || "").trim().replace(/\D/g, "");
}

export function average(values) {
  const nums = values.filter(v => v !== null && v !== undefined && isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Sheets client ──────────────────────────────────────────────────────────
function googleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing.");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function getSheetsClient() {
  return google.sheets({ version: "v4", auth: googleAuth() });
}

// ── Week tab discovery ─────────────────────────────────────────────────────
export async function getAvailableWeeks(sheets) {
  if (!SHEET_ID) throw new Error("SOAR_METRICS_SHEET_ID missing.");
  const meta  = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const weeks = [];
  for (const s of meta.data.sheets || []) {
    const title = String(s.properties.title || "").trim();
    const n = parseInt(title, 10);
    if (!isNaN(n) && n >= 1 && n <= 53 && String(n) === title) {
      weeks.push(n);
    }
  }
  weeks.sort((a, b) => a - b);
  return weeks;
}

// ── Header alias resolver ──────────────────────────────────────────────────
function lookupHeaderIndexes(headers) {
  const map = new Map();
  headers.forEach((h, i) => map.set(norm(h), i));
  const out = {};
  for (const key of Object.keys(HEADER_ALIASES)) {
    let found = null;
    for (const alias of HEADER_ALIASES[key]) {
      const idx = map.get(norm(alias));
      if (idx !== undefined) { found = idx; break; }
    }
    out[key] = found;
  }
  return out;
}

// ── Week data batch fetch ──────────────────────────────────────────────────
// Fetches multiple weeks of metric data in ONE Sheets batchGet call.
// Returns: Map<weekStr, { headers, idx, rows }> where rows excludes the
// header line and any row whose storeNum cell is empty (totals/summary
// row guard).
export async function batchGetWeeks(sheets, weekStrs) {
  if (!SHEET_ID) throw new Error("SOAR_METRICS_SHEET_ID missing.");
  if (!weekStrs.length) return new Map();
  const ranges = weekStrs.map(w => `${w}!A${HEADER_ROW}:ZZ`);
  let result;
  try {
    result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges,
    });
  } catch (e) {
    // If even one range is bad (e.g. a tab doesn't exist), Sheets
    // returns 400 for the whole call. Fall back to per-range fetches
    // so a single missing week doesn't break the rest.
    const out = new Map();
    for (let i = 0; i < weekStrs.length; i++) {
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID, range: ranges[i],
        });
        out.set(weekStrs[i], parseValueRange(r.data));
      } catch {
        out.set(weekStrs[i], { headers: [], idx: {}, rows: [] });
      }
    }
    return out;
  }
  const out = new Map();
  const valueRanges = result.data.valueRanges || [];
  for (let i = 0; i < weekStrs.length; i++) {
    out.set(weekStrs[i], parseValueRange(valueRanges[i] || {}));
  }
  return out;
}

function parseValueRange(vr) {
  const allRows = vr.values || [];
  if (!allRows.length) return { headers: [], idx: {}, rows: [] };
  const headers = (allRows[0] || []).map(h => String(h || "").trim());
  const idx     = lookupHeaderIndexes(headers);
  // Skip the header row + drop any row that lacks a store number
  // (defensive totals-row / blank-row guard).
  const rows = allRows.slice(1).filter(r => getStoreDigits(r[FIXED_COL.storeNum]));
  return { headers, idx, rows };
}

// ── Row + metric lookups ───────────────────────────────────────────────────
export function findRowByStore(rows, store) {
  const target = String(store).trim();
  for (const row of rows) {
    if (getStoreDigits(row[FIXED_COL.storeNum]) === target) return row;
  }
  return null;
}

export function getMetricRaw(row, idxMap, key) {
  if (!row) return null;
  if (key === "storeRank") return row[FIXED_COL.storeRank] ?? null;
  if (key === "storeNum")  return row[FIXED_COL.storeNum]  ?? null;
  if (key === "storeName") return row[FIXED_COL.storeName] ?? null;
  if (key === "gmName")    return row[FIXED_COL.gmName]    ?? null;
  if (key === "laborPct")  return row[FIXED_COL.laborPct]  ?? null;
  const idx = idxMap[key];
  if (idx === null || idx === undefined) return null;
  return row[idx] ?? null;
}

export function buildStoreMetricObject(row, idxMap) {
  const out = {};
  for (const k of METRIC_KEYS) out[k] = getMetricRaw(row, idxMap, k);
  return out;
}
