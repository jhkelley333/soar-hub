// Client wrappers around the access-link function — admin/VP/COO minting and
// revoking of standing "stay logged in" links.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/access-link";

export interface AccessLink {
  id: string;
  token: string;
  user_id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  user_name: string;
  user_email: string | null;
  user_role: string | null;
}

export interface AccessCandidate {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
}

export interface AccessLinkList {
  links: AccessLink[];
  users: AccessCandidate[];
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await authToken();
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchAccessLinks(): Promise<AccessLinkList> {
  return req<AccessLinkList>(`${FN}?action=list`);
}

export function mintAccessLink(input: { user_id: string; label?: string }): Promise<{ token: string; id: string; reused: boolean }> {
  return req(`${FN}`, { method: "POST", body: JSON.stringify({ action: "mint", ...input }) });
}

export function revokeAccessLink(id: string): Promise<{ ok: true }> {
  return req(`${FN}`, { method: "POST", body: JSON.stringify({ action: "revoke", id }) });
}
