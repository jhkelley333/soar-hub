// User Activity — client wrappers around the user-activity function.
// Mirrors the Bearer-JWT auth pattern used across the admin modules.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/user-activity";

async function req<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface UserActivityRow {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  last_seen_at: string | null;
  last_path: string | null;
  last_sign_in_at: string | null;
}

export interface ActivityFeedRow {
  source: string;
  actor: string;
  action: string;
  at: string;
}

export function fetchUserActivity(): Promise<{ users: UserActivityRow[] }> {
  return req(`${FN}?action=list`);
}

export function fetchActivityFeed(limit = 50): Promise<{ feed: ActivityFeedRow[] }> {
  return req(`${FN}?action=feed&limit=${limit}`);
}
