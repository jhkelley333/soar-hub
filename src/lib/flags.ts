// Feature-flag client. One round-trip per session to resolve every
// flag for the calling user, then a TanStack Query cache so every
// component that calls useFlag(key) shares the same response.
//
// The server returns the already-resolved boolean per key — clients
// never have to know about allowlists.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/feature-flags";

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  allowlist_stores: string[];
  allowlist_user_ids: string[];
  notes: string | null;
  updated_at: string;
  updated_by_id: string | null;
}

interface ResolveAllResponse {
  ok: true;
  flags: Record<string, boolean>;
}

async function authedFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  return body as T;
}

export function fetchResolvedFlags(): Promise<ResolveAllResponse> {
  return authedFetch<ResolveAllResponse>(`${FN}?action=resolveAll`);
}

// useFlag — true if the named flag is on for the calling user.
// Defaults to false during load / on error, so a missing flag never
// accidentally exposes gated code.
export function useFlag(key: string): boolean {
  const { data } = useQuery({
    queryKey: ["feature-flags"],
    queryFn: fetchResolvedFlags,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return !!data?.flags?.[key];
}

// Admin actions. Used by the feature-flags editor page only.

export interface UpsertFeatureFlagBody {
  key: string;
  enabled: boolean;
  allowlist_stores: string[];
  allowlist_user_ids: string[];
  notes: string | null;
}

export function listFeatureFlags(): Promise<{ ok: true; flags: FeatureFlagRow[] }> {
  return authedFetch<{ ok: true; flags: FeatureFlagRow[] }>(`${FN}?action=list`);
}

export function upsertFeatureFlag(
  payload: UpsertFeatureFlagBody,
): Promise<{ ok: true; flag: FeatureFlagRow }> {
  return authedFetch<{ ok: true; flag: FeatureFlagRow }>(`${FN}?action=upsert`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteFeatureFlag(key: string): Promise<{ ok: true }> {
  return authedFetch<{ ok: true }>(`${FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}
