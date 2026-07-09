// Store Command Center — backend for the public per-store page (/s/:token).
//
// The URL token is the credential, and it binds to the FIRST device that opens
// it (the store desktop): the browser generates a device_id once and sends it
// with every call; a mismatched device gets a clear 403 until an admin resets
// the binding. Data exposed is the store's own operational snapshot only.
//
// Admin actions (Bearer + role=admin) mint / revoke / reset tokens.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getSheetsClient, getAvailableWeeks, batchGetWeeks, findRowByStore, getMetricRaw,
} from "./_lib/ranker-sheets.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "SOAR Hub";

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("store-portal env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
const respond = (statusCode, payload) => ({
  statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

async function sendEmail({ to, subject, text }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!RESEND_API_KEY || !recipients.length) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`, to: recipients, subject, text }),
    });
    return { ok: res.ok };
  } catch { return { ok: false }; }
}

// ── Token + device gate ───────────────────────────────────────────────────────
// Resolves the token, enforces the device binding (first device claims an
// unclaimed token), and returns the store row.
async function gate(supa, body) {
  const token = String(body?.token || "").trim();
  const deviceId = String(body?.device_id || "").trim();
  if (!token || !deviceId) return { error: "Missing token or device.", status: 400 };
  const { data: t } = await supa.from("store_portal_tokens").select("*").eq("token", token).maybeSingle();
  if (!t || !t.is_active) return { error: "This link is no longer active. Ask your admin for a new one.", status: 404 };
  if (!t.device_id) {
    await supa.from("store_portal_tokens")
      .update({ device_id: deviceId, device_bound_at: new Date().toISOString(), last_used_at: new Date().toISOString() })
      .eq("id", t.id).is("device_id", null);
    // Re-read: if a concurrent first-open won the race, fall through to the check.
    const { data: t2 } = await supa.from("store_portal_tokens").select("*").eq("id", t.id).maybeSingle();
    if (t2?.device_id && t2.device_id !== deviceId) {
      return { error: "This link is registered to a different device. Ask your admin to reset it.", status: 403 };
    }
  } else if (t.device_id !== deviceId) {
    return { error: "This link is registered to a different device. Ask your admin to reset it.", status: 403 };
  } else {
    await supa.from("store_portal_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
  }
  const { data: store } = await supa.from("stores")
    .select("id, number, name, city, state").eq("id", t.store_id).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };
  return { tokenRow: t, store };
}

async function resolve(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  const { store } = g;
  return { ok: true, store: { number: store.number, name: store.name, city: store.city, state: store.state } };
}

// Store-scoped actions accept EITHER the screen's token+device OR a Bearer
// admin session + store_id, so the admin live view is fully interactive
// (file/manage tickets, send reports) without touching the device binding.
async function resolveAccess(supa, event, body) {
  if (body?.token) return gate(supa, body);
  const user = await getSessionUser(event, supa);
  if (!user) return { error: "unauthorized", status: 401 };
  const storeId = body?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  const { data: store } = await supa.from("stores")
    .select("id, number, name, city, state").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };
  return { store, tokenRow: null, adminUser: user };
}

// ── Snapshot — everything on the page in one call ─────────────────────────────
const pct = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 10);

async function laborAndSales(supa, storeNumber) {
  const { data: rows } = await supa.from("labor_v2_daily")
    .select("business_date, net_sales, labor_pct, target_labor_pct")
    .eq("store_number", String(storeNumber))
    .order("business_date", { ascending: false }).limit(10);
  const latest = rows?.[0];
  if (!latest) return { sales: null, labor: null };
  const wk = (rows || []).find((r) => {
    const d = new Date(`${latest.business_date}T00:00:00Z`) - new Date(`${r.business_date}T00:00:00Z`);
    return Math.round(d / 86_400_000) === 7;
  });
  const sales = {
    date: latest.business_date,
    net_sales: latest.net_sales == null ? null : Number(latest.net_sales),
    wow_pct: latest.net_sales != null && wk?.net_sales
      ? Math.round(((Number(latest.net_sales) - Number(wk.net_sales)) / Number(wk.net_sales)) * 1000) / 10
      : null,
  };
  const labor = {
    date: latest.business_date,
    labor_pct: pct(latest.labor_pct),
    target_pct: pct(latest.target_labor_pct),
  };
  return { sales, labor };
}

async function rankerRank(storeNumber) {
  try {
    const sheets = await getSheetsClient();
    const weeks = await getAvailableWeeks(sheets);
    if (!weeks.length) return null;
    const wk = String(weeks[weeks.length - 1]);
    const data = (await batchGetWeeks(sheets, [wk])).get(wk);
    if (!data) return null;
    const row = findRowByStore(data.rows, storeNumber);
    if (!row) return null;
    const rank = parseInt(getMetricRaw(row, data.idx, "storeRank"), 10);
    return Number.isNaN(rank) ? null : { rank, total: data.rows.length, week: wk };
  } catch { return null; }
}

async function openWorkOrders(supa, storeNumber) {
  const { data: rows } = await supa.from("tickets")
    .select("id, category, issue_description, status, priority, date_submitted")
    .eq("store_number", String(storeNumber))
    .not("status", "in", "(completed,closed,cancelled)")
    .order("date_submitted", { ascending: false }).limit(25);
  const open = rows || [];
  return {
    open_count: open.length,
    latest: open.slice(0, 2).map((t) => ({
      title: [t.category, (t.issue_description || "").slice(0, 80)].filter(Boolean).join(": "),
      status: t.status, priority: t.priority,
    })),
  };
}

async function storeNotes(supa, storeNumber) {
  const nowIso = new Date().toISOString();
  const { data } = await supa.from("store_messages")
    .select("id, title, body, is_pinned, created_at, expires_at, author_name")
    .contains("store_numbers", [String(storeNumber)])
    .eq("is_active", true)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8);
  return (data || [])
    .filter((m) => !m.expires_at || m.expires_at > nowIso)
    .slice(0, 5)
    .map((m) => ({ title: m.title, body: (m.body || "").slice(0, 240), pinned: m.is_pinned, author: m.author_name, created_at: m.created_at }));
}

// GM / DO / SDO / RVP for one store — compact version of org.js's resolution
// (primary scopes only; enough for a call sheet).
async function leadership(supa, store) {
  const out = [];
  const { data: gms } = await supa.from("profiles")
    .select("id, full_name, preferred_name, phone, email, role")
    .eq("primary_store_id", store.id).eq("is_active", true).eq("role", "gm").limit(1);
  if (gms?.[0]) out.push({ slot: "GM", ...pick(gms[0]) });

  const { data: srow } = await supa.from("stores").select("district_id").eq("id", store.id).maybeSingle();
  const districtId = srow?.district_id ?? null;
  let areaId = null, regionId = null;
  if (districtId) {
    const { data: d } = await supa.from("districts").select("area_id").eq("id", districtId).maybeSingle();
    areaId = d?.area_id ?? null;
  }
  if (areaId) {
    const { data: a } = await supa.from("areas").select("region_id").eq("id", areaId).maybeSingle();
    regionId = a?.region_id ?? null;
  }
  const slots = [
    { slot: "DO", role: "do", scope_type: "district", scope_id: districtId },
    { slot: "SDO", role: "sdo", scope_type: "area", scope_id: areaId },
    { slot: "RVP", role: "rvp", scope_type: "region", scope_id: regionId },
  ];
  for (const s of slots) {
    if (!s.scope_id) continue;
    const { data: scopes } = await supa.from("user_scopes")
      .select("user_id").eq("scope_type", s.scope_type).eq("scope_id", s.scope_id);
    const ids = (scopes || []).map((r) => r.user_id);
    if (!ids.length) continue;
    const { data: profs } = await supa.from("profiles")
      .select("id, full_name, preferred_name, phone, email, role")
      .in("id", ids).eq("is_active", true);
    const match = (profs || []).find((p) => p.role === s.role) || (profs || [])[0];
    if (match) out.push({ slot: s.slot, ...pick(match) });
  }
  return out;
}
const pick = (p) => ({ id: p.id || null, name: p.preferred_name || p.full_name || null, phone: p.phone || null, email: p.email || null });
// The public snapshot ships contacts without profile ids.
const publicContact = ({ slot, name, phone, email }) => ({ slot, name, phone, email });

async function assembleSnapshot(supa, store) {
  const [ls, rank, wo, notes, contacts] = await Promise.all([
    laborAndSales(supa, store.number),
    rankerRank(store.number),
    openWorkOrders(supa, store.number),
    storeNotes(supa, store.number),
    leadership(supa, store),
  ]);
  return {
    store: { number: store.number, name: store.name, city: store.city, state: store.state },
    sales: ls.sales, labor: ls.labor, rank, work_orders: wo, notes,
    contacts: contacts.map(publicContact),
  };
}

async function snapshot(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  return assembleSnapshot(supa, g.store);
}

const REPORT_KINDS = new Set(["tardiness", "safety", "equipment", "issue"]);
async function report(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const { store, tokenRow, adminUser } = g;
  const kind = REPORT_KINDS.has(body?.kind) ? body.kind : "issue";
  const message = String(body?.message || "").trim();
  if (!message) return { error: "Describe what is going on.", status: 400 };
  const reporter = String(body?.reporter_name || "").trim().slice(0, 120)
    || (adminUser ? (adminUser.preferred_name || adminUser.full_name || null) : null);

  const contacts = await leadership(supa, store);
  const to = contacts.filter((c) => (c.slot === "GM" || c.slot === "DO") && c.email).map((c) => c.email);
  const kindLabel = { tardiness: "Tardiness", safety: "SAFETY", equipment: "Equipment", issue: "Issue" }[kind];
  await sendEmail({
    to,
    subject: `[Store ${store.number}] ${kindLabel} report from the store floor`,
    text: [
      `Store #${store.number}${store.name ? ` - ${store.name}` : ""}`,
      `Type: ${kindLabel}`,
      reporter ? `Reported by: ${reporter}` : null,
      "",
      message.slice(0, 4000),
      "",
      "Sent from the Store Command Center screen.",
    ].filter((l) => l !== null).join("\n"),
  });
  const { error } = await supa.from("store_portal_reports").insert({
    store_id: store.id, token_id: tokenRow?.id ?? null, kind, message: message.slice(0, 4000),
    reporter_name: reporter, emailed_to: to,
  });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, notified: to.length };
}

// ── Work orders from the store screen ─────────────────────────────────────────
// The screen knows its store, so tickets list/create/comment are store-locked.
// Photos ride a QR handoff: the desktop mints a short-lived SIGNED token, the
// crew scans it, and their phone uploads straight onto the ticket — no login
// on either device. The token is stateless (HMAC over ticket+store+expiry
// keyed off the service key), so no table is needed.
const PHOTOS_BUCKET = "wo2-ticket-photos";
const PHONE_TOKEN_TTL_MS = 20 * 60_000;
const MAX_SCREEN_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_SCREEN_PHOTOS_PER_TICKET = 10;
const OPEN_TICKET_FILTER = "(completed,closed,cancelled)";

const signPhone = (payload) =>
  crypto.createHmac("sha256", `store-portal:${SERVICE_KEY}`).update(payload).digest("base64url");
function mintPhoneToken(ticketId, storeNumber) {
  const exp = Date.now() + PHONE_TOKEN_TTL_MS;
  const payload = `${ticketId}.${storeNumber}.${exp}`;
  return `${payload}.${signPhone(payload)}`;
}
function verifyPhoneToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return null;
  const [ticketId, storeNumber, expStr, sig] = parts;
  const payload = `${ticketId}.${storeNumber}.${expStr}`;
  const expected = signPhone(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return { expired: true };
  return { ticketId, storeNumber };
}

async function nextWONumber(supa, storeNumber) {
  const { data, error } = await supa.rpc("next_wo_sequence", { p_store: String(storeNumber) });
  if (!error && typeof data === "number") return `WO-${storeNumber}-${String(data).padStart(3, "0")}`;
  const { data: seq } = await supa.from("wo_sequences")
    .select("last_sequence").eq("store_number", String(storeNumber)).single();
  const next = ((seq && seq.last_sequence) || 0) + 1;
  await supa.from("wo_sequences").upsert({ store_number: String(storeNumber), last_sequence: next });
  return `WO-${storeNumber}-${String(next).padStart(3, "0")}`;
}

const ticketSummary = (t) => ({
  id: t.id, wo_number: t.wo_number, category: t.category, issue_description: t.issue_description,
  status: t.status, priority: t.priority, date_submitted: t.date_submitted,
  vendor_name: t.vendor_name || null,
});

async function listStoreTickets(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const num = String(g.store.number);
  const { data: open } = await supa.from("tickets")
    .select("id, wo_number, category, issue_description, status, priority, date_submitted, vendor_name")
    .eq("store_number", num).not("status", "in", OPEN_TICKET_FILTER)
    .order("date_submitted", { ascending: false }).limit(50);
  const { data: closed } = await supa.from("tickets")
    .select("id, wo_number, category, issue_description, status, priority, date_submitted, vendor_name")
    .eq("store_number", num).in("status", ["completed", "closed", "cancelled"])
    .order("date_submitted", { ascending: false }).limit(10);
  return { open: (open || []).map(ticketSummary), recent_closed: (closed || []).map(ticketSummary) };
}

// One ticket, verified to belong to the token's store.
async function storeTicket(supa, store, ticketId) {
  const { data: t } = await supa.from("tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!t || String(t.store_number) !== String(store.number)) return null;
  return t;
}

async function getStoreTicket(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const t = await storeTicket(supa, g.store, body?.ticket_id);
  if (!t) return { error: "Ticket not found for this store.", status: 404 };
  const [{ data: msgs }, { data: photos }, { data: acts }] = await Promise.all([
    supa.from("ticket_messages").select("user_name, user_role, message, created_at")
      .eq("ticket_id", t.id).eq("thread_type", "internal").order("created_at", { ascending: true }).limit(50),
    supa.from("ticket_photos").select("file_url, file_name, created_at")
      .eq("ticket_id", t.id).order("created_at", { ascending: true }).limit(30),
    supa.from("ticket_activities").select("update_type, event_type, user_name, created_at")
      .eq("ticket_id", t.id).order("created_at", { ascending: false }).limit(20),
  ]);
  return { ticket: ticketSummary(t), messages: msgs || [], photos: photos || [], activity: acts || [] };
}

// Mirrors the real Work Order intake (same fields and semantics as the WO2 /
// public-submit form), just with the store locked to the screen's token.
async function createStoreTicket(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const { store } = g;
  const name = String(body?.submitter_name || "").trim();
  const email = String(body?.submitter_email || "").trim();
  const phone = String(body?.submitter_phone || "").trim();
  const description = String(body?.issue_description || "").trim();
  const category = String(body?.category || "").trim().slice(0, 80);
  const assetType = String(body?.asset_type || "").trim().slice(0, 80);
  const modelNumber = String(body?.model_number || "").trim().slice(0, 80);
  const priority = ["Standard", "Urgent", "Emergency"].includes(body?.priority) ? body.priority : "Standard";
  const isBusinessCritical = body?.is_business_critical === true;
  const needsVendorHelp = body?.needs_vendor_help === true;
  const vendorIdInput = body?.vendor_id ? String(body.vendor_id).trim() : "";
  if (!name) return { error: "Enter your name.", status: 400 };
  if (description.length < 10) return { error: "Describe the issue in at least 10 characters.", status: 400 };

  // Vendor preference — validate the id like the public form does (the picker
  // the screen shows is already store-scoped by the public vendors endpoint).
  let resolvedVendorId = null;
  let resolvedVendorName = "";
  if (vendorIdInput && !needsVendorHelp) {
    const { data: v } = await supa.from("vendors")
      .select("id, name, is_active").eq("id", vendorIdInput).maybeSingle();
    if (v?.is_active) { resolvedVendorId = v.id; resolvedVendorName = v.name || ""; }
  }
  const wantsVendorHelp = needsVendorHelp || !resolvedVendorId;

  const submittedBy = `Store screen: ${name}`
    + (email ? ` <${email}>` : "") + (phone ? ` · ${phone}` : "");

  const woNumber = await nextWONumber(supa, store.number);
  const { data: ticket, error } = await supa.from("tickets").insert({
    wo_number: woNumber,
    store_number: String(store.number),
    store_name: store.name || "",
    store_email: "", do_email: "", sdo_email: "",
    submitted_by: submittedBy,
    submitted_by_user_id: null,
    category: category || "Store screen",
    asset_type: assetType, model_number: modelNumber,
    issue_description: description.slice(0, 4000),
    status: "submitted", priority,
    is_business_critical: isBusinessCritical,
    troubleshooting_checked: body?.troubleshooting_checked === true,
    vendor_id: resolvedVendorId, vendor_name: resolvedVendorName,
    vendor_contacted: false,
    needs_vendor_help: wantsVendorHelp,
    vendor_help_at: wantsVendorHelp ? new Date().toISOString() : null,
    date_submitted: new Date().toISOString(),
  }).select("id, wo_number").single();
  if (error) return { error: error.message, status: 500 };
  await supa.from("ticket_activities").insert({
    ticket_id: ticket.id, user_id: null, user_name: `Store screen: ${name}`, user_role: "store",
    update_type: "created", event_type: "created", event_data: { source: "store_screen" },
  });
  return { ok: true, ticket_id: ticket.id, wo_number: ticket.wo_number };
}

async function commentStoreTicket(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const t = await storeTicket(supa, g.store, body?.ticket_id);
  if (!t) return { error: "Ticket not found for this store.", status: 404 };
  const name = String(body?.name || "").trim().slice(0, 120);
  const message = String(body?.message || "").trim();
  if (!message) return { error: "Write a message.", status: 400 };
  const { error } = await supa.from("ticket_messages").insert({
    ticket_id: t.id, user_id: null,
    user_name: name ? `${name} (store screen)` : "Store screen",
    user_role: "store", message: message.slice(0, 2000), thread_type: "internal",
  });
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function photoQr(supa, event, body) {
  const g = await resolveAccess(supa, event, body);
  if (g.error) return g;
  const t = await storeTicket(supa, g.store, body?.ticket_id);
  if (!t) return { error: "Ticket not found for this store.", status: 404 };
  const token = mintPhoneToken(t.id, String(g.store.number));
  return { ok: true, token, expires_in_minutes: PHONE_TOKEN_TTL_MS / 60_000, wo_number: t.wo_number };
}

// ── Phone endpoints (signed-token gated; the phone is a different device) ─────
async function phoneInfo(supa, params) {
  const v = verifyPhoneToken(params?.token);
  if (!v) return { error: "This upload link is not valid.", status: 404 };
  if (v.expired) return { error: "This QR code expired. Ask the screen for a fresh one.", status: 410 };
  const { data: t } = await supa.from("tickets")
    .select("id, wo_number, issue_description, store_number, store_name").eq("id", v.ticketId).maybeSingle();
  if (!t) return { error: "Ticket not found.", status: 404 };
  const { count } = await supa.from("ticket_photos").select("id", { count: "exact", head: true }).eq("ticket_id", t.id);
  return {
    wo_number: t.wo_number, store_number: t.store_number, store_name: t.store_name,
    issue_description: (t.issue_description || "").slice(0, 200),
    photo_count: count || 0, max_photos: MAX_SCREEN_PHOTOS_PER_TICKET,
  };
}

async function phoneUpload(supa, body) {
  const v = verifyPhoneToken(body?.token);
  if (!v) return { error: "This upload link is not valid.", status: 404 };
  if (v.expired) return { error: "This QR code expired. Ask the screen for a fresh one.", status: 410 };
  const photoData = String(body?.photo_data || "");
  const photoName = String(body?.photo_name || "photo.jpg").slice(0, 120);
  const photoType = String(body?.photo_type || "image/jpeg");
  if (!photoData) return { error: "No photo received.", status: 400 };
  if (!/^image\//.test(photoType)) return { error: "Only images are allowed.", status: 400 };

  const { data: t } = await supa.from("tickets").select("id, store_number").eq("id", v.ticketId).maybeSingle();
  if (!t || String(t.store_number) !== v.storeNumber) return { error: "Ticket not found.", status: 404 };

  const { count } = await supa.from("ticket_photos")
    .select("id", { count: "exact", head: true }).eq("ticket_id", t.id).eq("upload_type", "store_screen");
  if ((count || 0) >= MAX_SCREEN_PHOTOS_PER_TICKET) {
    return { error: `Photo limit reached (${MAX_SCREEN_PHOTOS_PER_TICKET}).`, status: 429 };
  }
  const buf = Buffer.from(photoData, "base64");
  if (!buf.length) return { error: "Empty photo.", status: 400 };
  if (buf.length > MAX_SCREEN_PHOTO_BYTES) {
    return { error: `Photo too large; cap is ${MAX_SCREEN_PHOTO_BYTES / 1024 / 1024} MB.`, status: 413 };
  }

  const ext = (photoName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const fileName = `${t.id}/${Date.now()}_screen.${ext}`;
  const { error: upErr } = await supa.storage.from(PHOTOS_BUCKET)
    .upload(fileName, buf, { contentType: photoType, upsert: false });
  if (upErr) return { error: upErr.message, status: 500 };
  const { data: { publicUrl } } = supa.storage.from(PHOTOS_BUCKET).getPublicUrl(fileName);

  const { data: photo, error: insErr } = await supa.from("ticket_photos").insert({
    ticket_id: t.id, file_url: publicUrl || fileName, file_name: photoName,
    file_size: buf.length, mime_type: photoType,
    uploaded_by: "Store screen (phone)", upload_type: "store_screen",
  }).select("id").single();
  if (insErr) return { error: insErr.message, status: 500 };
  await supa.from("ticket_activities").insert({
    ticket_id: t.id, user_id: null, user_name: "Store screen (phone)", user_role: "store",
    update_type: "photo_added", event_type: "photo_added",
    event_data: { photo_id: photo?.id, file_name: photoName, source: "store_screen_qr" },
  });
  return { ok: true };
}

// ── Message a leader on Chat ──────────────────────────────────────────────────
// The store desktop can't place calls, so the call sheet messages leaders
// through the app's Chat instead: one dedicated "Store #N screen" thread per
// (store, leader), with the screen's notes arriving as system messages — the
// leader gets the normal inbox unread + push path on their own device.
async function chatLeader(supa, body) {
  const g = await gate(supa, body);
  if (g.error) return g;
  const { store } = g;
  const slot = String(body?.slot || "").trim().toUpperCase();
  const message = String(body?.message || "").trim();
  if (!slot || !message) return { error: "Pick a leader and write a message.", status: 400 };
  const reporter = String(body?.reporter_name || "").trim().slice(0, 120) || null;

  const contacts = await leadership(supa, store);
  const leader = contacts.find((c) => c.slot === slot && c.id);
  if (!leader) return { error: "That leader has no account to message. Try another contact.", status: 404 };

  // Find-or-create the per-(store, leader) thread.
  const scopeRef = `store-screen:${store.id}:${leader.id}`;
  let { data: thread } = await supa.from("chat_threads")
    .select("id").eq("scope_kind", "store").eq("scope_ref", scopeRef).maybeSingle();
  if (!thread) {
    const { data: created, error: tErr } = await supa.from("chat_threads").insert({
      kind: "group",
      title: `Store #${store.number} screen`,
      subtitle: [store.name, store.city].filter(Boolean).join(" · "),
      scope_kind: "store", scope_ref: scopeRef,
    }).select("id").single();
    if (tErr) return { error: tErr.message, status: 500 };
    thread = created;
    const { error: mErr } = await supa.from("chat_thread_members")
      .insert({ thread_id: thread.id, user_id: leader.id, role: "owner" });
    if (mErr) return { error: mErr.message, status: 500 };
  }

  const text = `${reporter ? `${reporter} at the store` : "The store screen"}: ${message.slice(0, 2000)}`;
  const { error } = await supa.from("chat_messages")
    .insert({ thread_id: thread.id, from_user_id: null, system: true, text });
  if (error) return { error: error.message, status: 500 };
  return { ok: true, leader: leader.name };
}

// ── Admin (Bearer + role=admin) ───────────────────────────────────────────────
async function getSessionUser(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: userRes, error } = await supa.auth.getUser(header.slice(7).trim());
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles")
    .select("id, role, is_active, full_name, preferred_name").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false || String(profile.role) !== "admin") return null;
  return profile;
}

async function adminList(supa) {
  const { data: stores } = await supa.from("stores")
    .select("id, number, name, city, state").eq("is_active", true).order("number");
  const { data: tokens } = await supa.from("store_portal_tokens")
    .select("id, store_id, token, is_active, device_id, device_bound_at, last_used_at, created_at")
    .order("created_at", { ascending: false });
  const byStore = new Map();
  for (const t of tokens || []) {
    if (!t.is_active) continue;
    if (!byStore.has(t.store_id)) byStore.set(t.store_id, t);
  }
  return {
    stores: (stores || []).map((s) => {
      const t = byStore.get(s.id) || null;
      return {
        store_id: s.id, number: s.number, name: s.name, city: s.city, state: s.state,
        token: t ? { id: t.id, token: t.token, bound: !!t.device_id, last_used_at: t.last_used_at, created_at: t.created_at } : null,
      };
    }),
  };
}

async function adminMint(supa, user, body) {
  const storeId = body?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  // One active token per store: revoke any existing active ones first.
  await supa.from("store_portal_tokens").update({ is_active: false }).eq("store_id", storeId).eq("is_active", true);
  const token = crypto.randomBytes(18).toString("hex");
  const { data, error } = await supa.from("store_portal_tokens")
    .insert({ store_id: storeId, token, created_by: user.id }).select("id, token").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, token_id: data.id, token: data.token };
}

async function adminRevoke(supa, _user, body) {
  const id = body?.token_id;
  if (!id) return { error: "Missing token.", status: 400 };
  const { error } = await supa.from("store_portal_tokens").update({ is_active: false }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// Live admin view of a store's Command Center: the same snapshot the store
// screen renders (no token/device needed — Bearer admin instead), plus the
// recent floor reports so the admin sees what is coming in.
async function adminSnapshot(supa, params) {
  const storeId = params?.store_id;
  if (!storeId) return { error: "Missing store.", status: 400 };
  const { data: store } = await supa.from("stores")
    .select("id, number, name, city, state").eq("id", storeId).maybeSingle();
  if (!store) return { error: "Store not found.", status: 404 };
  const [snap, reports] = await Promise.all([
    assembleSnapshot(supa, store),
    supa.from("store_portal_reports")
      .select("kind, message, reporter_name, created_at")
      .eq("store_id", storeId).order("created_at", { ascending: false }).limit(10)
      .then((r) => r.data || []),
  ]);
  return { ...snap, reports };
}

async function adminResetDevice(supa, _user, body) {
  const id = body?.token_id;
  if (!id) return { error: "Missing token.", status: 400 };
  const { error } = await supa.from("store_portal_tokens")
    .update({ device_id: null, device_bound_at: null }).eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const params = event.queryStringParameters || {};
  const action = params.action || "";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    // Public, token-gated actions.
    if (action === "resolve") return unwrap(await resolve(supa, body));
    if (action === "snapshot") return unwrap(await snapshot(supa, body));
    if (action === "report") return unwrap(await report(supa, event, body));
    if (action === "chat-leader") return unwrap(await chatLeader(supa, body));
    if (action === "tickets") return unwrap(await listStoreTickets(supa, event, body));
    if (action === "ticket") return unwrap(await getStoreTicket(supa, event, body));
    if (action === "create-ticket") return unwrap(await createStoreTicket(supa, event, body));
    if (action === "comment-ticket") return unwrap(await commentStoreTicket(supa, event, body));
    if (action === "photo-qr") return unwrap(await photoQr(supa, event, body));
    if (action === "phone-info") return unwrap(await phoneInfo(supa, params));
    if (action === "phone-upload") return unwrap(await phoneUpload(supa, body));
    // Admin actions.
    const user = await getSessionUser(event, supa);
    if (!user) return respond(401, { error: "unauthorized" });
    if (action === "admin-list") return unwrap(await adminList(supa));
    if (action === "admin-snapshot") return unwrap(await adminSnapshot(supa, params));
    if (action === "admin-mint") return unwrap(await adminMint(supa, user, body));
    if (action === "admin-revoke") return unwrap(await adminRevoke(supa, user, body));
    if (action === "admin-reset-device") return unwrap(await adminResetDevice(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
