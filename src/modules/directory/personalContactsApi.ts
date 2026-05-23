// Typed wrapper around netlify/functions/personal-contacts.js.
// Per-user private contacts. RLS (0073) keeps these owner-only.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/personal-contacts";

export interface PersonalContact {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonalContactInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  notes?: string | null;
  photo_url?: string | null;
}

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

export function listPersonalContacts(): Promise<{ contacts: PersonalContact[] }> {
  return request(`${FN}?action=list`);
}

export function createPersonalContact(
  input: PersonalContactInput,
): Promise<{ contact: PersonalContact }> {
  return request(`${FN}?action=create`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePersonalContact(
  id: string,
  patch: Partial<PersonalContactInput>,
): Promise<{ contact: PersonalContact }> {
  return request(`${FN}?action=update`, {
    method: "POST",
    body: JSON.stringify({ id, ...patch }),
  });
}

export function deletePersonalContact(id: string): Promise<{ ok: true }> {
  return request(`${FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}
