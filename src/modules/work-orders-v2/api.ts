// Client-side API wrappers for the facilities-v2 netlify function.
// Same Bearer-JWT pattern used by the rest of the app: pull the
// Supabase access token, inject it on every fetch.

import { supabase } from "@/lib/supabase";
import type {
  StatsResponse,
  TicketsResponse,
  UpdateTicketBody,
} from "./types";

const FN = "/.netlify/functions/facilities-v2";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(
      (body as { message?: string }).message ||
        `facilities-v2 ${res.status}`,
    );
  }
  return body as T;
}

export function fetchTickets(): Promise<TicketsResponse> {
  return request<TicketsResponse>(`${FN}?action=getTickets`);
}

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>(`${FN}?action=getStats`);
}

export function updateTicket(payload: UpdateTicketBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=updateTicket`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
