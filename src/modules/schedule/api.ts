// Typed wrappers around netlify/functions/schedule.

import { supabase } from "@/lib/supabase";
import type {
  CalendarsResponse,
  EventInput,
  LinkCalendarInput,
  LinkedCalendar,
  ScheduleEvent,
  ScheduleListResponse,
  StoresResponse,
} from "./types";

const FN = "/.netlify/functions/schedule";

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
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchEvents(from: string, to: string): Promise<ScheduleListResponse> {
  return request<ScheduleListResponse>(
    `${FN}?action=list&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

export function fetchScheduleStores(): Promise<StoresResponse> {
  return request<StoresResponse>(`${FN}?action=stores`);
}

export function createEvent(input: EventInput): Promise<{ ok: true; event: ScheduleEvent }> {
  return request(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}

export function updateEvent(input: EventInput): Promise<{ ok: true; event: ScheduleEvent }> {
  return request(`${FN}?action=update`, { method: "POST", body: JSON.stringify(input) });
}

export function deleteEvent(
  id: string,
  opts?: { mode?: "all" | "occurrence" | "following"; occurrenceDate?: string }
): Promise<{ ok: true }> {
  return request(`${FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ id, mode: opts?.mode, occurrence_date: opts?.occurrenceDate }),
  });
}

// ── Linked (external) calendars ───────────────────────────────────────────
export function fetchCalendars(): Promise<CalendarsResponse> {
  return request<CalendarsResponse>(`${FN}?action=calendars`);
}
export function linkCalendar(input: LinkCalendarInput): Promise<{ ok: true; calendar: LinkedCalendar }> {
  return request(`${FN}?action=link-calendar`, { method: "POST", body: JSON.stringify(input) });
}
export function updateCalendar(
  input: { id: string; label?: string; url?: string; color?: string; is_enabled?: boolean }
): Promise<{ ok: true; calendar: LinkedCalendar }> {
  return request(`${FN}?action=update-calendar`, { method: "POST", body: JSON.stringify(input) });
}
export function unlinkCalendar(id: string): Promise<{ ok: true }> {
  return request(`${FN}?action=unlink-calendar`, { method: "POST", body: JSON.stringify({ id }) });
}
