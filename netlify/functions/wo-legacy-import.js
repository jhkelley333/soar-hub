// netlify/functions/wo-legacy-import.js
//
// One-way port of Work Orders V1 (Smartsheet) → Work Orders V2 (Supabase
// `tickets` table). Admin-only. Idempotent on tickets.legacy_smartsheet_row_id.
//
// Two actions:
//   POST ?action=preview    → returns a dry-run summary (counts + sample
//                             mapped rows + unmapped values flagged)
//   POST ?action=execute    → actually inserts the rows
//
// Filter:
//   * `_submittedDate >= now() - 30 days`  (default, configurable per call)
//   * Optional `windowDays` override in the POST body for re-runs
//
// Idempotency:
//   * Each Smartsheet row has a stable numeric id. We stash that on
//     tickets.legacy_smartsheet_row_id. The unique partial index in
//     migration 0053 enforces one ticket per legacy row. Re-running
//     `execute` skips rows that already imported.
//
// Vendor matching:
//   * Lowercase + trim + strip common punctuation, then exact-match
//     against vendors.name. No match → store legacy text in
//     vendor_name, leave vendor_id null. Unmatched names show up in
//     the preview so admins can clean them up before re-running.
//
// Status mapping table — keep this in sync with the docs in the PR
// body.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMARTSHEET_TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_ID = process.env.SMARTSHEET_SHEET_ID;
const SS_BASE = "https://api.smartsheet.com/2.0";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function getCallerProfile(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// ── Smartsheet read ──

async function loadSheet() {
  if (!SMARTSHEET_TOKEN || !SHEET_ID) {
    throw new Error("Smartsheet env vars not configured.");
  }
  const r = await fetch(`${SS_BASE}/sheets/${SHEET_ID}`, {
    headers: { Authorization: `Bearer ${SMARTSHEET_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Smartsheet ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function flattenRow(row, columns) {
  const out = {
    _row_id: String(row.id),
    _modifiedAt: row.modifiedAt,
    _createdAt: row.createdAt,
  };
  for (const col of columns) {
    const cell = row.cells?.find((c) => c.columnId === col.id);
    out[col.title] = cell?.displayValue ?? cell?.value ?? null;
  }
  return out;
}

function firstTruthy(values) {
  for (const v of values) if (v != null && v !== "") return v;
  return null;
}

// ── Status + pause mapping ──
// Old Smartsheet → V2 (status, pause_state, approval_status_override)
const STATUS_MAP = {
  "Received":                 { status: "submitted",   pause: "none",                  approval: null },
  "Scheduled":                { status: "scheduled",   pause: "none",                  approval: null },
  "In Progress":              { status: "in_progress", pause: "none",                  approval: null },
  "On Hold":                  { status: "in_progress", pause: "on_hold",               approval: null },
  "Part on Order":            { status: "in_progress", pause: "awaiting_parts",        approval: null },
  "New Equipment Ordered":    { status: "in_progress", pause: "awaiting_replacement",  approval: null },
  "Pending Approval":         { status: "submitted",   pause: "none",                  approval: "Pending" },
  "Approved":                 { status: "in_progress", pause: "none",                  approval: "Approved" },
  "Rejected - See Notes":     { status: "cancelled",   pause: "none",                  approval: "Rejected" },
  "Closed":                   { status: "closed",      pause: "none",                  approval: null },
  // Legacy values that pre-date STATUSES_ORDER. Best-effort.
  "Open":                     { status: "submitted",   pause: "none",                  approval: null },
  "Awaiting Approval":        { status: "submitted",   pause: "none",                  approval: "Pending" },
  "Completed":                { status: "completed",   pause: "none",                  approval: null },
  "Cancelled":                { status: "cancelled",   pause: "none",                  approval: null },
};

function mapStatus(raw) {
  const s = String(raw || "").trim();
  return STATUS_MAP[s] || { status: "submitted", pause: "none", approval: null, unmapped: s || "(blank)" };
}

// ── Vendor matching ──
function normalizeVendor(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,'"&]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(llc|inc|co|corp|corporation|company|ltd)\b/g, "")
    .trim();
}

async function buildVendorIndex(supabase) {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("is_active", true);
  if (error) throw error;
  const idx = new Map();
  for (const v of data || []) {
    idx.set(normalizeVendor(v.name), { id: v.id, name: v.name });
  }
  return idx;
}

// ── Store lookup ──
// `stores` doesn't carry do_email / sdo_email / email columns — those
// are recorded on the ticket itself at submit time in the v2-native
// flow. For imported tickets we leave them blank; routing emails are
// resolved at notify time from the org tree if needed.
async function buildStoreIndex(supabase) {
  const { data, error } = await supabase
    .from("stores")
    .select("id, number, name");
  if (error) throw error;
  const idx = new Map();
  for (const s of data || []) {
    idx.set(String(s.number), s);
  }
  return idx;
}

// ── Build a candidate ticket row from a flattened Smartsheet row ──
function buildCandidate(flat, { vendorIndex, storeIndex }) {
  const submittedDateRaw = firstTruthy([
    flat["Date Submitted"], flat["Created"], flat["Submit Date"],
    flat["Date Created"], flat._createdAt,
  ]);
  const submittedDate = submittedDateRaw ? new Date(submittedDateRaw) : null;

  const submittedBy = firstTruthy([
    flat["Submitted By"], flat["Submitted by"], flat["Submitter"],
    flat["Created By"], flat["Submitted By Email"],
  ]) || "Legacy import";

  const issueDescription = firstTruthy([
    flat["Issue Description"], flat["Description"],
  ]) || "";

  const storeNumber = String(flat["Store Number"] || "").trim();
  const store = storeIndex.get(storeNumber);

  const statusInfo = mapStatus(flat["Status"]);
  const closedAt = statusInfo.status === "closed" || statusInfo.status === "completed"
    ? firstTruthy([flat["Date Closed"], flat["Closed Date"], flat["Date Completed"], flat._modifiedAt])
    : null;

  const vendorRawName = String(flat["Vendor"] || flat["Vendor Name"] || "").trim();
  let vendorMatch = null;
  if (vendorRawName) {
    vendorMatch = vendorIndex.get(normalizeVendor(vendorRawName)) || null;
  }

  const approvalLevel = firstTruthy([flat["Approval Level"], flat["Approval"]]) || null;
  const approvalNotes = firstTruthy([
    flat["Approval Notes"], flat["Approval Request Notes"],
  ]) || null;
  const quoteUrl = firstTruthy([flat["Quote URL"], flat["Quote Url"]]) || null;
  const notes = firstTruthy([flat["Notes"], flat["Latest Comment"]]) || null;
  const costRaw = firstTruthy([flat["Cost Estimate"], flat["Estimated Cost"], flat["Cost"]]);
  const costEstimate = costRaw != null && costRaw !== ""
    ? Number(String(costRaw).replace(/[^0-9.\-]/g, ""))
    : null;

  return {
    legacy_smartsheet_row_id: flat._row_id,
    submittedDate,
    submittedBy,
    storeNumber,
    store,
    storeFound: !!store,
    issueDescription,
    hasDescription: !!issueDescription,
    statusInfo,
    closedAt,
    vendorRawName,
    vendorMatch,
    category:   firstTruthy([flat["Category"], flat["Issue Category"]]) || null,
    assetType:  firstTruthy([flat["Asset Type"], flat["Equipment"], flat["Equipment Type"]]) || null,
    priority:   firstTruthy([flat["Priority"]]) || "Standard",
    modelNumber: firstTruthy([flat["Model Number"], flat["Model"]]) || null,
    approvalLevel,
    approvalNotes,
    quoteUrl,
    notes,
    costEstimate: Number.isFinite(costEstimate) ? costEstimate : null,
  };
}

// ── Convert candidate → insertable ticket row ──
function candidateToTicket(c, woNumber) {
  const closed = c.statusInfo.status === "closed" || c.statusInfo.status === "completed";
  return {
    wo_number:               woNumber,
    store_number:            c.storeNumber,
    store_name:              c.store?.name || "",
    store_email:             "",
    do_email:                "",
    sdo_email:               "",
    submitted_by:            c.submittedBy,
    submitted_by_user_id:    null,
    category:                c.category || "",
    asset_type:              c.assetType || "",
    model_number:            c.modelNumber || "",
    issue_description:       c.issueDescription,
    status:                  c.statusInfo.status,
    pause_state:             c.statusInfo.pause,
    priority:                c.priority,
    is_business_critical:    false,
    troubleshooting_checked: true,
    vendor_contacted:        !!c.vendorMatch || !!c.vendorRawName,
    vendor_id:               c.vendorMatch?.id || null,
    vendor_name:             c.vendorMatch?.name || c.vendorRawName || "",
    cost_estimate:           c.costEstimate,
    approval_level:          c.approvalLevel || null,
    approval_request_notes:  c.approvalNotes || null,
    approval_status:         c.statusInfo.approval || "None",
    latest_comment:          c.notes || null,
    date_submitted:          c.submittedDate ? c.submittedDate.toISOString() : new Date().toISOString(),
    date_status_updated:     new Date().toISOString(),
    date_completed:          closed && c.closedAt ? new Date(c.closedAt).toISOString() : null,
    legacy_smartsheet_row_id: c.legacy_smartsheet_row_id,
  };
}

// ── WO number generator (reuses the same RPC as native creates) ──
async function nextWONumber(supabase, storeNumber) {
  const { data, error } = await supabase.rpc("next_wo_sequence", {
    p_store: String(storeNumber),
  });
  if (!error && typeof data === "number") {
    return `WO-${storeNumber}-${String(data).padStart(3, "0")}`;
  }
  // Fallback if RPC missing.
  const { data: seq } = await supabase
    .from("wo_sequences")
    .select("last_sequence")
    .eq("store_number", String(storeNumber))
    .single();
  const next = ((seq && seq.last_sequence) || 0) + 1;
  await supabase.from("wo_sequences").upsert({
    store_number: String(storeNumber),
    last_sequence: next,
  });
  return `WO-${storeNumber}-${String(next).padStart(3, "0")}`;
}

// ── Main: gather + classify rows ──
async function gather(supabase, { windowDays = 30 } = {}) {
  const sheet = await loadSheet();
  const cols = sheet.columns;
  const flat = (sheet.rows || []).map((r) => flattenRow(r, cols));

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);

  const vendorIndex = await buildVendorIndex(supabase);
  const storeIndex = await buildStoreIndex(supabase);

  // Already-imported set so we can flag the preview.
  const { data: existingRows } = await supabase
    .from("tickets")
    .select("legacy_smartsheet_row_id")
    .not("legacy_smartsheet_row_id", "is", null);
  const alreadyImported = new Set(
    (existingRows || []).map((r) => r.legacy_smartsheet_row_id),
  );

  const inWindow = [];
  const outOfWindow = [];
  const noDate = [];
  for (const f of flat) {
    const c = buildCandidate(f, { vendorIndex, storeIndex });
    if (!c.submittedDate || isNaN(c.submittedDate.getTime())) {
      noDate.push(c);
      continue;
    }
    if (c.submittedDate >= cutoff) inWindow.push(c);
    else outOfWindow.push(c);
  }

  const ready = [];
  const skipped = [];
  for (const c of inWindow) {
    if (alreadyImported.has(c.legacy_smartsheet_row_id)) {
      skipped.push({ ...c, _skip_reason: "already_imported" });
      continue;
    }
    if (!c.storeFound) {
      skipped.push({ ...c, _skip_reason: "unknown_store" });
      continue;
    }
    if (!c.hasDescription) {
      skipped.push({ ...c, _skip_reason: "no_description" });
      continue;
    }
    ready.push(c);
  }

  return {
    cutoff: cutoff.toISOString(),
    windowDays,
    total_rows: flat.length,
    in_window_count: inWindow.length,
    out_of_window_count: outOfWindow.length,
    no_date_count: noDate.length,
    ready,
    skipped,
  };
}

// ── Preview summary (small payload) ──
function summarize(gathered) {
  const ready = gathered.ready;
  const skipped = gathered.skipped;
  const unmappedStatuses = new Map();
  const unmatchedVendors = new Map();
  const statusCounts = new Map();
  for (const c of ready) {
    statusCounts.set(c.statusInfo.status, (statusCounts.get(c.statusInfo.status) || 0) + 1);
    if (c.statusInfo.unmapped) {
      unmappedStatuses.set(c.statusInfo.unmapped, (unmappedStatuses.get(c.statusInfo.unmapped) || 0) + 1);
    }
    if (c.vendorRawName && !c.vendorMatch) {
      unmatchedVendors.set(c.vendorRawName, (unmatchedVendors.get(c.vendorRawName) || 0) + 1);
    }
  }
  const skipReasonCounts = new Map();
  for (const c of skipped) {
    skipReasonCounts.set(c._skip_reason, (skipReasonCounts.get(c._skip_reason) || 0) + 1);
  }
  return {
    cutoff: gathered.cutoff,
    windowDays: gathered.windowDays,
    total_smartsheet_rows: gathered.total_rows,
    in_window: gathered.in_window_count,
    ready_to_import: ready.length,
    will_skip: skipped.length,
    skip_reasons: Object.fromEntries(skipReasonCounts),
    status_breakdown: Object.fromEntries(statusCounts),
    unmapped_smartsheet_statuses: Object.fromEntries(unmappedStatuses),
    unmatched_vendors: Object.fromEntries(unmatchedVendors),
    sample_ready: ready.slice(0, 10).map((c) => ({
      legacy_row: c.legacy_smartsheet_row_id,
      store: `#${c.storeNumber}${c.store ? ` ${c.store.name || ""}` : " (unknown)"}`,
      submitted: c.submittedDate?.toISOString(),
      submitted_by: c.submittedBy,
      raw_status: c.statusInfo.unmapped || "—",
      mapped_status: c.statusInfo.status,
      pause_state: c.statusInfo.pause,
      approval: c.statusInfo.approval || "—",
      vendor: c.vendorMatch?.name || c.vendorRawName || "—",
      vendor_matched: !!c.vendorMatch,
      description: (c.issueDescription || "").slice(0, 120),
    })),
    sample_skipped: skipped.slice(0, 10).map((c) => ({
      legacy_row: c.legacy_smartsheet_row_id,
      store: `#${c.storeNumber}`,
      reason: c._skip_reason,
      submitted: c.submittedDate?.toISOString() || "—",
    })),
  };
}

// ── Execute import ──
async function executeImport(supabase, gathered) {
  const inserted = [];
  const failed = [];
  for (const c of gathered.ready) {
    try {
      const woNumber = await nextWONumber(supabase, c.storeNumber);
      const row = candidateToTicket(c, woNumber);
      const { data: ticket, error } = await supabase
        .from("tickets")
        .insert(row)
        .select("id, wo_number, store_number, status")
        .single();
      if (error) {
        // Could be a unique-violation if another concurrent run grabbed
        // this legacy row first. Treat as skipped.
        failed.push({ legacy_row: c.legacy_smartsheet_row_id, reason: error.message });
        continue;
      }
      // Seed an activity row so the new ticket has at least one entry
      // in its timeline showing where it came from.
      await supabase.from("ticket_activities").insert({
        ticket_id: ticket.id,
        user_id: null,
        user_name: "Legacy import",
        user_role: "system",
        update_type: "created",
        new_value: row.status,
        notes: `Imported from Smartsheet legacy row ${c.legacy_smartsheet_row_id}.`,
        event_type: "ticket_created",
        event_data: {
          initial_status: row.status,
          wo_number: woNumber,
          source: "legacy_smartsheet",
          legacy_row_id: c.legacy_smartsheet_row_id,
        },
        visibility: "all",
      });
      inserted.push({
        legacy_row: c.legacy_smartsheet_row_id,
        wo_number: ticket.wo_number,
        store: ticket.store_number,
        status: ticket.status,
      });
    } catch (e) {
      failed.push({ legacy_row: c.legacy_smartsheet_row_id, reason: e?.message || "insert error" });
    }
  }
  return { inserted, failed };
}

// ── Handler ──
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    const profile = await getCallerProfile(event);
    if (!profile) return respond(401, { ok: false, message: "Sign in required." });
    const role = String(profile.role || "").toLowerCase();
    if (role !== "admin") {
      return respond(403, { ok: false, message: "Admin only." });
    }

    const supabase = admin();
    const action = (event.queryStringParameters || {}).action || "preview";
    const body = event.body ? JSON.parse(event.body) : {};
    const windowDays = Math.max(1, parseInt(body.windowDays, 10) || 30);

    if (action === "preview") {
      const gathered = await gather(supabase, { windowDays });
      return respond(200, { ok: true, preview: summarize(gathered) });
    }

    if (action === "execute") {
      const gathered = await gather(supabase, { windowDays });
      const result = await executeImport(supabase, gathered);
      return respond(200, {
        ok: true,
        summary: summarize(gathered),
        inserted_count: result.inserted.length,
        failed_count: result.failed.length,
        inserted: result.inserted,
        failed: result.failed,
      });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[wo-legacy-import] error:", err);
    return respond(500, { ok: false, message: err?.message || "Internal error." });
  }
};
