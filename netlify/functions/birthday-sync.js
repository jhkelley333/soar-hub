// netlify/functions/birthday-sync.js
//
// Admin-only sync between a Google Sheet and the GM roster (gm_roster table).
// Compares name, birthday, and phone; shows a diff preview before writing.
//
// Actions:
//   GET  ?action=preview-gm   → read sheet + gm_roster, return diff rows
//   POST ?action=sync-gm      → body: { store_numbers: string[] } → apply diffs
//
// Auth: Bearer JWT → Supabase → must be admin.

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { getGoogleCredentials } from "./_lib/googleCreds.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHEET_ID = process.env.BIRTHDAY_SHEET_ID || "1pLpW2-GJpV26TTsTiQt2lg3hZ0AUy7EZclYFd8jWk10";
const SHEET_RANGE = "A1:Z500";

function supabaseAdmin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env vars not set.");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = supabaseAdmin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: await getGoogleCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Auto-detect columns from a header row. Returns -1 for any not found.
function detectColumns(headers) {
  const h = headers.map((v) => String(v ?? "").toLowerCase().trim());
  return {
    storeCol: h.findIndex((v) => /store\s*#|store\s*num|store\s*number|^#$|^store$/.test(v)),
    nameCol:  h.findIndex((v) => /\bname\b|full name/.test(v)),
    bdayCol:  h.findIndex((v) => /birth|bday|dob|date of birth/.test(v)),
    phoneCol: h.findIndex((v) => /phone|cell|mobile/.test(v)),
  };
}

// Scan the first 5 rows, pick the one that scores best on detected columns.
function findHeaderRow(allRows) {
  let best = { index: 0, score: 0, headers: allRows[0] ?? [], cols: { storeCol: -1, nameCol: -1, bdayCol: -1, phoneCol: -1 } };
  for (let i = 0; i < Math.min(5, allRows.length); i++) {
    const cols = detectColumns(allRows[i]);
    const score = (cols.storeCol >= 0 ? 3 : 0) + (cols.nameCol >= 0 ? 2 : 0) + (cols.bdayCol >= 0 ? 2 : 0) + (cols.phoneCol >= 0 ? 1 : 0);
    if (score > best.score) best = { index: i, score, headers: allRows[i], cols };
  }
  return best;
}

// Normalise a date cell into YYYY-MM-DD, or null.
function normaliseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    const year = y.length === 2 ? (parseInt(y, 10) > 30 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

// Normalise a phone number to digits-only 10-digit string, or null.
function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

// Format 10-digit phone for display: (555) 123-4567
function fmtPhone(digits) {
  if (!digits || digits.length !== 10) return digits ?? null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normName(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Preview-GM: read sheet + gm_roster, return diff ─────────────────────────
async function actionPreviewGm(supa, sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: SHEET_RANGE });
  const allRows = res.data.values ?? [];
  if (!allRows.length) {
    return { ok: true, cols: { storeCol: -1, nameCol: -1, bdayCol: -1, phoneCol: -1 }, headers: [], headerRowIndex: 0, diffs: [], unchanged: 0, unmatched: [] };
  }

  const { index: headerRowIndex, headers, cols } = findHeaderRow(allRows);
  const dataRows = allRows.slice(headerRowIndex + 1);

  // Parse sheet rows
  const sheetRows = dataRows.map((r, i) => ({
    rowIndex: headerRowIndex + i + 2,
    storeNumber: cols.storeCol >= 0 ? String(r[cols.storeCol] ?? "").trim().replace(/^0+/, "") : "",
    name:        cols.nameCol  >= 0 ? String(r[cols.nameCol]  ?? "").trim() : "",
    birthday:    cols.bdayCol  >= 0 ? normaliseDate(r[cols.bdayCol]) : null,
    phone:       cols.phoneCol >= 0 ? normalisePhone(r[cols.phoneCol]) : null,
    rawPhone:    cols.phoneCol >= 0 ? String(r[cols.phoneCol] ?? "").trim() : "",
  })).filter((r) => r.storeNumber || r.name);

  // Load gm_roster
  const { data: roster, error } = await supa
    .from("gm_roster")
    .select("store_number, store_name, gm_name, gm_cell, gm_birthday");
  if (error) throw new Error(error.message);

  const rosterByStore = new Map(roster.map((r) => [String(r.store_number).replace(/^0+/, ""), r]));
  const rosterByName  = new Map(roster.map((r) => [normName(r.gm_name), r]));

  const diffs = [];
  const unmatched = [];
  const seen = new Set();

  for (const row of sheetRows) {
    // Match by store number first, fall back to name.
    let match = row.storeNumber ? rosterByStore.get(row.storeNumber) : null;
    let matchedBy = "store_number";
    if (!match && row.name) {
      const normRow = normName(row.name);
      match = rosterByName.get(normRow);
      if (!match) {
        // Try "Last, First" → "First Last" flip
        const words = normRow.split(" ");
        if (words.length >= 2) {
          const flipped = `${words.slice(1).join(" ")} ${words[0]}`.trim();
          match = rosterByName.get(flipped);
        }
      }
      matchedBy = "name";
    }

    if (!match) {
      unmatched.push(row.storeNumber ? `#${row.storeNumber}` : row.name);
      continue;
    }

    const storeKey = String(match.store_number).replace(/^0+/, "");
    if (seen.has(storeKey)) continue;
    seen.add(storeKey);

    const currentPhone = normalisePhone(match.gm_cell);
    const nameChanged     = row.name     && normName(row.name) !== normName(match.gm_name);
    const birthdayChanged = row.birthday && row.birthday !== match.gm_birthday;
    const phoneChanged    = row.phone    && row.phone !== currentPhone;

    if (!nameChanged && !birthdayChanged && !phoneChanged) continue;

    diffs.push({
      store_number:    String(match.store_number),
      store_name:      match.store_name ?? null,
      matchedBy,
      // name
      currentName:     match.gm_name    ?? null,
      sheetName:       row.name         || null,
      nameChanged:     !!nameChanged,
      // birthday
      currentBirthday: match.gm_birthday ?? null,
      sheetBirthday:   row.birthday      ?? null,
      birthdayChanged: !!birthdayChanged,
      // phone
      currentPhone:    fmtPhone(currentPhone),
      sheetPhone:      fmtPhone(row.phone),
      phoneChanged:    !!phoneChanged,
    });
  }

  const unchanged = sheetRows.length - diffs.length - unmatched.length;

  return {
    ok: true,
    cols,
    headers,
    headerRowIndex,
    diffs,
    unchanged: Math.max(0, unchanged),
    unmatched,
  };
}

// ── Sync-GM: apply selected diffs ───────────────────────────────────────────
async function actionSyncGm(supa, sheets, body) {
  const selected = Array.isArray(body?.store_numbers) ? body.store_numbers : null;

  const preview = await actionPreviewGm(supa, sheets);
  const toApply = selected
    ? preview.diffs.filter((d) => selected.includes(d.store_number))
    : preview.diffs;

  if (!toApply.length) return { ok: true, updated: 0, message: "Nothing to apply." };

  // Re-read sheet to get the latest row values (avoid stale diffs).
  // We already have them in preview.diffs — apply directly.
  let updated = 0;
  const errors = [];

  for (const diff of toApply) {
    try {
      if (diff.nameChanged && diff.sheetName) {
        await supa.from("gm_roster").update({ gm_name: diff.sheetName }).eq("store_number", diff.store_number);
      }
      const fields = {};
      if (diff.birthdayChanged && diff.sheetBirthday) fields.gm_birthday = diff.sheetBirthday;
      if (diff.phoneChanged && diff.sheetPhone) {
        // Store normalised digits
        const digits = normalisePhone(diff.sheetPhone) ?? diff.sheetPhone;
        fields.gm_cell = fmtPhone(digits) ?? diff.sheetPhone;
      }
      if (Object.keys(fields).length) {
        await supa.from("gm_roster").update(fields).eq("store_number", diff.store_number);
      }
      updated++;
    } catch (e) {
      errors.push({ store_number: diff.store_number, error: e?.message ?? "unknown" });
    }
  }

  return { ok: true, updated, errors: errors.length ? errors : undefined };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try { user = await getSessionUser(event); } catch (e) {
    return respond(500, { ok: false, message: e.message });
  }
  if (!user) return respond(401, { ok: false, message: "Not authenticated." });
  if (user.role !== "admin") return respond(403, { ok: false, message: "Admin only." });

  const params = event.queryStringParameters || {};
  const action = params.action || "preview-gm";

  let body = {};
  if (event.body) { try { body = JSON.parse(event.body); } catch { /* ignore */ } }

  try {
    const sheets = await getSheets();
    const supa = supabaseAdmin();

    if (action === "preview-gm") return respond(200, await actionPreviewGm(supa, sheets));
    if (action === "sync-gm")    return respond(200, await actionSyncGm(supa, sheets, body));
    return respond(400, { ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("birthday-sync error:", err);
    return respond(500, { ok: false, message: err?.message || "Server error." });
  }
};
