// Typed wrapper around netlify/functions/admin-view-as (session start/end
// for the admin "View As" read-only debugging mode).
import { supabase } from "@/lib/supabase";
import type { ViewAsTarget } from "./viewAs";

const FN = "/.netlify/functions/admin-view-as";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function startViewAs(targetUserId: string): Promise<{ ok: true; session_id: string; target: ViewAsTarget }> {
  return request(`${FN}?action=start`, { method: "POST", body: JSON.stringify({ targetUserId }) });
}
export function endViewAs(sessionId: string): Promise<{ ok: true }> {
  return request(`${FN}?action=end`, { method: "POST", body: JSON.stringify({ sessionId }) });
}
export interface ViewAsHistoryEntry {
  id: string;
  target_user_id: string;
  target_user_name: string | null;
  started_at: string;
  ended_at: string | null;
}
export function fetchViewAsHistory(): Promise<{ ok: true; sessions: ViewAsHistoryEntry[] }> {
  return request(`${FN}?action=history`);
}
