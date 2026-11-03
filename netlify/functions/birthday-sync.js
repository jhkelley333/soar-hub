// netlify/functions/birthday-sync.js
//
// Two-way birthday sync between a Google Sheet and Hub profiles.
//
// Actions:
//   GET  ?action=preview          → read sheet, auto-detect columns, return rows
//   POST ?action=sync-from-sheet  → match sheet rows to profiles, update birthdays
//   POST ?action=write-to-sheet   → push Hub profile birthdays back into the sheet
//
// Auth: Bearer JWT → Supabase → must be do/sdo/rvp/vp/coo/admin.
// The service account must have view/edit access to the sheet.

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { getGoogleCredentials } from "./_lib/googleCreds.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHEET_ID = process.env.BIRTHDAY_SHEET_ID || "1pLpW2-GJpV26TTsTiQt2lg3hZ0AUy7EZclYFd8jWk10";
const SHEET_RANGE = "A1:Z500"; // generous; trimmed to data rows

const SYNC_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

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
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return google.sheets({ version: "v4", auth });
}

// Try to detect which column indices hold "name" and "birthday" by scanning
// the header row. Returns { nameCol, bdayCol, roleCol, headerRow }.
function detectColumns(headers) {
  const h = headers.map((v) => String(v ?? "").toLowerCase().trim());
  const nameCol = h.findIndex((v) => /\bname\b/.test(v) || v === "full name");
  const bdayCol = h.findIndex((v) =>
    /birth|bday|dob|date of birth/.test(v));
  const roleCol = h.findIndex((v) => /\brole\b/.test(v) || v === "title" || v === "position");
  return { nameCol, bdayCol, roleCol };
}

// Normalise a date value from a sheet cell into YYYY-MM-DD, or null.
function normaliseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    const year = y.length === 2 ? (parseInt(y, 10) > 30 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try JS Date as a last resort (handles "January 5, 1990", etc.)
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }

  return null;
}

// Normalise a name for fuzzy matching: lowercase, collapse whitespace, strip
// punctuation so "McDonald" and "Mcdonald" and "McDonald, Jane" all compare ok.
function normName(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function actionPreview(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });
  const rows = res.data.values ?? [];
  if (!rows.length) return { rows: [], cols: { nameCol: -1, bdayCol: -1, roleCol: -1 }, headers: [] };

  const headers = rows[0];
  const cols = detectColumns(headers);

  const parsed = rows.slice(1).map((r, i) => ({
    rowIndex: i + 2, // 1-based, row 1 is headers
    name: cols.nameCol >= 0 ? String(r[cols.nameCol] ?? "").trim() : "",
    birthday: cols.bdayCol >= 0 ? normaliseDate(r[cols.bdayCol]) : null,
    role: cols.roleCol >= 0 ? String(r[cols.roleCol] ?? "").trim() : "",
    rawBirthday: cols.bdayCol >= 0 ? String(r[cols.bdayCol] ?? "").trim() : "",
  })).filter((r) => r.name);

  return { headers, cols, rows: parsed };
}

async function actionSyncFromSheet(supa, sheets) {
  const preview = await actionPreview(sheets);
  if (preview.cols.nameCol < 0 || preview.cols.bdayCol < 0) {
    return { error: "Couldn't detect Name and Birthday columns in the sheet." };
  }

  // Load every active profile we might match against.
  const { data: profiles, error } = await supa
    .from("profiles")
    .select("id, full_name, preferred_name, birthday, role, is_active")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const results = [];
  for (const row of preview.rows) {
    if (!row.birthday) continue;
    const normRow = normName(row.name);

    // Find best match: exact normalised first, then first-word match.
    let match = profiles.find((p) => normName(p.full_name) === normRow || normName(p.preferred_name) === normRow);
    if (!match) {
      // Try matching on first+last name with permutation (sheet might be "Last, First")
      const words = normRow.split(" ");
      if (words.length >= 2) {
        const flipped = `${words.slice(1).join(" ")} ${words[0]}`.trim();
        match = profiles.find((p) => normName(p.full_name) === flipped || normName(p.preferred_name) === flipped);
      }
    }

    if (!match) {
      results.push({ name: row.name, birthday: row.birthday, status: "no_match" });
      continue;
    }

    if (match.birthday === row.birthday) {
      results.push({ name: row.name, profileId: match.id, birthday: row.birthday, status: "already_current" });
      continue;
    }

    const { error: updErr } = await supa
      .from("profiles")
      .update({ birthday: row.birthday })
      .eq("id", match.id);

    results.push({
      name: row.name,
      profileId: match.id,
      birthday: row.birthday,
      oldBirthday: match.birthday,
      status: updErr ? "error" : "updated",
      error: updErr?.message,
    });
  }

  const updated = results.filter((r) => r.status === "updated").length;
  const noMatch = results.filter((r) => r.status === "no_match").length;
  return { ok: true, updated, no_match: noMatch, results };
}

async function actionWriteToSheet(supa, sheets) {
  const preview = await actionPreview(sheets);
  if (preview.cols.nameCol < 0 || preview.cols.bdayCol < 0) {
    return { error: "Couldn't detect Name and Birthday columns in the sheet." };
  }

  // Load active profiles with birthdays.
  const { data: profiles, error } = await supa
    .from("profiles")
    .select("id, full_name, preferred_name, birthday, is_active")
    .eq("is_active", true)
    .not("birthday", "is", null);
  if (error) throw new Error(error.message);

  const profileMap = new Map(profiles.map((p) => [normName(p.full_name), p]));

  // For each sheet row, check if the Hub has a birthday to write back.
  const updates = []; // { range, value }
  for (const row of preview.rows) {
    const normRow = normName(row.name);
    const profile = profileMap.get(normRow);
    if (!profile?.birthday) continue;

    const formatted = new Date(profile.birthday + "T12:00:00").toLocaleDateString("en-US", {
      month: "numeric", day: "numeric", year: "numeric",
    });

    if (row.rawBirthday === formatted || row.birthday === profile.birthday) continue;

    // Convert col index to A1 column letter
    const colLetter = colToLetter(preview.cols.bdayCol);
    updates.push({
      range: `${colLetter}${row.rowIndex}`,
      value: formatted,
    });
  }

  if (!updates.length) {
    return { ok: true, updated: 0, message: "Sheet is already up to date." };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });

  return { ok: true, updated: updates.length };
}

function colToLetter(index) {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try { user = await getSessionUser(event); } catch (e) {
    return respond(500, { ok: false, message: e.message });
  }
  if (!user) return respond(401, { ok: false, message: "Not authenticated." });
  if (!SYNC_ROLES.has(user.role)) return respond(403, { ok: false, message: "Not authorised." });

  const params = event.queryStringParameters || {};
  const action = params.action || "preview";

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { /* ignore */ }
  }
  void body;

  try {
    const sheets = await getSheets();
    const supa = supabaseAdmin();

    if (action === "preview") {
      return respond(200, await actionPreview(sheets));
    }
    if (action === "sync-from-sheet") {
      return respond(200, await actionSyncFromSheet(supa, sheets));
    }
    if (action === "write-to-sheet") {
      return respond(200, await actionWriteToSheet(supa, sheets));
    }
    return respond(400, { ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("birthday-sync error:", err);
    return respond(500, { ok: false, message: err?.message || "Server error." });
  }
};
