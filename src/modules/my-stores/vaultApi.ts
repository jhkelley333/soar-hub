// Per-store password vault — typed client for the store-vault function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/store-vault";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface VaultEntry {
  id: string;
  label: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  has_password: boolean;
  updated_by_name: string | null;
  updated_at: string;
}

export function fetchVault(storeNumber: string): Promise<{ rows: VaultEntry[]; key_configured: boolean }> {
  return req(`${FN}?action=list&store=${encodeURIComponent(storeNumber)}`);
}
export function revealVaultPassword(id: string): Promise<{ password: string }> {
  return req(`${FN}?action=reveal&id=${encodeURIComponent(id)}`);
}
export function saveVaultEntry(input: {
  id?: string; store_number: string; label: string; username?: string; password?: string; url?: string; notes?: string;
}): Promise<{ ok: true; id: string }> {
  return req(`${FN}?action=save`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteVaultEntry(id: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });
}
