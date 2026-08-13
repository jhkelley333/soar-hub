// Store changeover checklists — typed client for the changeover function.
import { supabase } from "@/lib/supabase";
import type { ChangeoverKind } from "./templates";

const FN = "/.netlify/functions/changeover";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type ChangeoverStatus = "open" | "in_progress" | "complete";

export interface ChangeoverListRow {
  id: string;
  kind: ChangeoverKind;
  store_number: string | null;
  store_name: string | null;
  outgoing_name: string | null;
  incoming_name: string | null;
  status: ChangeoverStatus;
  checked_count: number;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
export interface ItemProgress {
  checked: boolean;
  checked_at: string | null;
  note: string | null;
  checked_by_name: string | null;
}
export interface ChangeoverDetail extends ChangeoverListRow {
  notes: string | null;
  progress: Record<string, ItemProgress>;
}

export function fetchChangeovers(): Promise<{ rows: ChangeoverListRow[]; can_create: { do: boolean; gm: boolean } }> {
  return req(`${FN}?action=list`);
}
export function fetchChangeover(id: string): Promise<{ checklist: ChangeoverDetail; can_edit: boolean }> {
  return req(`${FN}?action=get&id=${encodeURIComponent(id)}`);
}
export function createChangeover(input: {
  kind: ChangeoverKind; store_number: string; outgoing_name?: string; incoming_name?: string; assigned_email?: string;
}): Promise<{ ok: true; id: string }> {
  return req(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}
export function updateChangeover(id: string, patch: {
  status?: ChangeoverStatus; notes?: string; outgoing_name?: string; incoming_name?: string; assigned_email?: string;
}): Promise<{ ok: true }> {
  return req(`${FN}?action=update`, { method: "POST", body: JSON.stringify({ id, ...patch }) });
}
export function updateChangeoverItem(id: string, item_key: string, patch: { checked?: boolean; note?: string }): Promise<{ ok: true; item_key: string; status: ChangeoverStatus }> {
  return req(`${FN}?action=update-item`, { method: "POST", body: JSON.stringify({ id, item_key, ...patch }) });
}
export function deleteChangeover(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
}
