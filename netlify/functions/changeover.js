// Store changeover checklists. SDO/RVP run the DO changeover, DOs run the GM
// changeover, each assigned to a store (+ optionally a Hub user who can also
// work it). The checklist templates live in the app; this function stores meta
// + per-item progress (jsonb) and enforces role + org scope.
//
//   GET  ?action=list                 -> checklists the caller can see
//   GET  ?action=get&id=..            -> one checklist (with resolved names)
//   POST ?action=create   {kind,...}  -> new checklist for a store
//   POST ?action=update   {id,...}    -> status / notes / names / assignee
//   POST ?action=update-item {id,item_key,checked,note}
//   POST ?action=delete   {id}
//
// Service-role gatekeeper: RLS on changeover_checklists, no policies.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIEW_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]); // can open the tool (gm = assignee)
const CREATE_DO = new Set(["sdo", "rvp", "vp", "coo", "admin"]);              // DO changeover
const CREATE_GM = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);        // GM changeover
const ORG_WIDE = new Set(["admin", "vp", "coo"]);
const KINDS = new Set(["do", "gm"]);
const STATUSES = new Set(["open", "in_progress", "complete"]);
const KIND_LABEL = { do: "DO", gm: "GM" };

// Assignment notification (Resend — same sender as PAF / sign orders).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "paf@mysoarhub.com";
const RESEND_FROM_NAME = "SOAR Changeovers";
const SITE_URL = process.env.SITE_URL || process.env.URL || "";
const escHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Best-effort: email the assignee a link to the checklist. Never throws.
async function emailAssignee({ toEmail, kind, storeNumber, storeName, id, assignerName }) {
  if (!RESEND_API_KEY || !toEmail) return;
  const label = KIND_LABEL[kind] || "";
  const link = SITE_URL ? `${SITE_URL.replace(/\/$/, "")}/changeover/${id}` : `/changeover/${id}`;
  const store = `Sonic #${escHtml(storeNumber)}${storeName ? ` ${escHtml(storeName)}` : ""}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">
  <p>${assignerName ? `${escHtml(assignerName)} assigned you` : "You've been assigned"} a <b>${label} changeover</b> for <b>${store}</b>.</p>
  <p><a href="${link}" style="color:#1d4ed8;font-weight:600;">Open the checklist</a></p>
  <p style="color:#666;font-size:12px;margin-top:16px;">Check items off, add notes, and mark it complete in SOAR Hub.</p>
</div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`, to: [toEmail], subject: `${label} changeover assigned to you — Sonic #${storeNumber}`, html }),
    });
  } catch (e) {
    console.warn("[changeover] assignee email failed", e?.message || e);
  }
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const displayName = (p) => (p ? p.preferred_name || p.full_name || p.email || null : null);

async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const { data: { user } = {} } = await supa.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active, full_name, preferred_name, email").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase(), name: displayName(p) } : null;
}

// Store numbers a scoped leader may see/act on; null = org-wide (no filter).
async function visibleStoreNumbers(supa, user) {
  if (ORG_WIDE.has(user.role)) return null;
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean);
  if (!ids.length) return new Set();
  const { data } = await supa.from("stores").select("number").in("id", ids);
  return new Set((data ?? []).map((s) => String(s.number)));
}

async function namesByIds(supa, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", uniq);
  return new Map((data || []).map((p) => [p.id, displayName(p)]));
}

const canCreate = (role, kind) => (kind === "do" ? CREATE_DO.has(role) : CREATE_GM.has(role));
function visibleTo(row, user, visible) {
  if (visible == null) return true; // org-wide
  if (row.created_by === user.id || row.assigned_to === user.id) return true;
  return !!(row.store_number && visible.has(String(row.store_number)));
}
const canEdit = (row, user, visible) => ORG_WIDE.has(user.role) || row.created_by === user.id || row.assigned_to === user.id || (visible && row.store_number && visible.has(String(row.store_number)));

const checkedCount = (progress) => Object.values(progress || {}).filter((v) => v && v.checked).length;

function listRow(r, names) {
  return {
    id: r.id, kind: r.kind,
    store_number: r.store_number, store_name: r.store_name,
    outgoing_name: r.outgoing_name, incoming_name: r.incoming_name,
    status: r.status, checked_count: checkedCount(r.progress),
    assigned_to: r.assigned_to, assigned_to_name: r.assigned_to ? names.get(r.assigned_to) ?? null : null,
    created_by_name: r.created_by ? names.get(r.created_by) ?? null : null,
    created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at,
  };
}
function detail(r, names) {
  const progress = {};
  for (const [k, v] of Object.entries(r.progress || {})) {
    progress[k] = { checked: !!v?.checked, checked_at: v?.checked_at ?? null, note: v?.note ?? null, checked_by_name: v?.checked_by ? names.get(v.checked_by) ?? null : null };
  }
  return { ...listRow(r, names), notes: r.notes ?? null, progress };
}

async function resolveStore(supa, number) {
  const { data } = await supa.from("stores").select("id, number, name").eq("number", String(number)).or("brand.eq.sonic,brand.is.null").maybeSingle();
  return data || null;
}
const clean = (v, n = 200) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

// ── Editable template items (admin) ──────────────────────────────────────────
const tplRow = (r) => ({ id: r.id, kind: r.kind, section: r.section, section_order: r.section_order, sort_order: r.sort_order, item_key: r.item_key, label: r.label, hint: r.hint ?? null });

// section_order for a (kind, section): reuse the section's existing order, else
// append after the last section.
async function sectionOrderFor(supa, kind, section) {
  const { data } = await supa.from("changeover_template_items").select("section_order").eq("kind", kind).eq("section", section).limit(1).maybeSingle();
  if (data) return data.section_order;
  const { data: mx } = await supa.from("changeover_template_items").select("section_order").eq("kind", kind).order("section_order", { ascending: false }).limit(1).maybeSingle();
  return mx ? mx.section_order + 1 : 0;
}
async function nextSortOrder(supa, kind, section) {
  const { data } = await supa.from("changeover_template_items").select("sort_order").eq("kind", kind).eq("section", section).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return data ? data.sort_order + 1 : 0;
}

export const handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "changeover env vars not configured" });
    const supa = admin();
    const user = await sessionUser(supa, event);
    if (!user) return respond(401, { error: "unauthorized" });
    if (!VIEW_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

    const params = event.queryStringParameters || {};
    const action = params.action || "list";
    const visible = await visibleStoreNumbers(supa, user);

    if (event.httpMethod === "GET" && action === "list") {
      const { data } = await supa.from("changeover_checklists").select("*").order("updated_at", { ascending: false }).limit(1000);
      const rows = (data || []).filter((r) => visibleTo(r, user, visible));
      const names = await namesByIds(supa, rows.flatMap((r) => [r.created_by, r.assigned_to]));
      return respond(200, {
        rows: rows.map((r) => listRow(r, names)),
        can_create: { do: CREATE_DO.has(user.role), gm: CREATE_GM.has(user.role) },
      });
    }

    if (event.httpMethod === "GET" && action === "get") {
      const id = String(params.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      const { data: r } = await supa.from("changeover_checklists").select("*").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!visibleTo(r, user, visible)) return respond(403, { error: "This changeover isn't in your scope." });
      const names = await namesByIds(supa, [r.created_by, r.assigned_to, ...Object.values(r.progress || {}).map((v) => v?.checked_by)]);
      return respond(200, { checklist: detail(r, names), can_edit: canEdit(r, user, visible) });
    }

    // Editable checklist items (all active, both kinds). Empty when the table
    // isn't there yet — the app then falls back to its built-in defaults.
    if (event.httpMethod === "GET" && action === "templates") {
      const { data, error } = await supa.from("changeover_template_items").select("*").eq("is_active", true)
        .order("kind", { ascending: true }).order("section_order", { ascending: true }).order("sort_order", { ascending: true });
      if (error) return respond(200, { items: [], can_manage: user.role === "admin" });
      return respond(200, { items: (data || []).map(tplRow), can_manage: user.role === "admin" });
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "method not allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

    if (action === "save-template-item") {
      if (user.role !== "admin") return respond(403, { error: "Only an admin can edit the checklist." });
      const kind = String(body.kind || "").trim();
      if (!KINDS.has(kind)) return respond(400, { error: "kind must be 'do' or 'gm'." });
      const section = clean(body.section, 120);
      const label = clean(body.label, 300);
      if (!section) return respond(400, { error: "A section is required." });
      if (!label) return respond(400, { error: "A label is required." });
      const hint = clean(body.hint, 500);
      const id = clean(body.id, 60);
      const section_order = await sectionOrderFor(supa, kind, section);
      if (id) {
        const { error } = await supa.from("changeover_template_items").update({ section, section_order, label, hint, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) return respond(500, { error: error.message });
        return respond(200, { ok: true, id });
      }
      const { data, error } = await supa.from("changeover_template_items").insert({
        kind, section, section_order, sort_order: await nextSortOrder(supa, kind, section),
        item_key: `${kind}_${randomUUID()}`, label, hint,
      }).select("id, item_key").maybeSingle();
      if (error) {
        if (/changeover_template_items/.test(error.message)) return respond(500, { error: "Run migration 0286 first (changeover_template_items is missing)." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, id: data?.id, item_key: data?.item_key });
    }

    if (action === "delete-template-item") {
      if (user.role !== "admin") return respond(403, { error: "Only an admin can edit the checklist." });
      const id = clean(body.id, 60);
      if (!id) return respond(400, { error: "id is required" });
      const { error } = await supa.from("changeover_template_items").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    if (action === "move-template-item") {
      if (user.role !== "admin") return respond(403, { error: "Only an admin can edit the checklist." });
      const id = clean(body.id, 60);
      const dir = body.dir === "up" ? "up" : "down";
      if (!id) return respond(400, { error: "id is required" });
      const { data: item } = await supa.from("changeover_template_items").select("id, kind, section, sort_order").eq("id", id).maybeSingle();
      if (!item) return respond(404, { error: "Not found." });
      let nq = supa.from("changeover_template_items").select("id, sort_order").eq("kind", item.kind).eq("section", item.section);
      nq = dir === "up" ? nq.lt("sort_order", item.sort_order).order("sort_order", { ascending: false }) : nq.gt("sort_order", item.sort_order).order("sort_order", { ascending: true });
      const { data: neighbor } = await nq.limit(1).maybeSingle();
      if (!neighbor) return respond(200, { ok: true }); // already at the edge
      await supa.from("changeover_template_items").update({ sort_order: neighbor.sort_order }).eq("id", item.id);
      await supa.from("changeover_template_items").update({ sort_order: item.sort_order }).eq("id", neighbor.id);
      return respond(200, { ok: true });
    }

    if (action === "create") {
      const kind = String(body.kind || "").trim();
      if (!KINDS.has(kind)) return respond(400, { error: "kind must be 'do' or 'gm'." });
      if (!canCreate(user.role, kind)) return respond(403, { error: kind === "do" ? "Only SDO and above can create a DO changeover." : "Only DO and above can create a GM changeover." });
      const number = clean(body.store_number, 20);
      if (!number) return respond(400, { error: "A store is required." });
      const store = await resolveStore(supa, number);
      if (!store) return respond(404, { error: `Store ${number} not found.` });
      if (visible && !visible.has(String(store.number))) return respond(403, { error: "That store isn't in your scope." });

      let assignedTo = null;
      const email = clean(body.assigned_email, 200);
      if (email) {
        const { data: p } = await supa.from("profiles").select("id").ilike("email", email).eq("is_active", true).maybeSingle();
        if (!p) return respond(400, { error: `No active Hub user with email ${email}.` });
        assignedTo = p.id;
      }
      const now = new Date().toISOString();
      const { data, error } = await supa.from("changeover_checklists").insert({
        kind, store_id: store.id, store_number: String(store.number), store_name: store.name,
        outgoing_name: clean(body.outgoing_name), incoming_name: clean(body.incoming_name),
        assigned_to: assignedTo, status: "open", progress: {}, created_by: user.id, created_at: now, updated_at: now,
      }).select("id").maybeSingle();
      if (error) {
        if (/changeover_checklists/.test(error.message)) return respond(500, { error: "Run migration 0285 first (changeover_checklists is missing)." });
        return respond(500, { error: error.message });
      }
      if (assignedTo && email) await emailAssignee({ toEmail: email, kind, storeNumber: store.number, storeName: store.name, id: data?.id, assignerName: user.name });
      return respond(200, { ok: true, id: data?.id });
    }

    if (action === "update") {
      const id = String(body.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      const { data: r } = await supa.from("changeover_checklists").select("*").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!canEdit(r, user, visible)) return respond(403, { error: "You can't edit this changeover." });

      const patch = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(body, "status")) {
        const status = String(body.status);
        if (!STATUSES.has(status)) return respond(400, { error: "bad status" });
        patch.status = status;
        patch.completed_at = status === "complete" ? new Date().toISOString() : null;
      }
      if (Object.prototype.hasOwnProperty.call(body, "notes")) patch.notes = clean(body.notes, 4000);
      if (Object.prototype.hasOwnProperty.call(body, "outgoing_name")) patch.outgoing_name = clean(body.outgoing_name);
      if (Object.prototype.hasOwnProperty.call(body, "incoming_name")) patch.incoming_name = clean(body.incoming_name);
      let notifyEmail = null;
      if (Object.prototype.hasOwnProperty.call(body, "assigned_email")) {
        const email = clean(body.assigned_email, 200);
        if (!email) patch.assigned_to = null;
        else {
          const { data: p } = await supa.from("profiles").select("id").ilike("email", email).eq("is_active", true).maybeSingle();
          if (!p) return respond(400, { error: `No active Hub user with email ${email}.` });
          patch.assigned_to = p.id;
          if (p.id !== r.assigned_to) notifyEmail = email; // only on an actual (re)assignment
        }
      }
      const { error } = await supa.from("changeover_checklists").update(patch).eq("id", id);
      if (error) return respond(500, { error: error.message });
      if (notifyEmail) await emailAssignee({ toEmail: notifyEmail, kind: r.kind, storeNumber: r.store_number, storeName: r.store_name, id, assignerName: user.name });
      return respond(200, { ok: true });
    }

    if (action === "update-item") {
      const id = String(body.id || "").trim();
      const key = String(body.item_key || "").trim();
      if (!id || !key) return respond(400, { error: "id and item_key are required" });
      const { data: r } = await supa.from("changeover_checklists").select("*").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!canEdit(r, user, visible)) return respond(403, { error: "You can't edit this changeover." });

      const progress = { ...(r.progress || {}) };
      const cur = { ...(progress[key] || {}) };
      if (Object.prototype.hasOwnProperty.call(body, "checked")) {
        const on = !!body.checked;
        cur.checked = on;
        cur.checked_at = on ? new Date().toISOString() : null;
        cur.checked_by = on ? user.id : null;
      }
      if (Object.prototype.hasOwnProperty.call(body, "note")) cur.note = clean(body.note, 500);
      progress[key] = cur;

      // Auto status: any checked → in_progress; none → open (never override 'complete').
      let status = r.status;
      if (status !== "complete") status = Object.values(progress).some((v) => v && v.checked) ? "in_progress" : "open";
      const { error } = await supa.from("changeover_checklists").update({ progress, status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true, item_key: key, status });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return respond(400, { error: "id is required" });
      const { data: r } = await supa.from("changeover_checklists").select("created_by").eq("id", id).maybeSingle();
      if (!r) return respond(404, { error: "Not found." });
      if (!(ORG_WIDE.has(user.role) || r.created_by === user.id)) return respond(403, { error: "Only the creator (or an admin) can delete this." });
      const { error } = await supa.from("changeover_checklists").delete().eq("id", id);
      if (error) return respond(500, { error: error.message });
      return respond(200, { ok: true });
    }

    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[changeover]", e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
