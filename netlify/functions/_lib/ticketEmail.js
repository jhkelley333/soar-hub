// netlify/functions/_lib/ticketEmail.js
//
// Shared ticket-notification machinery used by both facilities-v2
// (DO-initiated work-order events) and vendor-portal (the anonymous
// QR portal). Pulled into a single module so:
//   * The two paths can't drift on recipient resolution.
//   * Edits to email_templates rows affect every send path.
//   * Adding new notification kinds is one file, not three.
//
// Public surface
//   sendEmail({ to, subject, html })           → low-level Resend wrapper
//   notifyTicketEvent(supabase, ticket, kind)  → recipients + render + send
//                                                + log to ticket_notifications
//
// Supported kinds (current):
//   "submitted"           — new ticket created
//   "approval_requested"  — quote routed to an approver tier
//   "approval_decided"    — approver clicked approve / reject
//   "vendor_help_needed"  — store submitted without a vendor; routed to the DO
//
// Adding a new kind = update findRecipients() below + add a
// template row (kind, subject, body_html) in email_templates OR
// extend fallbackSubject/fallbackHtml here so the system has
// something to send if the template row is missing.

import { isSingleStoreRole } from "./roles.js";

function appBaseUrl() {
  return process.env.APP_URL || process.env.URL || "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Recipient resolution ────────────────────────────────────────

// Walks store → district → area → region and returns the active
// profiles scoped to any of those levels matching the role filter.
// GM and shift_manager always route to the store inbox
// (stores.email) rather than the user's personal profile email —
// the store inbox survives staff turnover and is the de facto
// working address for facility operations.
export async function findUsersForStore(supabase, storeNumber, roleFilter) {
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
  return (users || []).map((u) => {
    const role = String(u.role || "").toLowerCase();
    if (isSingleStoreRole(role)) {
      return { ...u, email: storeEmail };
    }
    return u;
  });
}

async function findRecipients(supabase, ticket, kind) {
  if (kind === "submitted") {
    return findUsersForStore(supabase, ticket.store_number, ["gm", "do"]);
  }
  if (kind === "approval_requested") {
    const tier = String(ticket.approval_level || "");
    let role = "do";
    if (tier.startsWith("SDO")) role = "sdo";
    // Top approver band — labelled "RVP $1001-$1750" since RVPs
    // (Regional VPs) are the operational approvers at this tier,
    // not corporate VPs. Old rows may still say "VP $1001-$1750"
    // until the backfill runs; match either prefix so neither
    // path breaks during the transition.
    else if (tier.startsWith("RVP") || tier.startsWith("VP")) role = "rvp";
    // Backup coverage: also flag the next tier up so they can approve if
    // the assigned approver is out (SDO request → also notify the RVP).
    const backupRole = { do: "sdo", sdo: "rvp" }[role];
    const roles = backupRole ? [role, backupRole] : [role];
    return findUsersForStore(supabase, ticket.store_number, roles);
  }
  if (kind === "approval_decided") {
    if (!ticket.submitted_by_user_id) return [];
    const { data: u } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", ticket.submitted_by_user_id)
      .maybeSingle();
    if (!u) return [];
    const submitterRole = String(u.role || "").toLowerCase();
    if (isSingleStoreRole(submitterRole)) {
      const { data: storeRow } = await supabase
        .from("stores")
        .select("email")
        .eq("number", String(ticket.store_number))
        .maybeSingle();
      const storeEmail = (storeRow?.email || "").trim() || null;
      return [{ ...u, email: storeEmail }];
    }
    return [u];
  }
  if (kind === "info_requested") {
    // An approver is asking the submitter for more detail before they
    // decide. Same recipient resolution as approval_decided: the
    // submitter, with the store inbox substituted for GM / shift-manager.
    if (!ticket.submitted_by_user_id) return [];
    const { data: u } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", ticket.submitted_by_user_id)
      .maybeSingle();
    if (!u) return [];
    const submitterRole = String(u.role || "").toLowerCase();
    if (isSingleStoreRole(submitterRole)) {
      const { data: storeRow } = await supabase
        .from("stores")
        .select("email")
        .eq("number", String(ticket.store_number))
        .maybeSingle();
      const storeEmail = (storeRow?.email || "").trim() || null;
      return [{ ...u, email: storeEmail }];
    }
    return [u];
  }
  if (kind === "vendor_message_posted") {
    // GMs and DOs are the humans who'd actually reply to a vendor
    // message. SDOs+ can see the conversation in WO2's chat tab
    // but aren't pinged by email here to avoid escalating routine
    // "ETA changed" / "running late" chatter.
    return findUsersForStore(supabase, ticket.store_number, ["gm", "do"]);
  }
  if (kind === "vendor_help_needed") {
    // Store submitted without a vendor and asked for help — route to the
    // DO (district operator) who assigns vendors for the store.
    return findUsersForStore(supabase, ticket.store_number, ["do"]);
  }
  return [];
}

// ── Template rendering ─────────────────────────────────────────

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
    link: base ? `${base}/admin/work-orders-v2?ticket=${encodeURIComponent(ticket.id || "")}` : "",
  };
}

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

function fallbackSubject(ticket, kind, vars = {}) {
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
  if (kind === "vendor_message_posted") {
    const vendor = vars.vendor_name || "Vendor";
    return `[Work Order] New message from ${vendor} — ${ticket.wo_number}`;
  }
  if (kind === "info_requested") {
    return `[Work Order] More info needed — ${ticket.wo_number}`;
  }
  if (kind === "vendor_help_needed") {
    return `[Work Order] Vendor needed — ${ticket.wo_number} (Store ${ticket.store_number})`;
  }
  return `[Work Order] Update — ${ticket.wo_number}`;
}

function fallbackHtml(ticket, kind, vars = {}) {
  const base = appBaseUrl();
  const link = base
    ? `${base}/admin/work-orders-v2?ticket=${encodeURIComponent(ticket.id || "")}`
    : "";
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
  } else if (kind === "info_requested") {
    const asker = vars.requested_by || "An approver";
    const question = vars.question || "";
    body = `<p><strong>${escapeHtml(asker)}</strong> needs more information before approving this work order.</p>${detail}<p><strong>Question:</strong></p><blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #2563eb;background:#f1f5f9;color:#222;white-space:pre-wrap;">${escapeHtml(question)}</blockquote><p style="font-size:12px;color:#666;">Reply on the work order's chat thread so the approver can continue.</p>`;
  } else if (kind === "vendor_message_posted") {
    const vendor = vars.vendor_name || "Vendor";
    const preview = vars.message_preview || "";
    body = `<p><strong>${escapeHtml(vendor)}</strong> posted a message on this work order.</p>${detail}<p><strong>Message:</strong></p><blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #2563eb;background:#f1f5f9;color:#222;white-space:pre-wrap;">${escapeHtml(preview)}</blockquote><p style="font-size:12px;color:#666;">Reply directly in the Vendor chat tab on the work order.</p>`;
  } else if (kind === "vendor_help_needed") {
    body = `<p>The store submitted this work order but <strong>needs help choosing a vendor</strong>. Please assign one so it can move forward.</p>${detail}<p><strong>Issue:</strong></p><p style="white-space:pre-wrap;color:#333;">${escapeHtml(ticket.issue_description || "—")}</p><p style="font-size:12px;color:#666;">Open the work order and set the vendor — that clears the flag automatically.</p>`;
  }
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;padding:16px;">${body}${linkHtml}<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">Sent automatically by SOAR Facilities V2 (fallback template).</p></body></html>`;
}

async function renderEmail(supabase, ticket, kind, extraVars = {}) {
  const tmpl = await getActiveTemplate(supabase, kind);
  const vars = { ...buildTicketVars(ticket), ...extraVars };
  if (tmpl) {
    return {
      subject: renderTemplate(tmpl.subject, vars),
      html: renderTemplate(tmpl.body_html, vars),
    };
  }
  return {
    subject: fallbackSubject(ticket, kind, vars),
    html: fallbackHtml(ticket, kind, vars),
  };
}

// ── Send + log ─────────────────────────────────────────────────

// Resend wrapper used by both ticket notifications and one-off
// alerts (e.g. vendor-portal's drive-by completion). Reads
// FACILITIES_FROM_EMAIL first, then RESEND_FROM_EMAIL, then a
// hardcoded default — same precedence in both subsystems so the
// FROM address can't drift.
export async function sendEmail({ to, subject, html, cc, bcc, replyTo, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not set" };
  }
  const fromAddr =
    process.env.FACILITIES_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    "notifications@mysoarhub.com";
  const fromName =
    process.env.FACILITIES_FROM_NAME ||
    process.env.RESEND_FROM_NAME ||
    "SOAR Work Orders";
  const payload = {
    from: `${fromName} <${fromAddr}>`,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (cc && (Array.isArray(cc) ? cc.length : cc)) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (bcc && (Array.isArray(bcc) ? bcc.length : bcc)) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (replyTo) payload.reply_to = replyTo;
  // Resend attachments: [{ filename, content: <base64> }]
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
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

// Public entry point. Resolves recipients, renders template,
// sends to each recipient individually, and logs a row per send
// to ticket_notifications for the audit trail. Best-effort: any
// individual log-insert failure is warned but doesn't break the
// rest of the sends.
export async function notifyTicketEvent(supabase, ticket, kind, extraVars = {}) {
  const all = await findRecipients(supabase, ticket, kind);
  const seen = new Set();
  const recipients = all.filter((r) => {
    if (!r?.email) return false;
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });
  if (!recipients.length) return;

  const { subject, html } = await renderEmail(supabase, ticket, kind, extraVars);

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
      console.warn("[ticketEmail] notification log insert failed", e);
    });
  }
}
