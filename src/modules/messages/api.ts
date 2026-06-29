// Store message board — client data access. All reads/writes go through the
// service-role `store-messages` Netlify function (the tables are RLS-locked).
import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/store-messages";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export interface MessageLink {
  label: string;
  url: string;       // external https URL or an internal app path (/qsr/course/…)
  training?: boolean;
}

export interface StoreMessage {
  id: string;
  author_id: string | null;
  author_name: string | null;
  store_numbers: string[];
  audience_roles: UserRole[];
  title: string;
  body: string;
  attachments: MessageAttachment[];
  links: MessageLink[];
  is_pinned: boolean;
  /** ISO timestamp when the message auto-hides; null = no expiry. */
  expires_at: string | null;
  created_at: string;
  edited_at: string | null;
  read_count: number;
  /** Total audience size for this message (active profiles whose role + store match). */
  recipient_count: number;
  has_read: boolean;
  can_manage: boolean;
}

export interface MessageReader {
  user_id: string;
  user_name: string | null;
  read_at: string;
}

/**
 * "live"    — active, not-yet-expired posts. Default board view.
 * "archive" — deleted (is_active=false) OR expired posts, same visibility rules.
 */
export type MessageBoardView = "live" | "archive";
export function listMessages(
  view: MessageBoardView = "live",
): Promise<{ messages: StoreMessage[]; canPost: boolean }> {
  return req(`${FN}?action=list&view=${view}`);
}

export interface CreateMessageInput {
  title: string;
  body: string;
  audienceRoles: UserRole[];
  storeNumbers?: string[];
  attachments?: { data: string; name: string; type: string }[];
  links?: MessageLink[];
  isPinned?: boolean;
  /** Active for N days from posting (1..365). Omit or null = no auto-expiry. */
  daysActive?: number | null;
}
export function createMessage(input: CreateMessageInput): Promise<{ message: StoreMessage }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}

export interface UpdateMessageInput {
  id: string;
  title?: string;
  body?: string;
  audienceRoles?: UserRole[];
  links?: MessageLink[];
  isPinned?: boolean;
  attachments?: { data: string; name: string; type: string }[];
  removeAttachmentUrls?: string[];
  /** number = reset the countdown from now; null = clear (no expiry); undefined = no change. */
  daysActive?: number | null;
}
export function updateMessage(input: UpdateMessageInput): Promise<{ message: StoreMessage }> {
  return req(`${FN}?action=update`, { method: "POST", body: JSON.stringify(input) });
}

export function markMessageRead(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=markRead`, { method: "POST", body: JSON.stringify({ id }) });
}

export function fetchReaders(id: string): Promise<{ readers: MessageReader[]; recipientCount: number }> {
  return req(`${FN}?action=readers&id=${encodeURIComponent(id)}`);
}

export function deleteMessage(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
}

// Read a File as base64 (no data: prefix) for the JSON upload body.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Couldn't read file"));
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") { reject(new Error("Couldn't read file")); return; }
      const comma = r.indexOf(",");
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(file);
  });
}
