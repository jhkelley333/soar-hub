// Labor v2 — client wrappers around the admin-only labor-v2 function.
import { supabase } from "@/lib/supabase";
import type { LaborSummary } from "./types";

const FN = "/.netlify/functions/labor-v2";

async function req<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
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
