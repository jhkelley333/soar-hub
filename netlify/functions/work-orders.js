// netlify/functions/work-orders.js
//
// Phase 2a Work Orders backend — single Netlify Function brokering four
// external systems behind a Supabase JWT auth bridge.
//
// ─── DATA FLOW ──────────────────────────────────────────────────────────────
//
// SUBMISSION (today, one path)
//   React "📝 Submit Work Order" button → opens Smartsheet form in a new tab
//   → user fills form → Smartsheet creates the row directly. This function
//   does NOT see the submission. Smartsheet's own automation fires alerts.
//   (A POST createWorkOrder endpoint exists here for future use; no React
//   caller invokes it as of this writing.)
//
// LISTING / READING
//   React → fetch /.netlify/functions/work-orders
//          Authorization: Bearer <Supabase access token>
//   → function validates JWT (supabase.auth.getUser), looks up role +
//     visible stores via user_visible_stores RPC, fetches the entire sheet
//     from Smartsheet, filters rows by user's store scope, normalizes cell
//     values, returns JSON to the caller.
//
// UPDATING (status / approval / notes / vendor / etc.)
//   React drawer → fetch PUT /.netlify/functions/work-orders?id=<row id>
//   → function re-validates JWT, re-checks scope, runs server-side rules
//     (status workflow, approval gating, required notes), translates input
//     keys to actual sheet column ids, writes via Smartsheet PUT, returns
//     the refreshed row.
//
// ATTACHMENTS
//   React → POST /.netlify/functions/work-orders?action=upload (base64)
//   → function decodes, uploads to Supabase Storage bucket, gets the public
//     URL, writes URL into the Smartsheet "Quote URL" column (or "Notes"
//     fallback), returns { url, path }.
//
// SUPABASE TABLES TOUCHED (read-only via service-role key)
//   profiles, user_scopes (indirectly), stores/districts/areas/regions
//   (indirectly via the user_visible_stores Postgres function). No work-
//   order data lives in Supabase — Smartsheet is the source of truth.
//
// SUPABASE STORAGE (write)
//   Bucket SUPABASE_BUCKET (default 'work-order-attachments'). Public read
//   so the URL written into Smartsheet's "Quote URL" column resolves for
//   any user.
//
// COLUMN-NAME ALIASES (Smartsheet column titles drift over time)
//   _submittedDate     ← Date Submitted | Created | Submit Date | Date Created | rowCreatedAt
//   _submittedBy       ← Submitted By | Submitted by | Submitter | Created By | Submitted By Email
//   _approvalLevel     ← Approval Level | Approval
//   _approvalNotes     ← Approval Notes | Approval Request Notes
//   _issueDescription  ← Issue Description | Description
//   On WRITE, "Approval Notes" input is auto-routed to whichever column
//   actually exists on the sheet (Approval Notes OR Approval Request Notes).
//
// ─── REQUIRED NETLIFY ENV VARS ──────────────────────────────────────────────
//   VITE_SUPABASE_URL              — also exposed to the browser; safe.
//   SUPABASE_SERVICE_ROLE_KEY      — server-only.
//   SMARTSHEET_TOKEN
//   SMARTSHEET_SHEET_ID
//   VENDOR_SHEET_ID                — Google Sheet ID for vendors tab.
//   VIDEO_FOLDER_ID                — Google Drive folder ID for videos tab.
//                                    (Legacy alias VIDEOS_FOLDER_ID also accepted.)
//   GOOGLE_SERVICE_ACCOUNT_JSON    — full service-account JSON, stringified.
//   SUPABASE_BUCKET                — optional, defaults to 'work-order-attachments'.

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMARTSHEET_TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_ID = process.env.SMARTSHEET_SHEET_ID;
const VENDOR_SHEET_ID = process.env.VENDOR_SHEET_ID;
const VIDEO_FOLDER_ID =
  process.env.VIDEO_FOLDER_ID ||
  process.env.VIDEOS_FOLDER_ID ||
  // Default: shared training-videos folder. Override with the env var if you
  // ever swap to a different folder. Service account must be Viewer on the
  // folder regardless — Drive API doesn't honor "anyone with link" sharing
  // for service-account callers the way the web UI does.
  "1oeHi2gCuNlzdVaOUC5MCVf9Kh4eQAFlq";
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

  // user_visible_stores() returns setof uuid — flat list of UUID strings.
  // Resolve those to store numbers via a follow-up query so we can match
  // against the Smartsheet "Store Number" column. (Older code mapped the
  // RPC rows directly to .number, which silently produced undefined for
  // every row and emptied the visible-stores list for non-admin users.)
  const { data: visibleIds } = await supa.rpc("user_visible_stores", {
    uid: authUser.id,
  });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  let storeNumbers = [];
  if (ids.length > 0) {
    const { data: storeRows } = await supa
      .from("stores")
      .select("number")
      .in("id", ids);
    storeNumbers = (storeRows ?? [])
      .map((s) => String(s.number))
      .filter(Boolean);
  }

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
// Status workflow + role-based approval
// ----------------------------------------------------------------------------

// Canonical status list, in dropdown order. Old values like "Open",
// "Awaiting Approval", "Completed", "Cancelled" are not in this list — rows
// already carrying those values still display, but new transitions must use
// the canonical names.
const STATUSES_ORDER = [
  "Received",
  "Pending Approval",
  "Approved",
  "Rejected - See Notes",
  "Scheduled",
  "In Progress",
  "On Hold",
  "Part on Order",
  "New Equipment Ordered",
  "Closed",
];
const STATUSES_VALID = new Set(STATUSES_ORDER);

const APPROVER_ROLES = new Set(["rvp", "vp", "coo"]);

// Status changes permitted by role (cascading — higher tiers inherit lower).
function allowedStatusesForRole(role) {
  if (role === "admin") return new Set(STATUSES_ORDER);
  const hourly = ["Scheduled", "In Progress", "Closed"];
  const gm = [...hourly, "On Hold", "Part on Order", "New Equipment Ordered"];
  const approver = [...gm, "Approved", "Rejected - See Notes"];
  if (role === "shift_manager") return new Set(hourly);
  if (role === "gm" || role === "do" || role === "sdo") return new Set(gm);
  if (APPROVER_ROLES.has(role)) return new Set(approver);
  return new Set(); // payroll and any unrecognized role
}

function isApproverRole(role) {
  return role === "admin" || APPROVER_ROLES.has(role);
}

// Parse the Smartsheet "Approval Level" dropdown text down to a tier code.
//   "Regional VP < $1750"  → "rvp"
//   "VP $1751 -$2500"      → "vp"
//   "COO > $2500"          → "coo"
function tierFromApprovalLevel(value) {
  const v = String(value ?? "").trim();
  if (v.startsWith("Regional VP")) return "rvp";
  if (v.startsWith("VP")) return "vp";
  if (v.startsWith("COO")) return "coo";
  return null;
}

// Whether a given user role can approve a work order at this approval tier.
// Cascading: COO approves all, VP approves rvp+vp, RVP approves rvp only.
function canApproveRow(role, approvalLevel) {
  const tier = tierFromApprovalLevel(approvalLevel);
  if (!tier) return false;
  if (role === "admin" || role === "coo") return true;
  if (role === "vp") return tier === "rvp" || tier === "vp";
  if (role === "rvp") return tier === "rvp";
  return false;
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

function firstTruthy(values) {
  for (const v of values) {
    if (v != null && v !== "") return v;
  }
  return null;
}

function flattenRow(row, columns) {
  const out = { id: row.id, modifiedAt: row.modifiedAt, createdAt: row.createdAt };
  for (const col of columns) {
    const cell = row.cells?.find((c) => c.columnId === col.id);
    out[col.title] = cell?.displayValue ?? cell?.value ?? null;
  }
  // Normalized fields (column-name fallbacks). Underscore-prefixed so they
  // can never collide with a literal Smartsheet column title.
  out._submittedDate =
    firstTruthy([
      out["Date Submitted"],
      out["Created"],
      out["Submit Date"],
      out["Date Created"],
      row.createdAt,
    ]) || "";
  out._submittedBy =
    firstTruthy([
      out["Submitted By"],
      out["Submitted by"], // lowercase 'b' — current sheet column name
      out["Submitter"],
      out["Created By"],
      out["Submitted By Email"],
    ]) || "";
  out._approvalLevel =
    firstTruthy([out["Approval Level"], out["Approval"]]) || "";
  out._approvalNotes =
    firstTruthy([
      out["Approval Notes"],
      out["Approval Request Notes"], // legacy column name
    ]) || "";
  out._issueDescription =
    firstTruthy([out["Issue Description"], out["Description"]]) || "";
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

// If a caller sends an input key whose column doesn't exist on the sheet but
// a known alias does, route to the alias. Keeps callers blissfully unaware
// of column-name drift in Smartsheet.
const WRITE_ALIASES = {
  "Approval Notes": ["Approval Notes", "Approval Request Notes"],
  "Approval Request Notes": ["Approval Request Notes", "Approval Notes"],
};

function resolveWriteColumn(title, columnMap) {
  if (columnMap[title]) return columnMap[title];
  const aliases = WRITE_ALIASES[title];
  if (!aliases) return null;
  for (const a of aliases) {
    if (columnMap[a]) return columnMap[a];
  }
  return null;
}

function cellsFromInput(input, columnMap) {
  const cells = [];
  for (const [title, value] of Object.entries(input)) {
    const columnId = resolveWriteColumn(title, columnMap);
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
  // New tickets always start in "Received" — never trust the client.
  const cleaned = { ...input, Status: "Received" };
  const cells = cellsFromInput(cleaned, cols);
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

  // Work on a sanitized copy so we can mutate before sending.
  const cleaned = { ...input };

  // ---- Status change validation ---------------------------------------------
  if (cleaned.Status !== undefined) {
    const newStatus = String(cleaned.Status).trim();
    if (!STATUSES_VALID.has(newStatus)) {
      return { error: `invalid status: ${newStatus}`, status: 400 };
    }
    const allowed = allowedStatusesForRole(user.role);
    if (!allowed.has(newStatus)) {
      return {
        error: `your role (${user.role}) cannot set status to "${newStatus}"`,
        status: 403,
      };
    }
    // Approve / Reject require approver-of-this-tier. Approval Notes were
    // written at request time by whoever submitted the approval — approvers
    // don't add notes, they just decide.
    if (newStatus === "Approved" || newStatus === "Rejected - See Notes") {
      const approvalLevel =
        cleaned["Approval Level"] !== undefined
          ? cleaned["Approval Level"]
          : existing._approvalLevel;
      if (!canApproveRow(user.role, approvalLevel)) {
        return {
          error: "your role cannot approve this approval tier",
          status: 403,
        };
      }
    }
    // Closing a ticket requires Notes (≥3 chars), per legacy close-protection.
    if (newStatus === "Closed") {
      const notesNow =
        cleaned["Notes"] !== undefined ? cleaned["Notes"] : existing["Notes"];
      if (String(notesNow ?? "").trim().length < 3) {
        return { error: "Notes are required before closing a ticket.", status: 400 };
      }
    }
  }

  // ---- Approval-request validation (any role can trigger) ------------------
  // When a caller is filling in Approval Level for the first time, we treat
  // that as "submitting an approval request" and require:
  //   - Approval Notes (the requester's description)
  //   - A Quote URL (uploaded via /action=upload before this call OR present)
  // The status auto-bumps to "Pending Approval" so Smartsheet automation
  // routes the alert.
  const submittingApproval =
    cleaned["Approval Level"] !== undefined &&
    String(cleaned["Approval Level"] || "").trim() !== "" &&
    String(existing._approvalLevel || "").trim() === "";
  if (submittingApproval) {
    const notesRaw =
      cleaned["Approval Notes"] !== undefined
        ? cleaned["Approval Notes"]
        : existing._approvalNotes;
    if (String(notesRaw ?? "").trim().length < 3) {
      return {
        error: "Approval Notes are required when submitting an approval request.",
        status: 400,
      };
    }
    const quoteUrl =
      cleaned["Quote URL"] !== undefined
        ? cleaned["Quote URL"]
        : existing["Quote URL"];
    if (!String(quoteUrl ?? "").trim()) {
      return {
        error: "A vendor quote attachment is required when submitting an approval request.",
        status: 400,
      };
    }
    // Auto-bump Status to Pending Approval if the caller didn't pick one.
    if (cleaned.Status === undefined) cleaned.Status = "Pending Approval";
  }

  const cells = cellsFromInput(cleaned, cols);
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
// Env-var diagnostics (used by ?action=env-check)
// ----------------------------------------------------------------------------

function fingerprint(value) {
  if (value == null) return { present: false };
  const s = String(value);
  return {
    present: true,
    length: s.length,
    head: s.slice(0, 12),
    tail: s.slice(-4),
  };
}

function googleCredsHealth() {
  if (!GOOGLE_CREDS) return { present: false };
  try {
    const obj = JSON.parse(GOOGLE_CREDS);
    return {
      present: true,
      parses: true,
      type: obj.type ?? null,
      hasClientEmail: typeof obj.client_email === "string" && obj.client_email.length > 0,
      hasPrivateKey: typeof obj.private_key === "string" && obj.private_key.length > 0,
      privateKeyLooksOk:
        typeof obj.private_key === "string" &&
        obj.private_key.includes("BEGIN PRIVATE KEY") &&
        obj.private_key.includes("END PRIVATE KEY"),
    };
  } catch (e) {
    return {
      present: true,
      parses: false,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
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
      // Diagnostic — returns sanitized env-var fingerprints. Lets us tell
      // whether a deploy context is missing a value or has a malformed one
      // without leaking secrets. Admin-only so we don't expose it broadly.
      if (action === "env-check") {
        if (user.role !== "admin") return respond(403, { error: "admin only" });
        return respond(200, {
          context: process.env.CONTEXT || "(unset)",
          deployId: process.env.DEPLOY_ID || "(unset)",
          vars: {
            VITE_SUPABASE_URL: fingerprint(SUPABASE_URL),
            SUPABASE_SERVICE_ROLE_KEY: fingerprint(SERVICE_KEY),
            SMARTSHEET_TOKEN: fingerprint(SMARTSHEET_TOKEN),
            SMARTSHEET_SHEET_ID: fingerprint(SHEET_ID),
            VENDOR_SHEET_ID: fingerprint(VENDOR_SHEET_ID),
            VIDEO_FOLDER_ID: fingerprint(VIDEO_FOLDER_ID),
            GOOGLE_SERVICE_ACCOUNT_JSON: fingerprint(GOOGLE_CREDS),
          },
          googleCreds: googleCredsHealth(),
        });
      }
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
        meta: {
          statusOrder: STATUSES_ORDER,
          allowedStatusChanges: [...allowedStatusesForRole(user.role)],
          isApprover: isApproverRole(user.role),
        },
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
