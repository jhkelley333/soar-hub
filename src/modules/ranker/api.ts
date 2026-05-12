// Ranker — client-side fetch wrappers. Each call injects the caller's
// Supabase access token in the Authorization header so the netlify
// function can verify the JWT and look up the profile + scope.

import { supabase } from "@/lib/supabase";
import type {
  AISummaryResponse,
  InitResponse,
  StoreDashboardResponse,
  WarRoomResponse,
} from "./types";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated.");
  return { Authorization: `Bearer ${token}` };
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  let body: { ok?: boolean; message?: string } & Partial<T>;
  try {
    body = (await res.json()) as never;
  } catch {
    throw new Error(`Ranker API ${res.status} (non-JSON response)`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || `Ranker API ${res.status}`);
  }
  return body as T;
}

export function fetchInit(): Promise<InitResponse> {
  return fetchJson<InitResponse>(
    "/.netlify/functions/ranker?action=getInit",
  );
}

export function fetchWarRoom(week: string): Promise<WarRoomResponse> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getWarRoom");
  u.searchParams.set("week", week);
  return fetchJson<WarRoomResponse>(u.pathname + u.search);
}

export function fetchStoreDashboard(args: {
  week: string;
  store: string;
  peerStore?: string;
  trendWeeks: number;
}): Promise<StoreDashboardResponse> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getStoreDashboard");
  u.searchParams.set("week", args.week);
  u.searchParams.set("store", args.store);
  if (args.peerStore) u.searchParams.set("peerStore", args.peerStore);
  u.searchParams.set("trendWeeks", String(args.trendWeeks));
  return fetchJson<StoreDashboardResponse>(u.pathname + u.search);
}

export function generateAISummary(args: {
  store: string;
  week: number;
  force?: boolean;
}): Promise<AISummaryResponse> {
  return fetchJson<AISummaryResponse>(
    "/.netlify/functions/ranker-summary",
    {
      method: "POST",
      body: JSON.stringify({
        store: args.store,
        week: args.week,
        force: !!args.force,
      }),
    },
  );
}
