// Typed wrappers around netlify/functions/org.

import { supabase } from "@/lib/supabase";
import type { BirthdayEntry, MyTreeResponse } from "./types";

const FN = "/.netlify/functions/org";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(path, { headers });
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

export function fetchMyTree(): Promise<MyTreeResponse> {
  return request<MyTreeResponse>(`${FN}?action=my-tree`);
}

export function fetchBirthdays(start: string, end: string): Promise<{ entries: BirthdayEntry[] }> {
  return request<{ entries: BirthdayEntry[] }>(
    `${FN}?action=birthdays&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
}
