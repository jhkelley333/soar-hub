// Chat — typed client wrappers around netlify/functions/chat. Each call
// passes the caller's Supabase access token so the function can verify
// the JWT and resolve the profile.

import { supabase } from "@/lib/supabase";
import type { ChatThread, ChatMessage } from "./types";

const FN = "/.netlify/functions/chat";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  let body: { ok?: boolean; message?: string } & Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Chat API ${res.status}`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || `Chat API ${res.status}`);
  }
  return body as T;
}

export interface ChatUserLite {
  name: string;
  first: string;
  initials: string;
}

export interface ChatContact {
  id: string;
  name: string;
  first: string;
  initials: string;
  role: string;
  external: boolean;
}

export interface InboxResponse {
  ok: true;
  threads: ChatThread[];
  needsYouCount: number;
}

export interface ThreadResponse {
  ok: true;
  thread: {
    id: string;
    kind: ChatThread["kind"];
    title: string;
    subtitle: string;
    external: boolean;
    scope_kind: string | null;
    scope_ref: string | null;
  };
  members: { user_id: string; role: string }[];
  users: Record<string, ChatUserLite>;
  messages: ChatMessage[];
}

export function fetchInbox(): Promise<InboxResponse> {
  return req<InboxResponse>(`${FN}?action=inbox`);
}

export function fetchThread(threadId: string): Promise<ThreadResponse> {
  return req<ThreadResponse>(`${FN}?action=thread&threadId=${encodeURIComponent(threadId)}`);
}

export function fetchContacts(): Promise<{ ok: true; contacts: ChatContact[] }> {
  return req<{ ok: true; contacts: ChatContact[] }>(`${FN}?action=contacts`);
}

export function sendChatMessage(threadId: string, text: string): Promise<{ ok: true }> {
  return req(`${FN}?action=send`, {
    method: "POST",
    body: JSON.stringify({ threadId, text }),
  });
}

export interface CreateThreadBody {
  kind: ChatThread["kind"];
  title?: string;
  subtitle?: string;
  scopeKind?: string;
  scopeRef?: string;
  participantUserIds?: string[];
  external?: boolean;
  firstMessage?: string;
}

export function createThread(body: CreateThreadBody): Promise<{ ok: true; threadId: string }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(body) });
}

export type BroadcastAudience = "subtree" | "company";

// Post a news / announcement broadcast. Audience is resolved server-side
// from the caller's org subtree (or company-wide for COO / admin).
export function postBroadcast(body: {
  title?: string;
  text: string;
  audience: BroadcastAudience;
}): Promise<{ ok: true; threadId: string }> {
  return req(`${FN}?action=broadcast`, { method: "POST", body: JSON.stringify(body) });
}

export type ScopeKind = "workorder" | "submission";

// Find-or-create the chat thread tied to a work order / PAF and return it.
export function openScopedThread(
  scopeKind: ScopeKind,
  scopeRef: string,
): Promise<{ ok: true; threadId: string }> {
  return req(`${FN}?action=scoped`, {
    method: "POST",
    body: JSON.stringify({ scopeKind, scopeRef }),
  });
}

export function markThreadRead(threadId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=markRead`, {
    method: "POST",
    body: JSON.stringify({ threadId }),
  });
}
