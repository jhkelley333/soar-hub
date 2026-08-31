// hub-tickets — MyHub issue tracker. A shared feedback board for the Hub:
// anyone signed in files an issue/idea, everyone sees the board and can upvote,
// admins triage/resolve. Reporters are notified (email + push) when their ticket
// is resolved or an admin replies; admins are notified of new tickets + replies.
//
//   GET  ?action=list[&status=&kind=&mine=1]   the board (+ my vote/read state)
//   GET  ?action=get&id=                        one ticket + comments (marks read)
//   GET  ?action=my-updates                     count for the nav badge
//   POST ?action=create      { kind, title, description }
//   POST ?action=vote        { id }             toggle my upvote
//   POST ?action=comment     { id, body }
//   POST ?action=set-status  { id, status, resolution_note }   (admin only)
//
// Service-role only; every read/write is mediated here (RLS-locked tables).

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./_lib/ticketEmail.js";
import { sendPushToUsers } from "./_lib/push.js";
import { resolveNextLevelLeader } from "./_lib/eaApprovers.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = (process.env.SITE_URL || "https://mysoarhub.com").replace(/\/$/, "");

const STATUSES = new Set(["open", "planned", "in_progress", "resolved", "declined"]);
const STATUS_LABEL = { open: "Open", planned: "Planned", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };
const PHOTO_BUCKET = "support-ticket-photos";
const PHOTO_TTL = 3600; // 1h signed download URLs

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("hub-tickets env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
const displayName = (p) => p?.preferred_name || p?.full_name || p?.email || "Someone";
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function getSessionUser(event, supa) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}
const isAdmin = (u) => String(u?.role || "").toLowerCase() === "admin";

async function adminRecipients(supa) {
  const { data } = await supa.from("profiles").select("id, email").eq("role", "admin").eq("is_active", true);
  return { ids: (data || []).map((p) => p.id).filter(Boolean), emails: (data || []).map((p) => p.email).filter(Boolean) };
}

// Everyone looped into a ticket's conversation: the submitter, the submitter's
// next-level leader (their DO / SDO / RVP / COO up the org), and — unless
// opted out — the admins who triage the board. Deduped; the caller passes
// excludeUserId so the actor isn't notified of their own action.
async function ticketAudience(supa, ticket, { includeAdmins = true } = {}) {
  let leaders = [];
  if (ticket.created_by) {
    const { data: sub } = await supa
      .from("profiles").select("id, email, full_name, preferred_name, role, primary_store_id")
      .eq("id", ticket.created_by).maybeSingle();
    if (sub) {
      try { leaders = await resolveNextLevelLeader(supa, sub); }
      catch (e) { console.log(`[hub-tickets] leader resolve failed: ${e?.message || e}`); }
    }
  }
  const adm = includeAdmins ? await adminRecipients(supa) : { ids: [], emails: [] };
  const userIds = [...new Set([
    ...(ticket.created_by ? [ticket.created_by] : []),
    ...leaders.map((l) => l.id),
    ...adm.ids,
  ].filter(Boolean))];
  const emails = [...new Set([
    ...(ticket.created_by_email ? [ticket.created_by_email] : []),
    ...leaders.map((l) => l.email),
    ...adm.emails,
  ].filter(Boolean).map((e) => String(e).toLowerCase()))];
  return { userIds, emails, leaders };
}

// Fire-and-forget notify: push to userIds + email to emails. Never throws.
async function notify(supa, { userIds = [], emails = [], title, body, url = `${SITE_URL}/myhub`, excludeUserId = null }) {
  try {
    if (userIds.length) await sendPushToUsers(supa, userIds, { title, body, url, tag: "myhub" }, { excludeUserId });
  } catch (e) { console.log(`[hub-tickets] push failed: ${e?.message || e}`); }
  const to = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  if (to.length) {
    try {
      await sendEmail({
        to,
        subject: title,
        html: `<p>${body}</p><p><a href="${url}">Open MyHub →</a></p>`,
      });
    } catch (e) { console.log(`[hub-tickets] email failed: ${e?.message || e}`); }
  }
}

const touch = (supa, id) => supa.from("hub_tickets").update({ updated_at: new Date().toISOString() }).eq("id", id);

async function signPhoto(supa, path) {
  if (!path) return null;
  try {
    const { data } = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_TTL);
    return data?.signedUrl ?? null;
  } catch { return null; }
}

// Mint a signed PUT URL for one ticket photo, before the ticket exists. Path is
// namespaced to the caller so a user can only write under their own folder.
async function photoUploadUrl(supa, user, body) {
  const ext = /^(jpe?g|png|webp|heic|gif)$/i.test(String(body?.ext || "")) ? String(body.ext).toLowerCase() : "jpg";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `tickets/${user.id}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supa.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error) return { error: error.message, status: 500 };
  return { upload_url: data.signedUrl, token: data.token, path };
}

async function listBoard(supa, user, params) {
  let q = supa.from("hub_tickets").select("*");
  if (params.status && STATUSES.has(params.status)) q = q.eq("status", params.status);
  if (params.kind === "issue" || params.kind === "idea") q = q.eq("kind", params.kind);
  if (params.mine === "1") q = q.eq("created_by", user.id);
  const { data: tickets } = await q;
  const rows = tickets || [];
  const ids = rows.map((t) => t.id);

  // My votes + my read state + comment counts (best-effort, small board).
  const [myVotes, myReads, comments] = await Promise.all([
    ids.length ? supa.from("hub_ticket_votes").select("ticket_id").eq("user_id", user.id).in("ticket_id", ids) : { data: [] },
    ids.length ? supa.from("hub_ticket_reads").select("ticket_id, seen_at").eq("user_id", user.id).in("ticket_id", ids) : { data: [] },
    ids.length ? supa.from("hub_ticket_comments").select("ticket_id").in("ticket_id", ids) : { data: [] },
  ]);
  const voted = new Set((myVotes.data || []).map((v) => v.ticket_id));
  const seenAt = new Map((myReads.data || []).map((r) => [r.ticket_id, r.seen_at]));
  const commentCount = new Map();
  for (const c of comments.data || []) commentCount.set(c.ticket_id, (commentCount.get(c.ticket_id) || 0) + 1);

  const out = rows.map((t) => ({
    ...t,
    my_vote: voted.has(t.id),
    has_photo: !!t.photo_path,
    comment_count: commentCount.get(t.id) || 0,
    // Unseen = a ticket I reported that changed since I last opened it.
    has_update: t.created_by === user.id && (!seenAt.has(t.id) || new Date(t.updated_at) > new Date(seenAt.get(t.id))),
  }));
  // Sort: open work first, then by upvotes, then newest.
  const rank = { open: 0, planned: 1, in_progress: 1, resolved: 3, declined: 4 };
  out.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.upvotes - a.upvotes) || (new Date(b.created_at) - new Date(a.created_at)));
  return out;
}

async function getTicket(supa, user, id) {
  const { data: ticket } = await supa.from("hub_tickets").select("*").eq("id", id).maybeSingle();
  if (!ticket) return { error: "Ticket not found.", status: 404 };
  const [{ data: comments }, { data: myVote }] = await Promise.all([
    supa.from("hub_ticket_comments").select("id, author_name, is_admin, body, photo_path, created_at").eq("ticket_id", id).order("created_at", { ascending: true }),
    supa.from("hub_ticket_votes").select("ticket_id").eq("ticket_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  // Mark read.
  await supa.from("hub_ticket_reads").upsert({ user_id: user.id, ticket_id: id, seen_at: new Date().toISOString() }, { onConflict: "user_id,ticket_id" });
  const photo_url = await signPhoto(supa, ticket.photo_path);
  // Sign each comment's photo (if any) for the thread.
  const commentsOut = await Promise.all((comments || []).map(async (c) => ({
    ...c, photo_url: await signPhoto(supa, c.photo_path), photo_path: undefined,
  })));
  return { ticket: { ...ticket, my_vote: !!myVote, photo_url }, comments: commentsOut };
}

async function createTicket(supa, user, body) {
  const kind = body?.kind === "idea" ? "idea" : "issue";
  const title = clean(body?.title, 160);
  const description = clean(body?.description, 4000);
  const page_path = clean(body?.page_path, 300) || null;
  // Only accept a photo path under this user's own folder (defense in depth).
  const photoRaw = clean(body?.photo_path, 300);
  const photo_path = photoRaw && photoRaw.startsWith(`tickets/${user.id}/`) ? photoRaw : null;
  if (!title) return { error: "A title is required.", status: 400 };
  const { data, error } = await supa.from("hub_tickets").insert({
    kind, title, description, page_path, photo_path,
    created_by: user.id, created_by_name: displayName(user), created_by_email: user.email,
  }).select().single();
  if (error) return { error: error.message, status: 500 };

  // Loop in the admins AND the submitter's next-level leader from the start.
  const aud = await ticketAudience(supa, data);
  const emails = aud.emails.filter((e) => e !== String(user.email || "").toLowerCase());
  await notify(supa, {
    userIds: aud.userIds, emails,
    title: `New support ${kind}: ${title}`,
    body: `${displayName(user)} filed a${kind === "idea" ? "n idea" : "n issue"}: “${title}”.${page_path ? ` (on ${page_path})` : ""}`,
    url: `${SITE_URL}/myhub`, excludeUserId: user.id,
  });
  return { ticket: data };
}

async function toggleVote(supa, user, id) {
  const { data: existing } = await supa.from("hub_ticket_votes").select("ticket_id").eq("ticket_id", id).eq("user_id", user.id).maybeSingle();
  if (existing) await supa.from("hub_ticket_votes").delete().eq("ticket_id", id).eq("user_id", user.id);
  else await supa.from("hub_ticket_votes").insert({ ticket_id: id, user_id: user.id });
  // Recount (authoritative) and store.
  const { count } = await supa.from("hub_ticket_votes").select("user_id", { count: "exact", head: true }).eq("ticket_id", id);
  await supa.from("hub_tickets").update({ upvotes: count ?? 0 }).eq("id", id);
  return { upvotes: count ?? 0, my_vote: !existing };
}

async function addComment(supa, user, body) {
  const id = clean(body?.id, 64);
  const text = clean(body?.body, 4000);
  // Only accept a photo path under this user's own folder (defense in depth).
  const photoRaw = clean(body?.photo_path, 300);
  const photo_path = photoRaw && photoRaw.startsWith(`tickets/${user.id}/`) ? photoRaw : null;
  if (!id || (!text && !photo_path)) return { error: "A comment or photo is required.", status: 400 };
  const { data: ticket } = await supa.from("hub_tickets").select("id, title, created_by, created_by_email").eq("id", id).maybeSingle();
  if (!ticket) return { error: "Ticket not found.", status: 404 };
  const admin_ = isAdmin(user);
  const { data: comment, error } = await supa.from("hub_ticket_comments").insert({
    ticket_id: id, author_id: user.id, author_name: displayName(user), is_admin: admin_, body: text, photo_path,
  }).select("id, author_name, is_admin, body, photo_path, created_at").single();
  if (error) return { error: error.message, status: 500 };
  await touch(supa, id);

  // Message the whole conversation — the submitter, their next-level leader,
  // and the admins — minus whoever just posted.
  const url = `${SITE_URL}/myhub`;
  const aud = await ticketAudience(supa, ticket);
  const emails = aud.emails.filter((e) => e !== String(user.email || "").toLowerCase());
  const preview = text ? `“${text.slice(0, 160)}”` : "shared a photo";
  await notify(supa, {
    userIds: aud.userIds, emails,
    title: `New reply on support ticket: ${ticket.title}`,
    body: `${displayName(user)} commented: ${preview}.`,
    url, excludeUserId: user.id,
  });
  const photo_url = await signPhoto(supa, photo_path);
  return { comment: { ...comment, photo_url, photo_path: undefined } };
}

async function setStatus(supa, user, body) {
  if (!isAdmin(user)) return { error: "Admins only.", status: 403 };
  const id = clean(body?.id, 64);
  const status = clean(body?.status, 20);
  if (!STATUSES.has(status)) return { error: "Invalid status.", status: 400 };
  const note = clean(body?.resolution_note, 2000) || null;
  const { data: ticket } = await supa.from("hub_tickets").select("id, title, status, created_by, created_by_email").eq("id", id).maybeSingle();
  if (!ticket) return { error: "Ticket not found.", status: 404 };

  const patch = { status, updated_at: new Date().toISOString(), resolution_note: note };
  const closing = status === "resolved" || status === "declined";
  if (closing) { patch.resolved_at = new Date().toISOString(); patch.resolved_by = user.id; }
  const { error } = await supa.from("hub_tickets").update(patch).eq("id", id);
  if (error) return { error: error.message, status: 500 };

  // Notify the reporter AND their next-level leader of the status change
  // (esp. resolved/declined). Admins made the change, so skip the admin fan-out.
  if (ticket.created_by && ticket.created_by !== user.id) {
    const verb = status === "resolved" ? "resolved" : status === "declined" ? "closed" : `moved to ${STATUS_LABEL[status]}`;
    const aud = await ticketAudience(supa, ticket, { includeAdmins: false });
    const emails = aud.emails.filter((e) => e !== String(user.email || "").toLowerCase());
    await notify(supa, {
      userIds: aud.userIds, emails,
      title: `Your support ticket was ${verb}: ${ticket.title}`,
      body: `“${ticket.title}” is now ${STATUS_LABEL[status]}.${note ? ` Note: ${note}` : ""}`,
      url: `${SITE_URL}/myhub`, excludeUserId: user.id,
    });
  }
  return { ok: true, status };
}

async function myUpdates(supa, user) {
  // Count of my tickets that changed since I last opened them.
  const { data: mine } = await supa.from("hub_tickets").select("id, updated_at").eq("created_by", user.id);
  const rows = mine || [];
  if (!rows.length) return { count: 0 };
  const { data: reads } = await supa.from("hub_ticket_reads").select("ticket_id, seen_at").eq("user_id", user.id).in("ticket_id", rows.map((t) => t.id));
  const seen = new Map((reads || []).map((r) => [r.ticket_id, r.seen_at]));
  const count = rows.filter((t) => !seen.has(t.id) || new Date(t.updated_at) > new Date(seen.get(t.id))).length;
  return { count };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getSessionUser(event, supa);
  if (!user) return respond(401, { error: "Not signed in." });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.body) { try { body = JSON.parse(event.body); } catch { body = {}; } }

  try {
    if (action === "list") return respond(200, { tickets: await listBoard(supa, user, params) });
    if (action === "get") {
      const r = await getTicket(supa, user, clean(params.id, 64));
      return r.error ? respond(r.status, { error: r.error }) : respond(200, r);
    }
    if (action === "my-updates") return respond(200, await myUpdates(supa, user));
    if (action === "photo-upload-url") {
      const r = await photoUploadUrl(supa, user, body);
      return r.error ? respond(r.status, { error: r.error }) : respond(200, r);
    }
    if (action === "create") {
      const r = await createTicket(supa, user, body);
      return r.error ? respond(r.status, { error: r.error }) : respond(200, r);
    }
    if (action === "vote") return respond(200, await toggleVote(supa, user, clean(body?.id, 64)));
    if (action === "comment") {
      const r = await addComment(supa, user, body);
      return r.error ? respond(r.status, { error: r.error }) : respond(200, r);
    }
    if (action === "set-status") {
      const r = await setStatus(supa, user, body);
      return r.error ? respond(r.status, { error: r.error }) : respond(200, r);
    }
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.log(`[hub-tickets] ${action} failed: ${e?.message || e}`);
    return respond(500, { error: e?.message || "Request failed" });
  }
};
