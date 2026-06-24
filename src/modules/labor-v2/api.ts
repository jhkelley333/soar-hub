// Labor v2 — client wrappers around the labor-v2 function (admin rollup +
// the GM day view).
import { supabase } from "@/lib/supabase";
import type { GmLaborResponse, LaborStore, ReviewInput } from "@/modules/labor/types";
import type { LaborSummary, TeamLaborResponse } from "./types";

const FN = "/.netlify/functions/labor-v2";

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

export function fetchLaborSummary(opts?: { date?: string; refresh?: boolean }): Promise<LaborSummary> {
  const p = new URLSearchParams({ action: "summary" });
  if (opts?.date) p.set("date", opts.date);
  if (opts?.refresh) p.set("refresh", "1");
  return req(`${FN}?${p.toString()}`);
}

export function fetchLaborDates(): Promise<{ dates: string[] }> {
  return req(`${FN}?action=dates`);
}

// ── Leadership "Team labor" rollup (drill Region → Market → District → Store) ─
export function fetchLaborV2Team(date?: string): Promise<TeamLaborResponse> {
  const p = new URLSearchParams({ action: "team" });
  if (date) p.set("date", date);
  return req(`${FN}?${p.toString()}`);
}

// ── GM day view ──────────────────────────────────────────────────────
export function fetchLaborV2Stores(): Promise<{ stores: LaborStore[] }> {
  return req(`${FN}?action=my-stores`);
}

export function fetchLaborV2Gm(store: string, date?: string): Promise<GmLaborResponse> {
  const p = new URLSearchParams({ action: "gm", store });
  if (date) p.set("date", date);
  return req(`${FN}?${p.toString()}`);
}

export function saveLaborV2Review(input: ReviewInput): Promise<{ ok: true; review: { id: string; note: string } }> {
  return req(`${FN}?action=review`, { method: "POST", body: JSON.stringify(input) });
}
