// Chat — typed client wrappers around netlify/functions/chat. Each call
// passes the caller's Supabase access token so the function can verify
// the JWT and resolve the profile.

import { supabase } from "@/lib/supabase";
import { viewAsHeaders } from "@/lib/viewAs";
import type { ChatThread, ChatMessage } from "./types";

const FN = "/.netlify/functions/chat";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  // Admin "View As" (read-only) — see src/lib/viewAs.ts. No-op unless a
  // session is active; the backend rejects any POST that carries it.
  return { Authorization: `Bearer ${token}`, ...viewAsHeaders() };
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

export function fetchInbox(opts?: { archived?: boolean }): Promise<InboxResponse> {
  return req<InboxResponse>(`${FN}?action=inbox${opts?.archived ? "&archived=1" : ""}`);
}

export function fetchThread(threadId: string): Promise<ThreadResponse> {
  return req<ThreadResponse>(`${FN}?action=thread&threadId=${encodeURIComponent(threadId)}`);
}

export function fetchContacts(): Promise<{ ok: true; contacts: ChatContact[] }> {
  return req<{ ok: true; contacts: ChatContact[] }>(`${FN}?action=contacts`);
}

export interface AttachmentInput {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface SendMessageResult {
  ok: true;
  emailed: boolean;
  emailReason: string | null;
}

export function sendChatMessage(
  threadId: string,
  text: string,
  attachments?: AttachmentInput[],
  copyMe?: boolean,
): Promise<SendMessageResult> {
  return req(`${FN}?action=send`, {
    method: "POST",
    body: JSON.stringify({ threadId, text, attachments: attachments ?? [], copyMe: !!copyMe }),
  });
}

// Soft-delete a message. The sender can delete their own; thread owners and
// admins can delete anyone's. Server clears it from the unread counts so the
// recipient's notification badge drops on the next inbox sync.
export function deleteChatMessage(messageId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=deleteMessage`, {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
}

const CHAT_BUCKET = "chat-attachments";

export function isImageMime(mime: string): boolean {
  return /^image\//.test(mime);
}

// Upload a file to the thread's storage folder and return its metadata.
export async function uploadChatAttachment(
  threadId: string,
  file: File,
): Promise<AttachmentInput> {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${threadId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(error.message || "Upload failed");
  return { path, name: file.name, mime: file.type || "", size: file.size };
}

// Short-lived signed URL for rendering / downloading an attachment.
export async function signChatAttachment(path: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Couldn't sign URL");
  return data.signedUrl;
}

export interface ThreadAttachment {
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  uploadedBy: string | null;
  at: string;
}

export function fetchAttachments(threadId: string): Promise<{ ok: true; attachments: ThreadAttachment[] }> {
  return req(`${FN}?action=attachments&threadId=${encodeURIComponent(threadId)}`);
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

export interface ManagedOption {
  scopeType: string;
  scopeId: string | null;
  targetRole: string;
  label: string;
  count: number;
}

// The "team chat" managed groups the caller is allowed to create.
export function fetchManagedOptions(): Promise<{ ok: true; options: ManagedOption[] }> {
  return req(`${FN}?action=managedOptions`);
}

export function createManagedGroup(body: {
  scopeType: string;
  scopeId: string | null;
  targetRole: string;
  title?: string;
}): Promise<{ ok: true; threadId: string; existed?: boolean }> {
  return req(`${FN}?action=createManaged`, { method: "POST", body: JSON.stringify(body) });
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

export interface PafUnreadEntry {
  threadId: string;
  unread: number;
}

// Bulk "does this PAF's discussion have anything unread for me" lookup for
// list rows (bell badge) — one call for the whole page instead of N.
export function fetchPafUnread(pafIds: string[]): Promise<{ ok: true; byPaf: Record<string, PafUnreadEntry> }> {
  if (!pafIds.length) return Promise.resolve({ ok: true, byPaf: {} });
  return req(`${FN}?action=pafUnread&ids=${encodeURIComponent(pafIds.join(","))}`);
}

export interface GroupMemberProfile {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  role: string;
  primary_store_id: string | null;
  is_active: boolean;
  birthday: string | null;
  show_birthday: boolean;
  profile_photo_url: string | null;
}

export interface GroupMember {
  userId: string;
  name: string;
  initials: string;
  threadRole: "owner" | "admin" | "member";
  orgRole: string;
  storeNumber: string | null;
  joinedAt: string | null;
  phone: string | null;
  profile: GroupMemberProfile | null;
}

export interface GroupInfoResponse {
  ok: true;
  thread: {
    id: string;
    kind: ChatThread["kind"];
    title: string;
    description: string;
    external: boolean;
    managed: boolean;
    createdByName: string | null;
    avatarUrl: string | null;
    permSend: "everyone" | "admins";
    permAdd: "everyone" | "admins";
    permEdit: "everyone" | "admins";
    archived: boolean;
    myRole: "owner" | "admin" | "member";
    muted: boolean;
  };
  members: GroupMember[];
  adminsCount: number;
}

// Per-user archive — hides/shows the thread in only the caller's inbox
// (auto-resurfaces on a newer message). Distinct from archiveThread, which
// is the global owner/admin archive.
export function setThreadArchived(threadId: string, archived: boolean): Promise<{ ok: true }> {
  return req(`${FN}?action=setArchived`, {
    method: "POST",
    body: JSON.stringify({ threadId, archived }),
  });
}

export function archiveThread(threadId: string, archived: boolean): Promise<{ ok: true }> {
  return req(`${FN}?action=archiveThread`, {
    method: "POST",
    body: JSON.stringify({ threadId, archived }),
  });
}

export function deleteThread(threadId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=deleteThread`, { method: "POST", body: JSON.stringify({ threadId }) });
}

export function updatePermissions(body: {
  threadId: string;
  permSend?: "everyone" | "admins";
  permAdd?: "everyone" | "admins";
  permEdit?: "everyone" | "admins";
}): Promise<{ ok: true }> {
  return req(`${FN}?action=updatePermissions`, { method: "POST", body: JSON.stringify(body) });
}

export function updateGroup(body: {
  threadId: string;
  title?: string;
  description?: string;
  avatarUrl?: string;
}): Promise<{ ok: true }> {
  return req(`${FN}?action=updateGroup`, { method: "POST", body: JSON.stringify(body) });
}

const CHAT_AVATAR_BUCKET = "chat-avatars";

// Upload a group photo and return its public URL.
export async function uploadGroupAvatar(threadId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const path = `${threadId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(CHAT_AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw new Error(error.message || "Upload failed");
  const { data } = supabase.storage.from(CHAT_AVATAR_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function fetchGroupInfo(threadId: string): Promise<GroupInfoResponse> {
  return req(`${FN}?action=groupInfo&threadId=${encodeURIComponent(threadId)}`);
}

export function setThreadMute(threadId: string, muted: boolean): Promise<{ ok: true }> {
  return req(`${FN}?action=setMute`, { method: "POST", body: JSON.stringify({ threadId, muted }) });
}

export function leaveThread(threadId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=leave`, { method: "POST", body: JSON.stringify({ threadId }) });
}

export function setMemberRole(
  threadId: string,
  userId: string,
  role: "admin" | "member",
): Promise<{ ok: true }> {
  return req(`${FN}?action=setMemberRole`, {
    method: "POST",
    body: JSON.stringify({ threadId, userId, role }),
  });
}

export function removeMember(threadId: string, userId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=removeMember`, {
    method: "POST",
    body: JSON.stringify({ threadId, userId }),
  });
}

export function addMembers(threadId: string, userIds: string[]): Promise<{ ok: true; added: number }> {
  return req(`${FN}?action=addMembers`, {
    method: "POST",
    body: JSON.stringify({ threadId, userIds }),
  });
}

export function markThreadRead(threadId: string): Promise<{ ok: true }> {
  return req(`${FN}?action=markRead`, {
    method: "POST",
    body: JSON.stringify({ threadId }),
  });
}
