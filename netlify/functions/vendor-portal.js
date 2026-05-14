// netlify/functions/vendor-portal.js
//
// Anonymous endpoints for the per-store QR vendor portal. No JWT
// required — every request is authenticated by a long random token
// resolved against store_qr_tokens. Forward-only state changes:
// vendors can mark on_site, completed, submit a quote, or upload
// photos. They CANNOT close, cancel, or reopen — those remain with
// the GM / DO via the authenticated facilities-v2 function.
//
// Actions:
//   * resolve       GET  ?token=<t>           → store info + open tickets
//   * getTicket     GET  ?token=<t>&ticketId  → full ticket detail
//   * markOnSite    POST { token, ticketId, identity, notes? }
//   * markCompleted POST { token, ticketId, identity, notes?, resolution_category? }
//   * submitQuote   POST { token, ticketId, identity, amount, notes?, photo? }
//   * uploadPhoto   POST { token, ticketId, identity, photoData, photoType, photoName, label? }
//
// Identity is { vendor_name, vendor_company?, vendor_phone? }. Sent
// on every action — stored alongside the audit log entry. Never
// authoritative.
//
// Rate limiting: 10 mutating actions per token per hour. Lookups
// uncapped. Implemented in-memory per cold-start; good enough for
// the stopgap.

import { createClient } from "@supabase/supabase-js";
import { transition } from "./_lib/ticketStateMachine.js";
import { tierFor } from "./_lib/permissions.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const PHOTOS_BUCKET = "wo2-ticket-photos";
const RATE_WINDOW_MS = 60 * 60 * 1000;       // 1 hour
const RATE_LIMIT     = 10;                    // mutating ops per token per window

// In-memory rate buckets keyed by token. Resets on cold start; that's
// fine for a stopgap. For real long-term we'd back this with the DB.
const _buckets = new Map();

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // The portal is loaded from the same origin (Netlify deploy),
      // so no CORS is strictly required. Set permissive anyway in
      // case it's loaded from a printed QR landing page.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

function clientInfo(event) {
  const headers = event.headers || {};
  const fwd = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const ip = String(fwd).split(",")[0].trim() || null;
  const ua = headers["user-agent"] || headers["User-Agent"] || null;
  return { ip, ua };
}

function bumpRate(token) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const arr = (_buckets.get(token) || []).filter((t) => t > cutoff);
  arr.push(now);
  _buckets.set(token, arr);
  return arr.length;
}

// Resolve a token to its row + store info. Validates active + not expired.
async function resolveToken(supa, token) {
  if (!token || typeof token !== "string") return null;
  const { data } = await supa
    .from("store_qr_tokens")
    .select("id, store_number, label, is_active, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }
  return data;
}

async function logVisit(supa, payload) {
  try {
    await supa.from("vendor_visits").insert(payload);
  } catch (e) {
    console.warn("[vendor-portal] visit log failed", e);
  }
}

// Cost → approval tier mapping. Capped at VP per design decision —
// anything above $1,750 still routes to VP.
function tierForCost(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 500)   return "DO < $500";
  if (n <= 1000) return "SDO $501-$1000";
  return "VP $1001-$1750";
}

function pickIdentity(body) {
  const i = body?.identity || {};
  return {
    vendor_name:    typeof i.vendor_name    === "string" ? i.vendor_name.trim()    : null,
    vendor_company: typeof i.vendor_company === "string" ? i.vendor_company.trim() : null,
    vendor_phone:   typeof i.vendor_phone   === "string" ? i.vendor_phone.trim()   : null,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  try {
    const qs = event.queryStringParameters || {};
    const action = qs.action || "resolve";
    const supabase = getSupabase();

    // ── resolve: token → store + open ticket list ──────────────
    if (action === "resolve") {
      const token = qs.token;
      const tok = await resolveToken(supabase, token);
      if (!tok) {
        return respond(404, { ok: false, error: "invalid_or_expired_token" });
      }

      const { data: store } = await supabase
        .from("stores")
        .select("number, name, city, state")
        .eq("number", tok.store_number)
        .maybeSingle();

      // Open tickets = anything not in a terminal state. Vendors
      // should see in-flight work; closed/cancelled is irrelevant.
      const { data: tickets } = await supabase
        .from("tickets")
        .select("id, wo_number, asset_type, category, issue_description, priority, vendor_name, status, pause_state, date_submitted")
        .eq("store_number", tok.store_number)
        .in("status", ["submitted", "in_progress", "scheduled", "on_site"])
        .order("priority", { ascending: false })
        .order("date_submitted", { ascending: false });

      return respond(200, {
        ok: true,
        store,
        tokenLabel: tok.label,
        tickets: tickets || [],
      });
    }

    // ── getTicket: full detail for one ticket ──────────────────
    if (action === "getTicket") {
      const token = qs.token;
      const ticketId = qs.ticketId;
      const tok = await resolveToken(supabase, token);
      if (!tok) return respond(404, { ok: false, error: "invalid_or_expired_token" });
      if (!ticketId) return respond(400, { ok: false, error: "ticketId required" });

      const { data: ticket } = await supabase
        .from("tickets")
        .select(`
          id, wo_number, store_number, store_name, asset_type, category,
          model_number, issue_description, priority, is_business_critical,
          status, pause_state, vendor_name, vendor_eta, cost_estimate,
          troubleshooting_checked, date_submitted, closed_at,
          ticket_photos(id, file_url, file_name, upload_type, created_at)
        `)
        .eq("id", ticketId)
        .eq("store_number", tok.store_number) // scope to this store
        .maybeSingle();
      if (!ticket) {
        return respond(404, { ok: false, error: "ticket_not_at_this_store" });
      }
      return respond(200, { ok: true, ticket });
    }

    // ── Mutating actions from here down ────────────────────────
    if (event.httpMethod !== "POST") {
      return respond(405, { ok: false, error: "method_not_allowed" });
    }
    const body = JSON.parse(event.body || "{}");
    const token = body.token;
    const tok = await resolveToken(supabase, token);
    if (!tok) return respond(404, { ok: false, error: "invalid_or_expired_token" });

    const count = bumpRate(token);
    if (count > RATE_LIMIT) {
      return respond(429, { ok: false, error: "rate_limited", limit: RATE_LIMIT });
    }

    const identity = pickIdentity(body);
    if (!identity.vendor_name) {
      return respond(400, { ok: false, error: "vendor_name required" });
    }
    const ticketId = body.ticketId;
    const { ip, ua } = clientInfo(event);

    // Confirm the target ticket belongs to this store. Hard guard
    // against guessing other stores' ticket IDs.
    const { data: current } = await supabase
      .from("tickets")
      .select("id, status, pause_state, closed_at, store_number, wo_number")
      .eq("id", ticketId)
      .eq("store_number", tok.store_number)
      .maybeSingle();
    if (!current) {
      return respond(404, { ok: false, error: "ticket_not_at_this_store" });
    }

    // ── markOnSite ───────────────────────────────────────────
    if (action === "markOnSite") {
      let result;
      try {
        result = transition({
          from: current.status,
          to:   "on_site",
          payload: {
            vendor_name: identity.vendor_company || identity.vendor_name,
          },
          ctx: {
            ticketId,
            closed_at: current.closed_at,
            pause_state: current.pause_state,
            actor: { id: null, role: "vendor", tier: "vendor" },
          },
        });
      } catch (smErr) {
        return respond(smErr.statusCode || 500, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
          from: smErr.from, to: smErr.to,
        });
      }

      const updates = {
        ...result.updates,
        date_status_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("tickets").update(updates).eq("id", ticketId);
      if (error) throw error;

      // Activity entries — main + pause reset if any.
      const activityRows = [];
      if (result.activity) {
        activityRows.push({
          ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
          user_role: "vendor",
          update_type: "status_change",
          old_value: current.status, new_value: "on_site",
          event_type: result.activity.event_type,
          event_data: {
            ...result.activity.event_data,
            vendor_self_report: true,
            acted_on_behalf_of_vendor: true,
            vendor_identity: identity,
            notes: body.notes || null,
          },
          visibility: "all",
        });
      }
      if (result.pauseResetActivity) {
        activityRows.push({
          ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
          user_role: "vendor",
          update_type: "pause_state_change",
          event_type:  result.pauseResetActivity.event_type,
          event_data:  result.pauseResetActivity.event_data,
          visibility:  result.pauseResetActivity.visibility,
        });
      }
      if (activityRows.length) {
        await supabase.from("ticket_activities").insert(activityRows);
      }
      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "on_site", notes: body.notes || null,
        remote_ip: ip, user_agent: ua,
      });
      return respond(200, { ok: true });
    }

    // ── markCompleted ────────────────────────────────────────
    if (action === "markCompleted") {
      const payload = {
        resolution_category: body.resolution_category || null,
        vendor_name: identity.vendor_company || identity.vendor_name,
      };
      let result;
      try {
        result = transition({
          from: current.status,
          to:   "completed",
          payload,
          ctx: {
            ticketId,
            closed_at: current.closed_at,
            pause_state: current.pause_state,
            actor: { id: null, role: "vendor", tier: "vendor" },
          },
        });
      } catch (smErr) {
        return respond(smErr.statusCode || 500, {
          ok: false,
          error: smErr.code || "state_machine_error",
          message: smErr.message,
          from: smErr.from, to: smErr.to,
        });
      }

      const updates = {
        ...result.updates,
        date_status_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("tickets").update(updates).eq("id", ticketId);
      if (error) throw error;

      const activityRows = [];
      if (result.activity) {
        activityRows.push({
          ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
          user_role: "vendor",
          update_type: "status_change",
          old_value: current.status, new_value: "completed",
          event_type: result.activity.event_type,
          event_data: {
            ...result.activity.event_data,
            vendor_self_report: true,
            acted_on_behalf_of_vendor: true,
            vendor_identity: identity,
            notes: body.notes || null,
          },
          visibility: "all",
        });
      }
      if (result.pauseResetActivity) {
        activityRows.push({
          ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
          user_role: "vendor",
          update_type: "pause_state_change",
          event_type:  result.pauseResetActivity.event_type,
          event_data:  result.pauseResetActivity.event_data,
          visibility:  result.pauseResetActivity.visibility,
        });
      }
      if (activityRows.length) {
        await supabase.from("ticket_activities").insert(activityRows);
      }
      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "completed", notes: body.notes || null,
        remote_ip: ip, user_agent: ua,
      });
      return respond(200, { ok: true });
    }

    // ── submitQuote ─────────────────────────────────────────
    // Vendor submits a quote for the work. Creates a ticket_approvals
    // row with tier inferred from the dollar amount. Triggers the
    // existing approval_requested flow (handled by GM/DO via
    // facilities-v2 — no email fired from here yet; that can be
    // added in a follow-up).
    if (action === "submitQuote") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return respond(400, { ok: false, error: "amount must be a positive number" });
      }
      const tier = tierForCost(amount);
      if (!tier) {
        return respond(400, { ok: false, error: "invalid_amount" });
      }

      // Optional PDF attachment.
      let quoteUrl = null;
      if (body.photo && body.photo.photoData) {
        const buf = Buffer.from(body.photo.photoData, "base64");
        const ext = (body.photo.photoName || "quote.pdf").split(".").pop();
        const fileName = `${ticketId}/quote-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .upload(fileName, buf, {
            contentType: body.photo.photoType || "application/pdf",
            upsert: false,
          });
        if (upErr) {
          console.error("[vendor-portal] quote upload error", upErr);
          return respond(500, { ok: false, error: "quote_upload_failed" });
        }
        const { data: { publicUrl } } = supabase.storage
          .from(PHOTOS_BUCKET)
          .getPublicUrl(fileName);
        quoteUrl = publicUrl || fileName;

        await supabase.from("ticket_photos").insert({
          ticket_id: ticketId,
          file_url: quoteUrl,
          file_name: body.photo.photoName || "quote.pdf",
          file_size: buf.length,
          mime_type: body.photo.photoType || "application/pdf",
          uploaded_by: `Vendor: ${identity.vendor_name}`,
          upload_type: "quote",
        });
      }

      // Create the approval request row.
      const { error: appErr } = await supabase.from("ticket_approvals").insert({
        ticket_id: ticketId,
        approval_tier: tier,
        requested_by: `Vendor: ${identity.vendor_name}`,
        notes: body.notes || `Vendor quote: $${amount.toFixed(2)}`,
        quote_url: quoteUrl || "",
        status: "Pending",
      });
      if (appErr) throw appErr;

      // Bump the ticket's cost_estimate + approval status.
      await supabase.from("tickets").update({
        cost_estimate: amount,
        approval_level: tier,
        approval_request_notes: body.notes || `Vendor quote: $${amount.toFixed(2)}`,
        approval_status: "Pending",
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);

      await supabase.from("ticket_activities").insert({
        ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
        user_role: "vendor",
        update_type: "approval",
        new_value: "Pending",
        notes: body.notes || `Quote $${amount.toFixed(2)}`,
        event_type: "approval_requested",
        event_data: {
          approval_tier: tier,
          quote_url: quoteUrl,
          amount,
          notes: body.notes || null,
          vendor_self_report: true,
          acted_on_behalf_of_vendor: true,
          vendor_identity: identity,
        },
        visibility: "all",
      });

      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "quote_submitted",
        notes: `$${amount.toFixed(2)} • ${tier}`,
        remote_ip: ip, user_agent: ua,
      });
      return respond(200, { ok: true, tier, quoteUrl });
    }

    // ── uploadPhoto (standalone) ─────────────────────────────
    if (action === "uploadPhoto") {
      if (!body.photoData) return respond(400, { ok: false, error: "photoData required" });
      const buf = Buffer.from(body.photoData, "base64");
      const ext = (body.photoName || "photo.jpg").split(".").pop();
      const fileName = `${ticketId}/vendor-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(fileName, buf, {
          contentType: body.photoType || "image/jpeg",
          upsert: false,
        });
      if (upErr) {
        console.error("[vendor-portal] photo upload error", upErr);
        return respond(500, { ok: false, error: "upload_failed" });
      }
      const { data: { publicUrl } } = supabase.storage
        .from(PHOTOS_BUCKET)
        .getPublicUrl(fileName);

      const { data: photo } = await supabase.from("ticket_photos").insert({
        ticket_id: ticketId,
        file_url: publicUrl || fileName,
        file_name: body.photoName || "photo.jpg",
        file_size: buf.length,
        mime_type: body.photoType || "image/jpeg",
        uploaded_by: `Vendor: ${identity.vendor_name}`,
        upload_type: body.label === "after" ? "update" : (body.label || "update"),
      }).select().single();

      await supabase.from("ticket_activities").insert({
        ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
        user_role: "vendor",
        update_type: "photo_added",
        event_type:  "photo_added",
        event_data: {
          photo_id: photo?.id, file_name: body.photoName,
          label: body.label || null,
          vendor_self_report: true,
          acted_on_behalf_of_vendor: true,
          vendor_identity: identity,
        },
        visibility: "all",
      });

      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "photo_added", notes: body.label || null,
        remote_ip: ip, user_agent: ua,
      });
      return respond(200, { ok: true, photo });
    }

    // ── Admin-only token management ──────────────────────────
    // Distinct from the anonymous portal actions above; these
    // require a Bearer JWT and admin role. Listed under the same
    // function name to keep deploy simple.
    if (["adminList", "adminCreate", "adminRevoke"].includes(action)) {
      return await handleAdmin(supabase, event, action);
    }

    return respond(400, { ok: false, error: "unknown_action", action });
  } catch (err) {
    console.error("[vendor-portal] error", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal error.",
    });
  }
};

async function getAdminProfile(supabase, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const { data: userRes } = await supabase.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  if (profile.role !== "admin") return null;
  return profile;
}

async function handleAdmin(supabase, event, action) {
  const profile = await getAdminProfile(supabase, event);
  if (!profile) {
    return respond(403, { ok: false, error: "admin_only" });
  }

  if (action === "adminList") {
    const storeNumber = (event.queryStringParameters || {}).store;
    let q = supabase
      .from("store_qr_tokens")
      .select("id, store_number, token, label, is_active, expires_at, created_at, revoked_at, created_by_id, revoked_by_id")
      .order("created_at", { ascending: false });
    if (storeNumber) q = q.eq("store_number", storeNumber);
    const { data, error } = await q;
    if (error) throw error;

    // Also pull a small visit summary per token for the admin list.
    const tokenIds = (data || []).map((r) => r.id);
    let visitCounts = {};
    let lastVisits = {};
    if (tokenIds.length) {
      const { data: visits } = await supabase
        .from("vendor_visits")
        .select("token_id, action, created_at")
        .in("token_id", tokenIds)
        .order("created_at", { ascending: false });
      for (const v of visits || []) {
        visitCounts[v.token_id] = (visitCounts[v.token_id] || 0) + 1;
        if (!lastVisits[v.token_id]) lastVisits[v.token_id] = v.created_at;
      }
    }
    const annotated = (data || []).map((r) => ({
      ...r,
      visit_count: visitCounts[r.id] || 0,
      last_visit_at: lastVisits[r.id] || null,
    }));
    return respond(200, { ok: true, tokens: annotated });
  }

  if (action === "adminCreate" && event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const storeNumber = String(body.store_number || "").trim();
    if (!storeNumber) {
      return respond(400, { ok: false, error: "store_number required" });
    }
    const label = body.label ? String(body.label).trim() : null;
    const ttlDays = Number(body.ttl_days) || 365;
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();

    // Mint token via the DB helper added in migration 0044.
    const { data: tokenRow } = await supabase.rpc("gen_store_qr_token");
    const generatedToken = tokenRow || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));

    const { data, error } = await supabase
      .from("store_qr_tokens")
      .insert({
        store_number: storeNumber,
        token: generatedToken,
        label,
        expires_at: expiresAt,
        created_by_id: profile.id,
      })
      .select()
      .single();
    if (error) throw error;
    return respond(200, { ok: true, token: data });
  }

  if (action === "adminRevoke" && event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const id = body.id;
    if (!id) return respond(400, { ok: false, error: "id required" });
    const { error } = await supabase
      .from("store_qr_tokens")
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by_id: profile.id,
      })
      .eq("id", id);
    if (error) throw error;
    return respond(200, { ok: true });
  }

  return respond(400, { ok: false, error: "unknown_admin_action", action });
}

// tierFor is imported but currently unused — kept for future symmetry
// when we add caller-role-aware features to the portal.
void tierFor;
