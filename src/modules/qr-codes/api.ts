// Dynamic QR codes — client data access. All reads/writes go through the
// service-role `qr` Netlify function (the table is RLS-locked); the public
// redirect lives at /q/<code>, served by qr-redirect.js.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/qr";

async function qrFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface QrCode {
  id: string;
  code: string;
  label: string;
  target_url: string;
  is_active: boolean;
  scan_count: number;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export function listQrCodes(): Promise<{ codes: QrCode[] }> {
  return qrFetch(`${FN}?action=list`);
}
export function createQrCode(input: { label: string; target_url: string }): Promise<{ code: QrCode }> {
  return qrFetch(`${FN}?action=create`, { method: "POST", body: JSON.stringify(input) });
}
export function updateQrCode(input: { id: string; label?: string; target_url?: string }): Promise<{ code: QrCode }> {
  return qrFetch(`${FN}?action=update`, { method: "POST", body: JSON.stringify(input) });
}
export function setQrActive(id: string, is_active: boolean): Promise<{ code: QrCode }> {
  return qrFetch(`${FN}?action=toggle`, { method: "POST", body: JSON.stringify({ id, is_active }) });
}
export function deleteQrCode(id: string): Promise<{ ok: true }> {
  return qrFetch(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
}

// The stable URL the QR encodes — resolved on the current origin so it works
// in every environment (the /q/* rewrite lives on the same Netlify site).
export function publicQrUrl(code: string): string {
  return `${window.location.origin}/q/${code}`;
}
