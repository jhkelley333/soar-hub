import { supabase } from "@/lib/supabase";
import type {
  EcosureFilters,
  EcosureSummaryResp,
  EcosureStoreResp,
  EcosureOverdueResp,
} from "./types";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`/.netlify/functions/ecosure?${qs}`, {
    headers: await authHeader(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export function fetchEcosureSummary(filters: EcosureFilters = {}): Promise<EcosureSummaryResp> {
  const params: Record<string, string> = { action: "summary" };
  if (filters.region)   params.region   = filters.region;
  if (filters.area)     params.area     = filters.area;
  if (filters.district) params.district = filters.district;
  return apiFetch<EcosureSummaryResp>(params);
}

export function fetchEcosureStore(storeNumber: string): Promise<EcosureStoreResp> {
  return apiFetch<EcosureStoreResp>({ action: "store", storeNumber });
}

export function fetchEcosureOverdue(opts: { days?: number } & EcosureFilters = {}): Promise<EcosureOverdueResp> {
  const params: Record<string, string> = { action: "overdue" };
  if (opts.days)     params.days     = String(opts.days);
  if (opts.region)   params.region   = opts.region;
  if (opts.area)     params.area     = opts.area;
  if (opts.district) params.district = opts.district;
  return apiFetch<EcosureOverdueResp>(params);
}
