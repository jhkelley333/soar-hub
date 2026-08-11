// Hours of Operation — typed client for the store-hours function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/store-hours";

export interface DayHours {
  day_of_week: number;      // 0=Mon .. 6=Sun
  is_closed: boolean;
  open: string | null;      // "HH:MM" (24h) or null
  close: string | null;
}
export interface HoursGridStore {
  id: string;
  number: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  days: (DayHours | null)[]; // length 7, null = not set for that day
  configured: boolean;       // any day set
  upcoming_special: number;  // count of future special-hours overrides
}
export interface SpecialHours {
  id: string;
  date: string;             // YYYY-MM-DD
  is_closed: boolean;
  open: string | null;
  close: string | null;
  note: string;
}
export interface StoreHoursDetail {
  store: { id: string; number: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null };
  standard: DayHours[];     // length 7
  special: SpecialHours[];
  updated_at: string | null;
}

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

export function fetchHoursGrid(): Promise<{ stores: HoursGridStore[] }> {
  return request(`${FN}?action=list`);
}
export function fetchStoreHours(storeNumber: string): Promise<StoreHoursDetail> {
  return request(`${FN}?action=get&store=${encodeURIComponent(storeNumber)}`);
}
export function saveStandardHours(storeId: string, days: DayHours[]): Promise<{ ok: boolean }> {
  return request(`${FN}?action=save-standard`, { method: "POST", body: JSON.stringify({ store_id: storeId, days }) });
}
export function saveSpecialHours(storeId: string, s: { date: string; is_closed: boolean; open: string | null; close: string | null; note: string }): Promise<{ ok: boolean }> {
  return request(`${FN}?action=save-special`, { method: "POST", body: JSON.stringify({ store_id: storeId, ...s }) });
}
export function deleteSpecialHours(id: string): Promise<{ ok: boolean }> {
  return request(`${FN}?action=delete-special`, { method: "POST", body: JSON.stringify({ id }) });
}
