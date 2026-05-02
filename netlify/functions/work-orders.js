// netlify/functions/work-orders.js
//
// Phase 2a Work Orders backend.
//
// Auth model: the frontend sends `Authorization: Bearer <supabase_access_token>`.
// The server validates the JWT against Supabase using the service-role key,
// looks up the user's role and visible stores via the `user_visible_stores`
// Postgres function, and gates downstream calls on those scopes.
//
// External systems brokered here:
//   - Smartsheet — work-order tickets (list / get / create / update). The
//     "Store Number" column is matched 1:1 against `stores.number` rows
//     returned by Supabase, with admin/payroll roles bypassing the filter.
//   - Google Sheets — vendor list (read-only).
//   - Google Drive — training videos (read-only).
//   - Supabase Storage — attachment uploads. The resulting public URL is
//     written back to the Smartsheet "Quote URL" column when present
//     (falls back to "Notes").
//
// Required Netlify env vars (set in the Netlify dashboard):
//   VITE_SUPABASE_URL              — also exposed to the browser; safe.
//   SUPABASE_SERVICE_ROLE_KEY      — server-only.
//   SMARTSHEET_TOKEN
//   SMARTSHEET_SHEET_ID
//   VENDOR_SHEET_ID                — Google Sheet ID.
//   VIDEO_FOLDER_ID                — Google Drive folder ID.
//   GOOGLE_SERVICE_ACCOUNT_JSON    — full service-account JSON, stringified.
//   SUPABASE_BUCKET                — optional, defaults to 'work-order-attachments'.

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMARTSHEET_TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_ID = process.env.SMARTSHEET_SHEET_ID;
const VENDOR_SHEET_ID = process.env.VENDOR_SHEET_ID;
const VIDEO_FOLDER_ID = process.env.VIDEO_FOLDER_ID;
const GOOGLE_CREDS = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const BUCKET = process.env.SUPABASE_BUCKET || "work-order-attachments";

const SS_BASE = "https://api.smartsheet.com/2.0";

// ----------------------------------------------------------------------------
// Auth bridge
// ----------------------------------------------------------------------------

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Supabase env vars are not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;
  const authUser = userRes.user;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", authUser.id)
    .single();
  if (!profile || !profile.is_active) return null;

  const { data: stores } = await supa.rpc("user_visible_stores", { uid: authUser.id });
  const storeNumbers = (stores ?? [])
    .map((s) => s.number)
    .filter(Boolean)
    .map(String);

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    storeNumbers,
    canSeeAllStores: profile.role === "admin" || profile.role === "payroll",
  };
}

// ----------------------------------------------------------------------------
// Smartsheet
// ----------------------------------------------------------------------------

async function ssRequest(method, path, body) {
  if (!SMARTSHEET_TOKEN || !SHEET_ID) {
    throw new Error("Smartsheet env vars are not configured");
  }
  const r = await fetch(`${SS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SMARTSHEET_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Smartsheet ${r.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

function buildColumnMap(columns) {
  const byTitle = {};
  for (const c of columns) byTitle[c.title] = c.id;
  return byTitle;
}

function flattenRow(row, columns) {
  const out = { id: row.id, modifiedAt: row.modifiedAt, createdAt: row.createdAt };
  for (const col of columns) {
    const cell = row.cells?.find((c) => c.columnId === col.id);
    out[col.title] = cell?.displayValue ?? cell?.value ?? null;
  }
  return out;
}

function userCanSeeRow(user, row, storeColumnId) {
  if (user.canSeeAllStores) return true;
  const cell = row.cells?.find((c) => c.columnId === storeColumnId);
  if (!cell) return false;
  const num = String(cell.value ?? cell.displayValue ?? "").trim();
  return num !== "" && user.storeNumbers.includes(num);
}

async function loadSheet() {
  return ssRequest("GET", `/sheets/${SHEET_ID}`);
}

async function listWorkOrders(user) {
  const sheet = await loadSheet();
  const cols = buildColumnMap(sheet.columns);
  const storeColId = cols["Store Number"];
  if (!storeColId) throw new Error('Smartsheet column "Store Number" not found');
  const rows = (sheet.rows ?? []).filter((row) => userCanSeeRow(user, row, storeColId));
  return rows.map((r) => flattenRow(r, sheet.columns));
}

async function getWorkOrder(user, rowId) {
  const sheet = await loadSheet();
  const cols = buildColumnMap(sheet.columns);
  const storeColId = cols["Store Number"];
  const row = (sheet.rows ?? []).find((r) => String(r.id) === String(rowId));
  if (!row) return null;
  if (!userCanSeeRow(user, row, storeColId)) return null;
  return flattenRow(row, sheet.columns);
}

function cellsFromInput(input, columnMap) {
  const cells = [];
  for (const [title, value] of Object.entries(input)) {
    const columnId = columnMap[title];
    if (!columnId) continue;
    cells.push({ columnId, value });
  }
  return cells;
}

async function createWorkOrder(user, input) {
  const sheet = await loadSheet();
  const cols = buildColumnMap(sheet.columns);
  const storeNum = String(input["Store Number"] ?? "").trim();
  if (!user.canSeeAllStores && !user.storeNumbers.includes(storeNum)) {
    return { error: "store not in your scope", status: 403 };
  }
  const cells = cellsFromInput(input, cols);
  const res = await ssRequest("POST", `/sheets/${SHEET_ID}/rows`, [
    { toBottom: true, cells },
  ]);
  const newRow = res.result?.[0];
  return newRow ? flattenRow(newRow, sheet.columns) : { ok: true };
}

async function updateWorkOrder(user, rowId, input) {
  const existing = await getWorkOrder(user, rowId);
  if (!existing) return { error: "not found or not in scope", status: 404 };
  const sheet = await loadSheet();
  const cols = buildColumnMap(sheet.columns);
  const cells = cellsFromInput(input, cols);
  if (cells.length === 0) return existing;
  await ssRequest("PUT", `/sheets/${SHEET_ID}/rows`, [
    { id: Number(rowId), cells },
  ]);
  return getWorkOrder(user, rowId);
}

async function appendUrlToRow(rowId, url) {
  const sheet = await loadSheet();
  const cols = buildColumnMap(sheet.columns);
  const targetCol = cols["Quote URL"] ?? cols["Notes"];
  if (!targetCol) return;
  await ssRequest("PUT", `/sheets/${SHEET_ID}/rows`, [
    { id: Number(rowId), cells: [{ columnId: targetCol, value: url }] },
  ]);
}

// ----------------------------------------------------------------------------
// Google Sheets + Drive (vendors + videos)
// ----------------------------------------------------------------------------

function googleAuth(scopes) {
  if (!GOOGLE_CREDS) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const creds = JSON.parse(GOOGLE_CREDS);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
  });
}

async function listVendors() {
  if (!VENDOR_SHEET_ID) throw new Error("VENDOR_SHEET_ID is not set");
  const auth = googleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: VENDOR_SHEET_ID,
    range: "A:Z",
  });
  const values = res.data.values ?? [];
  if (values.length === 0) return [];
  const [header, ...rows] = values;
  return rows.map((row) =>
    Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]))
  );
}

async function listVideos() {
  if (!VIDEO_FOLDER_ID) throw new Error("VIDEO_FOLDER_ID is not set");
  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${VIDEO_FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, webViewLink, thumbnailLink, createdTime)",
    orderBy: "name",
    pageSize: 200,
  });
  return res.data.files ?? [];
}

// ----------------------------------------------------------------------------
// Supabase Storage upload
// ----------------------------------------------------------------------------

async function uploadAttachment(user, body) {
  const { rowId, fileName, contentType, dataBase64 } = body || {};
  if (!rowId || !fileName || !dataBase64) {
    return { error: "rowId, fileName, dataBase64 required", status: 400 };
  }
  // Confirm the user can see this row before letting them attach to it.
  const existing = await getWorkOrder(user, rowId);
  if (!existing) return { error: "not found or not in scope", status: 404 };

  const supa = admin();
  const buf = Buffer.from(dataBase64, "base64");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${rowId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(objectPath, buf, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { error: `upload failed: ${upErr.message}`, status: 500 };

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(objectPath);
  const url = pub?.publicUrl;
  if (url) await appendUrlToRow(rowId, url);
  return { url, path: objectPath };
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
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
  const action = params.action;
  const id = params.id;

  try {
    if (event.httpMethod === "GET") {
      if (action === "vendors") return respond(200, await listVendors());
      if (action === "videos") return respond(200, await listVideos());
      if (id) {
        const wo = await getWorkOrder(user, id);
        return wo ? respond(200, wo) : respond(404, { error: "not found" });
      }
      return respond(200, {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          storeNumbers: user.storeNumbers,
          canSeeAllStores: user.canSeeAllStores,
        },
        workOrders: await listWorkOrders(user),
      });
    }

    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "upload") return unwrap(await uploadAttachment(user, body));
      return unwrap(await createWorkOrder(user, body));
    }

    if (event.httpMethod === "PUT" || event.httpMethod === "PATCH") {
      if (!id) return respond(400, { error: "id required" });
      const body = event.body ? JSON.parse(event.body) : {};
      return unwrap(await updateWorkOrder(user, id, body));
    }

    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
