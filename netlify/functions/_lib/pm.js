// netlify/functions/_lib/pm.js
//
// Preventive-maintenance helpers shared between:
//   * netlify/functions/pm.js          (admin CRUD + manual spawn)
//   * netlify/functions/pm-spawner.js  (daily scheduled function)
//   * netlify/functions/facilities-v2.js  (ticket-close hook)
//
// Three concerns live here:
//   1. computeNextDueAt(template, fromDate) — when's the next PM due?
//   2. spawnDuePMs(supabase, { dryRun }) — create tickets for everything
//      that's hit its lead window. Idempotent: skips schedules whose
//      last_ticket_id is still open.
//   3. onPMTicketClosed(supabase, ticket) — when a PM ticket reaches
//      closed/cancelled, bump the schedule forward.
//
// The spawner intentionally uses the service-role client (no per-user
// auth) since it runs unattended.

import { notifyTicketEvent } from "./ticketEmail.js";

// Tickets considered "still in flight" — spawner won't re-spawn while
// last_ticket_id points to one of these. Anything else (closed,
// cancelled) is fair game for the next cycle.
const OPEN_STATUSES = new Set([
  "submitted", "received", "Received",
  "in_progress", "In Progress",
  "scheduled", "Scheduled",
  "on_site", "On Site",
  "on_hold", "On Hold",
  "awaiting_parts", "Awaiting Parts",
  "awaiting_replacement", "Awaiting Replacement",
  "completed", "Completed",
]);

// Statuses that count as "PM was actually performed" — the close hook
// only advances the schedule on success. Cancelled means the work
// didn't happen, so next_due_at stays where it is.
const SUCCESS_CLOSE_STATUSES = new Set(["closed", "Closed", "completed", "Completed"]);

// computeNextDueAt — central cadence math. Returns a Date.
//
// rolling: fromDate + cadence_days
// fixed:   the next future date matching fixed_months + fixed_day_of_month
//          (after fromDate). Searches up to 24 months ahead so it can
//          handle "annual" templates ({m:[6]}, day 1) without looping
//          forever.
export function computeNextDueAt(template, fromDate = new Date()) {
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (template.cadence_type === "rolling") {
    const days = Math.max(1, parseInt(template.cadence_days || 0, 10) || 90);
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }
  if (template.cadence_type === "fixed") {
    const months = Array.isArray(template.fixed_months) && template.fixed_months.length
      ? template.fixed_months.map((m) => parseInt(m, 10)).filter((m) => m >= 1 && m <= 12)
      : [1, 4, 7, 10];
    const day = Math.min(28, Math.max(1, parseInt(template.fixed_day_of_month || 1, 10) || 1));
    // Walk forward month-by-month to find the next match strictly after base.
    const cursor = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day, 0, 0, 0));
    for (let i = 0; i < 24; i++) {
      const month = cursor.getUTCMonth() + 1; // 1-12
      if (months.includes(month) && cursor > base) return cursor;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    // Fallback if something's misconfigured: rolling 90.
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + 90);
    return next;
  }
  // Unknown cadence_type — be defensive.
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + 90);
  return next;
}

// Internal: pick a WO number using the same RPC the regular create-
// ticket flow uses. Falls back to manual sequence increment so the
// spawner works even if the RPC is missing on a dev project.
async function nextWONumber(supabase, storeNumber) {
  const { data, error } = await supabase.rpc("next_wo_sequence", {
    p_store: String(storeNumber),
  });
  if (!error && typeof data === "number") {
    return `WO-${storeNumber}-${String(data).padStart(3, "0")}`;
  }
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

// spawnDuePMs — the heart of the scheduler. Returns a summary list of
// what was spawned (or would have been, if dryRun=true).
//
// Logic per pm_schedule row that is_active and overdue:
//   1. If last_ticket_id points to a still-open ticket → skip (idempotent).
//   2. Otherwise create a ticket linked back via pm_schedule_id.
//   3. Update last_ticket_id; do NOT touch next_due_at — that bumps on
//      successful close via onPMTicketClosed().
//
// Spawn window: next_due_at <= now() + lead_days days.
export async function spawnDuePMs(supabase, { dryRun = false } = {}) {
  const now = new Date();
  const horizon = new Date(now);
  // We use 60 days as the upper bound of the SQL query so we don't pull
  // back the whole table; the per-row lead_days check happens in JS.
  horizon.setUTCDate(horizon.getUTCDate() + 60);

  const { data: due, error } = await supabase
    .from("pm_schedule")
    .select(`
      id, template_id, store_id, override_vendor_id,
      next_due_at, last_ticket_id, last_completed_at,
      pm_templates:template_id (
        id, name, category, description, instructions, performer_type,
        default_vendor_id, lead_days, est_cost, checklist_url, priority,
        cadence_type, cadence_days, fixed_months, fixed_day_of_month,
        is_active
      ),
      stores:store_id ( id, number, name, email, do_email, sdo_email )
    `)
    .eq("is_active", true)
    .lte("next_due_at", horizon.toISOString());
  if (error) throw error;

  // Pre-resolve vendor names so we don't N+1.
  const vendorIds = new Set();
  for (const r of due || []) {
    if (r.override_vendor_id) vendorIds.add(r.override_vendor_id);
    if (r.pm_templates?.default_vendor_id) vendorIds.add(r.pm_templates.default_vendor_id);
  }
  const vendorById = new Map();
  if (vendorIds.size) {
    const { data: vrows } = await supabase
      .from("vendors")
      .select("id, name, email")
      .in("id", Array.from(vendorIds));
    for (const v of vrows || []) vendorById.set(v.id, v);
  }

  const spawned = [];
  const skipped = [];

  for (const row of due || []) {
    const tmpl = row.pm_templates;
    const store = row.stores;
    if (!tmpl || !tmpl.is_active || !store) {
      skipped.push({ schedule_id: row.id, reason: "missing template or store" });
      continue;
    }
    const dueAt = new Date(row.next_due_at);
    const leadDays = Math.max(0, parseInt(tmpl.lead_days || 0, 10) || 0);
    const windowOpensAt = new Date(dueAt);
    windowOpensAt.setUTCDate(windowOpensAt.getUTCDate() - leadDays);
    if (windowOpensAt > now) {
      skipped.push({ schedule_id: row.id, reason: "outside lead window" });
      continue;
    }

    // Idempotency: if last_ticket_id is still open, skip.
    if (row.last_ticket_id) {
      const { data: prev } = await supabase
        .from("tickets")
        .select("id, status")
        .eq("id", row.last_ticket_id)
        .maybeSingle();
      if (prev && OPEN_STATUSES.has(prev.status)) {
        skipped.push({ schedule_id: row.id, reason: "prior ticket still open", ticket_id: prev.id });
        continue;
      }
    }

    const vendorId = row.override_vendor_id || tmpl.default_vendor_id || null;
    const vendor = vendorId ? vendorById.get(vendorId) : null;

    if (dryRun) {
      spawned.push({
        schedule_id: row.id,
        store_number: store.number,
        store_name: store.name,
        template_name: tmpl.name,
        performer_type: tmpl.performer_type,
        vendor_name: vendor?.name || null,
        next_due_at: row.next_due_at,
        would_create: true,
      });
      continue;
    }

    const woNumber = await nextWONumber(supabase, store.number);
    const dueDateStr = dueAt.toISOString().slice(0, 10);
    const performerLine = tmpl.performer_type === "vendor"
      ? `Performed by vendor${vendor?.name ? `: ${vendor.name}` : ""}.`
      : "Performed by internal staff. Use the checklist link in this ticket and upload the completed form before closing.";
    const checklistLine = tmpl.checklist_url
      ? `\n\nChecklist: ${tmpl.checklist_url}`
      : "";
    const instructionsLine = tmpl.instructions ? `\n\n${tmpl.instructions}` : "";
    const description = `PM scheduled for ${dueDateStr}. ${performerLine}${instructionsLine}${checklistLine}`;

    const { data: ticket, error: tErr } = await supabase
      .from("tickets")
      .insert({
        wo_number:              woNumber,
        store_number:           store.number,
        store_name:             store.name || "",
        store_email:            store.email || "",
        do_email:               store.do_email || "",
        sdo_email:              store.sdo_email || "",
        submitted_by:           "Auto-PM",
        submitted_by_user_id:   null,
        category:               "Preventive Maintenance",
        asset_type:             tmpl.category || tmpl.name,
        issue_description:      description,
        status:                 "submitted",
        priority:               tmpl.priority || "Standard",
        is_business_critical:   false,
        troubleshooting_checked:true,
        vendor_contacted:       tmpl.performer_type === "vendor" && !!vendor,
        vendor_id:              vendor?.id || null,
        vendor_name:            vendor?.name || "",
        cost_estimate:          tmpl.est_cost || null,
        pm_schedule_id:         row.id,
        date_submitted:         new Date().toISOString(),
      })
      .select()
      .single();
    if (tErr) {
      skipped.push({ schedule_id: row.id, reason: `insert failed: ${tErr.message}` });
      continue;
    }

    await supabase.from("ticket_activities").insert({
      ticket_id: ticket.id,
      user_id: null,
      user_name: "Auto-PM",
      user_role: "system",
      update_type: "created",
      new_value: "submitted",
      notes: `PM ticket auto-spawned from template "${tmpl.name}". Due ${dueDateStr}.`,
      event_type: "ticket_created",
      event_data: {
        initial_status: "submitted",
        wo_number: woNumber,
        pm_schedule_id: row.id,
        pm_template_id: tmpl.id,
        performer_type: tmpl.performer_type,
      },
      visibility: "all",
    });

    await supabase
      .from("pm_schedule")
      .update({ last_ticket_id: ticket.id })
      .eq("id", row.id);

    // Fire the standard "submitted" notification so the right humans
    // get pinged. For vendor PMs they'll see it in the QR portal too
    // (vendor_id is set).
    try {
      await notifyTicketEvent(supabase, ticket, "submitted");
    } catch (e) {
      console.warn("[pm-spawner] notifyTicketEvent failed:", e?.message);
    }

    spawned.push({
      schedule_id: row.id,
      store_number: store.number,
      store_name: store.name,
      template_name: tmpl.name,
      performer_type: tmpl.performer_type,
      vendor_name: vendor?.name || null,
      ticket_id: ticket.id,
      wo_number: woNumber,
    });
  }

  return { spawned, skipped };
}

// onPMTicketClosed — called from facilities-v2 transitionTicket when a
// ticket reaches a terminal state. If the ticket is linked to a PM
// schedule, advance the schedule's next_due_at and record completion.
// No-op for non-PM tickets or cancellations.
export async function onPMTicketClosed(supabase, ticket) {
  if (!ticket?.pm_schedule_id) return;
  if (!SUCCESS_CLOSE_STATUSES.has(ticket.status)) return;

  const { data: schedule } = await supabase
    .from("pm_schedule")
    .select(`
      id, next_due_at,
      pm_templates:template_id ( cadence_type, cadence_days, fixed_months, fixed_day_of_month )
    `)
    .eq("id", ticket.pm_schedule_id)
    .maybeSingle();
  if (!schedule || !schedule.pm_templates) return;

  const nextDue = computeNextDueAt(schedule.pm_templates, new Date());
  await supabase
    .from("pm_schedule")
    .update({
      last_completed_at: new Date().toISOString(),
      last_ticket_id: null,
      next_due_at: nextDue.toISOString(),
    })
    .eq("id", schedule.id);
}
