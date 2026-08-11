// Hours of Operation — standard weekly hours + dated special-hours overrides per
// store. Admin-gated (System Settings tool). Backs the grid (action=list), the
// per-location editor (action=get), and the save paths (save-standard /
// save-special / delete-special). Storage: store_hours + store_special_hours (0281).
import { createClient } from "@supabase/supabase-js";

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
      const { data: stores } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active")
        .eq("is_active", true).order("number", { ascending: true });
      const ids = (stores || []).map((s) => s.id);
      const byStore = new Map();
      const specialByStore = new Map();
      if (ids.length) {
        const [{ data: hrs }, { data: sp }] = await Promise.all([
          supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time, updated_at").in("store_id", ids),
          supa.from("store_special_hours").select("store_id, special_date").in("store_id", ids).gte("special_date", new Date().toISOString().slice(0, 10)),
        ]);
        for (const r of hrs || []) {
          const arr = byStore.get(r.store_id) || Array(7).fill(null);
          arr[r.day_of_week] = { day_of_week: r.day_of_week, is_closed: r.is_closed, open: hhmm(r.open_time), close: hhmm(r.close_time) };
          byStore.set(r.store_id, arr);
        }
        for (const r of sp || []) specialByStore.set(r.store_id, (specialByStore.get(r.store_id) || 0) + 1);
      }
      const out = (stores || []).map((s) => {
        const days = byStore.get(s.id) || Array(7).fill(null);
        const configured = days.some((d) => d != null);
        return {
          id: s.id, number: String(s.number), name: s.name,
          address: s.address || null, city: s.city || null, state: s.state || null, zip: s.zip || null,
          days, configured, upcoming_special: specialByStore.get(s.id) || 0,
        };
      });
      return respond(200, { stores: out });
    }

    // ── get: one store's standard + special hours (editor) ────────────────────
    if (event.httpMethod === "GET" && action === "get") {
      const storeNumber = String(params.store || "").trim();
      if (!storeNumber) return respond(400, { error: "store is required" });
      const { data: store } = await supa.from("stores")
        .select("id, number, name, address, city, state, zip, is_active")
        .eq("number", storeNumber).maybeSingle();
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
      return respond(200, {
        store: { id: store.id, number: String(store.number), name: store.name, address: store.address, city: store.city, state: store.state, zip: store.zip },
        standard, special, updated_at: updatedAt,
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
      const { data: stores } = await supa.from("stores").select("id, number").eq("is_active", true);
      const idByNumber = new Map((stores || []).map((s) => [String(s.number), s.id]));
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

    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
