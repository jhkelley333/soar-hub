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

// Minimal Resend wrapper — same pattern as facilities-v2's sendEmail
// but duplicated here so the vendor portal stays self-contained.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  const fromAddr =
    process.env.RESEND_FROM_EMAIL ||
    "notifications@mysoarhub.com";
  const fromName = process.env.RESEND_FROM_NAME || "SOAR Work Orders";
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

// Drive-by completion: vendor marked on-site and then completed in
// under 5 minutes. Real service almost always takes longer; this
// pattern is a strong signal that someone may have hit both buttons
// in rapid succession without doing the work. Fires an admin email.
//
// Called from markCompleted AFTER the visit is logged so we have the
// just-written row in the DB.
async function maybeAlertDriveByCompletion(supabase, {
  tokenId, ticketId, woNumber, storeNumber, vendor,
}) {
  // Find the most recent on_site visit for this same ticket+token.
  const { data: prior } = await supabase
    .from("vendor_visits")
    .select("action, created_at")
    .eq("token_id", tokenId)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(10);
  const onSite = (prior || []).find((v) => v.action === "on_site");
  if (!onSite) return; // no prior on_site → can't be a drive-by
  const completed = (prior || []).find((v) => v.action === "completed");
  if (!completed) return;
  const gapMs = new Date(completed.created_at) - new Date(onSite.created_at);
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs >= 5 * 60_000) return;

  // Find admin emails. Tier-resolution would be ideal but for v1 we
  // only target literal role=admin so the alert volume stays low.
  const { data: admins } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("role", "admin")
    .eq("is_active", true);
  const recipients = (admins || []).map((a) => a.email).filter(Boolean);
  if (!recipients.length) return;

  const seconds = Math.round(gapMs / 1000);
  const subject = `[Vendor flag] Drive-by completion at Store ${storeNumber}`;
  const safeCompany = escapeHtml(vendor?.vendor_company || "");
  const safeName    = escapeHtml(vendor?.vendor_name    || "");
  const safePhone   = escapeHtml(vendor?.vendor_phone   || "");
  const safeWO      = escapeHtml(woNumber || "");
  const safeStore   = escapeHtml(storeNumber || "");
  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; color: #111;">
      <h2 style="margin-bottom: 4px;">Drive-by completion flagged</h2>
      <p style="margin-top: 4px; color: #444;">
        A vendor marked a ticket completed only <strong>${seconds} seconds</strong>
        after marking on-site. Real service calls almost always take longer;
        this pattern is worth a manual check.
      </p>
      <table style="border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Store</td><td><strong>${safeStore}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Ticket</td><td>${safeWO}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Vendor company</td><td>${safeCompany || "—"}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Vendor tech</td><td>${safeName || "—"}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Phone</td><td>${safePhone || "—"}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">On-site → completed</td><td>${seconds}s</td></tr>
      </table>
      <p style="margin-top: 16px; font-size: 13px; color: #555;">
        Review the full visit history in Work Orders V2 → Vendor QR → Recent Vendor Activity.
      </p>
    </div>
  `;
  try {
    await sendEmail({ to: recipients, subject, html });
  } catch (e) {
    console.warn("[vendor-portal] drive-by alert send failed", e);
  }
}

// Normalized store-number equality. Forgives type differences
// (text vs numeric in PostgREST responses), surrounding whitespace,
// and leading zeros — all of which have shown up across migrations
// and bulk-import paths. Use this instead of `===` whenever
// comparing token.store_number with ticket.store_number.
function storesMatch(a, b) {
  const norm = (v) => {
    if (v == null) return "";
    const s = String(v).trim();
    // Strip leading zeros for numeric-looking strings only — "0123"
    // → "123" but leave "01-A" alone.
    if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
    return s;
  };
  return norm(a) === norm(b);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
        .select("id, number, name, city, state, phone, district_id")
        .eq("number", tok.store_number)
        .maybeSingle();

      // Look up a DO assigned either directly to this store or to
      // its district. Used by the portal's empty-state panel so a
      // vendor with no matching ticket can call escalation directly
      // instead of "contact your District Operator" in the abstract.
      let doContact = null;
      if (store?.id) {
        const scopeIds = [store.id];
        if (store.district_id) scopeIds.push(store.district_id);
        const { data: scopes } = await supabase
          .from("user_scopes")
          .select("user_id")
          .in("scope_id", scopeIds);
        const userIds = [...new Set((scopes || []).map((s) => s.user_id))];
        if (userIds.length) {
          const { data: dos } = await supabase
            .from("profiles")
            .select("full_name, email, phone, role")
            .in("id", userIds)
            .eq("role", "do")
            .eq("is_active", true)
            .limit(1);
          if (dos && dos.length > 0) {
            doContact = {
              name:  dos[0].full_name,
              email: dos[0].email,
              phone: dos[0].phone,
            };
          }
        }
      }

      // Open tickets = anything not in a terminal state. Vendors
      // should see in-flight work; closed/cancelled is irrelevant.
      const { data: tickets } = await supabase
        .from("tickets")
        .select("id, wo_number, asset_type, category, issue_description, priority, vendor_name, status, pause_state, date_submitted")
        .eq("store_number", tok.store_number)
        .in("status", ["submitted", "in_progress", "scheduled", "on_site"])
        .order("priority", { ascending: false })
        .order("date_submitted", { ascending: false });

      // Drop the internal `id` and `district_id` from the response;
      // anonymous callers don't need them.
      const storeOut = store
        ? {
            number: store.number,
            name:   store.name,
            city:   store.city,
            state:  store.state,
            phone:  store.phone,
          }
        : null;

      return respond(200, {
        ok: true,
        store: storeOut,
        do_contact: doContact,
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

      // Fetch the ticket WITHOUT scoping by store_number first, then
      // compare normalized strings. The .eq filter does an exact
      // server-side comparison that can fail on store_number type
      // mismatches (text vs int) or whitespace — we'd rather have
      // the row back and inspect it than mysteriously return null.
      const { data: ticket, error: ticketErr } = await supabase
        .from("tickets")
        .select(`
          id, wo_number, store_number, store_name, asset_type, category,
          model_number, issue_description, priority, is_business_critical,
          status, pause_state, vendor_name, vendor_eta, cost_estimate,
          approval_status, approval_level, approval_request_notes,
          parts_ordered_by, parts_ordered_notes, parts_ordered_at,
          warranty_labor_days, warranty_parts_days, warranty_parts_source,
          warranty_starts_at, warranty_notes,
          troubleshooting_checked, date_submitted, closed_at,
          ticket_photos(id, file_url, file_name, upload_type, created_at)
        `)
        .eq("id", ticketId)
        .maybeSingle();
      // Distinguish a real DB error (e.g. missing column from a not-
      // yet-applied migration) from a genuine "no such row" so we
      // don't gaslight the caller with ticket_not_found.
      if (ticketErr) {
        console.error("[vendor-portal] getTicket query error", ticketErr);
        return respond(500, {
          ok: false,
          error: "ticket_query_failed",
          message: ticketErr.message || "Database query failed.",
        });
      }
      if (!ticket) {
        return respond(404, { ok: false, error: "ticket_not_found" });
      }
      if (!storesMatch(ticket.store_number, tok.store_number)) {
        console.warn("[vendor-portal] getTicket store mismatch", {
          ticketId,
          ticketStore: ticket.store_number,
          tokenStore:  tok.store_number,
        });
        return respond(404, {
          ok: false,
          error: "ticket_not_at_this_store",
          debug: {
            ticket_store: String(ticket.store_number ?? ""),
            token_store:  String(tok.store_number ?? ""),
          },
        });
      }
      return respond(200, { ok: true, ticket });
    }

    // ── Manager-only (SDO+) token management + monitoring ────
    // These use Bearer JWT auth and mix GET (list/listVisits) and
    // POST (create/revoke). Dispatch BEFORE the anonymous-mutating
    // 405 guard below; the manager handler enforces its own method
    // checks per action.
    if (["adminList", "adminCreate", "adminRevoke", "adminListVisits", "adminBulkCreate"].includes(action)) {
      return await handleManager(supabase, event, action);
    }

    // ── myStoreTokens: read-only token print panel for GMs/DOs ──
    // Any authenticated user gets their store's active QR token(s)
    // so they can print the sticker themselves. No create/revoke
    // here — that stays with SDO+ via the manager handler above.
    if (action === "myStoreTokens") {
      return await handleMyStoreTokens(supabase, event);
    }

    // ── getVendorMessages: anonymous read of the vendor thread ──
    // Vendor portal chat read. Authenticated via the QR token.
    // Only the 'vendor' thread is exposed — the 'internal' thread
    // (between DOs/GMs) stays private to authed staff.
    if (action === "getVendorMessages") {
      const tok = await resolveToken(supabase, qs.token);
      if (!tok) return respond(404, { ok: false, error: "invalid_or_expired_token" });
      if (!qs.ticketId) return respond(400, { ok: false, error: "ticketId required" });

      // Confirm ticket belongs to this token's store before exposing
      // messages — same defense as getTicket.
      const { data: ticket, error: tErr } = await supabase
        .from("tickets")
        .select("id, store_number")
        .eq("id", qs.ticketId)
        .maybeSingle();
      if (tErr) {
        return respond(500, { ok: false, error: "ticket_query_failed", message: tErr.message });
      }
      if (!ticket) return respond(404, { ok: false, error: "ticket_not_found" });
      if (!storesMatch(ticket.store_number, tok.store_number)) {
        return respond(404, { ok: false, error: "ticket_not_at_this_store" });
      }

      const { data: msgs, error } = await supabase
        .from("ticket_messages")
        .select("id, user_id, user_name, user_role, message, thread_type, created_at")
        .eq("ticket_id", qs.ticketId)
        .eq("thread_type", "vendor")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return respond(200, { ok: true, messages: msgs || [] });
    }

    // ── Anonymous mutating actions from here down ──────────────
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
    // against guessing other stores' ticket IDs. Same defensive
    // pattern as getTicket: pull the row without the store filter
    // so a type/whitespace mismatch on store_number doesn't silently
    // 404 us with a misleading "not at this store" message.
    const { data: current, error: currentErr } = await supabase
      .from("tickets")
      .select("id, status, pause_state, closed_at, store_number, wo_number")
      .eq("id", ticketId)
      .maybeSingle();
    if (currentErr) {
      console.error("[vendor-portal] mutating-action query error", currentErr);
      return respond(500, {
        ok: false,
        error: "ticket_query_failed",
        message: currentErr.message || "Database query failed.",
      });
    }
    if (!current) {
      return respond(404, { ok: false, error: "ticket_not_found" });
    }
    if (!storesMatch(current.store_number, tok.store_number)) {
      console.warn("[vendor-portal] mutating-action store mismatch", {
        action, ticketId,
        ticketStore: current.store_number,
        tokenStore:  tok.store_number,
      });
      return respond(404, {
        ok: false,
        error: "ticket_not_at_this_store",
        debug: {
          ticket_store: String(current.store_number ?? ""),
          token_store:  String(tok.store_number ?? ""),
        },
      });
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

      // Look up the vendor's default warranty (if any) and copy it
      // onto the ticket. Match by name against the vendors table —
      // same string the vendor self-selected from the portal. If
      // either days field is set, we stamp warranty_starts_at = now
      // so expiration math is straightforward elsewhere.
      const vendorNameForLookup = identity.vendor_company || identity.vendor_name;
      let warrantyDefaults = null;
      if (vendorNameForLookup) {
        const { data: vendorRow } = await supabase
          .from("vendors")
          .select("labor_warranty_days, parts_warranty_days, parts_warranty_source, warranty_notes")
          .eq("name", vendorNameForLookup)
          .maybeSingle();
        if (vendorRow && (
          vendorRow.labor_warranty_days != null ||
          vendorRow.parts_warranty_days != null
        )) {
          warrantyDefaults = vendorRow;
        }
      }

      const updates = {
        ...result.updates,
        date_status_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(warrantyDefaults ? {
          warranty_labor_days:   warrantyDefaults.labor_warranty_days,
          warranty_parts_days:   warrantyDefaults.parts_warranty_days,
          warranty_parts_source: warrantyDefaults.parts_warranty_source,
          warranty_notes:        warrantyDefaults.warranty_notes,
          warranty_starts_at:    new Date().toISOString(),
        } : {}),
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
      // Fire-and-forget drive-by detection. We don't await this in
      // the response path because the user's action succeeded — the
      // alert is bonus monitoring. Any error is logged and swallowed.
      maybeAlertDriveByCompletion(supabase, {
        tokenId:     tok.id,
        ticketId,
        woNumber:    current.wo_number,
        storeNumber: current.store_number,
        vendor:      identity,
      }).catch((e) => console.warn("[vendor-portal] drive-by alert path failed", e));
      return respond(200, { ok: true });
    }

    // ── markPartsOnOrder ────────────────────────────────────
    // Vendor parks the ticket because parts are on order. Captures
    // who's responsible for ordering ('vendor' or 'customer') and
    // optional notes (part numbers, expected arrival, vendor PO).
    // Moves the ticket into the existing in_progress / awaiting_parts
    // pause state — same shape the DO uses from the WO2 UI — so it
    // shows up in the queue with the familiar "Awaiting Parts" label.
    if (action === "markPartsOnOrder") {
      const orderedByRaw = String(body.ordered_by || "").toLowerCase();
      const orderedBy = orderedByRaw === "customer" ? "customer" :
                       orderedByRaw === "vendor"   ? "vendor"   : null;
      if (!orderedBy) {
        return respond(400, {
          ok: false,
          error: "ordered_by required (vendor|customer)",
        });
      }
      if (current.status === "closed" || current.status === "cancelled") {
        return respond(409, { ok: false, error: "ticket_terminal" });
      }
      if (current.status === "completed") {
        return respond(409, { ok: false, error: "ticket_already_completed" });
      }

      // From submitted/scheduled/on_site we move into in_progress so
      // the ticket shows up in the right bucket while paused. From
      // in_progress we stay put. We don't run this through the state
      // machine because there's no single status transition that
      // captures both the status change AND the pause change in one
      // step; we emit the activity rows manually instead.
      const newStatus = current.status === "in_progress" ? "in_progress" : "in_progress";
      const fromStatus = current.status;
      const fromPause  = current.pause_state || "none";
      const nowIso = new Date().toISOString();

      const reason = orderedBy === "vendor"
        ? "Vendor ordering parts"
        : "Customer ordering parts";

      const updates = {
        status:              newStatus,
        pause_state:         "awaiting_parts",
        parts_ordered_by:    orderedBy,
        parts_ordered_notes: body.notes || null,
        parts_ordered_at:    nowIso,
        date_status_updated: nowIso,
        updated_at:          nowIso,
      };
      const { error } = await supabase.from("tickets").update(updates).eq("id", ticketId);
      if (error) throw error;

      // Activity rows: status change (if any) + pause state change.
      const activityRows = [];
      if (fromStatus !== newStatus) {
        activityRows.push({
          ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
          user_role: "vendor",
          update_type: "status_change",
          old_value: fromStatus, new_value: newStatus,
          event_type: "status_changed",
          event_data: {
            // describe() in TicketActivityFeed reads from / to off
            // event_data, not the old_value / new_value columns, so
            // both have to be populated for the row to render as
            // "Status: X → Y" instead of "Status: — → —".
            from: fromStatus,
            to:   newStatus,
            reason_code: "parts_on_order",
            reason_text: reason,
            vendor_self_report: true,
            acted_on_behalf_of_vendor: true,
            vendor_identity: identity,
          },
          visibility: "all",
        });
      }
      activityRows.push({
        ticket_id: ticketId, user_id: null, user_name: identity.vendor_name,
        user_role: "vendor",
        update_type: "pause_state_change",
        old_value: fromPause, new_value: "awaiting_parts",
        // Note "ed" suffix — matches the canonical event_type used
        // by facilities-v2 and consumed by TicketActivityFeed's
        // describe() switch.
        event_type: "pause_state_changed",
        event_data: {
          from: fromPause,
          to:   "awaiting_parts",
          ordered_by: orderedBy,
          reason,
          notes: body.notes || null,
          vendor_self_report: true,
          acted_on_behalf_of_vendor: true,
          vendor_identity: identity,
        },
        visibility: "all",
      });
      await supabase.from("ticket_activities").insert(activityRows);

      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "parts_on_order",
        notes: `${reason}${body.notes ? ` — ${body.notes}` : ""}`,
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

    // ── sendVendorMessage: post a message to the vendor thread ──
    if (action === "sendVendorMessage") {
      const text = String(body.message || "").trim();
      if (!text) {
        return respond(400, { ok: false, error: "message required" });
      }
      if (text.length > 2000) {
        return respond(400, { ok: false, error: "message_too_long" });
      }
      const { error } = await supabase.from("ticket_messages").insert({
        ticket_id:   ticketId,
        user_id:     null,
        // Display the company first if we have one — that's what the
        // store side cares about ("Frostex says X"). Fallback to the
        // tech's name.
        user_name:   identity.vendor_company || identity.vendor_name,
        user_role:   "VENDOR",
        message:     text,
        thread_type: "vendor",
      });
      if (error) throw error;

      // Audit trail on the vendor side. Doesn't double-write the
      // message text to vendor_visits.notes to keep the audit log
      // compact; the ticket_messages row IS the message record.
      await logVisit(supabase, {
        token_id: tok.id, ticket_id: ticketId,
        vendor_name: identity.vendor_name,
        vendor_company: identity.vendor_company,
        vendor_phone: identity.vendor_phone,
        action: "message_sent",
        notes: text.slice(0, 200),
        remote_ip: ip, user_agent: ua,
      });
      return respond(200, { ok: true });
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

    // Manager actions dispatched at the top of the handler (see
    // earlier branch) so GETs aren't blocked by the anonymous-POST
    // guard. This block intentionally left as a fall-through.

    return respond(400, { ok: false, error: "unknown_action", action });
  } catch (err) {
    console.error("[vendor-portal] error", err);
    return respond(500, {
      ok: false,
      message: err?.message || "Internal error.",
    });
  }
};

// Roles allowed to manage QR tokens. SDO+ matches the "admin" tier
// from the central permission utility — district leadership owns
// store-level config in our operational model. Non-admin tiers are
// scoped by their visible-stores list below.
const QR_MANAGER_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

async function getQrManagerProfile(supabase, event) {
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
  if (!QR_MANAGER_ROLES.has(String(profile.role).toLowerCase())) return null;
  return profile;
}

// Returns either { all: true } for top-level roles, or
// { all: false, stores: Set<string> } for scoped roles.
// Uses user_visible_stores() RPC so we honor the same scope
// resolution every other module trusts.
async function visibleStoresForManager(supabase, profile) {
  const role = String(profile.role || "").toLowerCase();
  // Top-of-house roles see everything regardless of scope rows.
  if (role === "admin" || role === "coo" || role === "vp") {
    return { all: true, stores: null };
  }
  const { data: visibleIds } = await supabase.rpc("user_visible_stores", {
    uid: profile.id,
  });
  const ids = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return { all: false, stores: new Set() };
  const { data: stores } = await supabase
    .from("stores")
    .select("number")
    .in("id", ids);
  return {
    all: false,
    stores: new Set((stores || []).map((s) => String(s.number))),
  };
}

// Read-only print panel for any logged-in user. Returns active,
// non-expired tokens for stores visible to the caller via
// user_visible_stores. GMs and DOs use this to print their own
// store's sticker without bothering admin.
async function handleMyStoreTokens(supabase, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) {
    return respond(401, { ok: false, error: "auth_required" });
  }
  const jwt = header.slice("Bearer ".length).trim();
  if (!jwt) return respond(401, { ok: false, error: "auth_required" });
  const { data: userRes } = await supabase.auth.getUser(jwt);
  if (!userRes?.user) return respond(401, { ok: false, error: "invalid_session" });

  // Resolve visible stores. Empty visible-stores → empty token list.
  const { data: visibleIds } = await supabase.rpc("user_visible_stores", {
    uid: userRes.user.id,
  });
  const storeIds = (visibleIds ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!storeIds.length) return respond(200, { ok: true, tokens: [] });

  const { data: stores } = await supabase
    .from("stores")
    .select("number, name, city, state")
    .in("id", storeIds);
  const storeNumbers = (stores || []).map((s) => String(s.number));
  if (!storeNumbers.length) return respond(200, { ok: true, tokens: [] });

  const nowIso = new Date().toISOString();
  const { data: tokens } = await supabase
    .from("store_qr_tokens")
    .select("id, store_number, token, label, expires_at, created_at")
    .in("store_number", storeNumbers)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  // Filter expired tokens client-side (PostgREST .or() syntax is
  // gnarly; the table is small enough to filter in JS).
  const active = (tokens || []).filter(
    (t) => !t.expires_at || t.expires_at > nowIso,
  );

  const storeMap = new Map((stores || []).map((s) => [String(s.number), s]));
  const annotated = active.map((t) => {
    const s = storeMap.get(t.store_number);
    return {
      id:           t.id,
      store_number: t.store_number,
      store_name:   s?.name || null,
      store_city:   s?.city || null,
      store_state:  s?.state || null,
      token:        t.token,
      label:        t.label,
      expires_at:   t.expires_at,
    };
  });
  return respond(200, { ok: true, tokens: annotated });
}

async function handleManager(supabase, event, action) {
  const profile = await getQrManagerProfile(supabase, event);
  if (!profile) {
    return respond(403, { ok: false, error: "manager_role_required" });
  }
  const scope = await visibleStoresForManager(supabase, profile);
  // Helper — ensures the requested store is in this manager's scope.
  const canManageStore = (storeNumber) =>
    scope.all || scope.stores.has(String(storeNumber));

  if (action === "adminList") {
    const storeNumber = (event.queryStringParameters || {}).store;
    let q = supabase
      .from("store_qr_tokens")
      .select("id, store_number, token, label, is_active, expires_at, created_at, revoked_at, created_by_id, revoked_by_id")
      .order("created_at", { ascending: false });
    if (storeNumber) q = q.eq("store_number", storeNumber);
    // Scope filter — non-admin managers only see their stores.
    if (!scope.all) {
      const stores = Array.from(scope.stores);
      if (!stores.length) return respond(200, { ok: true, tokens: [] });
      q = q.in("store_number", stores);
    }
    const { data, error } = await q;
    if (error) throw error;

    // Visit summary per token for the list view.
    const tokenIds = (data || []).map((r) => r.id);
    const visitCounts = {};
    const lastVisits = {};
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
    if (!canManageStore(storeNumber)) {
      return respond(403, {
        ok: false,
        error: "store_outside_scope",
        message: `Store ${storeNumber} is outside your scope.`,
      });
    }
    const label = body.label ? String(body.label).trim() : null;
    const ttlDays = Number(body.ttl_days) || 365;
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();

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

  // ── adminBulkCreate: mint tokens for many stores at once ──
  // Admin-tier only. Two modes:
  //   "all_missing" — mint a token for every active store that
  //                   doesn't already have an active token.
  //   "specific"    — mint tokens for an explicit store_numbers list.
  // Stores already covered by an active token are skipped (returned
  // with status "skipped") so a re-run is safe.
  if (action === "adminBulkCreate" && event.httpMethod === "POST") {
    // SDO+ can mint single tokens; bulk is intentionally tighter —
    // limit to admin so a regional rollout requires top-of-house
    // sign-off, not district leadership doing it ad-hoc.
    if (String(profile.role).toLowerCase() !== "admin") {
      return respond(403, { ok: false, error: "admin_only_for_bulk" });
    }
    const body = JSON.parse(event.body || "{}");
    const mode = body.mode === "specific" ? "specific" : "all_missing";
    const label = body.label ? String(body.label).trim() : null;
    const ttlDays = Number(body.ttl_days) || 365;
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();

    let targetStores = [];
    if (mode === "specific") {
      if (!Array.isArray(body.store_numbers) || body.store_numbers.length === 0) {
        return respond(400, { ok: false, error: "store_numbers required for specific mode" });
      }
      targetStores = Array.from(new Set(
        body.store_numbers
          .map((s) => String(s).trim())
          .filter(Boolean),
      ));
    } else {
      const { data: stores, error } = await supabase
        .from("stores")
        .select("number")
        .eq("is_active", true);
      if (error) throw error;
      targetStores = (stores || []).map((s) => String(s.number));
    }

    // Cap to a sane upper bound so a typo can't accidentally try
    // to mint thousands of tokens in one shot.
    if (targetStores.length > 500) {
      return respond(400, {
        ok: false,
        error: "too_many_stores",
        message: "Bulk create capped at 500 stores per request.",
      });
    }

    // Find which already have an active, non-expired token.
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabase
      .from("store_qr_tokens")
      .select("store_number, expires_at")
      .in("store_number", targetStores)
      .eq("is_active", true);
    const covered = new Set(
      (existing || [])
        .filter((r) => !r.expires_at || r.expires_at > nowIso)
        .map((r) => String(r.store_number)),
    );

    const results = [];
    for (const sn of targetStores) {
      if (covered.has(sn)) {
        results.push({
          store_number: sn,
          status: "skipped",
          message: "active token already exists",
        });
        continue;
      }
      try {
        const { data: tokenStr } = await supabase.rpc("gen_store_qr_token");
        const generatedToken = tokenStr ||
          (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
        const { data: row, error: insErr } = await supabase
          .from("store_qr_tokens")
          .insert({
            store_number: sn,
            token: generatedToken,
            label,
            expires_at: expiresAt,
            created_by_id: profile.id,
          })
          .select("id, token, store_number")
          .single();
        if (insErr) throw insErr;
        results.push({ store_number: sn, status: "created", token: row });
      } catch (e) {
        results.push({
          store_number: sn,
          status: "failed",
          message: e?.message || "insert failed",
        });
      }
    }

    const summary = results.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
      {},
    );
    return respond(200, { ok: true, results, summary });
  }

  if (action === "adminRevoke" && event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const id = body.id;
    if (!id) return respond(400, { ok: false, error: "id required" });
    // Confirm the target token is in this manager's scope.
    const { data: target } = await supabase
      .from("store_qr_tokens")
      .select("store_number")
      .eq("id", id)
      .maybeSingle();
    if (!target) return respond(404, { ok: false, error: "token_not_found" });
    if (!canManageStore(target.store_number)) {
      return respond(403, { ok: false, error: "store_outside_scope" });
    }
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

  // ── adminListVisits: recent activity feed with danger flags ──
  if (action === "adminListVisits") {
    const qs = event.queryStringParameters || {};
    const sinceDays = Math.max(1, Math.min(Number(qs.days) || 7, 90));
    const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
    const limit = Math.max(1, Math.min(Number(qs.limit) || 100, 500));

    // Pull visits in window, scoped via tokens.
    let visitsQuery = supabase
      .from("vendor_visits")
      .select(`
        id, token_id, ticket_id, vendor_name, vendor_company, vendor_phone,
        action, notes, remote_ip, user_agent, created_at,
        store_qr_tokens!inner(store_number, label, is_active, expires_at)
      `)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!scope.all) {
      const stores = Array.from(scope.stores);
      if (!stores.length) return respond(200, { ok: true, visits: [] });
      visitsQuery = visitsQuery.in("store_qr_tokens.store_number", stores);
    }
    const { data: visits, error: vErr } = await visitsQuery;
    if (vErr) throw vErr;

    // Pull broader window for flag computation (need 24h of history
    // even if user asked for a 1-day window).
    const flagWindow = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: recentForFlags } = await supabase
      .from("vendor_visits")
      .select("token_id, ticket_id, action, remote_ip, created_at")
      .gte("created_at", flagWindow);

    const flagged = (visits || []).map((v) => {
      const flags = computeFlags(v, recentForFlags || []);
      return {
        id:              v.id,
        token_id:        v.token_id,
        ticket_id:       v.ticket_id,
        store_number:    v.store_qr_tokens?.store_number || null,
        token_label:     v.store_qr_tokens?.label || null,
        token_active:    v.store_qr_tokens?.is_active ?? null,
        token_expires_at:v.store_qr_tokens?.expires_at || null,
        vendor_name:     v.vendor_name,
        vendor_company:  v.vendor_company,
        vendor_phone:    v.vendor_phone,
        action:          v.action,
        notes:           v.notes,
        remote_ip:       v.remote_ip,
        user_agent:      v.user_agent,
        created_at:      v.created_at,
        flags,
      };
    });

    return respond(200, {
      ok: true,
      visits: flagged,
      flag_summary: summarizeFlags(flagged),
    });
  }

  return respond(400, { ok: false, error: "unknown_manager_action", action });
}

// Per-visit flag computation. Each flag is a tag string. The
// frontend renders them as colored badges. Severity ordering is
// purely for display: info < warning < danger.
function computeFlags(v, recentBucket) {
  const flags = [];
  const tokenVisits = recentBucket.filter((r) => r.token_id === v.token_id);

  // 1. Multi-IP from same token in last 24h.
  const ips = new Set(tokenVisits.map((r) => r.remote_ip).filter(Boolean));
  if (ips.size >= 2) {
    flags.push({ key: "multi_ip", severity: "warning",
      label: `Multiple IPs (${ips.size}) in 24h` });
  }

  // 2. High velocity in last hour.
  const hourAgo = Date.now() - 3600_000;
  const recentHour = tokenVisits.filter((r) => new Date(r.created_at).getTime() >= hourAgo);
  if (recentHour.length >= 5) {
    flags.push({ key: "high_velocity", severity: "warning",
      label: `${recentHour.length} scans in last hour` });
  }

  // 3. Drive-by completion (on_site immediately followed by completed).
  if (v.action === "completed" && v.ticket_id) {
    const sameTicket = tokenVisits
      .filter((r) => r.ticket_id === v.ticket_id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const idx = sameTicket.findIndex((r) => r.created_at === v.created_at);
    if (idx > 0) {
      const prev = sameTicket[idx - 1];
      const gapMs = new Date(v.created_at) - new Date(prev.created_at);
      if (prev.action === "on_site" && gapMs < 5 * 60_000) {
        flags.push({ key: "driveby_complete", severity: "danger",
          label: `On site → completed in ${Math.round(gapMs / 1000)}s` });
      }
    }
    // 4. Completed without any photo for this ticket from any vendor visit.
    const photoEvidence = tokenVisits.some(
      (r) => r.ticket_id === v.ticket_id && r.action === "photo_added");
    if (!photoEvidence) {
      flags.push({ key: "no_photo_evidence", severity: "warning",
        label: "Completed with no vendor photos" });
    }
  }

  // 5. Token already expired (shouldn't happen — backend rejects —
  // but flag any historical visits that snuck in).
  return flags;
}

function summarizeFlags(visits) {
  const counts = {};
  for (const v of visits) {
    for (const f of v.flags || []) {
      counts[f.key] = (counts[f.key] || 0) + 1;
    }
  }
  return counts;
}

// tierFor is imported but currently unused — kept for future symmetry
// when we add caller-role-aware features to the portal.
void tierFor;
