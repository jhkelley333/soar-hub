// Typed wrapper around netlify/functions/personal-contacts.js.
// Per-user private contacts. RLS (0073) keeps these owner-only.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/personal-contacts";

const PHOTO_BUCKET = "personal-contact-photos";
export const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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

// ----------------------------------------------------------------------------
// Photo upload — direct to Supabase Storage (owner-only bucket from 0074).
// Returns the public URL to store in photo_url. Path is keyed by a fresh
// UUID under the caller's uid folder so it works for both create + edit
// without needing the contact id first.
// ----------------------------------------------------------------------------

export async function uploadPersonalContactPhoto(file: File): Promise<string> {
  if (!PHOTO_MIME.includes(file.type)) {
    throw new Error("Photo must be JPG, PNG, or WEBP.");
  }
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error("Photo must be 5 MB or smaller.");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  // Cache-bust so a replaced photo refreshes immediately in <img>.
  return `${pub.publicUrl}?v=${Date.now()}`;
}
