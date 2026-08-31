// MyHub issue tracker — client wrappers around the hub-tickets function.
import { supabase } from "@/lib/supabase";
import type { HubTicket, HubComment, HubKind, HubStatus } from "./types";

const FN = "/.netlify/functions/hub-tickets";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface BoardFilters { status?: HubStatus | ""; kind?: HubKind | ""; mine?: boolean }

export function listHubTickets(f: BoardFilters = {}): Promise<{ tickets: HubTicket[] }> {
  const qs = new URLSearchParams({ action: "list" });
  if (f.status) qs.set("status", f.status);
  if (f.kind) qs.set("kind", f.kind);
  if (f.mine) qs.set("mine", "1");
  return req(`${FN}?${qs.toString()}`);
}

export function getHubTicket(id: string): Promise<{ ticket: HubTicket; comments: HubComment[] }> {
  return req(`${FN}?action=get&id=${encodeURIComponent(id)}`);
}

export function createHubTicket(input: {
  kind: HubKind; title: string; description: string; page_path?: string; photo_path?: string | null;
}): Promise<{ ticket: HubTicket }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}

// Upload one photo for a ticket (before the ticket exists) via a signed URL,
// mirroring the store-visit pattern. Returns the stored path to attach on create.
export async function uploadHubPhoto(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const { token, path } = await req<{ upload_url: string; token: string; path: string }>(
    `${FN}?action=photo-upload-url`, { method: "POST", body: JSON.stringify({ ext }) },
  );
  const { error } = await supabase.storage.from("support-ticket-photos").uploadToSignedUrl(path, token, file);
  if (error) throw new Error(error.message);
  return path;
}

export function voteHubTicket(id: string): Promise<{ upvotes: number; my_vote: boolean }> {
  return req(`${FN}?action=vote`, { method: "POST", body: JSON.stringify({ id }) });
}

export function commentHubTicket(id: string, body: string, photo_path?: string | null): Promise<{ comment: HubComment }> {
  return req(`${FN}?action=comment`, { method: "POST", body: JSON.stringify({ id, body, photo_path: photo_path ?? undefined }) });
}

export function setHubTicketStatus(id: string, status: HubStatus, resolution_note?: string): Promise<{ ok: true; status: HubStatus }> {
  return req(`${FN}?action=set-status`, { method: "POST", body: JSON.stringify({ id, status, resolution_note }) });
}

export function hubMyUpdates(): Promise<{ count: number }> {
  return req(`${FN}?action=my-updates`);
}
