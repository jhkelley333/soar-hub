// Hours of Operation — standard weekly hours + dated special-hours overrides per
// store. Admin-gated (System Settings tool). Backs the grid (action=list), the
// per-location editor (action=get), and the save paths (save-standard /
// save-special / delete-special). Storage: store_hours + store_special_hours (0281).
import { createClient } from "@supabase/supabase-js";
import { placesConfigured, findPlaceId, fetchPlaceHours, normalizeGoogleHours, compareHours } from "./_lib/places.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EDIT_ROLES = new Set(["admin", "vp", "coo"]);

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

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "store-hours env vars not configured" });
    const supa = admin();
    const user = await sessionUser(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!EDIT_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

    const params = event.queryStringParameters || {};
    const action = params.action || "list";

    // ── list: every active store + its assembled 7-day standard hours ─────────
    if (event.httpMethod === "GET" && action === "list") {
      const stores = await selectAll(() => supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active, google_hours, google_hours_checked_at")
        .eq("is_active", true).neq("brand", "little_caesars").order("number", { ascending: true }));
      const ids = (stores || []).map((s) => s.id);
      const byStore = new Map();
      const specialByStore = new Map();
      if (ids.length) {
        const today = new Date().toISOString().slice(0, 10);
        const [hrs, sp] = await Promise.all([
          selectAll(() => supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time, updated_at").in("store_id", ids)),
          selectAll(() => supa.from("store_special_hours").select("store_id, special_date").in("store_id", ids).gte("special_date", today)),
        ]);
        for (const r of hrs) {
          const arr = byStore.get(r.store_id) || Array(7).fill(null);
          arr[r.day_of_week] = { day_of_week: r.day_of_week, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) };
          byStore.set(r.store_id, arr);
        }
        for (const r of sp) specialByStore.set(r.store_id, (specialByStore.get(r.store_id) || 0) + 1);
      }
      const out = (stores || []).map((s) => {
        const days = byStore.get(s.id) || Array(7).fill(null);
        const configured = days.some((d) => d != null);
        // Google comparison from cache (0282). unchecked until first check;
        // not_found when checked but no listing/hours; else match/mismatch.
        let googleStatus = "unchecked", googleDiffs = 0;
        if (s.google_hours_checked_at) {
          if (!Array.isArray(s.google_hours)) googleStatus = "not_found";
          else { const c = compareHours(days.filter(Boolean), s.google_hours); googleStatus = c.status; googleDiffs = c.diffs.length; }
        }
        return {
          id: s.id, number: String(s.number), name: s.name,
          address: s.address || null, city: s.city || null, state: s.state || null, zip: s.zip || null,
          days, configured, upcoming_special: specialByStore.get(s.id) || 0,
          google_status: googleStatus, google_diffs: googleDiffs, google_checked_at: s.google_hours_checked_at || null,
        };
      });
      return respond(200, { stores: out, places_configured: placesConfigured() });
    }

    // ── get: one store's standard + special hours (editor) ────────────────────
    if (event.httpMethod === "GET" && action === "get") {
      const storeNumber = String(params.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active, google_place_id, google_hours, google_hours_checked_at")
        .eq("number", storeNumber).neq("brand", "little_caesars").maybeSingle();
      if (!store) return respond(404, { error: "Store not found." });
      const [{ data: hrs }, { data: sp }] = await Promise.all([
        supa.from("store_hours").select("day_of_week, is_closed, open_time, close_time, updated_at").eq("store_id", store.id),
        supa.from("store_special_hours").select("id, special_date, is_closed, open_time, close_time, note").eq("store_id", store.id).order("special_date", { ascending: true }),
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
      return respond(200, {
        store: { id: store.id, number: String(store.number), name: store.name, address: store.address, city: store.city, state: store.state, zip: store.zip },
        standard, special, updated_at: updatedAt,
        google: { status: cmp.status, diffs: cmp.diffs, checked_at: store.google_hours_checked_at || null, has_place: !!store.google_place_id, hours: store.google_hours || null, configured: placesConfigured() },
      });
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "method not allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    // ── save-standard: upsert all 7 weekday rows for a store ──────────────────
    if (action === "save-standard") {
      const storeId = String(body.store_id || "").trim();
      if (!storeId) return respond(400, { error: "store_id is required" });
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
      return respond(200, { ok: true, saved: rows.length });
    }

    // ── save-special: upsert one dated override ───────────────────────────────
    if (action === "save-special") {
      const storeId = String(body.store_id || "").trim();
      const date = String(body.date || "").trim();
      if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond(400, { error: "store_id and a valid date are required" });
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
      const { error } = await supa.from("store_special_hours").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    // ── bulk-import: seed standard hours from an uploaded spreadsheet ──────────
    // Body: { rows: [{ store_number, days: [{day_of_week, is_closed, open, close}] }] }
    // Only the days present in a row are written; unknown store numbers are
    // reported back, not silently dropped.
    if (action === "bulk-import") {
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
      const staleBefore = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      // Only stores that actually have system hours to compare against.
      const hrsIds = await selectAll(() => supa.from("store_hours").select("store_id"));
      const configured = [...new Set(hrsIds.map((r) => r.store_id))];
      if (!configured.length) return respond(200, { ok: true, checked: 0, failed: 0, remaining: 0 });
      const cand = await selectAll(() => supa.from("stores")
        .select("id, number, name, address, city, state, zip, latitude, longitude, brand, google_place_id, google_hours_checked_at")
        .in("id", configured).eq("is_active", true).neq("brand", "little_caesars")
        .order("google_hours_checked_at", { ascending: true, nullsFirst: true }));
      const eligible = cand.filter((s) => !s.google_hours_checked_at || s.google_hours_checked_at < staleBefore);
      const start = Date.now();
      let checked = 0, failed = 0;
      for (const s of eligible) {
        if (Date.now() - start > 8000) break; // stay under the function timeout; client loops on `remaining`
        const r = await refreshGoogle(supa, s);
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
