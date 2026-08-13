// Hours of Operation — standard weekly hours + dated special-hours overrides per
// store. Admin-gated (System Settings tool). Backs the grid (action=list), the
// per-location editor (action=get), and the save paths (save-standard /
// save-special / delete-special). Storage: store_hours + store_special_hours (0281).
import { createClient } from "@supabase/supabase-js";
import { placesConfigured, findPlaceId, fetchPlaceHours, normalizeGoogleHours, compareHours } from "./_lib/places.js";
import { resolveOrg } from "./_lib/kpiOrg.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VIEW_ROLES = new Set(["admin", "vp", "coo", "sdo", "rvp"]); // can open the tool
const ORG_WIDE = new Set(["admin", "vp", "coo"]);                 // see every store
const IMPORT_ROLES = new Set(["admin", "vp", "coo"]);             // bulk import / backfill

// Hours-of-operation sign ordering. The recipient (vendor) + subject + message
// defaults live in ea_settings (key hours_sign_order), editable by IMPORT_ROLES
// from the Sign order settings; each order can override the to/message inline.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "paf@mysoarhub.com";
const RESEND_FROM_NAME = "SOAR Hours of Operation";
const SIGN_SETTINGS_KEY = "hours_sign_order";
const SIGN_DEFAULTS = {
  to: "",
  subject: "Hours of Operation Sign Order — Store {{store}}",
  message: "Order Approved, No Proof Needed. Please ship to the store address below.",
};
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim());

// The store ids a user may act on. ORG_WIDE roles → null (no restriction);
// SDO/RVP → their org scope via user_visible_stores(uid).
async function visibleIds(supa, user) {
  if (ORG_WIDE.has(user.role)) return null;
  const { data } = await supa.rpc("user_visible_stores", { uid: user.id });
  return new Set((data ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean));
}
const inScope = (scope, id) => scope == null || scope.has(id);

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const { data: { user } = {} } = await supa.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase() } : null;
}

// "07:00" / "07:00:00" -> "07:00" ; blank -> null. Guards a valid HH:MM.
function normTime(v) {
  if (v == null) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  if (!m) return null;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : null); // DB "time" -> "HH:MM"

const RECON_SYSTEMS = new Set(["system", "rap", "itsacheckmate", "google", "sign"]);

// Shape a hours_reconciliation row for the client (defaults when none exists).
function reconOut(rec) {
  return {
    exists: !!rec,
    status: rec?.status || "open",
    wrong_systems: Array.isArray(rec?.wrong_systems) ? rec.wrong_systems : [],
    action_taken: rec?.action_taken || "",
    itsacheckmate_update_needed: !!rec?.itsacheckmate_update_needed,
    itsacheckmate_done: !!rec?.itsacheckmate_done,
    sign_order_needed: !!rec?.sign_order_needed,
    sign_ordered: !!rec?.sign_ordered,
    reviewed_by: rec?.reviewed_by || null,
    reviewed_at: rec?.reviewed_at || null,
  };
}

// Reconciliation flag summaries for the grid (best-effort: [] if table absent).
async function reconSummaries(supa, ids) {
  return selectAll(() => supa.from("hours_reconciliation")
    .select("store_id, status, itsacheckmate_update_needed, itsacheckmate_done, sign_order_needed, sign_ordered")
    .in("store_id", ids));
}

// Fetch every row of a query, paging past PostgREST's 1000-row cap. `make` must
// return a fresh query builder each call. Without this the grid's store_hours
// read truncated at ~1000 rows (~143 stores) even though all hours were stored.
async function selectAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ── Sign-order email ─────────────────────────────────────────────────────────
async function getSignSettings(supa) {
  let v = {};
  try {
    const { data } = await supa.from("ea_settings").select("value").eq("key", SIGN_SETTINGS_KEY).maybeSingle();
    v = data?.value || {};
  } catch { /* ea_settings may be absent → defaults */ }
  return {
    to: typeof v.to === "string" ? v.to : SIGN_DEFAULTS.to,
    subject: typeof v.subject === "string" && v.subject.trim() ? v.subject : SIGN_DEFAULTS.subject,
    message: typeof v.message === "string" && v.message.trim() ? v.message : SIGN_DEFAULTS.message,
  };
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function to12h(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
  if (!m) return "";
  let h = Number(m[1]); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
function dayLine(d) {
  if (!d || d.is_closed) return "Closed";
  if (!d.open || !d.close) return "—";
  return `${to12h(d.open)} – ${to12h(d.close)}`; // en dash
}
// daysArr: length-7 (index = day_of_week, 0=Mon) of {is_closed, open, close}|null.
function buildHoursLines(daysArr) {
  return DAY_NAMES.map((day, dow) => ({ day, val: dayLine(daysArr[dow]) }));
}
const escHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function buildSignEmailHtml({ message, shipName, addrLines, hoursLines, hasImage }) {
  const rows = hoursLines
    .map((l) => `<tr><td style="padding:2px 16px 2px 0;color:#555;">${escHtml(l.day)}</td><td style="padding:2px 0;font-weight:600;">${escHtml(l.val)}</td></tr>`)
    .join("");
  const addr = addrLines.map(escHtml).join("<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">
  <p style="font-size:15px;font-weight:700;margin:0 0 16px;">${escHtml(message)}</p>
  <p style="margin:0 0 4px;font-weight:700;">Ship to</p>
  <p style="margin:0 0 16px;">${escHtml(shipName)}<br>${addr}</p>
  <p style="margin:0 0 4px;font-weight:700;">Hours for the sign</p>
  <table style="border-collapse:collapse;margin:0 0 16px;">${rows}</table>
  ${hasImage ? `<p style="color:#555;margin:0;">A reference image is attached.</p>` : ""}
</div>`;
}

async function sendSignEmail({ to, subject, html, attachments }) {
  if (!RESEND_API_KEY) return { skipped: true };
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: "no recipient" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: recipients, subject, html,
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) { const detail = await res.text().catch(() => ""); return { ok: false, status: res.status, error: (detail || "").slice(0, 300) }; }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    return { ok: false, error: e?.message || "send failed" };
  }
}

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "store-hours env vars not configured" });
    const supa = admin();
    const user = await sessionUser(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!VIEW_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

    const params = event.queryStringParameters || {};
    const action = params.action || "list";
    // Store ids this user may see/act on (null = all, for ORG_WIDE roles).
    const scope = await visibleIds(supa, user);

    // ── list: every active store + its assembled 7-day standard hours ─────────
    if (event.httpMethod === "GET" && action === "list") {
      const allStores = await selectAll(() => supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active, google_hours, google_hours_checked_at")
        .eq("is_active", true).neq("brand", "little_caesars").order("number", { ascending: true }));
      const stores = allStores.filter((s) => inScope(scope, s.id)); // SDO/RVP → only their stores
      const ids = stores.map((s) => s.id);
      const orgMap = await resolveOrg(supa, stores.map((s) => String(s.number))); // for the SDO view
      const byStore = new Map();
      const specialByStore = new Map();
      const reconByStore = new Map();
      if (ids.length) {
        const today = new Date().toISOString().slice(0, 10);
        const [hrs, sp, recon] = await Promise.all([
          selectAll(() => supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time, updated_at").in("store_id", ids)),
          selectAll(() => supa.from("store_special_hours").select("store_id, special_date").in("store_id", ids).gte("special_date", today)),
          reconSummaries(supa, ids),
        ]);
        for (const r of recon) reconByStore.set(r.store_id, r);
        for (const r of hrs) {
          const arr = byStore.get(r.store_id) || Array(7).fill(null);
          arr[r.day_of_week] = { day_of_week: r.day_of_week, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) };
          byStore.set(r.store_id, arr);
        }
        for (const r of sp) specialByStore.set(r.store_id, (specialByStore.get(r.store_id) || 0) + 1);
      }
      const out = stores.map((s) => {
        const days = byStore.get(s.id) || Array(7).fill(null);
        const configured = days.some((d) => d != null);
        // Google comparison from cache (0282). unchecked until first check;
        // not_found when checked but no listing/hours; else match/mismatch.
        let googleStatus = "unchecked", googleDiffs = 0;
        if (s.google_hours_checked_at) {
          if (!Array.isArray(s.google_hours)) googleStatus = "not_found";
          else { const c = compareHours(days.filter(Boolean), s.google_hours); googleStatus = c.status; googleDiffs = c.diffs.length; }
        }
        const rc = reconByStore.get(s.id) || null;
        return {
          id: s.id, number: String(s.number), name: s.name,
          address: s.address || null, city: s.city || null, state: s.state || null, zip: s.zip || null,
          days, configured, upcoming_special: specialByStore.get(s.id) || 0,
          sdo: orgMap.get(String(s.number))?.sdoName || null,
          google_status: googleStatus, google_diffs: googleDiffs, google_checked_at: s.google_hours_checked_at || null,
          recon_status: rc ? rc.status : null,
          itsacheckmate_open: rc ? (rc.itsacheckmate_update_needed && !rc.itsacheckmate_done) : false,
          sign_open: rc ? (rc.sign_order_needed && !rc.sign_ordered) : false,
        };
      });
      return respond(200, { stores: out, places_configured: placesConfigured(), can_import: IMPORT_ROLES.has(user.role), scoped: scope != null });
    }

    // ── get: one store's standard + special hours (editor) ────────────────────
    if (event.httpMethod === "GET" && action === "get") {
      const storeNumber = String(params.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active, google_place_id, google_hours, google_hours_checked_at")
        .eq("number", storeNumber).neq("brand", "little_caesars").maybeSingle();
      if (!store) return respond(404, { error: "Store not found." });
      if (!inScope(scope, store.id)) return respond(403, { error: "This store isn't in your scope." });
      const [{ data: hrs }, { data: sp }, { data: rec }] = await Promise.all([
        supa.from("store_hours").select("day_of_week, is_closed, open_time, close_time, updated_at").eq("store_id", store.id),
        supa.from("store_special_hours").select("id, special_date, is_closed, open_time, close_time, note").eq("store_id", store.id).order("special_date", { ascending: true }),
        supa.from("hours_reconciliation").select("*").eq("store_id", store.id).maybeSingle(),
      ]);
      const standard = Array.from({ length: 7 }, (_, dow) => {
        const r = (hrs || []).find((h) => h.day_of_week === dow);
        return { day_of_week: dow, is_closed: r?.is_closed ?? false, open: hhmm(r?.open_time), close: hhmm(r?.close_time) };
      });
      const updatedAt = (hrs || []).reduce((mx, h) => (!mx || h.updated_at > mx ? h.updated_at : mx), null);
      const special = (sp || []).map((r) => ({ id: r.id, date: r.special_date, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time), note: r.note || "" }));
      const cmp = store.google_hours_checked_at
        ? (Array.isArray(store.google_hours) ? compareHours(standard, store.google_hours) : { status: "not_found", diffs: [] })
        : { status: "unchecked", diffs: [] };
      let reviewedByName = null;
      if (rec?.reviewed_by) {
        const { data: p } = await supa.from("profiles").select("preferred_name, full_name, email").eq("id", rec.reviewed_by).maybeSingle();
        reviewedByName = p ? (p.preferred_name || p.full_name || p.email || null) : null;
      }
      return respond(200, {
        store: { id: store.id, number: String(store.number), name: store.name, address: store.address, city: store.city, state: store.state, zip: store.zip },
        standard, special, updated_at: updatedAt,
        google: { status: cmp.status, diffs: cmp.diffs, checked_at: store.google_hours_checked_at || null, has_place: !!store.google_place_id, hours: store.google_hours || null, configured: placesConfigured() },
        reconciliation: { ...reconOut(rec), reviewed_by_name: reviewedByName },
      });
    }

    // ── reconciliation-list: worklist of open items (scoped), for the exports ──
    if (event.httpMethod === "GET" && action === "reconciliation-list") {
      const stores = await selectAll(() => supa.from("stores")
        .select("id, number, name, address, city, state, zip").eq("is_active", true).neq("brand", "little_caesars").order("number", { ascending: true }));
      const scoped = stores.filter((s) => inScope(scope, s.id));
      const ids = scoped.map((s) => s.id);
      if (!ids.length) return respond(200, { rows: [] });
      const [recs, hrs] = await Promise.all([
        selectAll(() => supa.from("hours_reconciliation").select("*").in("store_id", ids)),
        selectAll(() => supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time").in("store_id", ids)),
      ]);
      const recByStore = new Map(recs.map((r) => [r.store_id, r]));
      const daysByStore = new Map();
      for (const r of hrs) {
        const arr = daysByStore.get(r.store_id) || Array(7).fill(null);
        arr[r.day_of_week] = { day_of_week: r.day_of_week, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) };
        daysByStore.set(r.store_id, arr);
      }
      const rows = scoped.map((s) => {
        const rc = recByStore.get(s.id) || null;
        return {
          number: String(s.number), name: s.name,
          address: [s.address, s.city, s.state].filter(Boolean).join(", ") + (s.zip ? ` ${s.zip}` : ""),
          status: rc ? rc.status : null,
          wrong_systems: rc?.wrong_systems || [],
          itsacheckmate_open: rc ? (rc.itsacheckmate_update_needed && !rc.itsacheckmate_done) : false,
          sign_open: rc ? (rc.sign_order_needed && !rc.sign_ordered) : false,
          action_taken: rc?.action_taken || "",
          days: daysByStore.get(s.id) || Array(7).fill(null),
        };
      });
      return respond(200, { rows });
    }

    // ── history: change-log of standard hours for one store (newest first) ─────
    if (event.httpMethod === "GET" && action === "history") {
      const storeNumber = String(params.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name").eq("number", storeNumber).neq("brand", "little_caesars").maybeSingle();
      if (!store) return respond(404, { error: "Store not found." });
      if (!inScope(scope, store.id)) return respond(403, { error: "This store isn't in your scope." });
      const rows = await selectAll(() => supa.from("store_hours_history")
        .select("id, changed_at, changed_by, source, days, note")
        .eq("store_id", store.id).order("changed_at", { ascending: false }).order("id", { ascending: false }));
      const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))];
      const nameById = new Map();
      if (ids.length) {
        const { data: profs } = await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", ids);
        for (const p of profs || []) nameById.set(p.id, p.preferred_name || p.full_name || p.email || "—");
      }
      const history = rows.map((r) => ({
        id: r.id, changed_at: r.changed_at, source: r.source || null, note: r.note || null,
        by: r.changed_by ? (nameById.get(r.changed_by) || "—") : null, days: Array.isArray(r.days) ? r.days : [],
      }));
      return respond(200, { store: { number: String(store.number), name: store.name }, history });
    }

    // ── sign-settings: the default vendor recipient + subject + message ───────
    if (event.httpMethod === "GET" && action === "sign-settings") {
      const settings = await getSignSettings(supa);
      return respond(200, { settings, can_edit: IMPORT_ROLES.has(user.role), email_configured: !!RESEND_API_KEY });
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "method not allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    // ── save-sign-settings: update the default recipient/subject/message ──────
    if (action === "save-sign-settings") {
      if (!IMPORT_ROLES.has(user.role)) return respond(403, { error: "Only Admin / VP / COO can change sign settings." });
      const to = String(body.to ?? "").trim();
      if (to && !isEmail(to)) return respond(400, { error: "Enter a valid recipient email." });
      const subject = String(body.subject ?? "").trim() || SIGN_DEFAULTS.subject;
      const message = String(body.message ?? "").trim() || SIGN_DEFAULTS.message;
      const { error } = await supa.from("ea_settings").upsert({ key: SIGN_SETTINGS_KEY, value: { to, subject, message } }, { onConflict: "key" });
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true, settings: { to, subject, message } });
    }

    // ── order-sign: email the vendor to order a store's hours-of-op sign ──────
    if (action === "order-sign") {
      const storeNumber = String(body.store_number || body.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store_number is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip")
        .eq("number", storeNumber).neq("brand", "little_caesars").maybeSingle();
      if (!store) return respond(404, { error: "Store not found." });
      if (!inScope(scope, store.id)) return respond(403, { error: "This store isn't in your scope." });
      if (!RESEND_API_KEY) return respond(500, { error: "Email isn't configured on the server (RESEND_API_KEY missing)." });

      const settings = await getSignSettings(supa);
      const to = String(body.to ?? settings.to ?? "").trim();
      if (!isEmail(to)) return respond(400, { error: "A valid recipient email is required — set one in Sign order settings or the order form." });
      const subjectTpl = String(body.subject ?? "").trim() || settings.subject;
      const messageTpl = String(body.message ?? "").trim() || settings.message;

      // Assemble the store's standard hours.
      const { data: hrs } = await supa.from("store_hours")
        .select("day_of_week, is_closed, open_time, close_time").eq("store_id", store.id);
      const daysArr = Array(7).fill(null);
      for (const r of hrs || []) daysArr[r.day_of_week] = { is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) };
      const hoursLines = buildHoursLines(daysArr);

      const shipName = `Sonic #${store.number}${store.name ? ` ${store.name}` : ""}`;
      const cityLine = [store.city, store.state].filter(Boolean).join(", ") + (store.zip ? ` ${store.zip}` : "");
      const addrLines = [store.address, cityLine].map((x) => (x || "").trim()).filter(Boolean);
      const fullAddress = [store.address, store.city, store.state].filter(Boolean).join(", ") + (store.zip ? ` ${store.zip}` : "");
      const fill = (t) => String(t)
        .replace(/\{\{store\}\}/g, store.number)
        .replace(/\{\{name\}\}/g, store.name || "")
        .replace(/\{\{address\}\}/g, fullAddress)
        .replace(/\{\{hours\}\}/g, hoursLines.map((l) => `${l.day}: ${l.val}`).join("; "));

      let attachments = [];
      if (body.image && body.image.content) {
        const content = String(body.image.content).replace(/^data:[^;]+;base64,/, "");
        if (content) attachments = [{ filename: String(body.image.name || "sign-reference.png").slice(0, 120), content }];
      }

      const html = buildSignEmailHtml({ message: fill(messageTpl), shipName, addrLines, hoursLines, hasImage: attachments.length > 0 });
      const sent = await sendSignEmail({ to, subject: fill(subjectTpl), html, attachments });
      if (sent.skipped) return respond(500, { error: "Email isn't configured on the server (RESEND_API_KEY missing)." });
      if (!sent.ok) return respond(502, { error: `Email failed: ${sent.error || sent.status || "unknown"}` });

      // Mark the sign ordered on the reconciliation record (best-effort).
      try {
        const now = new Date().toISOString();
        const { data: rec } = await supa.from("hours_reconciliation").select("store_id").eq("store_id", store.id).maybeSingle();
        if (rec) await supa.from("hours_reconciliation").update({ sign_ordered: true, reviewed_by: user.id, reviewed_at: now }).eq("store_id", store.id);
        else await supa.from("hours_reconciliation").insert({ store_id: store.id, status: "in_progress", sign_order_needed: true, sign_ordered: true, reviewed_by: user.id, reviewed_at: now });
      } catch { /* non-fatal */ }

      return respond(200, { ok: true, to, sign_ordered: true });
    }

    // ── save-standard: upsert all 7 weekday rows for a store ──────────────────
    if (action === "save-standard") {
      const storeId = String(body.store_id || "").trim();
      if (!storeId) return respond(400, { error: "store_id is required" });
      if (!inScope(scope, storeId)) return respond(403, { error: "This store isn't in your scope." });
      const days = Array.isArray(body.days) ? body.days : [];
      const rows = [];
      for (let dow = 0; dow < 7; dow++) {
        const d = days.find((x) => Number(x?.day_of_week) === dow) || {};
        const isClosed = !!d.is_closed;
        const open = isClosed ? null : normTime(d.open);
        const close = isClosed ? null : normTime(d.close);
        rows.push({
          store_id: storeId, day_of_week: dow, is_closed: isClosed,
          open_time: open, close_time: close, updated_at: new Date().toISOString(), updated_by: user.id,
        });
      }
      const { error } = await supa.from("store_hours").upsert(rows, { onConflict: "store_id,day_of_week" });
      if (error) {
        if (/store_hours/.test(error.message)) return respond(500, { error: "Run migration 0281 first (store_hours is missing)." });
        return respond(500, { error: error.message });
      }
      await recordHistory(supa, [storeId], user.id, "edit");
      return respond(200, { ok: true, saved: rows.length });
    }

    // ── save-special: upsert one dated override ───────────────────────────────
    if (action === "save-special") {
      const storeId = String(body.store_id || "").trim();
      const date = String(body.date || "").trim();
      if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond(400, { error: "store_id and a valid date are required" });
      if (!inScope(scope, storeId)) return respond(403, { error: "This store isn't in your scope." });
      const isClosed = !!body.is_closed;
      const row = {
        store_id: storeId, special_date: date, is_closed: isClosed,
        open_time: isClosed ? null : normTime(body.open), close_time: isClosed ? null : normTime(body.close),
        note: body.note ? String(body.note).slice(0, 300) : null,
        updated_at: new Date().toISOString(), updated_by: user.id,
      };
      const { error } = await supa.from("store_special_hours").upsert(row, { onConflict: "store_id,special_date" });
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    // ── delete-special ────────────────────────────────────────────────────────
    if (action === "delete-special") {
      const id = String(body.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      if (scope != null) {
        const { data: row } = await supa.from("store_special_hours").select("store_id").eq("id", id).maybeSingle();
        if (row && !inScope(scope, row.store_id)) return respond(403, { error: "This store isn't in your scope." });
      }
      const { error } = await supa.from("store_special_hours").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    // ── save-reconciliation: upsert a store's discrepancy remediation record ──
    if (action === "save-reconciliation") {
      const storeId = String(body.store_id || "").trim();
      if (!storeId) return respond(400, { error: "store_id is required" });
      if (!inScope(scope, storeId)) return respond(403, { error: "This store isn't in your scope." });
      const wrong = Array.isArray(body.wrong_systems) ? [...new Set(body.wrong_systems.map(String).filter((s) => RECON_SYSTEMS.has(s)))] : [];
      const status = ["open", "in_progress", "resolved"].includes(body.status) ? body.status : "open";
      const row = {
        store_id: storeId, status, wrong_systems: wrong,
        action_taken: body.action_taken ? String(body.action_taken).slice(0, 2000) : null,
        itsacheckmate_update_needed: !!body.itsacheckmate_update_needed,
        itsacheckmate_done: !!body.itsacheckmate_done,
        sign_order_needed: !!body.sign_order_needed,
        sign_ordered: !!body.sign_ordered,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      const { error } = await supa.from("hours_reconciliation").upsert(row, { onConflict: "store_id" });
      if (error) {
        if (/hours_reconciliation/.test(error.message)) return respond(500, { error: "Run migration 0284 first (hours_reconciliation is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true });
    }

    // ── bulk-import: seed standard hours from an uploaded spreadsheet ──────────
    // Body: { rows: [{ store_number, days: [{day_of_week, is_closed, open, close}] }] }
    // Only the days present in a row are written; unknown store numbers are
    // reported back, not silently dropped.
    if (action === "bulk-import") {
      if (!IMPORT_ROLES.has(user.role)) return respond(403, { error: "Only Admin / VP / COO can bulk-import hours." });
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return respond(400, { error: "no rows to import" });
      if (rows.length > 5000) return respond(400, { error: "too many rows (max 5000)" });
      const stores = await selectAll(() => supa.from("stores").select("id, number").eq("is_active", true).neq("brand", "little_caesars").order("number", { ascending: true }));
      const idByNumber = new Map(stores.map((s) => [String(s.number), s.id]));
      const upserts = [];
      const errors = [];
      const touched = new Set();
      for (const r of rows) {
        const num = String(r?.store_number ?? "").trim();
        const storeId = idByNumber.get(num);
        if (!storeId) { errors.push({ store_number: num, reason: "unknown or inactive store" }); continue; }
        const days = Array.isArray(r.days) ? r.days : [];
        let any = false;
        for (const d of days) {
          const dow = Number(d?.day_of_week);
          if (!(dow >= 0 && dow <= 6)) continue;
          const isClosed = !!d.is_closed;
          upserts.push({
            store_id: storeId, day_of_week: dow, is_closed: isClosed,
            open_time: isClosed ? null : normTime(d.open), close_time: isClosed ? null : normTime(d.close),
            updated_at: new Date().toISOString(), updated_by: user.id,
          });
          any = true;
        }
        if (any) touched.add(num);
      }
      if (upserts.length) {
        const { error } = await supa.from("store_hours").upsert(upserts, { onConflict: "store_id,day_of_week" });
        if (error) {
          if (/store_hours/.test(error.message)) return respond(500, { error: "Run migration 0281 first (store_hours is missing)." });
          return respond(500, { error: error.message });
        }
        await recordHistory(supa, [...touched].map((n) => idByNumber.get(n)).filter(Boolean), user.id, "import");
      }
      return respond(200, { ok: true, imported_stores: touched.size, imported_days: upserts.length, errors });
    }

    // ── google-check-store: refresh one store's Google hours + compare ────────
    if (action === "google-check-store") {
      if (!placesConfigured()) return respond(400, { error: "Google Places not configured (set GOOGLE_PLACES_API_KEY)." });
      const storeNumber = String(body.store || body.store_number || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip, latitude, longitude, brand, google_place_id")
        .eq("number", storeNumber).neq("brand", "little_caesars").maybeSingle();
      if (!store) return respond(404, { error: "Store not found." });
      if (!inScope(scope, store.id)) return respond(403, { error: "This store isn't in your scope." });
      // A single-store check always re-resolves the place_id (ignores any cached
      // one) so a bad earlier match gets corrected on Re-check.
      const r = await refreshGoogle(supa, store, true);
      const { data: hrs } = await supa.from("store_hours").select("day_of_week, is_closed, open_time, close_time").eq("store_id", store.id);
      const standard = Array.from({ length: 7 }, (_, dow) => {
        const h = (hrs || []).find((x) => x.day_of_week === dow);
        return { day_of_week: dow, is_closed: h?.is_closed ?? false, open: hhmm(h?.open_time), close: hhmm(h?.close_time) };
      });
      const cmp = Array.isArray(r.google_hours) ? compareHours(standard, r.google_hours) : { status: "not_found", diffs: [] };
      return respond(200, { ok: true, status: cmp.status, diffs: cmp.diffs, hours: r.google_hours || null, checked_at: new Date().toISOString(), error: r.error || null });
    }

    // ── google-check-all: time-budgeted refresh of configured stores ──────────
    if (action === "google-check-all") {
      if (!placesConfigured()) return respond(400, { error: "Google Places not configured (set GOOGLE_PLACES_API_KEY)." });
      const force = !!body.force;
      // Skip stores checked since this cutoff. A forced sweep passes `since` =
      // the sweep's start time (set once by the client and held across the
      // paged loop), so every store gets re-checked exactly once this run and
      // the loop still converges as each store's checked_at moves past `since`.
      // Default (no since): skip anything checked in the last 12h.
      const staleBefore = typeof body.since === "string" && body.since
        ? body.since
        : new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      // Only stores that actually have system hours to compare against.
      const hrsIds = await selectAll(() => supa.from("store_hours").select("store_id"));
      const configured = [...new Set(hrsIds.map((r) => r.store_id))];
      if (!configured.length) return respond(200, { ok: true, checked: 0, failed: 0, remaining: 0 });
      const cand = await selectAll(() => supa.from("stores")
        .select("id, number, name, address, city, state, zip, latitude, longitude, brand, google_place_id, google_hours_checked_at")
        .in("id", configured).eq("is_active", true).neq("brand", "little_caesars")
        .order("google_hours_checked_at", { ascending: true, nullsFirst: true }));
      const eligible = cand.filter((s) => inScope(scope, s.id) && (!s.google_hours_checked_at || s.google_hours_checked_at < staleBefore));
      const start = Date.now();
      let checked = 0, failed = 0;
      for (const s of eligible) {
        if (Date.now() - start > 8000) break; // stay under the function timeout; client loops on `remaining`
        const r = await refreshGoogle(supa, s, force); // force → re-resolve the place_id (fixes bad cached matches)
        checked += 1;
        if (r.status === "not_found") failed += 1;
      }
      return respond(200, { ok: true, checked, failed, remaining: Math.max(0, eligible.length - checked) });
    }

    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};

// Append a standard-hours snapshot for each store whose current hours differ
// from its most recent history row (no-op saves don't add noise). Best-effort:
// never fails the save/import that triggered it. Snapshot shape + ordering match
// the 0283 baseline so dedup compares cleanly.
async function recordHistory(supa, storeIds, userId, source) {
  try {
    const ids = [...new Set((storeIds || []).filter(Boolean))];
    if (!ids.length) return;
    const hrs = await selectAll(() => supa.from("store_hours")
      .select("store_id, day_of_week, is_closed, open_time, close_time")
      .in("store_id", ids).order("store_id", { ascending: true }).order("day_of_week", { ascending: true }));
    const snap = new Map();
    for (const r of hrs) {
      const arr = snap.get(r.store_id) || [];
      arr.push({ day_of_week: r.day_of_week, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) });
      snap.set(r.store_id, arr);
    }
    const hist = await selectAll(() => supa.from("store_hours_history")
      .select("store_id, changed_at, days")
      .in("store_id", ids).order("store_id", { ascending: true }).order("changed_at", { ascending: false }).order("id", { ascending: false }));
    const latest = new Map();
    for (const h of hist) if (!latest.has(h.store_id)) latest.set(h.store_id, h.days);
    const now = new Date().toISOString();
    const inserts = [];
    for (const [sid, days] of snap) {
      const prev = latest.get(sid);
      if (prev && JSON.stringify(prev) === JSON.stringify(days)) continue; // unchanged
      inserts.push({ store_id: sid, changed_at: now, changed_by: userId, source, days });
    }
    for (let i = 0; i < inserts.length; i += 500) await supa.from("store_hours_history").insert(inserts.slice(i, i + 500));
  } catch (e) {
    console.warn("[store-hours] recordHistory failed", e?.message || e);
  }
}

// Resolve a store's Google place (cached place_id if present, else Find Place),
// pull its hours, normalize, and cache place_id + hours + checked_at on the store.
// Never throws — a Places hiccup just records a not_found check.
async function refreshGoogle(supa, store, forceResolve = false) {
  const now = new Date().toISOString();
  let placeId = forceResolve ? null : (store.google_place_id || null);
  if (!placeId) {
    const f = await findPlaceId(store);
    if (f.error) { await supa.from("stores").update({ google_hours: null, google_hours_checked_at: now }).eq("id", store.id); return { status: "not_found", error: f.error }; }
    placeId = f.place_id;
  }
  const h = await fetchPlaceHours(placeId);
  if (h.error) { await supa.from("stores").update({ google_place_id: placeId, google_hours: null, google_hours_checked_at: now }).eq("id", store.id); return { status: "not_found", error: h.error }; }
  const norm = normalizeGoogleHours(h.periods);
  await supa.from("stores").update({ google_place_id: placeId, google_hours: norm, google_hours_checked_at: now }).eq("id", store.id);
  return { status: Array.isArray(norm) ? "ok" : "not_found", google_hours: norm, place_id: placeId };
}
