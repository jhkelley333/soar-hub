// netlify/functions/facilities-v2.js
//
// Work Orders V2 (Facilities V2) — Supabase Bearer-JWT auth, bare-name
// tables, wo2-ticket-photos bucket (public). Lives on the
// claude/work-orders-v2 branch.
//
// Email notifications via Resend (REST API, no extra dep):
//   * createTicket       → notifies GM + DO with scope over the store
//   * submitApproval     → notifies users whose role matches the tier
//                          (DO < $500 → role 'do', SDO… → 'sdo', VP… → 'vp')
//   * decideApproval     → notifies the original requester
// Each send also writes a row into ticket_notifications so the audit
// log shows who got what.
//
// Templates: admin-editable rows in `email_templates` keyed by `kind`.
// `{{variable}}` placeholders get replaced with html-escaped values at
// send-time. If the row is missing or inactive the function falls back
// to a hardcoded default so a broken template doesn't stop sends.
//
// Required env vars:
//   SUPABASE_URL / VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY
//   RESEND_API_KEY                          — same key PAF already uses
//   FACILITIES_FROM_EMAIL                   — defaults to PAF's address
//   FACILITIES_FROM_NAME                    — default "SOAR Facilities"
//   APP_URL                                 — base URL for deep links;
//                                             Netlify exposes URL by default

import { createClient } from "@supabase/supabase-js";
import { can, requireCap, tierFor, activityVisibilityForTier } from "./_lib/permissions.js";
import { transition, setPause, isWithinReopenGrace, REOPEN_GRACE } from "./_lib/ticketStateMachine.js";
import { toNewStatus, toLegacyStatus, annotateLegacy } from "./_lib/statusMapping.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const PHOTOS_BUCKET = "wo2-ticket-photos";

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCallerProfile(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = getSupabase();
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

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function roleLevel(role) {
  const levels = {
    admin: 1, coo: 1, vp: 1,
    rvp: 2, sdo: 2,
    do: 3,
    gm: 4,
    shift_manager: 5,
    payroll: 6,
  };
  return levels[String(role || "").toLowerCase()] || 99;
}

async function getStoresForUser(supabase, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (["admin", "coo", "vp", "sdo", "rvp"].includes(role)) {
    return { all: true, stores: [] };
  }
  const { data: scopes } = await supabase
    .from("user_scopes")
    .select("scope_type, scope_id")
    .eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, stores: [] };

  const directStoreIds = scopes
    .filter((s) => s.scope_type === "store")
    .map((s) => s.scope_id);
  const districtIds = scopes
    .filter((s) => s.scope_type === "district")
    .map((s) => s.scope_id);
  const areaIds = scopes
    .filter((s) => s.scope_type === "area")
    .map((s) => s.scope_id);
  const regionIds = scopes
    .filter((s) => s.scope_type === "region")
    .map((s) => s.scope_id);

  if (regionIds.length) {
    const { data } = await supabase
      .from("areas")
      .select("id")
      .in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supabase
      .from("districts")
      .select("id")
      .in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supabase
      .from("stores")
      .select("id")
      .in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, stores: [] };

  const { data: storeRows } = await supabase
    .from("stores")
    .select("number")
    .in("id", Array.from(storeIds));
  return {
    all: false,
    stores: (storeRows || []).map((s) => String(s.number)),
  };
}

async function generateWONumber(supabase, storeNumber) {
  const { data, error } = await supabase.rpc("next_wo_sequence", {
    p_store: String(storeNumber),
  });
  if (error) {
    const { data: seq } = await supabase
      .from("wo_sequences")
      .select("last_sequence")
      .eq("store_number", String(storeNumber))
      .single();
    const next = ((seq && seq.last_sequence) || 0) + 1;
    await supabase
      .from("wo_sequences")
      .upsert({ store_number: String(storeNumber), last_sequence: next });
    return `WO-${storeNumber}-${String(next).padStart(3, "0")}`;
  }
  return `WO-${storeNumber}-${String(data).padStart(3, "0")}`;
}

// ── Notifications ─────────────────────────────────────────────

async function findUsersForStore(supabase, storeNumber, roleFilter) {
  if (!storeNumber) return [];
  const { data: store } = await supabase
    .from("stores")
    .select("id, district_id, email")
    .eq("number", String(storeNumber))
    .maybeSingle();
  if (!store) return [];
  const storeEmail = (store.email || "").trim() || null;

  const ids = [store.id];
  if (store.district_id) {
    ids.push(store.district_id);
    const { data: district } = await supabase
      .from("districts")
      .select("area_id")
      .eq("id", store.district_id)
      .maybeSingle();
    if (district?.area_id) {
      ids.push(district.area_id);
      const { data: area } = await supabase
        .from("areas")
        .select("region_id")
        .eq("id", district.area_id)
        .maybeSingle();
      if (area?.region_id) ids.push(area.region_id);
    }
  }

  const { data: scopes } = await supabase
    .from("user_scopes")
    .select("user_id")
    .in("scope_id", ids);
  const userIds = [...new Set((scopes || []).map((s) => s.user_id))];
  if (!userIds.length) return [];

  let q = supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .in("id", userIds)
    .eq("is_active", true);
  const rf = Array.isArray(roleFilter) ? roleFilter : roleFilter ? [roleFilter] : null;
  if (rf?.length) q = q.in("role", rf);

  const { data: users } = await q;
  // For GM and shift_manager, always route to the store's shared
  // email (stores.email) instead of their personal profile email.
  // The store inbox is the GM's working address for this app, and it
  // survives staff turnover. Never substitute plate_iq_email.
  return (users || []).map((u) => {
    const role = String(u.role || "").toLowerCase();
    if (role === "gm" || role === "shift_manager") {
      return { ...u, email: storeEmail };
    }
    return u;
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appBaseUrl() {
  return process.env.APP_URL || process.env.URL || "";
}

// Build the substitution dictionary for {{var}} placeholders. Anything
// not in this map gets left as the raw token at render-time so an
// unknown var doesn't silently delete text.
function buildTicketVars(ticket) {
  const base = appBaseUrl();
  return {
    wo_number: ticket.wo_number || "",
    store_number: ticket.store_number || "",
    store_name: ticket.store_name || "",
    asset_type: ticket.asset_type || "",
    category: ticket.category || "",
    priority: ticket.priority || "",
    status: ticket.status || "",
    issue_description: ticket.issue_description || "",
    approval_level: ticket.approval_level || "",
    approval_request_notes: ticket.approval_request_notes || "",
    approval_status: ticket.approval_status || "",
    approval_approved_by: ticket.approval_approved_by || "",
    submitted_by: ticket.submitted_by || "",
    is_business_critical: ticket.is_business_critical ? "Yes" : "No",
    link: base ? `${base}/admin/work-orders-v2` : "",
  };
}

// Mustache-ish: only `{{name}}` is supported. Unknown vars stay as-is
// so the admin can spot typos. Values are html-escaped before insert.
function renderTemplate(text, vars) {
  if (!text) return "";
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined ? `{{${key}}}` : escapeHtml(String(v));
  });
}

async function getActiveTemplate(supabase, kind) {
  const { data } = await supabase
    .from("email_templates")
    .select("subject, body_html, is_active")
    .eq("kind", kind)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data;
}

// Hardcoded fallback used when the DB template is missing or off.
// Kept tight so a busted template can't take notifications down.
function fallbackSubject(ticket, kind) {
  if (kind === "submitted") {
    const what = ticket.asset_type || ticket.category || "Service Request";
    return `[Work Order] New ${ticket.wo_number} — Store ${ticket.store_number}: ${what}`;
  }
  if (kind === "approval_requested") {
    return `[Work Order] Approval needed (${ticket.approval_level || "—"}) — ${ticket.wo_number}`;
  }
  if (kind === "approval_decided") {
    return `[Work Order] Approval ${ticket.approval_status || "Decided"} — ${ticket.wo_number}`;
  }
  return `[Work Order] Update — ${ticket.wo_number}`;
}

function fallbackHtml(ticket, kind) {
  const base = appBaseUrl();
  const link = base ? `${base}/admin/work-orders-v2` : "";
  const linkHtml = link
    ? `<p style="margin-top:16px;"><a href="${link}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;">View in Work Orders V2 →</a></p>`
    : "";
  const detail = `
    <table style="font-size:14px;border-collapse:collapse;margin:10px 0;">
      <tr><td style="padding:3px 8px;color:#666;">WO #</td><td style="padding:3px 8px;font-family:monospace;">${escapeHtml(ticket.wo_number)}</td></tr>
      <tr><td style="padding:3px 8px;color:#666;">Store</td><td style="padding:3px 8px;">${escapeHtml(ticket.store_number)}${ticket.store_name ? ` — ${escapeHtml(ticket.store_name)}` : ""}</td></tr>
      <tr><td style="padding:3px 8px;color:#666;">Asset</td><td style="padding:3px 8px;">${escapeHtml(ticket.asset_type || "—")}</td></tr>
      <tr><td style="padding:3px 8px;color:#666;">Priority</td><td style="padding:3px 8px;">${escapeHtml(ticket.priority || "—")}${ticket.is_business_critical ? " · 🔴 Critical" : ""}</td></tr>
      <tr><td style="padding:3px 8px;color:#666;">Status</td><td style="padding:3px 8px;">${escapeHtml(ticket.status)}</td></tr>
    </table>
  `;
  let body = "";
  if (kind === "submitted") {
    body = `<p>A new facilities work order was submitted.</p>${detail}<p><strong>Issue:</strong></p><p style="white-space:pre-wrap;color:#333;">${escapeHtml(ticket.issue_description || "—")}</p>`;
  } else if (kind === "approval_requested") {
    body = `<p><strong>Approval requested at tier:</strong> ${escapeHtml(ticket.approval_level || "—")}</p>${detail}<p><strong>Request notes:</strong></p><p style="white-space:pre-wrap;color:#333;">${escapeHtml(ticket.approval_request_notes || "—")}</p>`;
  } else if (kind === "approval_decided") {
    body = `<p>Your approval request was <strong>${escapeHtml(ticket.approval_status || "Decided")}</strong>${ticket.approval_approved_by ? ` by ${escapeHtml(ticket.approval_approved_by)}` : ""}.</p>${detail}`;
  }
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;padding:16px;">${body}${linkHtml}<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">Sent automatically by SOAR Facilities V2 (fallback template).</p></body></html>`;
}

// Returns { subject, html } using a DB template if available, otherwise
// the hardcoded fallback. Always succeeds.
async function renderEmail(supabase, ticket, kind) {
  const tmpl = await getActiveTemplate(supabase, kind);
  if (tmpl) {
    const vars = buildTicketVars(ticket);
    return {
      subject: renderTemplate(tmpl.subject, vars),
      html: renderTemplate(tmpl.body_html, vars),
    };
  }
  return {
    subject: fallbackSubject(ticket, kind),
    html: fallbackHtml(ticket, kind),
  };
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not set" };
  }
  const fromAddr =
    process.env.FACILITIES_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    "paf@mysoarhub.com";
  const fromName = process.env.FACILITIES_FROM_NAME || "SOAR Facilities";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddr}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { sent: false, reason: body?.message || `HTTP ${res.status}` };
    }
    return { sent: true, id: body.id };
  } catch (e) {
    return { sent: false, reason: e?.message || String(e) };
  }
}

async function notifyTicketEvent(supabase, ticket, kind) {
  let recipients = [];
  if (kind === "submitted") {
    recipients = await findUsersForStore(supabase, ticket.store_number, ["gm", "do"]);
  } else if (kind === "approval_requested") {
    const tier = String(ticket.approval_level || "");
    let role = "do";
    if (tier.startsWith("SDO")) role = "sdo";
    else if (tier.startsWith("VP")) role = "vp";
    recipients = await findUsersForStore(supabase, ticket.store_number, [role]);
  } else if (kind === "approval_decided") {
    if (ticket.submitted_by_user_id) {
      const { data: u } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", ticket.submitted_by_user_id)
        .maybeSingle();
      if (u) {
        // Same policy as findUsersForStore: GM and shift_manager
        // always route to the store inbox, not their personal email.
        const submitterRole = String(u.role || "").toLowerCase();
        if (submitterRole === "gm" || submitterRole === "shift_manager") {
          const { data: storeRow } = await supabase
            .from("stores")
            .select("email")
            .eq("number", String(ticket.store_number))
            .maybeSingle();
          const storeEmail = (storeRow?.email || "").trim() || null;
          recipients = [{ ...u, email: storeEmail }];
        } else {
          recipients = [u];
        }
      }
    }
  }

  const seen = new Set();
  recipients = recipients.filter((r) => {
    if (!r?.email) return false;
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });
  if (!recipients.length) return;

  const { subject, html } = await renderEmail(supabase, ticket, kind);

  for (const r of recipients) {
    const result = await sendEmail({ to: r.email, subject, html });
    await supabase.from("ticket_notifications").insert({
      ticket_id: ticket.id,
      recipient_email: r.email,
      recipient_name: r.full_name,
      notification_type: kind,
      subject,
      message: html,
      status: result.sent ? "sent" : `failed: ${result.reason}`,
    }).then(() => {}).catch((e) => {
      console.warn("[facilities-v2] notification log insert failed", e);
    });
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  const profile = await getCallerProfile(event);
  if (!profile) return respond(401, { ok: false, message: "Not authenticated." });

  const action = (event.queryStringParameters || {}).action || "";
  const role = String(profile.role || "").toLowerCase();
  const userId = profile.id;
  const userName = profile.full_name || profile.email;
  const supabase = getSupabase();

  try {
    // ── EMAIL TEMPLATES (admin only for writes) ──
    if (action === "getEmailTemplates") {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("kind");
      if (error) throw error;
      return respond(200, { ok: true, templates: data });
    }
    if (action === "saveEmailTemplate" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const payload = JSON.parse(event.body);
      const { kind, subject, body_html, is_active } = payload;
      if (!kind || !subject || !body_html) {
        return respond(400, {
          ok: false,
          message: "kind, subject, body_html required.",
        });
      }
      const { data, error } = await supabase
        .from("email_templates")
        .upsert({
          kind,
          subject,
          body_html,
          is_active: is_active !== false,
          updated_by: userName,
          updated_at: new Date().toISOString(),
        }, { onConflict: "kind" })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, template: data });
    }
    if (action === "previewEmailTemplate" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const { subject, body_html, vars } = JSON.parse(event.body);
      if (!subject || !body_html) {
        return respond(400, {
          ok: false, message: "subject and body_html required.",
        });
      }
      const sampleVars = vars || buildTicketVars({
        wo_number: "WO-1082-001",
        store_number: "1082",
        store_name: "Test Store",
        asset_type: "Fryer",
        category: "Equipment Type",
        priority: "Urgent",
        status: "Pending Approval",
        issue_description: "Sample issue description for preview.",
        approval_level: "SDO $501-$1000",
        approval_request_notes: "Sample approval notes.",
        approval_status: "Approved",
        approval_approved_by: "Jane Approver",
        submitted_by: "GM Test",
        is_business_critical: false,
      });
      return respond(200, {
        ok: true,
        subject: renderTemplate(subject, sampleVars),
        html: renderTemplate(body_html, sampleVars),
      });
    }

    // ── GET ISSUE LIBRARY ──
    if (action === "getIssueLibrary") {
      const { data, error } = await supabase
        .from("issue_library")
        .select("*")
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return respond(200, { ok: true, items: data });
    }

    // ── GET CALLER STORES ──
    // Drives the Store field on the New Ticket modal.
    //   - GM / shift_manager → "single" mode + their primary store (auto-fill)
    //   - DO+                → "list"   mode + every store in their scope
    // Stores arrive as { id, number, name } so the UI can render either a
    // chip or a dropdown without a second round-trip.
    if (action === "getCallerStores") {
      const isSingle = role === "gm" || role === "shift_manager";

      // Source of truth: user_visible_stores(uid) RPC (migration 0032).
      // Already encodes user_scopes (store/district/area/region/global)
      // AND profile.primary_store_id fallback. Using it here means v2
      // store visibility is identical to v1 + the rest of the app.
      async function visibleStoreRows() {
        const { data: visibleIds } = await supabase.rpc("user_visible_stores", {
          uid: userId,
        });
        const ids = (visibleIds ?? [])
          .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
          .filter(Boolean);
        if (!ids.length) return [];
        const { data: rows } = await supabase
          .from("stores")
          .select("id, number, name")
          .in("id", ids)
          .order("number");
        return (rows || []).map((s) => ({
          id: s.id,
          number: String(s.number),
          name: s.name || "",
        }));
      }

      if (isSingle) {
        const stores = await visibleStoreRows();
        if (stores.length === 0) {
          return respond(200, { ok: true, mode: "single", stores: [] });
        }
        if (stores.length === 1) {
          return respond(200, { ok: true, mode: "single", stores });
        }
        // Multi-site shift_manager / GM — let them pick from a dropdown.
        return respond(200, { ok: true, mode: "list", stores });
      }

      // Non-single roles: admin/coo/vp/sdo/rvp see every active store
      // (existing v2 contract). DO falls through user_visible_stores.
      if (["admin", "coo", "vp", "sdo", "rvp"].includes(role)) {
        const { data: rows, error } = await supabase
          .from("stores")
          .select("id, number, name")
          .order("number");
        if (error) throw error;
        return respond(200, {
          ok: true,
          mode: "list",
          stores: (rows || []).map((s) => ({
            id: s.id,
            number: String(s.number),
            name: s.name || "",
          })),
        });
      }

      return respond(200, {
        ok: true,
        mode: "list",
        stores: await visibleStoreRows(),
      });
    }

    // ── GET TICKETS ──
    if (action === "getTickets") {
      const storeAccess = await getStoresForUser(supabase, profile);
      let query = supabase
        .from("tickets")
        .select(`
          *,
          ticket_photos(id, file_url, file_name, upload_type, created_at),
          ticket_approvals(id, approval_tier, status, requested_at, approved_at, approved_by, notes, quote_url),
          ticket_activities(id, user_name, event_type, event_data, notes, created_at)
        `)
        .order("date_submitted", { ascending: false });

      if (!storeAccess.all && storeAccess.stores.length) {
        query = query.in("store_number", storeAccess.stores);
      } else if (!storeAccess.all) {
        return respond(200, { ok: true, tickets: [] });
      }

      const storeFilter = (event.queryStringParameters || {}).store;
      if (storeFilter) query = query.eq("store_number", storeFilter);

      const { data, error } = await query;
      if (error) throw error;
      return respond(200, { ok: true, tickets: annotateLegacy(data) });
    }

    // ── GET SINGLE TICKET ──
    if (action === "getTicket") {
      const { id } = event.queryStringParameters || {};
      if (!id) return respond(400, { ok: false, message: "id required." });
      const { data, error } = await supabase
        .from("tickets")
        .select(`
          *,
          ticket_photos(*),
          ticket_approvals(*),
          ticket_activities(*)
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      return respond(200, { ok: true, ticket: annotateLegacy(data) });
    }

    // ── CREATE TICKET ──
    if (action === "createTicket" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const {
        storeNumber, storeName, storeEmail, doEmail, sdoEmail,
        category, assetType, modelNumber, issueDescription,
        priority, isBusinessCritical, troubleshootingChecked,
        vendorContacted, vendorName, costEstimate, photos,
      } = payload;

      if (!storeNumber || !issueDescription) {
        return respond(400, {
          ok: false,
          message: "Store number and issue description required.",
        });
      }

      const woNumber = await generateWONumber(supabase, storeNumber);

      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .insert({
          wo_number:              woNumber,
          store_number:           storeNumber,
          store_name:             storeName || "",
          store_email:            storeEmail || "",
          do_email:               doEmail || "",
          sdo_email:              sdoEmail || "",
          submitted_by:           userName,
          submitted_by_user_id:   userId,
          category:               category || "",
          asset_type:             assetType || "",
          model_number:           modelNumber || "",
          issue_description:      issueDescription,
          status:                 "submitted",
          priority:               priority || "Standard",
          is_business_critical:   isBusinessCritical || false,
          troubleshooting_checked:troubleshootingChecked || false,
          vendor_contacted:       vendorContacted || false,
          vendor_name:            vendorName || "",
          cost_estimate:          costEstimate || null,
          date_submitted:         new Date().toISOString(),
        })
        .select()
        .single();
      if (ticketError) throw ticketError;

      await supabase.from("ticket_activities").insert({
        ticket_id:   ticket.id,
        user_id:     userId,
        user_name:   userName,
        user_role:   role,
        update_type: "created",
        new_value:   "submitted",
        notes:       "Ticket created",
        event_type:  "ticket_created",
        event_data:  { initial_status: "submitted", wo_number: woNumber },
        visibility:  "all",
      });

      if (photos && photos.length) {
        const photoRows = photos.map((p) => ({
          ticket_id:   ticket.id,
          file_url:    p.url || "",
          file_name:   p.name || "",
          file_size:   p.size || 0,
          mime_type:   p.mimeType || "",
          uploaded_by: userName,
          upload_type: "submission",
        }));
        await supabase.from("ticket_photos").insert(photoRows);
      }

      try {
        await notifyTicketEvent(supabase, ticket, "submitted");
      } catch (e) {
        console.warn("[facilities-v2] notifyTicketEvent submitted failed", e);
      }

      return respond(200, { ok: true, ticket: annotateLegacy(ticket), woNumber });
    }

    // ── UPDATE TICKET ──
    if (action === "updateTicket" && event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const {
        id, status, notes, vendorName, vendorId, vendorEta,
        costEstimate, priority, isBusinessCritical,
      } = payload;
      if (!id) return respond(400, { ok: false, message: "id required." });

      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state, vendor_name, closed_at")
        .eq("id", id)
        .single();
      if (!current) {
        return respond(404, { ok: false, message: "Ticket not found." });
      }

      const updates = { updated_at: new Date().toISOString() };
      const activityEntries = [];

      // ── Status change — route through state machine ──
      // Legacy clients send v1 strings ("Closed", "In Progress"); new
      // clients send the v2 enum ("closed", "in_progress"). toNewStatus
      // normalizes both.
      if (status !== undefined && status !== null && status !== "") {
        const mapped = toNewStatus(status);
        if (!mapped || !mapped.status) {
          return respond(422, {
            ok: false,
            error: "unknown_status",
            message: `Unrecognized status value: ${status}`,
          });
        }
        const targetStatus = mapped.status;
        const targetPause  = mapped.pause_state;

        if (targetStatus !== current.status) {
          // Real transition. Legacy callers may not send the structured
          // reason/vendor fields the state machine wants. For backwards
          // compatibility during the dual-write release, derive defaults
          // for known-safe cases; otherwise reject with 422 and let the
          // caller learn the new shape.
          const transitionPayload = { ...payload };
          if (targetStatus === "closed" && !transitionPayload.store_close_reason
              && !transitionPayload.admin_close_reason) {
            // Legacy "Closed" with no reason → assume admin close, verified.
            transitionPayload.admin_close_reason = "completed_and_verified";
            transitionPayload.resolution_category =
              transitionPayload.resolution_category || "completed_and_verified";
          }
          if (targetStatus === "scheduled" && !transitionPayload.vendor_id && vendorId) {
            transitionPayload.vendor_id = vendorId;
          }

          let machineResult;
          try {
            machineResult = transition({
              from: current.status,
              to:   targetStatus,
              payload: transitionPayload,
              ctx: {
                ticketId:    id,
                closed_at:   current.closed_at,
                pause_state: current.pause_state,
                actor: { id: userId, role, tier: tierFor(role) },
              },
            });
          } catch (smErr) {
            const code = smErr.statusCode || 500;
            return respond(code, {
              ok: false,
              error: smErr.code || "state_machine_error",
              message: smErr.message,
              ...(smErr.from ? { from: smErr.from, to: smErr.to } : {}),
              ...(smErr.field ? { field: smErr.field } : {}),
            });
          }

          Object.assign(updates, machineResult.updates);
          updates.date_status_updated = new Date().toISOString();
          if (targetStatus === "closed" || targetStatus === "cancelled") {
            // Preserve legacy `date_completed` for v1 reporting tools.
            updates.date_completed = updates.closed_at || new Date().toISOString();
          }

          if (machineResult.activity) {
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "status_change",
              old_value:   current.status,
              new_value:   targetStatus,
              event_type:  machineResult.activity.event_type,
              event_data:  machineResult.activity.event_data,
              visibility:  machineResult.activity.visibility,
            });
          }
          if (machineResult.pauseResetActivity) {
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "pause_state_change",
              event_type:  machineResult.pauseResetActivity.event_type,
              event_data:  machineResult.pauseResetActivity.event_data,
              visibility:  machineResult.pauseResetActivity.visibility,
            });
          }
        }

        // Legacy substatus (On Hold / Part on Order / New Equipment
        // Ordered) implies a pause_state too. Apply it after status if
        // status didn't auto-reset it.
        if (targetPause && targetPause !== "none"
            && (targetStatus === "in_progress" || targetStatus === "scheduled")) {
          if (current.pause_state !== targetPause) {
            updates.pause_state = targetPause;
            activityEntries.push({
              ticket_id: id, user_id: userId, user_name: userName, user_role: role,
              update_type: "pause_state_change",
              event_type:  "pause_state_changed",
              event_data:  { from: current.pause_state, to: targetPause,
                             auto_reset: false, source: "legacy_status_mapping" },
              visibility:  "all",
            });
          }
        }
      }

      // ── Non-status field edits ──
      if (notes !== undefined) {
        updates.latest_comment = notes;
        if (notes && String(notes).trim()) {
          activityEntries.push({
            ticket_id: id, user_id: userId, user_name: userName, user_role: role,
            update_type: "comment",
            notes,
            event_type:  "comment_added",
            event_data:  { text: notes },
            visibility:  "all",
          });
        }
      }
      if (vendorName !== undefined) updates.vendor_name = vendorName;
      if (vendorId) updates.vendor_id = vendorId;
      if (vendorEta) updates.vendor_eta = vendorEta;
      if (costEstimate !== undefined) updates.cost_estimate = costEstimate;
      if (priority) updates.priority = priority;
      if (isBusinessCritical !== undefined) {
        updates.is_business_critical = isBusinessCritical;
      }
      if (vendorName && vendorName !== current.vendor_name) {
        activityEntries.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "vendor_assigned",
          new_value:   vendorName,
          event_type:  "assigned",
          event_data:  { vendor_name: vendorName, vendor_id: vendorId || null },
          visibility:  "all",
        });
      }
      if (vendorEta) {
        activityEntries.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "eta_set",
          new_value:   String(vendorEta),
          event_type:  "eta_set",
          event_data:  { eta: vendorEta },
          visibility:  "all",
        });
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      if (activityEntries.length) {
        await supabase.from("ticket_activities").insert(activityEntries);
      }
      return respond(200, { ok: true, ticket: annotateLegacy(ticket) });
    }

    // ── TRANSITION TICKET (new strict path) ──
    // Single endpoint for any status change. Same state machine,
    // strict payload validation. New UI uses this directly; the
    // legacy updateTicket also routes status changes through the
    // same machine for backwards compat.
    if (action === "transitionTicket" && event.httpMethod === "POST") {
      const denied = requireCap(profile, "transition_status");
      if (denied) return denied;

      const body = JSON.parse(event.body || "{}");
      const { id, to, payload: txPayload = {} } = body;
      if (!id || !to) {
        return respond(400, { ok: false, message: "id and to required." });
      }

      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state, closed_at, vendor_name")
        .eq("id", id)
        .single();
      if (!current) return respond(404, { ok: false, message: "Ticket not found." });

      let result;
      try {
        result = transition({
          from: current.status,
          to,
          payload: txPayload,
          ctx: {
            ticketId:    id,
            closed_at:   current.closed_at,
            pause_state: current.pause_state,
            actor: { id: userId, role, tier: tierFor(role) },
          },
        });
      } catch (smErr) {
        const code = smErr.statusCode || 500;
        return respond(code, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
          ...(smErr.from ? { from: smErr.from, to: smErr.to } : {}),
          ...(smErr.field ? { field: smErr.field } : {}),
        });
      }

      const updates = {
        ...result.updates,
        date_status_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (to === "closed" || to === "cancelled") {
        updates.date_completed = updates.closed_at || new Date().toISOString();
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      const activityRows = [];
      if (result.activity) {
        activityRows.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "status_change",
          old_value:   current.status,
          new_value:   to,
          event_type:  result.activity.event_type,
          event_data:  result.activity.event_data,
          visibility:  result.activity.visibility,
        });
      }
      if (result.pauseResetActivity) {
        activityRows.push({
          ticket_id: id, user_id: userId, user_name: userName, user_role: role,
          update_type: "pause_state_change",
          event_type:  result.pauseResetActivity.event_type,
          event_data:  result.pauseResetActivity.event_data,
          visibility:  result.pauseResetActivity.visibility,
        });
      }
      if (activityRows.length) {
        await supabase.from("ticket_activities").insert(activityRows);
      }

      return respond(200, { ok: true, ticket: annotateLegacy(ticket) });
    }

    // ── SET PAUSE STATE ──
    if (action === "setPauseState" && event.httpMethod === "POST") {
      const denied = requireCap(profile, "set_pause_state");
      if (denied) return denied;

      const body = JSON.parse(event.body || "{}");
      const { id, pause_state: nextPause, reason_note: reasonNote } = body;
      if (!id || nextPause === undefined) {
        return respond(400, { ok: false, message: "id and pause_state required." });
      }
      const { data: current } = await supabase
        .from("tickets")
        .select("status, pause_state")
        .eq("id", id)
        .single();
      if (!current) return respond(404, { ok: false, message: "Ticket not found." });

      let result;
      try {
        result = setPause({
          currentStatus: current.status,
          currentPause:  current.pause_state,
          to:            nextPause,
          reasonNote,
        });
      } catch (smErr) {
        return respond(smErr.statusCode || 500, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
        });
      }

      const { data: ticket, error } = await supabase
        .from("tickets")
        .update({ ...result.updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      await supabase.from("ticket_activities").insert({
        ticket_id: id, user_id: userId, user_name: userName, user_role: role,
        update_type: "pause_state_change",
        event_type:  result.activity.event_type,
        event_data:  result.activity.event_data,
        visibility:  result.activity.visibility,
      });

      return respond(200, { ok: true, ticket: annotateLegacy(ticket) });
    }

    // ── GET TICKET ACTIVITIES ──
    if (action === "getTicketActivities") {
      const { id } = event.queryStringParameters || {};
      if (!id) return respond(400, { ok: false, message: "id required." });

      let q = supabase
        .from("ticket_activities")
        .select("id, ticket_id, user_id, user_name, user_role, event_type, event_data, notes, visibility, created_at")
        .eq("ticket_id", id)
        .order("created_at", { ascending: false });

      const allowed = activityVisibilityForTier(tierFor(role));
      if (allowed) q = q.in("visibility", allowed);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { ok: true, activities: data || [] });
    }

    // ── SUBMIT APPROVAL ──
    if (action === "submitApproval" && event.httpMethod === "POST") {
      const { id, approvalTier, approvalNotes, quoteUrl } = JSON.parse(event.body);
      if (!id || !approvalTier) {
        return respond(400, { ok: false, message: "id and approvalTier required." });
      }
      const { error: approvalError } = await supabase
        .from("ticket_approvals")
        .insert({
          ticket_id:    id,
          approval_tier:approvalTier,
          requested_by: userName,
          notes:        approvalNotes || "",
          quote_url:    quoteUrl || "",
          status:       "Pending",
        });
      if (approvalError) throw approvalError;

      await supabase
        .from("tickets")
        .update({
          approval_level:         approvalTier,
          approval_request_notes: approvalNotes || "",
          approval_status:        "Pending",
          updated_at:             new Date().toISOString(),
        })
        .eq("id", id);

      await supabase.from("ticket_activities").insert({
        ticket_id:   id, user_id: userId, user_name: userName,
        user_role:   role, update_type: "approval", new_value: "Pending",
        notes:       `Approval requested: ${approvalTier}`,
        event_type:  "approval_requested",
        event_data:  { approval_tier: approvalTier, quote_url: quoteUrl || null,
                       notes: approvalNotes || null },
        visibility:  "all",
      });

      const { data: refreshed } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .single();
      if (refreshed) {
        try {
          await notifyTicketEvent(supabase, refreshed, "approval_requested");
        } catch (e) {
          console.warn("[facilities-v2] notifyTicketEvent approval_requested failed", e);
        }
      }

      return respond(200, { ok: true });
    }

    // ── DECIDE APPROVAL ──
    if (action === "decideApproval" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const { id, approvalId, decision, notes } = JSON.parse(event.body);
      await supabase
        .from("ticket_approvals")
        .update({
          status:      decision,
          approved_by: userName,
          approved_at: new Date().toISOString(),
          notes:       notes || "",
        })
        .eq("id", approvalId);

      await supabase
        .from("tickets")
        .update({
          approval_status:     decision,
          approval_approved_by:userName,
          approval_approved_at:new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        })
        .eq("id", id);

      await supabase.from("ticket_activities").insert({
        ticket_id:   id, user_id: userId, user_name: userName,
        user_role:   role, update_type: "approval", new_value: decision,
        notes:       `Approval ${decision} by ${userName}`,
        event_type:  "approval_decided",
        event_data:  { decision, decided_by: userName, decision_notes: decisionNotes || null },
        visibility:  "all",
      });

      const { data: refreshed } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", id)
        .single();
      if (refreshed) {
        try {
          await notifyTicketEvent(supabase, refreshed, "approval_decided");
        } catch (e) {
          console.warn("[facilities-v2] notifyTicketEvent approval_decided failed", e);
        }
      }

      return respond(200, { ok: true });
    }

    // ── UPLOAD PHOTO ──
    if (action === "uploadPhoto" && event.httpMethod === "POST") {
      const { id, photoData, photoType, photoName, uploadType } = JSON.parse(event.body);
      if (!id || !photoData) {
        return respond(400, { ok: false, message: "id and photoData required." });
      }
      const buf = Buffer.from(photoData, "base64");
      const ext = (photoName || "photo.jpg").split(".").pop();
      const fileName = `${id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(fileName, buf, {
          contentType: photoType || "image/jpeg",
          upsert: false,
        });
      if (uploadError) {
        console.error("Upload error:", JSON.stringify(uploadError));
        throw uploadError;
      }
      const { data: { publicUrl } } = supabase.storage
        .from(PHOTOS_BUCKET)
        .getPublicUrl(fileName);

      const { data: photo } = await supabase
        .from("ticket_photos")
        .insert({
          ticket_id:   id,
          file_url:    publicUrl || fileName,
          file_name:   photoName || "photo.jpg",
          file_size:   buf.length,
          mime_type:   photoType || "image/jpeg",
          uploaded_by: userName,
          upload_type: uploadType || "update",
        })
        .select()
        .single();

      // Activity entry so the photo shows up on the ticket timeline.
      await supabase.from("ticket_activities").insert({
        ticket_id: id, user_id: userId, user_name: userName, user_role: role,
        update_type: "photo_added",
        event_type:  "photo_added",
        event_data: {
          photo_id:    photo?.id,
          file_name:   photoName || "photo.jpg",
          upload_type: uploadType || "update",
        },
        visibility: "all",
      });

      return respond(200, { ok: true, photo });
    }

    // ── SAVE VENDOR ──
    if (action === "saveVendor" && event.httpMethod === "POST") {
      if (roleLevel(role) > 3) {
        return respond(403, { ok: false, message: "DO and above only." });
      }
      const payload = JSON.parse(event.body);
      const { id: vendorId, ...fields } = payload;
      if (vendorId) {
        const { data, error } = await supabase
          .from("vendors")
          .update(fields)
          .eq("id", vendorId)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, vendor: data });
      } else {
        const { data, error } = await supabase
          .from("vendors")
          .insert(fields)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, vendor: data });
      }
    }

    // ── STATS ──
    if (action === "getStats") {
      const storeAccess = await getStoresForUser(supabase, profile);
      let query = supabase
        .from("tickets")
        .select("status, priority, is_business_critical, date_submitted, store_number");
      if (!storeAccess.all && storeAccess.stores.length) {
        query = query.in("store_number", storeAccess.stores);
      } else if (!storeAccess.all) {
        return respond(200, {
          ok: true,
          stats: { open: 0, closed: 0, critical: 0, aged: 0, byStatus: {}, total: 0 },
        });
      }
      const { data, error } = await query;
      if (error) throw error;

      const now = Date.now();
      // "Open" is anything not in a terminal state. Phase 1 enum:
      // completed counts as still-open-pending-confirmation, closed
      // and cancelled are terminal. Mirrors the frontend's
      // isOpenStatus() helper exactly.
      const TERMINAL = new Set(["completed", "closed", "cancelled"]);
      const open     = data.filter((t) => !TERMINAL.has(t.status)).length;
      const closed   = data.filter((t) => t.status === "closed").length;
      const critical = data.filter(
        (t) => t.is_business_critical && !TERMINAL.has(t.status),
      ).length;
      const aged = data.filter((t) => {
        if (TERMINAL.has(t.status)) return false;
        const d = new Date(t.date_submitted);
        return (now - d.getTime()) / 86400000 >= 15;
      }).length;
      const byStatus = {};
      for (const t of data) byStatus[t.status] = (byStatus[t.status] || 0) + 1;

      return respond(200, {
        ok: true,
        stats: { open, closed, critical, aged, byStatus, total: data.length },
      });
    }

    // ── ISSUE LIBRARY CRUD (admin only) ──
    if (action === "saveIssueItem" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const payload = JSON.parse(event.body);
      const { id: itemId, ...fields } = payload;
      if (itemId) {
        const { data, error } = await supabase
          .from("issue_library")
          .update(fields)
          .eq("id", itemId)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, item: data });
      } else {
        const { data, error } = await supabase
          .from("issue_library")
          .insert(fields)
          .select()
          .single();
        if (error) throw error;
        return respond(200, { ok: true, item: data });
      }
    }
    if (action === "deleteIssueItem" && event.httpMethod === "POST") {
      if (role !== "admin") {
        return respond(403, { ok: false, message: "Admin only." });
      }
      const { id: itemId } = JSON.parse(event.body);
      await supabase.from("issue_library").delete().eq("id", itemId);
      return respond(200, { ok: true });
    }

    // ── VENDOR RATINGS ──
    if (action === "rateVendor" && event.httpMethod === "POST") {
      const { vendorId, ticketId, storeNumber, rating, comment } =
        JSON.parse(event.body);
      if (!vendorId || !rating) {
        return respond(400, {
          ok: false,
          message: "vendorId and rating required.",
        });
      }
      if (rating < 1 || rating > 5) {
        return respond(400, { ok: false, message: "Rating must be 1-5." });
      }
      const { data, error } = await supabase
        .from("vendor_ratings")
        .insert({
          vendor_id:    vendorId,
          ticket_id:    ticketId || null,
          store_number: storeNumber || "",
          rating:       parseInt(rating, 10),
          comment:      comment || "",
          rated_by:     userName,
        })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, rating: data });
    }
    if (action === "getVendorRatings") {
      const { vendorId } = event.queryStringParameters || {};
      if (!vendorId) {
        return respond(400, { ok: false, message: "vendorId required." });
      }
      const { data, error } = await supabase
        .from("vendor_ratings")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("rated_at", { ascending: false });
      if (error) throw error;
      const avg = data.length
        ? Math.round((data.reduce((t, r) => t + r.rating, 0) / data.length) * 10) / 10
        : null;
      return respond(200, {
        ok: true, ratings: data, avgRating: avg, totalRatings: data.length,
      });
    }

    // ── VENDOR LIST / SEARCH ──
    if (action === "getVendors") {
      const { data: vendors, error } = await supabase
        .from("vendors")
        .select("*, vendor_ratings(rating)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const enriched = (vendors || []).map((v) => {
        const ratings = (v.vendor_ratings || []).map((r) => r.rating);
        const avg = ratings.length
          ? Math.round((ratings.reduce((t, r) => t + r, 0) / ratings.length) * 10) / 10
          : null;
        const { vendor_ratings, ...rest } = v;
        return { ...rest, avgRating: avg, totalRatings: ratings.length };
      });
      return respond(200, { ok: true, vendors: enriched });
    }
    if (action === "searchVendors") {
      const { q, assetType } = event.queryStringParameters || {};
      let query = supabase
        .from("vendors")
        .select("id,name,category,service_area,services,phone,email,contact_person")
        .eq("is_active", true);
      if (q) {
        query = query.or(
          `name.ilike.%${q}%,services.ilike.%${q}%,category.ilike.%${q}%`,
        );
      }
      if (assetType) {
        query = query.ilike("services", `%${assetType}%`);
      }
      query = query.limit(8).order("name");
      const { data, error } = await query;
      if (error) throw error;
      return respond(200, { ok: true, vendors: data });
    }

    // ── RECENT MESSAGES (dashboard notification) ──
    // Surfaces ticket_messages created within the last N hours that the
    // caller did NOT author, scoped to tickets in their store access.
    // Used by the Dashboard "Take Action" widget to flag conversations
    // that need a reply.
    if (action === "getRecentMessages") {
      const rawHours = Number((event.queryStringParameters || {}).hours);
      const hours = Number.isFinite(rawHours) && rawHours > 0
        ? Math.min(rawHours, 168) // cap at 7 days
        : 48;
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const access = await getStoresForUser(supabase, profile);

      const { data, error } = await supabase
        .from("ticket_messages")
        .select(`
          id, ticket_id, user_id, user_name, user_role,
          message, thread_type, created_at,
          tickets!inner(wo_number, store_number, asset_type, status)
        `)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      const filtered = (data || []).filter((m) => {
        // Drop the caller's own messages so we only surface things
        // someone else wrote.
        if (m.user_id && m.user_id === userId) return false;
        // Honor scope when the caller isn't all-stores.
        if (!access.all) {
          const sn = m.tickets?.store_number;
          if (!sn || !access.stores.includes(String(sn))) return false;
        }
        return true;
      }).slice(0, 20);

      const messages = filtered.map((m) => ({
        id:           m.id,
        ticket_id:    m.ticket_id,
        wo_number:    m.tickets?.wo_number || "",
        store_number: m.tickets?.store_number ? String(m.tickets.store_number) : "",
        asset_type:   m.tickets?.asset_type || null,
        ticket_status:m.tickets?.status || null,
        user_name:    m.user_name,
        user_role:    m.user_role,
        message:      m.message,
        thread_type:  m.thread_type,
        created_at:   m.created_at,
      }));
      return respond(200, { ok: true, messages, count: messages.length });
    }

    // ── MESSAGES ──
    if (action === "getMessages") {
      const { ticketId, threadType } = event.queryStringParameters || {};
      if (!ticketId) {
        return respond(400, { ok: false, message: "ticketId required." });
      }
      const thread = threadType || "internal";
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("thread_type", thread)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return respond(200, { ok: true, messages: data, threadType: thread });
    }
    if (action === "sendMessage" && event.httpMethod === "POST") {
      const { ticketId, message, threadType } = JSON.parse(event.body);
      if (!ticketId || !message || !message.trim()) {
        return respond(400, {
          ok: false, message: "ticketId and message required.",
        });
      }
      const thread = threadType || "internal";
      const { data, error } = await supabase
        .from("ticket_messages")
        .insert({
          ticket_id:   ticketId,
          user_id:     userId,
          user_name:   userName,
          user_role:   role.toUpperCase(),
          message:     message.trim(),
          thread_type: thread,
        })
        .select()
        .single();
      if (error) throw error;
      return respond(200, { ok: true, message: data });
    }

    return respond(400, { ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("facilities-v2 error:", err);
    return respond(500, { ok: false, message: err.message || "Server error." });
  }
};
