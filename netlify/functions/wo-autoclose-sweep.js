// wo-autoclose-sweep — scheduled auto-close for stale Work Orders (WO2).
//
// Any ticket that is NOT already terminal (closed / cancelled) and has had no
// activity (updated_at) for 30 days is closed automatically with
// admin_close_reason = 'auto_closed_no_verification', and that store's DO, SDO
// and RVP are emailed a summary of what closed. A closed ticket can still be
// reopened within the 30-day grace window (the normal closed->in_progress path).
//
// Mirrors the repo's other scheduled functions: service-role client, a
// Central-time gate (runs at 07:00 CT; over-firing is safe), and a
// config.schedule backup. The reliable trigger is .github/workflows/
// wo-autoclose.yml, which pings this endpoint daily.
//
// Manual test:
//   GET /.netlify/functions/wo-autoclose-sweep?dry=1     — report, no writes
//   GET /.netlify/functions/wo-autoclose-sweep?force=1   — run now, any hour

import { createClient } from "@supabase/supabase-js";
import { findUsersForStore, sendEmail } from "./_lib/ticketEmail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SEND_TZ = "America/Chicago";
const SEND_HOUR = 7;
const IDLE_DAYS = 30;
const APP_URL = (process.env.APP_URL || process.env.URL || "https://mysoarhub.com").replace(/\/$/, "");

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function wallHourInTz(tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).formatToParts(new Date());
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value, 10);
  if (hour === 24) hour = 0;
  return hour;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const ticketDesc = (t) => [t.category, t.asset_type, t.issue_description].map((x) => (x || "").trim()).filter(Boolean).join(" · ") || "Work order";
const STATUS_LABEL = {
  submitted: "Submitted", in_progress: "In Progress", scheduled: "Scheduled", on_site: "On Site",
  awaiting_equipment: "Awaiting Equipment", parts_on_order: "Parts on Order", completed: "Completed",
};

function buildHtml(storeNumber, storeName, tickets) {
  const rows = tickets.map((t) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;font-weight:600;color:#1E3A5F;white-space:nowrap">${esc(t.wo_number)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;color:#27272a">${esc(ticketDesc(t))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;color:#52525b;white-space:nowrap">${esc(STATUS_LABEL[t.status] || t.status)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;color:#52525b;white-space:nowrap">${fmtDate(t.updated_at)}</td>
    </tr>`).join("");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#27272a">
    <div style="background:#1E3A5F;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
      <div style="font-size:16px;font-weight:700">Work orders auto-closed — ${esc(storeName)} (#${esc(storeNumber)})</div>
      <div style="font-size:12px;color:#c9d6e4;margin-top:2px">${tickets.length} ticket${tickets.length > 1 ? "s" : ""} closed after ${IDLE_DAYS} days with no activity</div>
    </div>
    <div style="border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px;padding:16px 20px">
      <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#52525b">
        The following work order${tickets.length > 1 ? "s were" : " was"} closed automatically because ${tickets.length > 1 ? "they" : "it"} had no updates for ${IDLE_DAYS} days.
        If a job is still open, you can reopen the ticket within 30 days.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left;color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:.03em">
            <th style="padding:6px 10px">WO #</th><th style="padding:6px 10px">Issue</th>
            <th style="padding:6px 10px">Was</th><th style="padding:6px 10px">Last activity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:16px 0 0"><a href="${APP_URL}/work-orders" style="background:#008AD8;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:600">Open Work Orders</a></p>
      <p style="margin:14px 0 0;font-size:11px;color:#a1a1aa">Automated message from SOAR Work Orders · auto-close after ${IDLE_DAYS} days of inactivity.</p>
    </div>
  </div>`;
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 200, body: "wo-autoclose-sweep not configured (env vars missing)" };
  }
  const params = event?.queryStringParameters || {};
  const force = params.force === "1" || params.force === "true";
  const dry = params.dry === "1" || params.dry === "true";

  const hour = wallHourInTz(SEND_TZ);
  if (!force && hour !== SEND_HOUR) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "outside send window", hour }) };
  }

  const supa = admin();
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - IDLE_DAYS * 86400000).toISOString();

  // Candidates: non-terminal tickets idle >= 30 days.
  const { data: candidates, error } = await supa
    .from("tickets")
    .select("id, wo_number, store_number, store_name, category, asset_type, issue_description, status, pause_state, created_at, updated_at")
    .not("status", "in", "(closed,cancelled)")
    .lt("updated_at", cutoff)
    .order("store_number", { ascending: true })
    .limit(2000);
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const byStore = new Map(); // store_number -> [closed ticket rows]
  let closedCount = 0;

  for (const t of candidates || []) {
    if (!dry) {
      const updates = {
        status: "closed",
        admin_close_reason: "auto_closed_no_verification",
        closed_by_store: false,
        closed_at: nowIso,
        date_completed: nowIso,
        date_status_updated: nowIso,
        updated_at: nowIso,
      };
      // Mirror the state machine's pause auto-reset when leaving a pausable state.
      if ((t.status === "in_progress" || t.status === "scheduled") && t.pause_state && t.pause_state !== "none") {
        updates.pause_state = "none";
        updates.pause_reason_note = null;
      }
      // Optimistic guard: only close if the status hasn't changed since we read it.
      const { data: updated, error: uerr } = await supa
        .from("tickets").update(updates).eq("id", t.id).eq("status", t.status).select("id").maybeSingle();
      if (uerr) { console.warn(`[wo-autoclose] update failed ${t.wo_number}: ${uerr.message}`); continue; }
      if (!updated) continue; // raced — status changed under us, skip

      await supa.from("ticket_activities").insert({
        ticket_id: t.id, user_id: null, user_name: "SOAR Hub (auto-close)", user_role: "system",
        update_type: "status_change", old_value: t.status, new_value: "closed",
        event_type: "status_changed",
        event_data: { from: t.status, to: "closed", reason_code: "auto_closed_no_verification", auto_closed: true, idle_days: IDLE_DAYS },
        visibility: "all",
      }).then(() => {}).catch((e) => console.warn(`[wo-autoclose] activity insert failed ${t.wo_number}: ${e?.message}`));
      closedCount++;
    }
    (byStore.get(t.store_number) || byStore.set(t.store_number, []).get(t.store_number)).push(t);
  }

  // Email each store's DO / SDO / RVP a summary of what closed.
  let emailsSent = 0, storesNotified = 0;
  for (const [storeNumber, tickets] of byStore) {
    const leaders = await findUsersForStore(supa, storeNumber, ["do", "sdo", "rvp"]);
    const seen = new Set();
    const recipients = leaders.filter((r) => r?.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()));
    if (!recipients.length) continue;
    const storeName = tickets[0].store_name || `Store ${storeNumber}`;
    const subject = `Auto-closed: ${tickets.length} work order${tickets.length > 1 ? "s" : ""} at ${storeName} (${IDLE_DAYS}+ days inactive)`;
    const html = buildHtml(storeNumber, storeName, tickets);
    storesNotified++;
    if (dry) continue;
    for (const r of recipients) {
      const res = await sendEmail({ to: r.email, subject, html });
      if (res.sent) emailsSent++;
      for (const t of tickets) {
        await supa.from("ticket_notifications").insert({
          ticket_id: t.id, recipient_email: r.email, recipient_name: r.full_name,
          notification_type: "auto_closed", subject, message: html,
          status: res.sent ? "sent" : `failed: ${res.reason}`,
        }).then(() => {}).catch(() => {});
      }
    }
  }

  const summary = { dry, cutoff, candidates: candidates?.length || 0, closed: dry ? (candidates?.length || 0) : closedCount, stores: byStore.size, storesNotified, emailsSent };
  console.log("[wo-autoclose]", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};

// Daily at 12:00 and 13:00 UTC; the handler proceeds only at 07:00 Central
// (DST-safe). Backup trigger only — .github/workflows/wo-autoclose.yml is the
// reliable one. Safe to fire redundantly: closes are idempotent (terminal
// statuses are excluded) and the optimistic guard prevents double-closes.
export const config = {
  schedule: "0 12,13 * * *",
};
