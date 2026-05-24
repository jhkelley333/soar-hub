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
        })),
      });
    }

    if (action === "send" && event.httpMethod === "POST") {
      const { threadId, text } = JSON.parse(event.body || "{}");
      if (!threadId || !text?.trim()) return respond(400, { ok: false, message: "threadId and text required." });
      const { data: mine } = await supa
        .from("chat_thread_members")
        .select("user_id")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      if (!mine) return respond(403, { ok: false, message: "Not a member of this thread." });
      const { data, error } = await supa
        .from("chat_messages")
        .insert({ thread_id: threadId, from_user_id: uid, text: text.trim() })
        .select()
        .single();
      if (error) throw error;
      await supa
        .from("chat_thread_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("user_id", uid);
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
