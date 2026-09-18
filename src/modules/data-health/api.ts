import { supabase } from "@/lib/supabase";
import { refreshAccessTokenOnce } from "@/lib/authRefresh";

const FN = "/.netlify/functions/data-health";

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

async function req<T>(params: Record<string, string>): Promise<T> {
  const p = new URLSearchParams(params);
  const call = (token: string) =>
    fetch(`${FN}?${p.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  let res = await call(await authToken());
  if (res.status === 401) {
    const fresh = await refreshAccessTokenOnce();
    if (fresh) res = await call(fresh);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface DataStream {
  name: string;
  label: string;
  description: string;
  first_date: string | null;
  last_date: string | null;
  total_rows: number;
}

export interface CoverageDay {
  date: string;
  store_count: number;
}

export interface PullLogEntry {
  id: string;
  created_at: string;
  source: string;
  ok: boolean;
  business_date: string | null;
  store_rows: number | null;
  wtd_rows: number | null;
  kpi_snapshot: boolean | null;
  duration_ms: number | null;
  error: string | null;
}

export interface OverviewResponse {
  streams: DataStream[];
  coverage: CoverageDay[];
  pull_log: PullLogEntry[];
  total_stores: number;
}

export interface MissingStore {
  number: string;
  name: string | null;
}

export interface IncompleteRow {
  store_number: string;
  missing_fields: string[];
}

export interface CoverageDetailResponse {
  date: string;
  present_count: number;
  total_stores: number;
  missing: MissingStore[];
  incomplete: IncompleteRow[];
  pulls_for_date: PullLogEntry[];
}

export function fetchDataHealthOverview(): Promise<OverviewResponse> {
  return req({ action: "overview" });
}

export function fetchCoverageDetail(date: string): Promise<CoverageDetailResponse> {
  return req({ action: "coverage-detail", date });
}
