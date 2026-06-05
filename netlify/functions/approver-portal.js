// netlify/functions/approver-portal.js
//
// Approver Portal — token-in-URL Work Order approvals for COO / VP / RVP /
// SDO / DO, no login. The URL is the credential (same pattern as the vendor
// QR portal). Token-auth actions need no JWT; admin mint/list/revoke actions
// require a Bearer JWT from an RVP+ minter.
//
// Portal actions (token):
//   GET  ?action=resolve&token=…       -> approver identity + label
//   GET  ?action=listPending&token=…   -> pending approvals in their tier + scope
//   POST ?action=decide                -> { token, approvalId, ticketId, decision,
//                                           notes?, quoteId?, verbal? } (authority-gated)
// Admin actions (Bearer JWT, RVP+):
//   GET  ?action=adminApprovers        -> candidate approvers to mint for
//   GET  ?action=adminList             -> existing approver tokens
//   POST ?action=adminCreate           -> { approver_id, label?, ttl_days? }
//   POST ?action=adminRevoke           -> { id }

import { createClient } from "@supabase/supabase-js";
import { notifyTicketEvent } from "./_lib/ticketEmail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const MINT_ROLES = new Set(["rvp", "vp", "coo", "admin"]);
const APPROVER_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("approver-portal env not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

// ── role ladder (mirror facilities-v2 roleLevel / approvalTiersForRole) ──
function roleLevel(role) {
  const order = { admin: 0, coo: 1, vp: 2, rvp: 3, sdo: 4, do: 5, gm: 6, shift_manager: 7 };
  return order[String(role || "").toLowerCase()] ?? 99;
}
function approvalTiersForRole(role) {
  const DO = "DO < $500", SDO = "SDO $501-$1000", RVP = "RVP $1001-$1750";
  switch (String(role || "").toLowerCase()) {
    case "do":  return [DO];
    case "sdo": return [SDO, DO];
    case "rvp":
    case "vp":
    case "coo":
    case "admin": return [RVP, SDO, DO];
    default: return [];
  }
}

// Visible store numbers for a profile — copied from facilities-v2 getStoresForUser.
async function getStoresForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (["admin", "coo", "vp"].includes(role)) return { all: true, stores: [] };
  const { data: scopes } = await supa
    .from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, stores: [] };
  const directStoreIds = scopes.filter((s) => s.scope_type === "store").map((s) => s.scope_id);
  const districtIds = scopes.filter((s) => s.scope_type === "district").map((s) => s.scope_id);
  const areaIds = scopes.filter((s) => s.scope_type === "area").map((s) => s.scope_id);
  const regionIds = scopes.filter((s) => s.scope_type === "region").map((s) => s.scope_id);
  if (regionIds.length) {
    const { data } = await supa.from("areas").select("id").in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supa.from("districts").select("id").in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supa.from("stores").select("id").in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, stores: [] };
  const { data: storeRows } = await supa.from("stores").select("number").in("id", Array.from(storeIds));
  return { all: false, stores: (storeRows || []).map((s) => String(s.number)) };
}

// Resolve a token to its row + the bound approver profile. Validates active,
// not revoked, not expired.
async function resolveApproverToken(supa, token) {
  if (!token || typeof token !== "string") return null;
  const { data } = await supa
    .from("approver_tokens")
    .select("id, approver_id, label, is_active, expires_at, revoked_at, " +
      "approver:profiles!approver_id(id, full_name, preferred_name, email, role, is_active)")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.is_active || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  if (!data.approver || data.approver.is_active === false) return null;
  return data;
}

function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Approver";
}

// Bearer-JWT profile for admin actions.
async function getSessionProfile(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: u } = await supa.auth.getUser(token);
  if (!u?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, full_name, preferred_name, email, role, is_active")
    .eq("id", u.user.id).single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// ── portal: list pending approvals in the approver's tier + scope ──
async function listPending(supa, tokenRow) {
  const approver = tokenRow.approver;
  const tiers = approvalTiersForRole(approver.role);
  if (!tiers.length) return { approver: { name: displayName(approver), role: approver.role }, pending: [] };

  const access = await getStoresForUser(supa, approver);
  let storeFilter = null;
  if (!access.all) {
    storeFilter = access.stores;
    if (!storeFilter.length) return { approver: { name: displayName(approver), role: approver.role }, pending: [] };
  }

  let q = supa
    .from("ticket_approvals")
    .select(`
      id, ticket_id, approval_tier, requested_by, notes, created_at,
      tickets!inner(id, wo_number, store_number, store_name, asset_type, category,
                    work_requested, priority, status, cost_estimate)
    `)
    .eq("status", "Pending")
    .in("approval_tier", tiers)
    .order("created_at", { ascending: false });
  if (storeFilter) q = q.in("tickets.store_number", storeFilter);
  const { data, error } = await q;
  if (error) return { error: error.message, status: 500 };

  // Recommended quote per ticket (drives the displayed amount + decide quoteId).
  const ticketIds = (data || []).map((r) => r.ticket_id);
  const recByTicket = {};
  if (ticketIds.length) {
    const { data: quotes } = await supa
      .from("ticket_quotes")
      .select("id, ticket_id, vendor_name, amount_cents, is_recommended")
      .in("ticket_id", ticketIds);
    for (const qz of quotes || []) {
      if (qz.is_recommended || !recByTicket[qz.ticket_id]) recByTicket[qz.ticket_id] = qz;
    }
  }

  const pending = (data || []).map((r) => {
    const t = r.tickets;
    const rec = recByTicket[r.ticket_id] || null;
    const amountCents = rec ? rec.amount_cents : Math.round((Number(t?.cost_estimate) || 0) * 100);
    return {
      approvalId: r.id,
      ticketId: r.ticket_id,
      woNumber: t?.wo_number || null,
      storeNumber: t?.store_number || null,
      storeName: t?.store_name || null,
      title: t?.asset_type || t?.category || "Work order",
      workRequested: t?.work_requested || null,
      priority: t?.priority || null,
      tier: r.approval_tier,
      requestedBy: r.requested_by || null,
      requestNotes: r.notes || null,
      amountCents,
      quoteId: rec?.id || null,
      vendorName: rec?.vendor_name || null,
      createdAt: r.created_at,
    };
  });
  return { approver: { name: displayName(approver), role: approver.role }, pending };
}

// ── portal: decide an approval (authority-gated; mirrors decideApproval) ──
async function decide(supa, tokenRow, body, event) {
  const approver = tokenRow.approver;
  const role = String(approver.role || "").toLowerCase();
  if (roleLevel(role) > 5) return { error: "not an approver", status: 403 };

  const { approvalId, ticketId: id, decision, notes, quoteId, verbal } = body || {};
  if (!approvalId || !id || !["Approved", "Rejected"].includes(decision)) {
    return { error: "approvalId, ticketId and a valid decision are required", status: 400 };
  }
  const approverName = displayName(approver);

  let approvalNote = notes || "";
  if (decision === "Approved") {
    let amountCents = 0;
    if (quoteId) {
      const { data: qz } = await supa.from("ticket_quotes").select("amount_cents").eq("id", quoteId).maybeSingle();
      amountCents = qz?.amount_cents || 0;
    } else {
      const { data: tk } = await supa.from("tickets").select("cost_estimate").eq("id", id).maybeSingle();
      amountCents = Math.round((Number(tk?.cost_estimate) || 0) * 100);
    }
    const { data: thr } = await supa.from("wo_approval_thresholds").select("*").order("sort_order", { ascending: true });
    const active = (thr || []).filter((t) => t.is_active);
    const isAdmin = role === "admin";
    const callerRow = (thr || []).find((t) => t.role === role);
    if (active.length && amountCents > 0 && !isAdmin) {
      const topActive = active.reduce((a, b) => (b.nte_cents > a.nte_cents ? b : a));
      const fmt = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      if (amountCents > topActive.nte_cents) {
        if (!verbal || !callerRow || callerRow.sort_order < topActive.sort_order) {
          return { error: "verbal_required", status: 422,
            message: `${fmt(amountCents)} is above the top approval tier (${topActive.label}). Needs a verbal / Owner approval recorded by ${topActive.label} or above.` };
        }
        approvalNote = `${approvalNote ? approvalNote + " " : ""}— verbal approval recorded by ${approverName} (approver link)`;
      } else {
        const required = active.find((t) => t.nte_cents >= amountCents);
        if (!callerRow || !required || callerRow.sort_order < required.sort_order) {
          return { error: "exceeds_authority", status: 422,
            message: `${fmt(amountCents)} is above your approval limit. Needs ${required ? required.label : "a higher approver"}.` };
        }
      }
    }
  }

  await supa.from("ticket_approvals").update({
    status: decision, approved_by: approverName, approved_at: new Date().toISOString(), notes: approvalNote,
  }).eq("id", approvalId);

  const ticketUpdates = {
    approval_status: decision, approval_approved_by: approverName, approval_approved_at: new Date().toISOString(),
    awaiting_info: false, awaiting_info_at: null, updated_at: new Date().toISOString(),
  };
  if (decision === "Approved" && quoteId) {
    await supa.from("ticket_quotes").update({ is_recommended: false }).eq("ticket_id", id);
    const { data: chosen } = await supa.from("ticket_quotes").update({ is_recommended: true }).eq("id", quoteId).select().single();
    if (chosen) ticketUpdates.cost_estimate = (chosen.amount_cents || 0) / 100;
  }
  await supa.from("tickets").update(ticketUpdates).eq("id", id);

  const ip = event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"] || null;
  const ua = event.headers?.["user-agent"] || null;
  await supa.from("ticket_activities").insert({
    ticket_id: id, user_id: approver.id, user_name: approverName, user_role: approver.role,
    update_type: "approval", new_value: decision, notes: `Approval ${decision} by ${approverName} (approver link)`,
    event_type: "approval_decided",
    event_data: { decision, decided_by: approverName, via: "approver_portal", token_id: tokenRow.id, ip, ua },
    visibility: "all",
  });

  await supa.from("approver_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);

  const { data: refreshed } = await supa.from("tickets").select("*").eq("id", id).single();
  if (refreshed) {
    try { await notifyTicketEvent(supa, refreshed, "approval_decided"); }
    catch (e) { console.warn("[approver-portal] notify failed", e?.message || e); }
  }
  return { ok: true };
}

// ── admin: candidate approvers, list/create/revoke tokens ──
async function adminApprovers(supa) {
  const { data } = await supa
    .from("profiles")
    .select("id, full_name, preferred_name, email, role")
    .in("role", APPROVER_ROLES)
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  return { approvers: (data || []).map((p) => ({ id: p.id, name: displayName(p), role: p.role, email: p.email })) };
}

async function adminListTokens(supa) {
  const { data } = await supa
    .from("approver_tokens")
    .select("id, token, label, is_active, expires_at, last_used_at, created_at, revoked_at, " +
      "approver:profiles!approver_id(full_name, preferred_name, email, role)")
    .order("created_at", { ascending: false });
  return {
    tokens: (data || []).map((r) => ({
      id: r.id, token: r.token, label: r.label,
      isActive: r.is_active && !r.revoked_at,
      expiresAt: r.expires_at, lastUsedAt: r.last_used_at, createdAt: r.created_at,
      approverName: displayName(r.approver), approverRole: r.approver?.role || null,
    })),
  };
}

async function adminCreate(supa, minter, body) {
  const approverId = body?.approver_id;
  if (!approverId) return { error: "approver_id required", status: 400 };
  const { data: prof } = await supa
    .from("profiles").select("id, email, role, is_active").eq("id", approverId).maybeSingle();
  if (!prof || !prof.is_active) return { error: "approver not found", status: 404 };
  if (!APPROVER_ROLES.includes(String(prof.role).toLowerCase())) {
    return { error: "that user isn't an approver role", status: 422 };
  }
  const label = body.label ? String(body.label).trim() : null;
  const ttlDays = Number(body.ttl_days) || 365;
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();
  const { data: gen } = await supa.rpc("gen_store_qr_token");
  const token = gen || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const { data, error } = await supa
    .from("approver_tokens")
    .insert({
      approver_id: approverId, approver_email: prof.email, token, label,
      expires_at: expiresAt, created_by_id: minter.id,
    })
    .select("id, token")
    .single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, id: data.id, token: data.token };
}

async function adminRevoke(supa, minter, body) {
  if (!body?.id) return { error: "id required", status: 400 };
  const { error } = await supa
    .from("approver_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by_id: minter.id })
    .eq("id", body.id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

function unwrap(result) {
  if (result && result.error) return respond(result.status || 400, result);
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  const params = event.queryStringParameters || {};
  const action = params.action || "resolve";
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }

  try {
    // ── Admin (Bearer JWT) actions ──
    if (action.startsWith("admin")) {
      const minter = await getSessionProfile(event);
      if (!minter) return respond(401, { error: "unauthorized" });
      if (!MINT_ROLES.has(String(minter.role).toLowerCase())) {
        return respond(403, { error: "RVP and above can manage approver links." });
      }
      if (event.httpMethod === "GET") {
        if (action === "adminApprovers") return unwrap(await adminApprovers(supa));
        if (action === "adminList") return unwrap(await adminListTokens(supa));
        return respond(400, { error: `unknown GET admin action: ${action}` });
      }
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "adminCreate") return unwrap(await adminCreate(supa, minter, body));
      if (action === "adminRevoke") return unwrap(await adminRevoke(supa, minter, body));
      return respond(400, { error: `unknown POST admin action: ${action}` });
    }

    // ── Portal (token) actions ──
    const token = action === "decide"
      ? (event.body ? JSON.parse(event.body).token : null)
      : params.token;
    const tokenRow = await resolveApproverToken(supa, token);
    if (!tokenRow) return respond(401, { error: "invalid_or_expired", message: "This approver link is invalid, expired, or revoked." });

    if (event.httpMethod === "GET") {
      if (action === "resolve") {
        return respond(200, { ok: true, approver: { name: displayName(tokenRow.approver), role: tokenRow.approver.role }, label: tokenRow.label || null });
      }
      if (action === "listPending") return unwrap(await listPending(supa, tokenRow));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST" && action === "decide") {
      const body = JSON.parse(event.body || "{}");
      return unwrap(await decide(supa, tokenRow, body, event));
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    console.error("[approver-portal]", e);
    return respond(500, { error: e?.message || "server error" });
  }
};
