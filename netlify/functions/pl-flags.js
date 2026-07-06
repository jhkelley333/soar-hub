// netlify/functions/pl-flags.js
//
// P&L walkthrough flags — read from the monthly Google Sheet, notes written
// back to its column N (and saved to pl_flag_notes as the system of record,
// since the sheet is replaced each period). Actions:
//   GET  ?action=flags[&store=N]  -> parsed flags, scope-filtered to the
//                                    caller's visible stores
//   GET  ?action=dry              -> admin parse diagnostic (structure counts
//                                    + samples, no scope filter, no writes)
//   POST ?action=note             -> save a note: upsert pl_flag_notes +
//                                    write sheet column N (row re-verified
//                                    against store/category/item first, so a
//                                    shifted sheet can never take the wrong
//                                    note)
//
// Sheet layout (verified against the P6 walkthrough): a title row carrying
// "Period Ending <date>", a header row (Store # / Store Name / GM / Sales /
// CI % / CI $ / Category / Item / <value> / Note / prior periods / Notes),
// then store rows (numeric Store # in col B) each followed by that store's
// flag rows (Category in col H, Store # empty). Parsing keys on that shape,
// not on the ▼/⚠ marker glyphs.
//
// Requires the service account to be shared as EDITOR on the sheet — reads
// work with viewer access, but column-N writes need edit rights.

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleCredentials } from "./_lib/googleCreds.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SHEET_ID =
  process.env.PL_FLAGS_SHEET_ID || "1UsamgxZBIwtbiQqRJkDCi6JVu1tmGGcztrhz6s0BZ5M";
const SHEET_RANGE = process.env.PL_FLAGS_SHEET_RANGE || "A1:N2000";
const NOTES_COL = "N";

const ORG_WIDE = new Set(["admin", "vp", "coo", "payroll", "accounting"]);
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll", "accounting", "fbc"]);
// Who can write notes — GMs and DOs per the spec, plus the tiers above them.
const NOTE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("pl-flags env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
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

async function callerVisibleStoreNumbers(supa, user) {
  if (ORG_WIDE.has(user.role) || user.role === "fbc") {
    const { data } = await supa.from("stores").select("number").eq("is_active", true);
    return new Set((data ?? []).map((s) => String(s.number)));
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return new Set();
  const { data } = await supa.from("stores").select("number").in("id", ids);
  return new Set((data ?? []).map((s) => String(s.number)));
}

// Full-access Sheets client (writes need it; reads work too).
async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: await getGoogleCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const cell = (row, i) => String(row?.[i] ?? "").trim();
const isStoreNum = (v) => /^\d{3,6}$/.test(v);

// Parse the walkthrough sheet into { period_end, stores: [{store_number,
// store_name, gm, sales, ci_pct, ci_amount, flags: [...] }] }. Each flag
// carries its 1-based sheet row for the write-back.
function parseFlagsSheet(rows) {
  let periodEnd = null;
  let headerIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const a = cell(rows[r], 0);
    const m = /period ending\s+(?:\w+,\s*)?(.+?)\s*$/i.exec(a);
    if (m && !periodEnd) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) {
        periodEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
    const rowText = (rows[r] ?? []).map((c) => String(c ?? "").toLowerCase());
    if (headerIdx < 0 && rowText.includes("store #") && rowText.includes("category")) headerIdx = r;
  }
  if (headerIdx < 0) throw new Error('Couldn\'t find the header row ("Store #" + "Category") in the flags sheet.');

  // Column indexes from the header row (defensive against column drift).
  const header = (rows[headerIdx] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const col = (needle, fallback) => {
    const i = header.findIndex((h) => h === needle || h.startsWith(needle));
    return i >= 0 ? i : fallback;
  };
  const C = {
    store: col("store #", 1),
    name: col("store name", 2),
    gm: col("gm", 3),
    sales: col("sales", 4),
    ciPct: col("ci %", 5),
    ciAmt: col("ci $", 6),
    category: col("category", 7),
    item: col("item", 8),
    value: col("jun value", 9) >= 0 ? col("jun value", 9) : 9,
    rule: col("note", 10),
    prior1: 11,
    prior2: 12,
    notes: 13, // column N
  };

  const stores = [];
  const byNumber = new Map();
  let current = null;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const storeNum = cell(row, C.store);
    // "Top CI:" / "Bottom CI:" summary rows inside each DO block ALSO carry
    // a store number in the Store # column — they are highlights, not store
    // rows, and treating them as stores shadowed the real row (the app
    // then served the flagless duplicate first). Skip them outright.
    const isSummaryRow = /\b(top|bottom)\s*ci\b/i.test(cell(row, 0));
    if (isSummaryRow) continue;
    if (isStoreNum(storeNum)) {
      // Belt & suspenders: if a number somehow repeats, merge into the
      // existing entry instead of creating a shadow duplicate.
      const existing = byNumber.get(storeNum);
      if (existing) {
        current = existing;
        continue;
      }
      current = {
        store_number: storeNum,
        store_name: cell(row, C.name) || null,
        gm: cell(row, C.gm) || null,
        sales: cell(row, C.sales) || null,
        ci_pct: cell(row, C.ciPct) || null,
        ci_amount: cell(row, C.ciAmt) || null,
        flags: [],
      };
      byNumber.set(storeNum, current);
      stores.push(current);
      continue;
    }
    const category = cell(row, C.category);
    if (current && category) {
      current.flags.push({
        sheet_row: r + 1, // 1-based for A1 notation
        category,
        item: cell(row, C.item) || null,
        value: cell(row, C.value) || null,
        rule: cell(row, C.rule) || null,
        prior_1: cell(row, C.prior1) || null,
        prior_2: cell(row, C.prior2) || null,
        sheet_note: cell(row, C.notes) || null,
      });
    }
  }

  return { period_end: periodEnd, header_row: headerIdx + 1, stores: stores.filter((s) => s.flags.length || true) };
}

async function readSheet() {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });
  return res.data.values ?? [];
}

async function listFlags(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const rows = await readSheet();
  const parsed = parseFlagsSheet(rows);

  const visible = await callerVisibleStoreNumbers(supa, user);
  let stores = parsed.stores.filter((s) => visible.has(s.store_number));
  const storeFilter = String(params.store || "").trim();
  if (storeFilter) stores = stores.filter((s) => s.store_number === storeFilter);

  // Overlay app-saved notes (the system of record) — the sheet's column N
  // may lag or be blank if a write failed.
  if (parsed.period_end && stores.length) {
    const { data: notes } = await supa
      .from("pl_flag_notes")
      .select("store_number, category, item, note, noted_by_name, updated_at")
      .eq("period_end", parsed.period_end)
      .in("store_number", stores.map((s) => s.store_number));
    const key = (sn, c, i) => `${sn}|${c}|${i ?? ""}`;
    const byKey = new Map((notes ?? []).map((n) => [key(n.store_number, n.category, n.item), n]));
    for (const s of stores) {
      for (const f of s.flags) {
        const n = byKey.get(key(s.store_number, f.category, f.item));
        if (n) {
          f.note = n.note;
          f.noted_by = n.noted_by_name;
          f.noted_at = n.updated_at;
        } else if (f.sheet_note) {
          f.note = f.sheet_note;
        }
      }
    }
  }

  return { period_end: parsed.period_end, stores };
}

// Admin diagnostic — structure counts + a sample, unfiltered, no writes.
async function dryRun(user) {
  if (user.role !== "admin") return { error: "not authorized", status: 403 };
  const rows = await readSheet();
  const parsed = parseFlagsSheet(rows);
  return {
    period_end: parsed.period_end,
    header_row: parsed.header_row,
    store_count: parsed.stores.length,
    flag_count: parsed.stores.reduce((t, s) => t + s.flags.length, 0),
    sample: parsed.stores.slice(0, 2),
  };
}

async function saveNote(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(body?.store_number || "").trim();
  const category = String(body?.category || "").trim();
  const item = String(body?.item || "").trim();
  const note = String(body?.note || "").trim();
  const sheetRow = Number(body?.sheet_row);
  const periodEnd = String(body?.period_end || "").trim();
  if (!storeNumber || !category || !note || !periodEnd) {
    return { error: "store_number, category, period_end and note are required.", status: 400 };
  }
  if (note.length > 1000) return { error: "Note is too long (1000 chars max).", status: 400 };

  // Scope: the store must be visible to the caller.
  const visible = await callerVisibleStoreNumbers(supa, user);
  if (!visible.has(storeNumber)) return { error: "Store is outside your scope.", status: 403 };

  const name = user.preferred_name || user.full_name || user.email;
  const now = new Date().toISOString();

  // 1) System of record first — survives the monthly sheet replacement.
  const { error: dbErr } = await supa.from("pl_flag_notes").upsert(
    {
      period_end: periodEnd,
      store_number: storeNumber,
      category,
      item: item || "",
      note,
      sheet_row: Number.isFinite(sheetRow) ? sheetRow : null,
      noted_by: user.id,
      noted_by_name: name,
      updated_at: now,
    },
    { onConflict: "period_end,store_number,category,item" },
  );
  if (dbErr) return { error: dbErr.message, status: 500 };

  // 2) Best-effort sheet write-back to column N. The row is re-verified
  // against the flag's category/item (and the owning store above it) so a
  // sheet that shifted since the read can never take the wrong note.
  let sheetWritten = false;
  let sheetReason = null;
  if (Number.isFinite(sheetRow) && sheetRow > 1) {
    try {
      const rows = await readSheet();
      const parsed = parseFlagsSheet(rows);
      let target = null;
      for (const s of parsed.stores) {
        const f = s.flags.find(
          (x) => x.sheet_row === sheetRow && s.store_number === storeNumber &&
                 x.category === category && (x.item ?? "") === item,
        );
        if (f) { target = f; break; }
      }
      if (!target) {
        // Row moved — find the flag by identity instead.
        const s = parsed.stores.find((x) => x.store_number === storeNumber);
        target = s?.flags.find((x) => x.category === category && (x.item ?? "") === item) ?? null;
      }
      if (!target) {
        sheetReason = "Flag not found on the sheet (it may have been removed) — note saved in the app.";
      } else {
        const sheets = await sheetsClient();
        const noteWithSig = `${note} — ${name}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${NOTES_COL}${target.sheet_row}`,
          valueInputOption: "RAW",
          requestBody: { values: [[noteWithSig]] },
        });
        sheetWritten = true;
      }
    } catch (e) {
      console.warn("[pl-flags] sheet write-back failed", e?.message || e);
      sheetReason =
        /permission|forbidden|403/i.test(String(e?.message))
          ? "The service account doesn't have Editor access on the sheet — note saved in the app only."
          : "Sheet write failed — note saved in the app.";
    }
  }

  return { ok: true, sheet_written: sheetWritten, sheet_reason: sheetReason };
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
  const action = params.action || "";

  const unwrap = (result) => {
    if (result && typeof result === "object" && "status" in result && "error" in result) {
      return respond(result.status, { error: result.error });
    }
    return respond(200, result);
  };

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "flags") return unwrap(await listFlags(supa, user, params));
      if (action === "dry") return unwrap(await dryRun(user));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "note") return unwrap(await saveNote(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    console.error("[pl-flags]", action, e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
