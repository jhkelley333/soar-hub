// netlify/functions/chat.js
//
// Chat backend for the SOAR Field App. Actions (query param `action`):
//   GET  inbox                  → caller's threads + per-tab unread + needsYou
//   GET  thread?threadId=…      → one thread, its members, and messages
//   GET  contacts               → active profiles (compose people picker)
//   POST send     {threadId,text}
//   POST create   {kind,title,subtitle?,scopeKind?,scopeRef?,participantUserIds[],external?,firstMessage?}
//   POST markRead {threadId}
//
// Uses the service key and enforces membership in every query. "needsYou"
// is a simplified server derivation for now (WO/submission threads with
// unread, or unread @mentions) — the full approver-state rules come later.

import { createClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "./_lib/push.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function getCaller(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = getSupabase();
  const { data: userRes } = await supa.auth.getUser(token);
  if (!userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function displayName(p) {
  if (!p) return "Unknown";
  return (p.preferred_name || p.full_name || p.email || "Unknown").trim();
}
function firstNameOf(name) {
  return (name || "").trim().split(/\s+/)[0] || "";
}
function initialsOf(name) {
  return (name || "")
    .replace(/^(SDO|RVP|DO|GM|VP|COO)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay) {
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? "p" : "a";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")}${ap}`;
  }
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { ok: false, message: "Supabase not configured." });

  const caller = await getCaller(event);
  if (!caller) return respond(401, { ok: false, message: "Not authenticated." });

  const supa = getSupabase();
  const uid = caller.id;
  const action = (event.queryStringParameters || {}).action || "";

  try {
    if (action === "contacts") {
      const { data } = await supa
        .from("profiles")
        .select("id, full_name, preferred_name, email, role")
        .eq("is_active", true)
        .neq("id", uid)
        .order("full_name");
      const contacts = (data ?? []).map((p) => ({
        id: p.id,
        name: displayName(p),
        first: firstNameOf(displayName(p)),
        initials: initialsOf(displayName(p)),
        role: p.role ? String(p.role).toUpperCase() : "",
        external: false,
      }));
      return respond(200, { ok: true, contacts });
    }

    if (action === "inbox") {
      const { data: memberships } = await supa
        .from("chat_thread_members")
        .select("thread_id, pinned, muted_until, last_read_at")
        .eq("user_id", uid);
      const ids = (memberships ?? []).map((m) => m.thread_id);
      if (!ids.length) {
        return respond(200, { ok: true, threads: [], needsYouCount: 0 });
      }
      const memById = new Map((memberships ?? []).map((m) => [m.thread_id, m]));

      const [{ data: threads }, { data: members }, { data: msgs }] = await Promise.all([
        supa.from("chat_threads").select("*").in("id", ids),
        supa.from("chat_thread_members").select("thread_id, user_id").in("thread_id", ids),
        supa
          .from("chat_messages")
          .select("thread_id, from_user_id, text, created_at, system")
          .in("thread_id", ids),
      ]);

      const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));
      const { data: profiles } = userIds.length
        ? await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", userIds)
        : { data: [] };
      const profById = new Map((profiles ?? []).map((p) => [p.id, p]));
      const callerFirst = firstNameOf(displayName(caller)).toLowerCase();

      const membersByThread = new Map();
      for (const m of members ?? []) {
        const list = membersByThread.get(m.thread_id) ?? [];
        list.push(m.user_id);
        membersByThread.set(m.thread_id, list);
      }

      const out = (threads ?? []).map((t) => {
        const mine = memById.get(t.id);
        const readAt = mine?.last_read_at ? new Date(mine.last_read_at).getTime() : 0;
        const tMsgs = (msgs ?? []).filter((x) => x.thread_id === t.id);
        let unread = 0;
        let mentioned = 0;
        for (const x of tMsgs) {
          if (x.system || x.from_user_id === uid) continue;
          if (new Date(x.created_at).getTime() > readAt) {
            unread++;
            if (callerFirst && String(x.text || "").toLowerCase().includes("@" + callerFirst)) {
              mentioned++;
            }
          }
        }
        const memberIds = membersByThread.get(t.id) ?? [];
        // Direct thread title = the other participant.
        let title = t.title;
        if (t.kind === "direct") {
          const other = memberIds.find((u) => u !== uid);
          title = displayName(profById.get(other)) || t.title || "Direct";
        }
        const needsYou =
          mentioned > 0 ||
          ((t.kind === "workorder" || t.kind === "submission") && unread > 0);
        return {
          id: t.id,
          kind: t.kind,
          title,
          subtitle:
            t.kind === "group" ? `${memberIds.length} members` : t.subtitle || "",
          scope: t.scope_kind ? { kind: t.scope_kind, refId: t.scope_ref } : undefined,
          participantUserIds: memberIds,
          external: t.external,
          pinned: !!mine?.pinned,
          mutedUntil: mine?.muted_until || undefined,
          needsYou,
          unreadCount: unread,
          mentionedCount: mentioned,
          updatedAt: t.updated_at,
          memberCount: memberIds.length,
          memberInitials: memberIds
            .filter((u) => u !== uid)
            .slice(0, 2)
            .map((u) => initialsOf(displayName(profById.get(u)))),
          lastMessage: {
            fromUserId: t.last_message_from || "system",
            text: t.last_message_text || "",
            at: fmtTime(t.last_message_at),
          },
        };
      });

      out.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      });

      return respond(200, {
        ok: true,
        threads: out,
        needsYouCount: out.filter((t) => t.needsYou).length,
      });
    }

    if (action === "thread") {
      const threadId = (event.queryStringParameters || {}).threadId;
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      const { data: mine } = await supa
        .from("chat_thread_members")
        .select("user_id")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!mine) return respond(403, { ok: false, message: "Not a member of this thread." });

      const [{ data: thread }, { data: members }, { data: messages }] = await Promise.all([
        supa.from("chat_threads").select("*").eq("id", threadId).single(),
        supa.from("chat_thread_members").select("user_id, role").eq("thread_id", threadId),
        supa
          .from("chat_messages")
          .select("id, thread_id, from_user_id, text, system, created_at")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: true }),
      ]);

      const userIds = (members ?? []).map((m) => m.user_id);
      const { data: profiles } = userIds.length
        ? await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", userIds)
        : { data: [] };
      const users = {};
      for (const p of profiles ?? []) {
        const name = displayName(p);
        users[p.id] = { name, first: firstNameOf(name), initials: initialsOf(name) };
      }

      const msgIds = (messages ?? []).map((m) => m.id);
      const { data: atts } = msgIds.length
        ? await supa
            .from("chat_attachments")
            .select("id, message_id, storage_path, file_name, mime_type, size_bytes")
            .in("message_id", msgIds)
        : { data: [] };
      const attByMsg = new Map();
      for (const a of atts ?? []) {
        const arr = attByMsg.get(a.message_id) || [];
        arr.push({
          id: a.id,
          path: a.storage_path,
          name: a.file_name,
          mime: a.mime_type || "",
          size: a.size_bytes || 0,
        });
        attByMsg.set(a.message_id, arr);
      }

      return respond(200, {
        ok: true,
        thread,
        members: members ?? [],
        users,
        messages: (messages ?? []).map((m) => ({
          id: m.id,
          threadId: m.thread_id,
          fromUserId: m.system ? "system" : m.from_user_id,
          text: m.text,
          system: m.system,
          at: fmtTime(m.created_at),
          attachments: attByMsg.get(m.id) || [],
        })),
      });
    }

    if (action === "send" && event.httpMethod === "POST") {
      const { threadId, text, attachments } = JSON.parse(event.body || "{}");
      const atts = Array.isArray(attachments) ? attachments.filter((a) => a?.path && a?.name) : [];
      if (!threadId || (!text?.trim() && atts.length === 0)) {
        return respond(400, { ok: false, message: "threadId and text or an attachment required." });
      }
      const { data: mine } = await supa
        .from("chat_thread_members")
        .select("user_id, role")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!mine) return respond(403, { ok: false, message: "Not a member of this thread." });

      // Broadcasts are announce-only: only the owner (poster) can add messages.
      const { data: thr } = await supa
        .from("chat_threads")
        .select("kind, title")
        .eq("id", threadId)
        .maybeSingle();
      if (thr?.kind === "broadcast" && mine.role !== "owner") {
        return respond(403, { ok: false, message: "This is an announcement — replies are disabled." });
      }
      const { data, error } = await supa
        .from("chat_messages")
        .insert({ thread_id: threadId, from_user_id: uid, text: (text || "").trim() })
        .select()
        .single();
      if (error) throw error;

      if (atts.length) {
        await supa.from("chat_attachments").insert(
          atts.map((a) => ({
            message_id: data.id,
            thread_id: threadId,
            storage_path: String(a.path),
            file_name: String(a.name).slice(0, 300),
            mime_type: a.mime ? String(a.mime).slice(0, 200) : null,
            size_bytes: Number.isFinite(a.size) ? a.size : null,
            uploaded_by: uid,
          })),
        );
        // Keep the inbox preview meaningful for attachment-only messages.
        if (!text?.trim()) {
          const label = atts.length === 1 ? `📎 ${atts[0].name}` : `📎 ${atts.length} files`;
          await supa.from("chat_threads").update({ last_message_text: label }).eq("id", threadId);
        }
      }
      await supa
        .from("chat_thread_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("user_id", uid);

      // Best-effort push to the other members. Never blocks the send.
      try {
        const { data: mems } = await supa
          .from("chat_thread_members")
          .select("user_id")
          .eq("thread_id", threadId);
        const senderName = displayName(caller);
        const notifTitle =
          thr?.kind === "direct" || !thr?.title ? senderName : `${senderName} · ${thr.title}`;
        await sendPushToUsers(
          supa,
          (mems || []).map((m) => m.user_id),
          {
            title: notifTitle,
            body: (text?.trim() || (atts.length === 1 ? `📎 ${atts[0].name}` : `📎 ${atts.length} files`)).slice(0, 180),
            url: `/chat/${threadId}`,
            tag: `thread-${threadId}`,
          },
          { excludeUserId: uid },
        );
      } catch (e) {
        console.warn("[chat] push notify failed", e?.message || e);
      }
      return respond(200, { ok: true, message: data });
    }

    if (action === "create" && event.httpMethod === "POST") {
      const b = JSON.parse(event.body || "{}");
      const kind = b.kind;
      if (!["direct", "group", "submission", "workorder", "broadcast"].includes(kind)) {
        return respond(400, { ok: false, message: "Invalid kind." });
      }
      const participants = Array.isArray(b.participantUserIds)
        ? Array.from(new Set([uid, ...b.participantUserIds.filter(Boolean)]))
        : [uid];

      const { data: thread, error: tErr } = await supa
        .from("chat_threads")
        .insert({
          kind,
          title: b.title || "",
          subtitle: b.subtitle || "",
          scope_kind: b.scopeKind || null,
          scope_ref: b.scopeRef || null,
          external: !!b.external,
          created_by: uid,
        })
        .select()
        .single();
      if (tErr) throw tErr;

      const memberRows = participants.map((u) => ({
        thread_id: thread.id,
        user_id: u,
        role: u === uid ? "owner" : "member",
        last_read_at: u === uid ? new Date().toISOString() : null,
      }));
      await supa.from("chat_thread_members").insert(memberRows);

      if (b.firstMessage?.trim()) {
        await supa
          .from("chat_messages")
          .insert({ thread_id: thread.id, from_user_id: uid, text: b.firstMessage.trim() });
      }
      return respond(200, { ok: true, threadId: thread.id });
    }

    // Post a news / announcement broadcast. Audience is resolved server-side:
    //   "subtree"  → everyone the poster manages (manageable_users)
    //   "company"  → all active profiles (COO / admin only)
    // The poster is the owner; recipients are members. Broadcasts surface in
    // the News tab and never trip "Needs you" (announce-only).
    if (action === "broadcast" && event.httpMethod === "POST") {
      const b = JSON.parse(event.body || "{}");
      const role = String(caller.role || "").toLowerCase();
      const title = String(b.title || "").trim();
      const text = String(b.text || "").trim();
      const audience = b.audience === "company" ? "company" : "subtree";

      if (!text) return respond(400, { ok: false, message: "Message body is required." });

      const CAN_POST = ["do", "sdo", "rvp", "vp", "coo", "admin"];
      const CAN_POST_COMPANY = ["coo", "admin"];
      if (!CAN_POST.includes(role)) {
        return respond(403, { ok: false, message: "You don't have permission to post news." });
      }
      if (audience === "company" && !CAN_POST_COMPANY.includes(role)) {
        return respond(403, { ok: false, message: "Only COO / admin can post company-wide." });
      }

      let recipientIds = [];
      if (audience === "company") {
        const { data: all } = await supa
          .from("profiles")
          .select("id")
          .eq("is_active", true);
        recipientIds = (all ?? []).map((p) => p.id);
      } else {
        const { data: managed } = await supa.rpc("manageable_users", { manager_id: uid });
        recipientIds = (managed ?? []).map((p) => p.id);
      }

      const participants = Array.from(new Set([uid, ...recipientIds.filter(Boolean)]));
      if (participants.length <= 1) {
        return respond(400, { ok: false, message: "No recipients in your downline to broadcast to." });
      }

      const { data: thread, error: tErr } = await supa
        .from("chat_threads")
        .insert({
          kind: "broadcast",
          title: title || "Announcement",
          subtitle: audience === "company" ? "Company-wide" : `${participants.length - 1} recipients`,
          created_by: uid,
        })
        .select()
        .single();
      if (tErr) throw tErr;

      await supa.from("chat_thread_members").insert(
        participants.map((u) => ({
          thread_id: thread.id,
          user_id: u,
          role: u === uid ? "owner" : "member",
          last_read_at: u === uid ? new Date().toISOString() : null,
        })),
      );

      await supa
        .from("chat_messages")
        .insert({ thread_id: thread.id, from_user_id: uid, text });

      // Best-effort push to recipients of the announcement.
      try {
        await sendPushToUsers(
          supa,
          uniqueParticipants,
          {
            title: title ? `📣 ${title}` : "📣 New announcement",
            body: text.slice(0, 180),
            url: `/chat/${thread.id}`,
            tag: `thread-${thread.id}`,
          },
          { excludeUserId: uid },
        );
      } catch (e) {
        console.warn("[chat] broadcast push failed", e?.message || e);
      }

      return respond(200, { ok: true, threadId: thread.id });
    }

    // List the managed ("team") groups the caller is allowed to create —
    // derived from the seats they hold in user_scopes. Each option carries
    // the scope node, target tier, a label, and a live headcount.
    if (action === "managedOptions" && event.httpMethod === "GET") {
      const role = String(caller.role || "").toLowerCase();
      const CAN_CREATE = ["do", "sdo", "rvp", "vp", "coo", "admin"];
      if (!CAN_CREATE.includes(role)) return respond(200, { ok: true, options: [] });

      const ROLE_PLURAL = { gm: "GMs", do: "DOs", sdo: "SDOs", rvp: "RVPs", shift_manager: "Shift Managers" };
      const PLAN = {
        do: { from: "district", targets: ["gm"] },
        sdo: { from: "area", targets: ["gm", "do"] },
        rvp: { from: "region", targets: ["gm", "do", "sdo"] },
      };
      const ORG_WIDE = ["vp", "coo", "admin"];

      const nodeName = async (type, id) => {
        const table = type === "district" ? "districts" : type === "area" ? "areas" : type === "region" ? "regions" : null;
        if (!table || !id) return type;
        const { data } = await supa.from(table).select("name").eq("id", id).maybeSingle();
        return data?.name || type;
      };
      const countRoster = async (scopeType, scopeId, targetRole) => {
        const { data } = await supa.rpc("chat_org_roster", {
          p_scope_type: scopeType,
          p_scope_id: scopeId,
          p_role: targetRole,
        });
        return (data || []).length;
      };

      const options = [];

      if (ORG_WIDE.includes(role)) {
        for (const tr of ["gm", "do", "sdo", "rvp"]) {
          const count = await countRoster("global", null, tr);
          if (count > 0) {
            options.push({ scopeType: "global", scopeId: null, targetRole: tr, label: `All ${ROLE_PLURAL[tr]} (company-wide)`, count });
          }
        }
      }

      const plan = PLAN[role];
      if (plan) {
        const { data: scopeRows } = await supa
          .from("user_scopes")
          .select("scope_type, scope_id")
          .eq("user_id", uid);
        for (const s of scopeRows || []) {
          if (s.scope_type !== plan.from) continue;
          const name = await nodeName(s.scope_type, s.scope_id);
          for (const tr of plan.targets) {
            const count = await countRoster(s.scope_type, s.scope_id, tr);
            options.push({ scopeType: s.scope_type, scopeId: s.scope_id, targetRole: tr, label: `${name} · ${ROLE_PLURAL[tr]}`, count });
          }
        }
      }

      return respond(200, { ok: true, options });
    }

    // Create (or return) a seat-owned managed group for an org node + target
    // role — e.g. (district, 14B, gm) = "all GMs in District 14B". The roster
    // is derived from the org tree and reconciled; the owner is whoever holds
    // the seat. Caller must hold that seat in user_scopes (or be coo/admin).
    if (action === "createManaged" && event.httpMethod === "POST") {
      const b = JSON.parse(event.body || "{}");
      const scopeType = b.scopeType;
      const scopeId = b.scopeId || null;
      const targetRole = b.targetRole;
      const VALID_SCOPES = ["store", "district", "area", "region", "global"];
      const VALID_ROLES = ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"];

      if (!VALID_SCOPES.includes(scopeType)) {
        return respond(400, { ok: false, message: "Invalid scopeType." });
      }
      if (scopeType !== "global" && !scopeId) {
        return respond(400, { ok: false, message: "scopeId is required for non-global scopes." });
      }
      if (!VALID_ROLES.includes(targetRole)) {
        return respond(400, { ok: false, message: "Invalid targetRole." });
      }

      // Authorize: org-wide roles can create anything; everyone else must
      // actually hold the seat for this scope node.
      const callerRole = String(caller.role || "").toLowerCase();
      let authorized = ["coo", "admin"].includes(callerRole);
      if (!authorized && scopeType !== "global") {
        const { data: held } = await supa
          .from("user_scopes")
          .select("id")
          .eq("user_id", uid)
          .eq("scope_type", scopeType)
          .eq("scope_id", scopeId)
          .maybeSingle();
        authorized = Boolean(held);
      }
      if (!authorized) {
        return respond(403, { ok: false, message: "You don't manage this scope." });
      }

      // Dedup — one managed group per (scope node, target role).
      let dupQ = supa
        .from("chat_threads")
        .select("id")
        .eq("managed", true)
        .eq("org_scope_type", scopeType)
        .eq("target_role", targetRole);
      dupQ = scopeId ? dupQ.eq("org_scope_id", scopeId) : dupQ.is("org_scope_id", null);
      const { data: existing } = await dupQ.maybeSingle();
      if (existing) {
        await supa.rpc("chat_reconcile_managed_group", { p_thread: existing.id, p_actor: uid });
        return respond(200, { ok: true, threadId: existing.id, existed: true });
      }

      const { data: thread, error: tErr } = await supa
        .from("chat_threads")
        .insert({
          kind: "group",
          managed: true,
          title: (b.title || "").trim() || `${targetRole.toUpperCase()} team`,
          description: (b.description || "").trim() || null,
          org_scope_type: scopeType,
          org_scope_id: scopeId,
          target_role: targetRole,
          created_by: uid,
        })
        .select()
        .single();
      if (tErr) throw tErr;

      await supa.rpc("chat_reconcile_managed_group", { p_thread: thread.id, p_actor: uid });
      return respond(200, { ok: true, threadId: thread.id });
    }

    // Find-or-create the chat thread tied to a work order or PAF. Clicking
    // "Discuss" from a WO/PAF lands the caller in the same thread every time;
    // the first click seeds members (requester/submitter/SDO approver + the
    // opener) and a system context line.
    if (action === "scoped" && event.httpMethod === "POST") {
      const { scopeKind, scopeRef } = JSON.parse(event.body || "{}");
      if (!["workorder", "submission"].includes(scopeKind) || !scopeRef) {
        return respond(400, { ok: false, message: "scopeKind (workorder|submission) and scopeRef required." });
      }

      const { data: existing } = await supa
        .from("chat_threads")
        .select("id")
        .eq("scope_kind", scopeKind)
        .eq("scope_ref", scopeRef)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { data: mem } = await supa
          .from("chat_thread_members")
          .select("user_id")
          .eq("thread_id", existing.id)
          .eq("user_id", uid)
          .maybeSingle();
        if (!mem) {
          await supa.from("chat_thread_members").insert({
            thread_id: existing.id,
            user_id: uid,
            role: "member",
            last_read_at: new Date().toISOString(),
          });
        }
        return respond(200, { ok: true, threadId: existing.id });
      }

      let kind = scopeKind;
      let title = "";
      let subtitle = "";
      let systemText = "";
      const participants = [uid];

      if (scopeKind === "workorder") {
        const { data: wo } = await supa
          .from("tickets")
          .select("wo_number, store_number, store_name, submitted_by_user_id")
          .eq("id", scopeRef)
          .maybeSingle();
        if (!wo) return respond(404, { ok: false, message: "Work order not found." });
        const store = wo.store_name || (wo.store_number ? `Store ${wo.store_number}` : "");
        title = `WO ${wo.wo_number || ""}`.trim();
        subtitle = store;
        systemText = `Discussion started for work order ${wo.wo_number || ""}${store ? ` · ${store}` : ""}.`;
        if (wo.submitted_by_user_id) participants.push(wo.submitted_by_user_id);
      } else {
        const { data: paf } = await supa
          .from("paf_submissions")
          .select("employee_name, submitter_id, sdo_approver_id, status")
          .eq("id", scopeRef)
          .maybeSingle();
        if (!paf) return respond(404, { ok: false, message: "PAF not found." });
        title = `PAF · ${paf.employee_name || "Submission"}`;
        subtitle = paf.status || "";
        systemText = `Discussion started for ${paf.employee_name || "this"} PAF.`;
        if (paf.submitter_id) participants.push(paf.submitter_id);
        if (paf.sdo_approver_id) participants.push(paf.sdo_approver_id);
      }

      const uniqueParticipants = Array.from(new Set(participants.filter(Boolean)));

      const { data: thread, error: tErr } = await supa
        .from("chat_threads")
        .insert({
          kind,
          title,
          subtitle,
          scope_kind: scopeKind,
          scope_ref: scopeRef,
          created_by: uid,
        })
        .select()
        .single();
      if (tErr) throw tErr;

      await supa.from("chat_thread_members").insert(
        uniqueParticipants.map((u) => ({
          thread_id: thread.id,
          user_id: u,
          role: u === uid ? "owner" : "member",
          last_read_at: u === uid ? new Date().toISOString() : null,
        })),
      );

      await supa
        .from("chat_messages")
        .insert({ thread_id: thread.id, from_user_id: null, text: systemText, system: true });

      return respond(200, { ok: true, threadId: thread.id });
    }

    // Group Info payload: thread meta + members enriched with org role +
    // store number + thread role. Caller must be a member.
    if (action === "groupInfo" && event.httpMethod === "GET") {
      const threadId = (event.queryStringParameters || {}).threadId;
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });

      const { data: meRow } = await supa
        .from("chat_thread_members")
        .select("role, muted_until")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!meRow) return respond(403, { ok: false, message: "Not a member of this thread." });

      const { data: t } = await supa
        .from("chat_threads")
        .select("id, kind, title, description, external, managed, created_by, avatar_url")
        .eq("id", threadId)
        .maybeSingle();
      if (!t) return respond(404, { ok: false, message: "Thread not found." });

      const { data: memRows } = await supa
        .from("chat_thread_members")
        .select("user_id, role, joined_at")
        .eq("thread_id", threadId);

      const ids = (memRows || []).map((m) => m.user_id);
      if (t.created_by) ids.push(t.created_by);
      const { data: profs } = ids.length
        ? await supa
            .from("profiles")
            .select(
              "id, full_name, preferred_name, email, role, primary_store_id, phone, is_active, birthday, show_birthday, profile_photo_url",
            )
            .in("id", Array.from(new Set(ids)))
        : { data: [] };
      const profById = new Map((profs || []).map((p) => [p.id, p]));

      const storeIds = Array.from(
        new Set((profs || []).map((p) => p.primary_store_id).filter(Boolean)),
      );
      const { data: stores } = storeIds.length
        ? await supa.from("stores").select("id, number").in("id", storeIds)
        : { data: [] };
      const storeNumById = new Map((stores || []).map((s) => [s.id, s.number]));

      const members = (memRows || [])
        .map((m) => {
          const p = profById.get(m.user_id);
          return {
            userId: m.user_id,
            name: displayName(p),
            initials: initialsOf(displayName(p)),
            threadRole: m.role,
            orgRole: p?.role || "",
            storeNumber: p?.primary_store_id ? storeNumById.get(p.primary_store_id) || null : null,
            joinedAt: m.joined_at,
            phone: p?.phone || null,
            // Full profile object so the client can open the shared
            // MemberProfileDrawer (Stores / history / PAFs) without a refetch.
            profile: p
              ? {
                  id: p.id,
                  email: p.email,
                  phone: p.phone ?? null,
                  full_name: p.full_name ?? null,
                  preferred_name: p.preferred_name ?? null,
                  role: p.role,
                  primary_store_id: p.primary_store_id ?? null,
                  is_active: p.is_active ?? true,
                  birthday: p.birthday ?? null,
                  show_birthday: p.show_birthday ?? false,
                  profile_photo_url: p.profile_photo_url ?? null,
                }
              : null,
          };
        })
        .sort((a, b) => {
          const rank = { owner: 0, admin: 1, member: 2 };
          if (rank[a.threadRole] !== rank[b.threadRole]) return rank[a.threadRole] - rank[b.threadRole];
          return a.name.localeCompare(b.name);
        });

      return respond(200, {
        ok: true,
        thread: {
          id: t.id,
          kind: t.kind,
          title: t.title,
          description: t.description || "",
          external: t.external,
          managed: t.managed,
          createdByName: t.created_by ? displayName(profById.get(t.created_by)) : null,
          avatarUrl: t.avatar_url || null,
          myRole: meRow.role,
          muted: meRow.muted_until ? new Date(meRow.muted_until).getTime() > Date.now() : false,
        },
        members,
        adminsCount: members.filter((m) => m.threadRole === "owner" || m.threadRole === "admin").length,
      });
    }

    // Mute / unmute the thread for the caller.
    if (action === "setMute" && event.httpMethod === "POST") {
      const { threadId, muted } = JSON.parse(event.body || "{}");
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      await supa
        .from("chat_thread_members")
        .update({ muted_until: muted ? "2999-01-01T00:00:00Z" : null })
        .eq("thread_id", threadId)
        .eq("user_id", uid);
      return respond(200, { ok: true });
    }

    // Add members to a normal group (owner & admins). Blocked on managed
    // groups — the roster is rule-driven and would drop manual adds.
    if (action === "addMembers" && event.httpMethod === "POST") {
      const { threadId, userIds } = JSON.parse(event.body || "{}");
      const ids = Array.isArray(userIds) ? Array.from(new Set(userIds.filter(Boolean))) : [];
      if (!threadId || ids.length === 0) {
        return respond(400, { ok: false, message: "threadId and userIds required." });
      }
      const { data: t } = await supa
        .from("chat_threads")
        .select("managed")
        .eq("id", threadId)
        .maybeSingle();
      if (t?.managed) {
        return respond(400, { ok: false, message: "Managed-team membership is automatic — change it in My Team." });
      }
      const { data: me } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!me || !["owner", "admin"].includes(me.role)) {
        return respond(403, { ok: false, message: "Only owners and admins can add members." });
      }

      await supa.from("chat_thread_members").upsert(
        ids.map((u) => ({ thread_id: threadId, user_id: u, role: "member", last_read_at: null })),
        { onConflict: "thread_id,user_id", ignoreDuplicates: true },
      );

      await supa.from("chat_messages").insert({
        thread_id: threadId,
        from_user_id: null,
        text: `${displayName(caller)} added ${ids.length} member${ids.length === 1 ? "" : "s"}.`,
        system: true,
      });

      return respond(200, { ok: true, added: ids.length });
    }

    // Edit group identity — name / description / photo. Owner & admins only.
    if (action === "updateGroup" && event.httpMethod === "POST") {
      const { threadId, title, description, avatarUrl } = JSON.parse(event.body || "{}");
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      const { data: me } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!me || !["owner", "admin"].includes(me.role)) {
        return respond(403, { ok: false, message: "Only owners and admins can edit group info." });
      }
      const patch = {};
      if (typeof title === "string" && title.trim()) patch.title = title.trim().slice(0, 200);
      if (typeof description === "string") patch.description = description.trim().slice(0, 1000) || null;
      if (typeof avatarUrl === "string") patch.avatar_url = avatarUrl || null;
      if (Object.keys(patch).length) {
        await supa.from("chat_threads").update(patch).eq("id", threadId);
      }
      return respond(200, { ok: true });
    }

    // Leave a thread (caller removes self). Blocked on managed groups — the
    // roster would just re-add them; they should mute instead.
    if (action === "leave" && event.httpMethod === "POST") {
      const { threadId } = JSON.parse(event.body || "{}");
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      const { data: t } = await supa
        .from("chat_threads")
        .select("managed")
        .eq("id", threadId)
        .maybeSingle();
      if (t?.managed) {
        return respond(400, { ok: false, message: "This is a managed team — mute it instead of leaving." });
      }
      await supa.from("chat_thread_members").delete().eq("thread_id", threadId).eq("user_id", uid);
      return respond(200, { ok: true });
    }

    // Promote / demote a member (owner & admins only; can't touch the owner).
    if (action === "setMemberRole" && event.httpMethod === "POST") {
      const { threadId, userId, role } = JSON.parse(event.body || "{}");
      if (!threadId || !userId || !["admin", "member"].includes(role)) {
        return respond(400, { ok: false, message: "threadId, userId, role(admin|member) required." });
      }
      const { data: me } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!me || !["owner", "admin"].includes(me.role)) {
        return respond(403, { ok: false, message: "Only owners and admins can change roles." });
      }
      const { data: target } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!target) return respond(404, { ok: false, message: "Member not found." });
      if (target.role === "owner") {
        return respond(400, { ok: false, message: "The owner's role can't be changed." });
      }
      await supa
        .from("chat_thread_members")
        .update({ role })
        .eq("thread_id", threadId)
        .eq("user_id", userId);
      return respond(200, { ok: true });
    }

    // Remove a member (owner & admins only). Blocked on managed groups —
    // the roster would re-add them; deactivate/transfer in My Team instead.
    if (action === "removeMember" && event.httpMethod === "POST") {
      const { threadId, userId } = JSON.parse(event.body || "{}");
      if (!threadId || !userId) return respond(400, { ok: false, message: "threadId and userId required." });
      const { data: t } = await supa
        .from("chat_threads")
        .select("managed")
        .eq("id", threadId)
        .maybeSingle();
      if (t?.managed) {
        return respond(400, { ok: false, message: "Managed-team membership is automatic — change it in My Team." });
      }
      const { data: me } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!me || !["owner", "admin"].includes(me.role)) {
        return respond(403, { ok: false, message: "Only owners and admins can remove members." });
      }
      const { data: target } = await supa
        .from("chat_thread_members")
        .select("role")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();
      if (target?.role === "owner") {
        return respond(400, { ok: false, message: "The owner can't be removed." });
      }
      await supa.from("chat_thread_members").delete().eq("thread_id", threadId).eq("user_id", userId);
      return respond(200, { ok: true });
    }

    // All attachments in a thread, newest first (the Files list). Members only.
    if (action === "attachments" && event.httpMethod === "GET") {
      const threadId = (event.queryStringParameters || {}).threadId;
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      const { data: meRow } = await supa
        .from("chat_thread_members")
        .select("user_id")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!meRow) return respond(403, { ok: false, message: "Not a member of this thread." });

      const { data: rows } = await supa
        .from("chat_attachments")
        .select("id, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false });

      return respond(200, {
        ok: true,
        attachments: (rows || []).map((a) => ({
          id: a.id,
          path: a.storage_path,
          name: a.file_name,
          mime: a.mime_type || "",
          size: a.size_bytes || 0,
          uploadedBy: a.uploaded_by,
          at: fmtTime(a.created_at),
        })),
      });
    }

    if (action === "markRead" && event.httpMethod === "POST") {
      const { threadId } = JSON.parse(event.body || "{}");
      if (!threadId) return respond(400, { ok: false, message: "threadId required." });
      await supa
        .from("chat_thread_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("user_id", uid);
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (e) {
    console.error("[chat]", action, e?.message || e);
    return respond(500, { ok: false, message: e?.message || "Server error" });
  }
};
