// Metric definitions registry — client for netlify/functions/metric-definitions.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/metric-definitions";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface MetricDefinition {
  key: string;
  label: string;
  definition: string;
  source: string | null;
  category: string | null;
  sort_order: number;
}

export function fetchDefinitions(): Promise<{ ok: true; definitions: MetricDefinition[] }> {
  return req(`${FN}?action=list`);
}
export function upsertDefinition(input: Partial<MetricDefinition> & { key: string; label: string; definition: string }): Promise<{ ok: true; definition: MetricDefinition }> {
  return req(`${FN}?action=upsert`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteDefinition(key: string): Promise<{ ok: true }> {
  return req(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ key }) });
}
