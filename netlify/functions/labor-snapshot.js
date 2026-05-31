// netlify/functions/labor-snapshot.js
//
// Netlify Scheduled Function — nightly snapshot of the SOAR labor Google
// Sheet into Supabase, so labor history accrues for trend tracking.
//
// The "Labor" tab is a single-day overwrite view: one row per store with
// Daily + WTD + PTD bands side by side, all stamped to the "Sales Date"
// in the header. Each night we read it, tag every row with that business
// date, and upsert into labor_daily_snapshots keyed on (store, date).
// Re-runs and restatements are safe (upsert); the sheet keeps no daily
// archive, so history only exists from the first snapshot forward.
//
// Parsing is header-driven (not fixed column letters) because the sheet
// has spacer columns and the layout can drift — same discipline as
// _lib/ranker-sheets.js. Values are read UNFORMATTED, so percentages
// arrive as fractions (0.3444) and the date as a serial number; we
// convert both. Column positions verified against the live sheet:
// DI in col C, three bands each starting with "Labor %", "Base PTD
// Labor Goal" last.
//
// Manual / test invocation (HTTP GET to the function URL):
//   ?dry=1   parse + return the column map, parsed date, and a sample of
//            mapped rows WITHOUT writing anything. Run this first to
//            confirm the mapping before going live.
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_JSON   service account with read access to the sheet
//   LABOR_SHEET_ID                spreadsheet id (defaults to the known sheet)
//   LABOR_SHEET_TAB               tab name (default "Labor")
//   LABOR_SHEET_RANGE             range (default "A1:AB200")
//   SUPABASE_* / VITE_SUPABASE_*  standard service-role access

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SHEET_ID =
  process.env.LABOR_SHEET_ID || "1gDnirnXocpzA7394kU6J7YrnE2V4SNr2uwJnBsLnwK4";
const SHEET_TAB = process.env.LABOR_SHEET_TAB || "Labor";
const SHEET_RANGE = process.env.LABOR_SHEET_RANGE || "A1:AB200";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Google Sheets ────────────────────────────────────────────────────
function sheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing.");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readGrid() {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!${SHEET_RANGE}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  return res.data.values || [];
}

// ── Parsing helpers ──────────────────────────────────────────────────
function norm(v) {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function colLetter(i) {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Sheet stores percentages as fractions when read UNFORMATTED (0.3444 →
// 34.44%). Convert to the percent number we persist. Guard against a
// future FORMATTED pull by leaving values already in percent range alone.
function pct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) <= 1.5 ? round2(n * 100) : round2(n);
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Google/Excel serial date (epoch 1899-12-30) → "YYYY-MM-DD".
function serialToIso(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Accept a serial number, ISO date, or "DD/Mon/YYYY" (the sheet's display
// format). Returns "YYYY-MM-DD" or null.
function parseAnyDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 1000) return serialToIso(v);
  const s = String(v).trim();
  if (/^\d{4,}$/.test(s)) return serialToIso(parseInt(s, 10));
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/\- ]([A-Za-z]{3,})[/\- ](\d{4})$/.exec(s); // 30/may/2026
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${pad2(mon)}-${pad2(parseInt(m[1], 10))}`;
  }
  m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/.exec(s); // MM/DD/YYYY
  if (m) return `${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`;
  return null;
}

// Find the header row: the one carrying "DI" and "Labor %".
function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(norm);
    if (cells.includes("di") && cells.includes("labor %")) return r;
  }
  return -1;
}

// Map header text → column indices. Bands are delimited by each "Labor %"
// occurrence (1st = daily, 2nd = wtd, 3rd = ptd).
function buildColumnMap(headerRow) {
  const map = {
    di: null, location_name: null, gm: null, do: null, sdo: null, rvp: null,
    base_ptd_labor_goal: null,
    daily: {}, wtd: {}, ptd: {},
  };
  const bands = ["daily", "wtd", "ptd"];
  let bandIdx = -1;
  let band = null;

  headerRow.forEach((raw, i) => {
    const t = norm(raw);
    if (!t) return;
    if (t === "labor %") {
      bandIdx += 1;
      band = bands[bandIdx] || null;
      if (band) map[band].labor_pct = i;
      return;
    }
    if (band === null) {
      // Location Information section (before the first band).
      if (t === "di" && map.di === null) map.di = i;
      else if (t === "location") map.location_name = i;
      else if (t === "gm") map.gm = i;
      else if (t === "do") map.do = i;
      else if (t === "sdo") map.sdo = i;
      else if (t === "rvp") map.rvp = i;
      return;
    }
    if (/base ptd labor goal/.test(t)) { map.base_ptd_labor_goal = i; return; }
    if (/sales/.test(t)) map[band].sales = i;
    else if (/variance/.test(t)) map[band].variance = i;
    else if (/over chart/.test(t) && /\$|dollar/.test(t)) map[band].dollars_over = i;
    else if (/over chart/.test(t) && /hour/.test(t)) map[band].hours_over = i;
  });
  return map;
}

// Locate the "Sales Date" value (serial / date) near the sheet header.
function findBusinessDate(rows, headerIdx) {
  for (let r = 0; r < Math.min(rows.length, headerIdx + 1, 15); r++) {
    const row = rows[r] || [];
    const labelCol = row.findIndex((c) => /sales date/i.test(String(c ?? "")));
    if (labelCol >= 0) {
      for (let c = labelCol + 1; c < row.length; c++) {
        const d = parseAnyDate(row[c]);
        if (d) return d;
      }
    }
  }
  // Fallback: any serial-looking number in the top rows.
  for (let r = 0; r < Math.min(rows.length, headerIdx + 1, 15); r++) {
    for (const c of rows[r] || []) {
      if (typeof c === "number" && c > 40000 && c < 80000) return serialToIso(c);
    }
  }
  return null;
}

function bandFields(row, cols) {
  return {
    labor_pct: pct(row[cols.labor_pct]),
    sales: num(row[cols.sales]),
    variance_to_chart: pct(row[cols.variance]),
    dollars_over_chart: num(row[cols.dollars_over]),
    hours_over_chart: num(row[cols.hours_over]),
  };
}

function buildSnapshotRow(row, map, businessDate) {
  const storeNumber = row[map.di];
  if (storeNumber == null || String(storeNumber).trim() === "") return null;
  const numCheck = num(storeNumber);
  if (numCheck == null) return null; // skip footers / non-store rows

  const d = bandFields(row, map.daily);
  const w = bandFields(row, map.wtd);
  const p = bandFields(row, map.ptd);

  return {
    store_number: String(storeNumber).trim(),
    business_date: businessDate,
    location_name: map.location_name != null ? String(row[map.location_name] ?? "").trim() || null : null,
    gm_name: map.gm != null ? String(row[map.gm] ?? "").trim() || null : null,
    do_name: map.do != null ? String(row[map.do] ?? "").trim() || null : null,
    sdo_name: map.sdo != null ? String(row[map.sdo] ?? "").trim() || null : null,
    rvp_name: map.rvp != null ? String(row[map.rvp] ?? "").trim() || null : null,
    daily_labor_pct: d.labor_pct,
    daily_sales: d.sales,
    daily_variance_to_chart: d.variance_to_chart,
    daily_dollars_over_chart: d.dollars_over_chart,
    daily_hours_over_chart: d.hours_over_chart,
    wtd_labor_pct: w.labor_pct,
    wtd_sales: w.sales,
    wtd_variance_to_chart: w.variance_to_chart,
    wtd_dollars_over_chart: w.dollars_over_chart,
    wtd_hours_over_chart: w.hours_over_chart,
    ptd_labor_pct: p.labor_pct,
    ptd_sales: p.sales,
    ptd_variance_to_chart: p.variance_to_chart,
    ptd_dollars_over_chart: p.dollars_over_chart,
    ptd_hours_over_chart: p.hours_over_chart,
    base_ptd_labor_goal: map.base_ptd_labor_goal != null ? pct(row[map.base_ptd_labor_goal]) : null,
  };
}

// ── Handler ──────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[labor-snapshot] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }
  const dry = (event?.queryStringParameters || {}).dry === "1";

  let rows;
  try {
    rows = await readGrid();
  } catch (e) {
    console.error("[labor-snapshot] sheet read failed:", e?.message || e);
    return { statusCode: 502, body: JSON.stringify({ error: "sheet read failed", detail: e?.message }) };
  }

  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    console.error("[labor-snapshot] header row not found; sheet layout changed?");
    return { statusCode: 422, body: JSON.stringify({ error: "header row not found" }) };
  }
  const map = buildColumnMap(rows[headerIdx]);
  const businessDate = findBusinessDate(rows, headerIdx);
  if (!businessDate) {
    console.error("[labor-snapshot] could not resolve business date from sheet.");
    return { statusCode: 422, body: JSON.stringify({ error: "business date not found" }) };
  }

  // Parse data rows.
  const parsed = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const snap = buildSnapshotRow(rows[r] || [], map, businessDate);
    if (snap) parsed.push(snap);
  }

  const supa = admin();

  // Resolve store_id from store_number.
  const numbers = Array.from(new Set(parsed.map((p) => p.store_number)));
  const idByNumber = new Map();
  if (numbers.length) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("id, number")
      .in("number", numbers);
    for (const s of storeRows ?? []) idByNumber.set(String(s.number), s.id);
  }

  const ready = [];
  const orphans = [];
  const now = new Date().toISOString();
  for (const p of parsed) {
    const storeId = idByNumber.get(p.store_number);
    if (!storeId) {
      orphans.push(p.store_number);
      continue;
    }
    ready.push({ ...p, store_id: storeId, raw: p, source_synced_at: now, updated_at: now });
  }

  const summary = {
    business_date: businessDate,
    rows_parsed: parsed.length,
    stores_matched: ready.length,
    stores_orphaned: orphans,
    dry,
  };

  if (dry) {
    summary.column_map = {
      di: colLetter(map.di),
      location: colLetter(map.location_name),
      gm: colLetter(map.gm), do: colLetter(map.do), sdo: colLetter(map.sdo), rvp: colLetter(map.rvp),
      base_ptd_labor_goal: map.base_ptd_labor_goal != null ? colLetter(map.base_ptd_labor_goal) : null,
      daily: Object.fromEntries(Object.entries(map.daily).map(([k, v]) => [k, colLetter(v)])),
      wtd: Object.fromEntries(Object.entries(map.wtd).map(([k, v]) => [k, colLetter(v)])),
      ptd: Object.fromEntries(Object.entries(map.ptd).map(([k, v]) => [k, colLetter(v)])),
    };
    summary.sample = ready.slice(0, 3);
    return { statusCode: 200, body: JSON.stringify(summary, null, 2) };
  }

  if (!ready.length) {
    console.warn(`[labor-snapshot] no resolvable rows for ${businessDate}.`);
    return { statusCode: 200, body: JSON.stringify(summary) };
  }

  const { error } = await supa
    .from("labor_daily_snapshots")
    .upsert(ready, { onConflict: "store_id,business_date" });
  if (error) {
    console.error("[labor-snapshot] upsert failed:", error.message);
    return { statusCode: 500, body: JSON.stringify({ ...summary, error: error.message }) };
  }

  if (orphans.length) {
    console.warn(`[labor-snapshot] ${orphans.length} DI(s) not in stores: ${orphans.join(", ")}`);
  }
  console.log(
    `[labor-snapshot] date=${businessDate} parsed=${parsed.length} upserted=${ready.length} orphaned=${orphans.length}`
  );
  return { statusCode: 200, body: JSON.stringify({ ...summary, upserted: ready.length }) };
};

// Schedule config — Netlify reads this export. Daily at 11:00 UTC
// (~5–6 AM US Central), after the sheet's overnight refresh. The snapshot
// is stamped with whatever Sales Date the sheet carries, so exact timing
// only needs to land after the refresh; re-runs are idempotent. Tune via
// the cron here if the refresh window moves.
export const config = {
  schedule: "0 11 * * *",
};
