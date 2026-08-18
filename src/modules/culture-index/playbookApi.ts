// Client for netlify/functions/trait-playbook — the DO Playbook.

import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/trait-playbook";

export interface PlaybookMember {
  id: string;
  name: string;
  role: UserRole;
  trait: string;
  store_number: string | null;
  store_name: string | null;
  coaching?: string;
}

export interface TeamResponse {
  leader: { id: string; name: string; role: UserRole };
  members: PlaybookMember[];
  has_playbook: boolean;
}

export interface PlaybookContent {
  overview: string;
  dynamics: string;
  actions: string[];
  members: PlaybookMember[];
}

export interface CoachResponse {
  ok: boolean;
  content: PlaybookContent;
  cached: boolean;
  generatedAt: string;
  model: string | null;
}

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

export function fetchTeam(): Promise<TeamResponse> {
  return request<TeamResponse>(`${FN}?action=team`);
}

export function generatePlaybook(force = false): Promise<CoachResponse> {
  return request<CoachResponse>(`${FN}?action=coach`, {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}
