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
  region: string | null;
  store_number: string | null;
  store_name: string | null;
  coaching?: string;
}

export interface TeamResponse {
  leader: { id: string; name: string; role: UserRole };
  members: PlaybookMember[];
  regions: string[];
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

export type RunStatus = "running" | "done" | "error";

export interface PlaybookProgress {
  total: number;
  coached: number;
  status: RunStatus;
}

export interface CoachResult {
  content: PlaybookContent;
  cached: boolean;
  generatedAt: string;
}

interface CoachRead {
  ready: boolean;
  status?: RunStatus;
  error?: string | null;
  progress?: PlaybookProgress;
  content?: PlaybookContent;
  generatedAt?: string;
  empty?: boolean;
}

// A live progress tick during generation: how far along, and the partial
// coaching committed so far (members fill in as their batch lands).
export interface GenerationTick {
  progress: PlaybookProgress;
  content: PlaybookContent;
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

function readCoach(region: string): Promise<CoachRead> {
  const q = region ? `&region=${encodeURIComponent(region)}` : "";
  return request<CoachRead>(`${FN}?action=coach${q}`);
}

// Read a saved playbook for a region without triggering generation. Null if
// none is cached yet.
export async function fetchCachedPlaybook(region = ""): Promise<CoachResult | null> {
  const c = await readCoach(region);
  if (c.ready && c.content) return { content: c.content, cached: true, generatedAt: c.generatedAt ?? "" };
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kick the background generator and poll until the run completes. Generation is
// chunked, so `onTick` fires each poll with live progress + the partial coaching
// committed so far. For a plain view (force=false) a completed run returns
// instantly. `region` narrows generation to one region (recommended for large
// downlines). Throws if the run ends in an error state or never finishes.
export async function generatePlaybook(
  force = false,
  region = "",
  onTick?: (t: GenerationTick) => void,
): Promise<CoachResult> {
  const first = await readCoach(region);
  if (first.ready && first.content && !force) {
    return { content: first.content, cached: true, generatedAt: first.generatedAt ?? "" };
  }
  const prevAt = first.ready ? first.generatedAt : null;

  // Fire-and-forget: the background function returns 202 immediately.
  await fetch(FN_BG, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ force, region: region || null }) });

  // Poll until a fresh completed run appears. The run passes through 'running'
  // (surfaced as progress) before 'done'. A batch failure lands the run in
  // 'error' with partial work saved — retrying resumes it.
  let sawRunning = false;
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const c = await readCoach(region);
    if (c.progress && c.content && onTick) onTick({ progress: c.progress, content: c.content });
    if (c.status === "running") { sawRunning = true; continue; }
    if (c.ready && c.content && c.generatedAt !== prevAt) {
      return { content: c.content, cached: false, generatedAt: c.generatedAt ?? "" };
    }
    // Terminal error — but only trust it once this run has actually started, so
    // we don't trip on a stale 'error' row from a previous attempt.
    if (c.status === "error" && sawRunning) {
      throw new Error(c.error || "Generation didn't finish. Try again to resume where it left off.");
    }
  }
  throw new Error("The coaching is taking longer than usual to generate. Give it a moment and try again.");
}
