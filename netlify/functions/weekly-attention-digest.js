// netlify/functions/weekly-attention-digest.js
//
// Netlify Scheduled Function — Monday 9:00 AM US Central "needs your attention"
// digest for every active DO and SDO.
//
// For each DO/SDO we gather, scoped to the stores they oversee:
//   • Work Orders that need action or closeout
//       - needs a vendor assigned (needs_vendor_help)
//       - awaiting approval (a Pending ticket_approvals row)
//       - ready to close out (status 'completed', awaiting verification)
//       - open 15+ days (stalled)
//   • Employee Actions awaiting them (PTO / Training Credit) per the same
//     role-gating the in-app queue uses. Training "On Weekly Sheet" closeouts
//     are intentionally omitted here — those already go out in the separate
//     7 AM Monday training-credit-digest, so we don't double-nag.
//
// Recipients with nothing pending get no email.
//
// Timezone: Netlify cron is UTC and NOT DST-aware, so we fire at both candidate
// UTC hours (14:00 and 15:00) every Monday and only do real work when the wall
// clock in America/Chicago is 09:00. (Same approach as training-credit-digest.)
//
// Manual / test invocation (HTTP GET):
//   ?force=1   bypass the Monday-09:00-Central time guard
//   ?dry=1     compute + return the per-recipient digests but send nothing
//
// Service-role key only (RLS is on with no policies), like the rest of the
// facilities + employee-actions backend.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SEND_TZ = "America/Chicago";
const SEND_HOUR = 9;
const SEND_WEEKDAY = 1; // Monday
const STALE_DAYS = 15;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Dedicated branding so the digest isn't labelled with the PAF sender name that
// RESEND_FROM_NAME carries. Falls back to the shared verified address.
const RESEND_FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "notifications@mysoarhub.com";
const RESEND_FROM_NAME = process.env.DIGEST_FROM_NAME || "SOAR Hub";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

const OPEN_STATUSES = ["submitted", "in_progress", "scheduled", "on_site", "awaiting_equipment", "parts_on_order"];

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function appBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "https://mysoarhub.com").replace(/\/$/, "");
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "there";
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Wall-clock components in `tz` for a UTC instant.
function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour };
}

async function sendEmail({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to ? [to] : [];
  if (!recipients.length) return { skipped: true };
  if (!RESEND_API_KEY) {
    console.warn("[weekly-attention-digest] RESEND_API_KEY not set; skipping send", { subject });
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: recipients, subject, html, text,
        ...(RESEND_REPLY_TO ? { reply_to: RESEND_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[weekly-attention-digest] Resend failed", res.status, detail);
      return { ok: false, status: res.status };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id };
  } catch (e) {
    console.warn("[weekly-attention-digest] Resend threw", e);
    return { ok: false, error: e?.message };
  }
}

// Which step (if any) the given role still owes on an Employee Action at this
// status. Mirrors actionableStep() in employee-actions.js so the digest matches
// the in-app queue exactly.
function eaStep(type, status, role, isOwner) {
  const isApprover = role === "sdo" || role === "rvp" || role === "admin";
  const isDo = role === "do" || role === "admin";
  const canOps = isDo || (isOwner && isApprover);
  if (type === "training") {
    if (status === "Submitted") return isApprover ? "Approve / send back" : null;
    if (status === "Approved") return isApprover ? "Mark on weekly sheet" : null;
    if (status === "On Weekly Sheet") return null; // covered by the 7 AM training digest
    return null;
  }
  if (status === "Submitted") return (isDo || (isOwner && isApprover)) ? "Approve / send back" : null;
  if (status === "DO Approved") return isApprover ? "Approve / send back" : null;
  if (status === "SDO/RVP Approved") return canOps ? "Submit vacation PAF" : null;
  if (status === "PAF Submitted") return canOps ? "Close out" : null;
  return null;
}

// Resolve the store numbers a DO/SDO oversees via the same RPC the app uses.
async function storeNumbersFor(supa, userId) {
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: userId });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data: rows } = await supa.from("stores").select("number").in("id", ids);
  return [...new Set((rows ?? []).map((s) => String(s.number)))];
}

// ── Gather one recipient's items ──────────────────────────────────────────
async function gatherForRecipient(supa, recipient, storeNumbers) {
  const wo = { needsVendor: [], pendingApproval: [], toCloseOut: [], stalled: [] };
  const ea = new Map(); // label -> items[]

  if (storeNumbers.length) {
    // Work Orders — open + completed, with their approvals embedded.
    const { data: tickets } = await supa
      .from("tickets")
      .select("id, wo_number, store_number, store_name, asset_type, category, status, needs_vendor_help, date_submitted, priority, vendor_name, ticket_approvals(status)")
      .in("store_number", storeNumbers)
      .in("status", [...OPEN_STATUSES, "completed"])
      .order("date_submitted", { ascending: true });

    const now = Date.now();
    for (const t of tickets ?? []) {
      const isOpen = OPEN_STATUSES.includes(t.status);
      const pending = (t.ticket_approvals ?? []).some((a) => a.status === "Pending");
      const ageDays = (now - new Date(t.date_submitted).getTime()) / 86400000;
      const item = {
        wo_number: t.wo_number, store_number: t.store_number, store_name: t.store_name,
        asset_type: t.asset_type || t.category || "Work order", priority: t.priority,
      };
      // One bucket per ticket, most-urgent first.
      if (isOpen && t.needs_vendor_help) wo.needsVendor.push(item);
      else if (pending) wo.pendingApproval.push(item);
      else if (t.status === "completed") wo.toCloseOut.push(item);
      else if (isOpen && ageDays >= STALE_DAYS) wo.stalled.push(item);
    }
  }

  // Employee Actions awaiting this recipient, in scope.
  if (storeNumbers.length) {
    const TERMINAL = ["Completed", "Closed", "Withdrawn"];
    const [{ data: tcs }, { data: ptos }] = await Promise.all([
      supa.from("training_credit_requests")
        .select("id, store_number, employee_name, status, submitter_id, training_type")
        .in("store_number", storeNumbers).not("status", "in", `(${TERMINAL.join(",")})`),
      supa.from("pto_requests")
        .select("id, store_number, employee_name, status, submitter_id, position")
        .in("store_number", storeNumbers).not("status", "in", `(${TERMINAL.join(",")})`),
    ]);
    const add = (label, item) => { if (!ea.has(label)) ea.set(label, []); ea.get(label).push(item); };
    for (const r of tcs ?? []) {
      const label = eaStep("training", r.status, recipient.role, r.submitter_id === recipient.id);
      if (label) add(label, { kind: "Training", who: r.employee_name, store: r.store_number });
    }
    for (const r of ptos ?? []) {
      const label = eaStep("pto", r.status, recipient.role, r.submitter_id === recipient.id);
      if (label) add(label, { kind: "PTO", who: r.employee_name, store: r.store_number });
    }
  }

  const woTotal = wo.needsVendor.length + wo.pendingApproval.length + wo.toCloseOut.length + wo.stalled.length;
  const eaTotal = [...ea.values()].reduce((n, arr) => n + arr.length, 0);
  return { wo, ea, woTotal, eaTotal, total: woTotal + eaTotal };
}

// ── Render ────────────────────────────────────────────────────────────────
function renderList(items, fmt, cap = 20) {
  const shown = items.slice(0, cap).map((it) => `<li style="margin:2px 0;color:#3f3f46;font-size:13px">${fmt(it)}</li>`).join("");
  const more = items.length > cap ? `<li style="margin:2px 0;color:#71717a;font-size:12px">…and ${items.length - cap} more</li>` : "";
  return `<ul style="margin:6px 0 14px;padding-left:18px">${shown}${more}</ul>`;
}
function woLine(it) {
  return `<strong>${esc(it.wo_number)}</strong> · Store ${esc(it.store_number)}${it.store_name ? ` (${esc(it.store_name)})` : ""} — ${esc(it.asset_type)}${it.priority ? ` <span style="color:#a1a1aa">[${esc(it.priority)}]</span>` : ""}`;
}
function eaLine(it) {
  return `<strong>${esc(it.kind)}</strong> · ${esc(it.who || "—")} · Store ${esc(it.store)}`;
}

function buildEmail(recipient, data, base) {
  const woUrl = `${base}/admin/work-orders-v2`;
  const eaUrl = `${base}/employee-actions`;
  const sec = (title, count, body, href) =>
    !count ? "" :
    `<h3 style="margin:18px 0 2px;font-size:15px;color:#18181b">${title} <span style="color:#a1a1aa;font-weight:600">(${count})</span></h3>${body}<a href="${href}" style="font-size:12px;color:#2563eb;text-decoration:none">Open in SOAR Hub →</a>`;

  const woSections = [
    data.wo.needsVendor.length ? `<h4 style="margin:12px 0 0;font-size:13px;color:#b45309">🔧 Needs a vendor assigned (${data.wo.needsVendor.length})</h4>${renderList(data.wo.needsVendor, woLine)}` : "",
    data.wo.pendingApproval.length ? `<h4 style="margin:12px 0 0;font-size:13px;color:#1d4ed8">✅ Awaiting approval (${data.wo.pendingApproval.length})</h4>${renderList(data.wo.pendingApproval, woLine)}` : "",
    data.wo.toCloseOut.length ? `<h4 style="margin:12px 0 0;font-size:13px;color:#15803d">📋 Ready to close out (${data.wo.toCloseOut.length})</h4>${renderList(data.wo.toCloseOut, woLine)}` : "",
    data.wo.stalled.length ? `<h4 style="margin:12px 0 0;font-size:13px;color:#b91c1c">⏳ Open ${STALE_DAYS}+ days (${data.wo.stalled.length})</h4>${renderList(data.wo.stalled, woLine)}` : "",
  ].join("");

  const eaSections = [...data.ea.entries()]
    .map(([label, items]) => `<h4 style="margin:12px 0 0;font-size:13px;color:#3f3f46">${esc(label)} (${items.length})</h4>${renderList(items, eaLine)}`)
    .join("");

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#27272a">
  <h2 style="font-size:20px;margin:0 0 2px">Good morning, ${esc(displayName(recipient))}</h2>
  <p style="margin:0 0 4px;color:#52525b;font-size:13px">Here's what needs your attention on SOAR Hub this week — ${data.total} item${data.total === 1 ? "" : "s"} total.</p>
  ${sec("Work Orders", data.woTotal, woSections, woUrl)}
  ${sec("Employee Actions", data.eaTotal, eaSections, eaUrl)}
  <p style="margin:22px 0 0;color:#a1a1aa;font-size:11px">You're receiving this because you're a DO/SDO on SOAR Hub. Sent Mondays at 9:00 AM Central.</p>
</div>`;

  // Plain-text fallback.
  const lines = [`Good morning, ${displayName(recipient)}`, `${data.total} item(s) need your attention on SOAR Hub.`, ""];
  if (data.woTotal) {
    lines.push(`WORK ORDERS (${data.woTotal}) — ${woUrl}`);
    const tl = (label, arr) => { if (arr.length) { lines.push(` ${label} (${arr.length}):`); for (const it of arr.slice(0, 20)) lines.push(`  - ${it.wo_number} · Store ${it.store_number} — ${it.asset_type}`); } };
    tl("Needs a vendor", data.wo.needsVendor);
    tl("Awaiting approval", data.wo.pendingApproval);
    tl("Ready to close out", data.wo.toCloseOut);
    tl(`Open ${STALE_DAYS}+ days`, data.wo.stalled);
    lines.push("");
  }
  if (data.eaTotal) {
    lines.push(`EMPLOYEE ACTIONS (${data.eaTotal}) — ${eaUrl}`);
    for (const [label, items] of data.ea.entries()) {
      lines.push(` ${label} (${items.length}):`);
      for (const it of items.slice(0, 20)) lines.push(`  - ${it.kind} · ${it.who || "—"} · Store ${it.store}`);
    }
  }
  return { html, text: lines.join("\n") };
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[weekly-attention-digest] missing Supabase env vars; aborting.");
    return { statusCode: 500, body: "missing env" };
  }
  const params = event?.queryStringParameters || {};
  const force = params.force === "1" || params.force === "true";
  const dry = params.dry === "1" || params.dry === "true";

  const central = wallClockInTz(new Date(), SEND_TZ);
  const dow = new Date(Date.UTC(central.year, central.month - 1, central.day)).getUTCDay();
  if (!force && (central.hour !== SEND_HOUR || dow !== SEND_WEEKDAY)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "outside send window", central }) };
  }

  const supa = admin();
  const { data: recipients, error } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role")
    .in("role", ["do", "sdo"])
    .eq("is_active", true);
  if (error) return { statusCode: 500, body: error.message };

  const summary = { recipients: recipients?.length || 0, emailed: 0, sent: 0, skipped: 0, dry, details: [] };

  for (const r of recipients ?? []) {
    if (!r.email) continue;
    const storeNumbers = await storeNumbersFor(supa, r.id);
    const data = await gatherForRecipient(supa, r, storeNumbers);
    if (data.total === 0) continue; // skip empty — no nag

    summary.emailed += 1;
    const subject = `Your Monday hub digest — ${data.total} item${data.total === 1 ? "" : "s"} need attention`;
    if (dry) {
      summary.details.push({ to: r.email, total: data.total, wo: data.woTotal, ea: data.eaTotal });
      continue;
    }
    const { html, text } = buildEmail(r, data, appBaseUrl());
    const res = await sendEmail({ to: r.email, subject, html, text });
    if (res?.ok) summary.sent += 1; else summary.skipped += 1;
    summary.details.push({ to: r.email, total: data.total, result: res?.ok ? "sent" : (res?.status || res?.error || "skipped") });
  }

  console.log(`[weekly-attention-digest] recipients=${summary.recipients} emailed=${summary.emailed} sent=${summary.sent} skipped=${summary.skipped} dry=${dry}`);
  return { statusCode: 200, body: JSON.stringify(summary) };
};

// Mondays at 14:00 and 15:00 UTC; the handler proceeds only at 09:00
// America/Chicago (DST-safe — one of the two is always 9 AM Central).
export const config = {
  schedule: "0 14,15 * * 1",
};
