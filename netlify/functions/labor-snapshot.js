// netlify/functions/labor-snapshot.js
//
// Netlify Scheduled Function — change-driven snapshot of the SOAR labor
// Google Sheet into Supabase, so labor history accrues for trend tracking.
//
// Back office fills the "Labor" tab at different times through the day,
// with no single "done" moment — so a one-shot nightly capture risks
// snapshotting half-filled data. Instead this polls on a short interval
// (every 15 min during business hours) and only does the heavy upsert
// when the sheet's content has actually CHANGED for the current business
// date. Change detection: we hash the normalized data rows and compare to
// labor_sync_state.content_hash for that date; an unchanged poll is a
// cheap read with no write. Because the upsert is idempotent on
// (store_id, business_date), repeated pulls converge to the final numbers
// as back office finishes — no need to detect a single completion moment.
//
// The "Labor" tab is a single-day overwrite view: one row per store with
// Daily + WTD + PTD bands side by side, all stamped to the "Sales Date"
// in the header. The sheet keeps no daily archive, so history only exists
// from the first snapshot forward.
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
//   ?dry=1     parse + return the column map, parsed date, sample rows,
//              and whether the content changed — WITHOUT writing anything.
//   ?force=1   bypass the business-hours window AND the no-change skip
//              (re-upsert even if the hash matches). For backfills/tests.
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_JSON   service account with read access to the sheet
//   LABOR_SHEET_ID                spreadsheet id (defaults to the known sheet)
//   LABOR_SHEET_TAB               tab name (default "Labor")
//   LABOR_SHEET_RANGE             range (default "A1:AB1000")
//   LABOR_POLL_TZ                 poll-window tz (default America/Chicago)
//   LABOR_POLL_START              window open, local "HH:MM" (default 07:30)
//   LABOR_POLL_END                window close, local "HH:MM" (default 14:00)
//                                 (legacy LABOR_POLL_START_HOUR/END_HOUR honored)
//   SUPABASE_* / VITE_SUPABASE_*  standard service-role access

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SHEET_ID =
  process.env.LABOR_SHEET_ID || "1gDnirnXocpzA7394kU6J7YrnE2V4SNr2uwJnBsLnwK4";
const SHEET_TAB = process.env.LABOR_SHEET_TAB || "Labor";
// Generous row bound: the sheet has ~277 store rows today and the API only
// returns populated rows, so over-provisioning here costs nothing and
// leaves headroom as stores are added. (A too-small bound silently
// truncates the tail — that's how a 200 cap once dropped stores past row
// 200.) Override with LABOR_SHEET_RANGE if the column span ever changes.
const SHEET_RANGE = process.env.LABOR_SHEET_RANGE || "A1:AB1000";

const POLL_TZ = process.env.LABOR_POLL_TZ || "America/Chicago";

// Poll window, local to POLL_TZ, stored as minutes-since-midnight so it can
// start/end on the half hour. Set via LABOR_POLL_START / LABOR_POLL_END as
// "HH:MM" (or a bare hour); the legacy *_HOUR vars still work as a fallback.
// Default 07:30–14:00 — back office fills the sheet late-morning through
// early afternoon. Both ends are inclusive to the minute.
const POLL_START_MIN = minutesEnv(
  process.env.LABOR_POLL_START,
  process.env.LABOR_POLL_START_HOUR,
  7 * 60 + 30,
);
const POLL_END_MIN = minutesEnv(
  process.env.LABOR_POLL_END,
  process.env.LABOR_POLL_END_HOUR,
  14 * 60,
);

// Parse a clock time to minutes-of-day. Prefers an "HH:MM"/bare-hour string,
// then a legacy bare-hour value, then the default (already in minutes).
function minutesEnv(timeStr, legacyHour, dflt) {
  if (timeStr != null && String(timeStr).trim() !== "") {
    const m = String(timeStr).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (m) {
      const h = Math.min(23, parseInt(m[1], 10));
      const mm = m[2] ? Math.min(59, parseInt(m[2], 10)) : 0;
      return h * 60 + mm;
    }
  }
  const lh = parseInt(legacyHour, 10);
  if (Number.isFinite(lh)) return lh * 60;
  return dflt;
}


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

// Minutes-since-midnight in `tz` for a given instant (poll-window gate).
function minuteOfDayInTz(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  let h = parseInt(parts.find((p) => p.type === "hour")?.value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value, 10);
  if (h === 24) h = 0;
  return h * 60 + m;
}

// Stable content hash of the mapped snapshot rows — the change signal.
// Sort by store so row reordering on the sheet doesn't look like a change;
// include business_date so a date rollover always counts as a change.
function hashSnapshots(rows, businessDate) {
  const canonical = rows
    .map((r) => JSON.stringify(r))
    .sort()
    .join("\n");
  return createHash("sha256").update(`${businessDate}\n${canonical}`).digest("hex");
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
  const params = event?.queryStringParameters || {};
  const dry = params.dry === "1";
  const force = params.force === "1";

  // Business-hours gate: outside the window there's nothing new to capture,
  // so skip the sheet read entirely. ?force or ?dry bypasses it.
  if (!force && !dry) {
    const localMin = minuteOfDayInTz(new Date(), POLL_TZ);
    if (localMin < POLL_START_MIN || localMin > POLL_END_MIN) {
      return {
        statusCode: 200,
        body: JSON.stringify({ skipped: true, reason: "outside poll window", localMin }),
      };
    }
  }

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

  // Change detection: hash the parsed rows and compare to the last hash we
  // stored for this business date. Unchanged → cheap no-op (just bump the
  // poll counter). This is what lets us poll frequently while back office
  // fills the sheet, without re-writing on every poll.
  const contentHash = hashSnapshots(parsed, businessDate);
  const { data: prevState } = await supa
    .from("labor_sync_state")
    .select("content_hash, poll_count, change_count")
    .eq("business_date", businessDate)
    .maybeSingle();
  const changed = !prevState || prevState.content_hash !== contentHash;

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
    content_hash: contentHash,
    changed,
    dry,
    force,
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

  // Unchanged since last poll → record the poll and skip the upsert.
  if (!changed && !force) {
    await supa.from("labor_sync_state").update({
      poll_count: (prevState?.poll_count ?? 0) + 1,
      last_polled_at: now,
    }).eq("business_date", businessDate);
    console.log(`[labor-snapshot] date=${businessDate} no change; skipped upsert.`);
    return { statusCode: 200, body: JSON.stringify({ ...summary, upserted: 0, skipped: "no change" }) };
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

  // Record the new sync state (upsert on the business_date primary key).
  await supa.from("labor_sync_state").upsert({
    business_date: businessDate,
    content_hash: contentHash,
    rows_captured: parsed.length,
    stores_matched: ready.length,
    stores_orphaned: orphans.length,
    poll_count: (prevState?.poll_count ?? 0) + 1,
    change_count: (prevState?.change_count ?? 0) + 1,
    last_polled_at: now,
    last_changed_at: now,
  }, { onConflict: "business_date" });

  if (orphans.length) {
    console.warn(`[labor-snapshot] ${orphans.length} DI(s) not in stores: ${orphans.join(", ")}`);
  }
  console.log(
    `[labor-snapshot] date=${businessDate} parsed=${parsed.length} upserted=${ready.length}`
    + ` orphaned=${orphans.length} changed=${changed} force=${force}`
  );
  return { statusCode: 200, body: JSON.stringify({ ...summary, upserted: ready.length }) };
};

// Schedule config — Netlify reads this export. Poll every 15 minutes; the
// handler gates itself to the poll window (LABOR_POLL_START..LABOR_POLL_END
// in LABOR_POLL_TZ, default 07:30–14:00) and only upserts when the sheet
// content changed, so off-window and no-change polls are cheap. This is what
// lets the snapshot
// follow back office filling the sheet at different times instead of
// betting on one nightly capture.
export const config = {
  schedule: "*/15 * * * *",
};
