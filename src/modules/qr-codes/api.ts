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

// Visual styling for a code (persisted as jsonb). All fields optional; the
// renderer falls back to sensible defaults so old rows render fine.
export interface QrStyle {
  shape?: "square" | "circle"; // overall QR shape
  dots?: "square" | "rounded" | "dots" | "classy" | "extra-rounded";
  corners?: "square" | "dot" | "extra-rounded";
  fg?: string; // foreground / dots color
  bg?: string; // background color
  gradient?: boolean; // linear gradient on the dots
  fg2?: string; // gradient end color
  // Caption frame — words around the QR (e.g. "SCAN ME"). Baked into the PNG.
  frame?: "none" | "label" | "border"; // label = caption bar; border = framed card + bar
  frameText?: string; // the words
  framePosition?: "top" | "bottom"; // which side the caption sits on
  frameColor?: string; // bar / border color (defaults to the dots color)
  frameTextColor?: string; // caption text color (defaults to white)
}

export interface QrCode {
  id: string;
  code: string;
  label: string;
  target_url: string;
  is_active: boolean;
  scan_count: number;
  style: QrStyle;
  logo_url: string | null; // center logo (a data URL or external URL)
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
export function updateQrCode(
  input: { id: string; label?: string; target_url?: string; style?: QrStyle; logo_url?: string | null },
): Promise<{ code: QrCode }> {
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
