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

// Same bucket WO2 uses. Public photos get upload_type =
// 'public_submission' so admins can audit / mass-purge if abuse
// shows up.
const PHOTOS_BUCKET = "wo2-ticket-photos";

// Public upload guards. The combination of all three keeps anonymous
// uploads tightly scoped:
//   * Per-photo size cap: 5 MB decoded (after base64). Modern phone
//     photos comfortably fit; abusers can't lob 100 MB blobs.
//   * Per-ticket count cap: 3 photos. Mirrors the form's UI.
//   * Time window: 15 min from ticket creation. After this the
//     ticket "closes" for public photo uploads even if the count
//     isn't full yet.
const MAX_PUBLIC_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PUBLIC_PHOTOS_PER_TICKET = 3;
const PUBLIC_UPLOAD_WINDOW_MS = 15 * 60 * 1000;

// ── Vendor visibility helpers ──
// Inlined copies of the same functions in facilities-v2.js so this
// function has no cross-file Lambda dep. A vendor is visible at a
// store iff one of its vendor_scopes rows resolves to one of the
// store's hierarchy keys, OR it has no scope rows (legacy "show
// everywhere" fallback).
async function visibleScopeKeysForStore(supabase, storeNumber) {
  const num = String(storeNumber || "").trim();
  if (!num) return null;
  const { data: store } = await supabase
    .from("stores")
    .select("id, district_id, districts(area_id, areas(region_id))")
    .eq("number", num)
    .maybeSingle();
  if (!store) return null;
  const districtId = store.district_id || null;
  const areaId = store.districts?.area_id || null;
  const regionId = store.districts?.areas?.region_id || null;
  const keys = new Set();
  keys.add("national");
  if (store.id)   keys.add(`store:${store.id}`);
  if (districtId) keys.add(`district:${districtId}`);
  if (areaId)     keys.add(`area:${areaId}`);
  if (regionId)   keys.add(`region:${regionId}`);
  return keys;
}

function isVendorVisibleAtStore(scopes, allowedSet, strict = false) {
  if (!scopes || scopes.length === 0) return !strict;
  for (const s of scopes) {
    if (s.scope_type === "national") {
      if (allowedSet.has("national")) return true;
      continue;
    }
    if (s.scope_id && allowedSet.has(`${s.scope_type}:${s.scope_id}`)) {
      return true;
    }
  }
  return false;
}

async function isStrictVendorScopes(supabase) {
  try {
    const { data } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "wo2_strict_vendor_scopes")
      .maybeSingle();
    return !!data?.enabled;
  } catch {
    return false;
  }
}

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
      const modelNumber = String(body.model_number || "").trim();
      const issueDescription = String(body.issue_description || "").trim();
      const priority = ["Standard", "Urgent", "Emergency"].includes(body.priority)
        ? body.priority : "Standard";
      // Tri-state: true if the submitter explicitly said "yes", false
      // otherwise. We don't gate submission on this — see the
      // troubleshooting question on the public form.
      const troubleshootingChecked = body.troubleshooting_checked === true;
      // Optional vendor preference. If supplied, re-validate that the
      // vendor exists, is active, and is visible at this store before
      // writing it onto the ticket — never trust the client.
      const vendorIdInput = body.vendor_id ? String(body.vendor_id).trim() : "";
      let resolvedVendorId = null;
      let resolvedVendorName = "";
      if (vendorIdInput) {
        const { data: v } = await supabase
          .from("vendors")
          .select("id, name, is_active, vendor_scopes(scope_type, scope_id)")
          .eq("id", vendorIdInput)
          .maybeSingle();
        if (v && v.is_active) {
          const allowedSet = await visibleScopeKeysForStore(supabase, store.number);
          const strict = await isStrictVendorScopes(supabase);
          if (allowedSet && isVendorVisibleAtStore(v.vendor_scopes || [], allowedSet, strict)) {
            resolvedVendorId = v.id;
            resolvedVendorName = v.name || "";
          }
        }
      }

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
          model_number:           modelNumber || "",
          issue_description:      issueDescription,
          status:                 "submitted",
          priority,
          is_business_critical:   false,
          troubleshooting_checked:troubleshootingChecked,
          vendor_id:              resolvedVendorId,
          vendor_name:            resolvedVendorName,
          // vendor_contacted stays false — the submitter is suggesting
          // a vendor, not confirming one has been contacted yet.
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
          // Returning the uuid lets the client follow up with photo
          // uploads against this just-created public ticket.
          id: ticket.id,
          wo_number: ticket.wo_number,
          store_number: store.number,
          store_name: store.name,
        },
      });
    }

    // ── Issue-library typeahead (public) ──
    // Same shape as the WO2 modal's typeahead. Exposed publicly
    // because the library has no PII or operational details — just
    // category + asset_type + display_name + troubleshooting_tips.
    if (action === "searchIssueLibrary") {
      const q = String((event.queryStringParameters || {}).q || "").trim();
      if (q.length < 2) {
        return respond(200, { ok: true, items: [] });
      }
      const { data, error } = await supabase
        .from("issue_library")
        .select("id, category, asset_type, display_name, troubleshooting_tips, sort_order")
        .or(`display_name.ilike.%${q}%,category.ilike.%${q}%,asset_type.ilike.%${q}%`)
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true })
        .limit(20);
      if (error) throw error;
      return respond(200, { ok: true, items: data || [] });
    }

    // ── Vendor list (public, store-scoped) ──
    // Returns the same scope-filtered set of vendors the WO2 picker
    // shows, but stripped down to id + name + category. Phone /
    // email / cost-tier / ratings stay out so anonymous visitors
    // can't farm the vendor directory.
    if (action === "listVendors") {
      const params = event.queryStringParameters || {};
      const storeNumber = String(params.store_number || "").trim();
      const category = String(params.category || "").trim();
      if (!storeNumber) {
        return respond(400, { ok: false, message: "store_number required" });
      }
      const { data: vendors, error } = await supabase
        .from("vendors")
        .select("id, name, category, vendor_scopes(scope_type, scope_id)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;

      const allowedSet = await visibleScopeKeysForStore(supabase, storeNumber);
      const strict = await isStrictVendorScopes(supabase);
      const visible = (vendors || []).filter((v) => {
        if (!allowedSet) return true;
        return isVendorVisibleAtStore(v.vendor_scopes || [], allowedSet, strict);
      }).filter((v) => {
        if (!category) return true;
        // Loose category match — many vendors cover multiple
        // categories via a slash- or comma-delimited string, so a
        // simple includes() does the right thing here.
        const vc = String(v.category || "").toLowerCase();
        return !vc || vc.includes(category.toLowerCase()) || category.toLowerCase().includes(vc);
      }).map((v) => ({ id: v.id, name: v.name, category: v.category || "" }));

      return respond(200, { ok: true, vendors: visible });
    }

    // ── Photo upload for a just-created public ticket ──
    // No auth, but heavily guarded:
    //   * ticket must exist
    //   * submitted_by_user_id IS NULL AND submitted_by starts with
    //     "Public:" — so this can only target public-submitted rows
    //   * ticket.date_submitted within PUBLIC_UPLOAD_WINDOW_MS
    //   * existing public photo count < MAX_PUBLIC_PHOTOS_PER_TICKET
    //   * decoded payload <= MAX_PUBLIC_PHOTO_BYTES
    //   * MIME starts with "image/"
    // Anyone forging a request would need to know a freshly-created
    // ticket UUID. After 15 min or 3 photos the door closes.
    if (action === "uploadPhoto" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const ticketId = String(body.ticket_id || "").trim();
      const photoData = String(body.photo_data || "");
      const photoName = String(body.photo_name || "photo.jpg");
      const photoType = String(body.photo_type || "image/jpeg");

      if (!ticketId || !photoData) {
        return respond(400, { ok: false, message: "ticket_id and photo_data required." });
      }
      if (!/^image\//.test(photoType)) {
        return respond(400, { ok: false, message: "Only image uploads allowed." });
      }

      const { data: ticket, error: tErr } = await supabase
        .from("tickets")
        .select("id, submitted_by, submitted_by_user_id, date_submitted")
        .eq("id", ticketId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!ticket) return respond(404, { ok: false, message: "Ticket not found." });

      if (ticket.submitted_by_user_id || !String(ticket.submitted_by || "").startsWith("Public:")) {
        return respond(403, { ok: false, message: "Photo upload not allowed for this ticket." });
      }
      const ageMs = Date.now() - new Date(ticket.date_submitted).getTime();
      if (!Number.isFinite(ageMs) || ageMs > PUBLIC_UPLOAD_WINDOW_MS) {
        return respond(403, { ok: false, message: "Upload window has closed." });
      }

      const { count: existing } = await supabase
        .from("ticket_photos")
        .select("*", { count: "exact", head: true })
        .eq("ticket_id", ticketId)
        .eq("upload_type", "public_submission");
      if ((existing ?? 0) >= MAX_PUBLIC_PHOTOS_PER_TICKET) {
        return respond(429, {
          ok: false,
          message: `Photo limit reached (${MAX_PUBLIC_PHOTOS_PER_TICKET}).`,
        });
      }

      const buf = Buffer.from(photoData, "base64");
      if (buf.length === 0) {
        return respond(400, { ok: false, message: "Empty photo." });
      }
      if (buf.length > MAX_PUBLIC_PHOTO_BYTES) {
        return respond(413, {
          ok: false,
          message: `Photo too large (${(buf.length / 1024 / 1024).toFixed(1)} MB); cap is ${MAX_PUBLIC_PHOTO_BYTES / 1024 / 1024} MB.`,
        });
      }

      const ext = (photoName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const fileName = `${ticketId}/${Date.now()}_public.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(fileName, buf, { contentType: photoType, upsert: false });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage
        .from(PHOTOS_BUCKET)
        .getPublicUrl(fileName);

      const { data: photo, error: insErr } = await supabase
        .from("ticket_photos")
        .insert({
          ticket_id:   ticketId,
          file_url:    publicUrl || fileName,
          file_name:   photoName,
          file_size:   buf.length,
          mime_type:   photoType,
          uploaded_by: ticket.submitted_by,
          upload_type: "public_submission",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await supabase.from("ticket_activities").insert({
        ticket_id:  ticketId,
        user_id:    null,
        user_name:  ticket.submitted_by,
        user_role:  "public",
        update_type:"photo_added",
        event_type: "photo_added",
        event_data: {
          photo_id: photo?.id,
          file_name: photoName,
          upload_type: "public_submission",
        },
        visibility: "all",
      });

      return respond(200, { ok: true, photo });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[public-submit] error:", err);
    return respond(500, { ok: false, message: err?.message || "Internal error." });
  }
};
