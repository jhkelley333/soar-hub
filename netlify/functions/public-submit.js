// netlify/functions/public-submit.js
//
// Unauthenticated public ticket-submission flow. Lives at /submit
// in the browser; this function backs the two endpoints it needs:
//
//   GET  ?action=searchStores&q=<query>  — typeahead store picker
//   POST ?action=createTicket            — file the ticket
//
// No login required. Risk surface is small:
//   * searchStores returns only (id, number, name). Public store
//     numbers + names are already on every storefront — leaking them
//     via this endpoint isn't a new exposure. Min query length 2 +
//     20-row cap keep this from being a full-table dump.
//   * createTicket requires submitter name, valid-looking email,
//     a real store id, and a non-trivial issue description. Ticket
//     is filed with submitted_by = "Public: <name> <email>" and
//     submitted_by_user_id = null so it's easy to filter in the
//     admin queue.
//   * No file uploads in v1 — keeps storage-abuse surface zero.
//
// Spam mitigation later: rate-limit per IP, hCaptcha on the form,
// confirmation email loop. Not blocking initial launch.

import { createClient } from "@supabase/supabase-js";
import { notifyTicketEvent } from "./_lib/ticketEmail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Very forgiving email regex — just enough to catch obvious typos.
// We're not validating deliverability here, just shape.
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

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

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    const supabase = getSupabase();
    const action = (event.queryStringParameters || {}).action || "";

    // ── Store typeahead (public) ──
    if (action === "searchStores") {
      const q = String((event.queryStringParameters || {}).q || "").trim();
      if (q.length < 2) {
        return respond(200, { ok: true, stores: [] });
      }
      // OR-search across number + name. ilike for case-insensitive
      // substring match. Cap at 20 rows so an attacker can't pull
      // the whole table by sending q="".
      const { data, error } = await supabase
        .from("stores")
        .select("id, number, name")
        .or(`number.ilike.%${q}%,name.ilike.%${q}%`)
        .eq("is_active", true)
        .order("number", { ascending: true })
        .limit(20);
      if (error) throw error;
      return respond(200, { ok: true, stores: data || [] });
    }

    // ── Submit ticket (public) ──
    if (action === "createTicket" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const storeId = String(body.store_id || "").trim();
      const submitterName = String(body.submitter_name || "").trim();
      const submitterEmail = String(body.submitter_email || "").trim();
      const submitterPhone = String(body.submitter_phone || "").trim();
      const category = String(body.category || "").trim();
      const assetType = String(body.asset_type || "").trim();
      const issueDescription = String(body.issue_description || "").trim();
      const priority = ["Standard", "Urgent", "Emergency"].includes(body.priority)
        ? body.priority : "Standard";

      // Required fields. Be strict here — no anonymous "test"
      // submissions from the public form.
      if (!storeId) {
        return respond(400, { ok: false, message: "Pick a store before submitting." });
      }
      if (!submitterName) {
        return respond(400, { ok: false, message: "Please enter your name." });
      }
      if (!looksLikeEmail(submitterEmail)) {
        return respond(400, { ok: false, message: "Please enter a valid email." });
      }
      if (issueDescription.length < 10) {
        return respond(400, {
          ok: false,
          message: "Describe the issue in at least 10 characters.",
        });
      }

      // Resolve store. Reject if the id doesn't match a real active
      // store — covers the case where someone tampers with the
      // hidden field client-side.
      const { data: store, error: storeErr } = await supabase
        .from("stores")
        .select("id, number, name")
        .eq("id", storeId)
        .eq("is_active", true)
        .maybeSingle();
      if (storeErr) throw storeErr;
      if (!store) {
        return respond(400, { ok: false, message: "Unknown store." });
      }

      const woNumber = await nextWONumber(supabase, store.number);
      const submittedBy = `Public: ${submitterName} <${submitterEmail}>`
        + (submitterPhone ? ` · ${submitterPhone}` : "");

      const { data: ticket, error: tErr } = await supabase
        .from("tickets")
        .insert({
          wo_number:              woNumber,
          store_number:           store.number,
          store_name:             store.name || "",
          store_email:            "",
          do_email:               "",
          sdo_email:              "",
          submitted_by:           submittedBy,
          submitted_by_user_id:   null,
          category:               category || "Public submission",
          asset_type:             assetType || "",
          issue_description:      issueDescription,
          status:                 "submitted",
          priority,
          is_business_critical:   false,
          troubleshooting_checked:false,
          vendor_contacted:       false,
          date_submitted:         new Date().toISOString(),
        })
        .select()
        .single();
      if (tErr) throw tErr;

      // Audit row so the ticket's timeline shows where it came from.
      await supabase.from("ticket_activities").insert({
        ticket_id:  ticket.id,
        user_id:    null,
        user_name:  submittedBy,
        user_role:  "public",
        update_type:"created",
        new_value:  "submitted",
        notes:      "Submitted via public /submit page.",
        event_type: "ticket_created",
        event_data: {
          initial_status: "submitted",
          wo_number: woNumber,
          source: "public_submit",
          submitter_email: submitterEmail,
          submitter_phone: submitterPhone || null,
        },
        visibility: "all",
      });

      // Fire the standard "submitted" notification so the right
      // internal recipients get pinged. notifyTicketEvent already
      // handles missing store/DO/SDO emails gracefully.
      try {
        await notifyTicketEvent(supabase, ticket, "submitted");
      } catch (e) {
        console.warn("[public-submit] notifyTicketEvent failed:", e?.message);
      }

      return respond(200, {
        ok: true,
        ticket: {
          wo_number: ticket.wo_number,
          store_number: store.number,
          store_name: store.name,
        },
      });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[public-submit] error:", err);
    return respond(500, { ok: false, message: err?.message || "Internal error." });
  }
};
