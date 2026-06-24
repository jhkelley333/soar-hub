// KPI snapshot — client wrapper around the server-side proxy
// (netlify/functions/kpi-snapshot). The browser never sees the upstream token.
import { supabase } from "@/lib/supabase";
import type { KpiSnapshot } from "./types";

const FN = "/.netlify/functions/kpi-snapshot";

export async function fetchKpiSnapshot(): Promise<KpiSnapshot> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(FN, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as KpiSnapshot;
}
