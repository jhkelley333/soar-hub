// Client for the DO Playbook.
//
// Generation is slow (an LLM call that exceeds Netlify's 10s synchronous
// limit), so it runs in a background function. generatePlaybook() kicks that
// off and polls the cache-only `coach` read until the result lands.

import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/trait-playbook";
const FN_BG = "/.netlify/functions/trait-playbook-background";

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
  truncated?: boolean;
  coached_count?: number;
  team_count?: number;
}

export interface CoachResult {
  content: PlaybookContent;
  cached: boolean;
  generatedAt: string;
}

interface CoachRead {
  ready: boolean;
  content?: PlaybookContent;
  generatedAt?: string;
  empty?: boolean;
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

function readCoach(): Promise<CoachRead> {
  return request<CoachRead>(`${FN}?action=coach`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kick the background generator and poll the cache read until a NEW result
// appears. For a plain view (force=false) a cached result returns instantly.
export async function generatePlaybook(force = false): Promise<CoachResult> {
  const first = await readCoach();
  if (first.ready && first.content && !force) {
    return { content: first.content, cached: true, generatedAt: first.generatedAt ?? "" };
  }
  const prevAt = first.ready ? first.generatedAt : null;

  // Fire-and-forget: the background function returns 202 immediately.
  await fetch(FN_BG, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ force }) });

  // Poll for a fresh result (generatedAt must differ from any prior one).
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const c = await readCoach();
    if (c.ready && c.content && c.generatedAt !== prevAt) {
      return { content: c.content, cached: false, generatedAt: c.generatedAt ?? "" };
    }
  }
  throw new Error("The coaching is taking longer than usual to generate. Give it a moment and try again.");
}
