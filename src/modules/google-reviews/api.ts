// Google Reviews (Tier A) — client wrapper around the google-reviews function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/google-reviews";

async function req<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface WorstLocation { number: string; name: string; rating: number; count: number | null }
export interface ReviewRow {
  store: string; author: string; rating: number | null;
  body: string; review_time: string | null; relative_time: string | null;
}
export interface KeywordTag { word: string; count: number }
export interface TrendPoint { date: string; count: number; avg: number | null }
export interface ReviewSummary {
  overall: { avg: number; stores: number; total_reviews: number } | null;
  worst: WorstLocation[];
  recent: ReviewRow[];
  trend: TrendPoint[];
  keywords: { issues: KeywordTag[]; positive: KeywordTag[] };
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number; total: number } | null;
  coverage: { rated: number; with_place_id: number; total: number };
  configured: boolean;
}
export interface RefreshResult {
  refreshed: number; reviews_seen?: number; errors?: number; remaining?: number;
  total_with_place_id?: number; note?: string;
}

export function fetchReviewSummary(): Promise<ReviewSummary> {
  return req(`${FN}?action=summary`);
}
export function refreshReviews(limit = 20): Promise<RefreshResult> {
  return req(`${FN}?action=refresh&limit=${limit}`);
}

// Drain the whole queue: each call pulls a time-boxed batch (the server caps a
// single request to a few seconds), so loop until nothing is left stale. This
// is what makes the manual button pull EVERY site instead of ~20 at a time.
export async function refreshAllReviews(
  onProgress?: (done: number, remaining: number) => void,
): Promise<{ refreshed: number; reviews_seen: number; errors: number; note?: string }> {
  let refreshed = 0, reviews_seen = 0, errors = 0;
  let note: string | undefined;
  for (let i = 0; i < 60; i++) {
    const r = await refreshReviews(40);
    if (r.note && !r.refreshed) { note = r.note; break; }
    refreshed += r.refreshed ?? 0;
    reviews_seen += r.reviews_seen ?? 0;
    errors += r.errors ?? 0;
    const remaining = r.remaining ?? 0;
    onProgress?.(refreshed, remaining);
    if (!remaining) break;
    if (!(r.refreshed ?? 0)) break; // nothing progressed — avoid spinning
  }
  return { refreshed, reviews_seen, errors, note };
}
