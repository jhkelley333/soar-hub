import { supabase } from "@/lib/supabase";
import type { RapScoresResp, RapStoreResp, RapReviewsResp } from "./types";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const headers = await authHeader();
  const res = await fetch(`/.netlify/functions/rap-data?${qs}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export function fetchRapScores(scope: string): Promise<RapScoresResp> {
  return apiFetch<RapScoresResp>({ action: "scores", scope });
}

export function fetchRapStore(storeNumber: string): Promise<RapStoreResp> {
  return apiFetch<RapStoreResp>({ action: "store", storeNumber });
}

export function fetchRapReviews(opts: {
  store?: string;
  channel?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
}): Promise<RapReviewsResp> {
  const params: Record<string, string> = { action: "reviews" };
  if (opts.store) params.store = opts.store;
  if (opts.channel) params.channel = opts.channel;
  if (opts.from) params.from = opts.from;
  if (opts.to) params.to = opts.to;
  if (opts.q) params.q = opts.q;
  if (opts.page !== undefined) params.page = String(opts.page);
  return apiFetch<RapReviewsResp>(params);
}
